// src/http/routes/realtime.routes.ts
import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders } from '#/infra/db/schema'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { SessionService } from '#/domain/auth/session.service'
import { asOrderId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import { requireAuth } from '#/http/hooks/require-auth'

const encoder = new TextEncoder()
const sseChunk = (event: string, data: unknown): Uint8Array =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

// ── phase-1: کانال‌های مجاز (سفت‌تر از قبل) ──
// demo:* (تست) | orders:new (پنل) | orders:{displayId یا uuid} (ردیابی)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DISPLAY_RE = /^ord-[a-z0-9]{8}$/
const CHANNEL_RE =
  /^(demo:[A-Za-z0-9_-]{1,40}|orders:new|orders:(ord-[a-z0-9]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/

const HEARTBEAT_MS = 15_000
const MAX_QUEUE = 128 // سقف صفِ هر اتصال — بک‌پرشر: بیشتر نشود، قدیمی‌ترین می‌افتد

export interface RealtimeDeps {
  hub: SseHub
  sessions: SessionService
  db: Db // ← phase-1: برای auth مالکیت orders:{id}
}

/** phase-1 — قواعد دسترسی به کانال‌ها (قبلاً فقط «لاگین‌شده» کافی بود!) */
async function authorizeChannel(
  deps: RealtimeDeps,
  channel: string,
  user: { id: string; role: string },
): Promise<void> {
  if (channel.startsWith('demo:')) return

  if (channel === 'orders:new') {
    if (user.role !== 'admin' && user.role !== 'admin2') {
      throw Err.forbidden('کانال سفارش‌های زنده فقط برای پنل مدیریت است.')
    }
    return
  }

  // orders:{displayId | uuid}
  if (user.role === 'admin' || user.role === 'admin2') return
  const target = channel.slice('orders:'.length)
  // فرمت را قبل از کوئری چک کن — eq روی uuid با مقدار نامعتبر یعنی خطای PG
  const row = DISPLAY_RE.test(target)
    ? await deps.db
      .select({ userId: orders.userId })
      .from(orders)
      .where(eq(orders.displayId, target))
      .limit(1)
      .then((r) => r[0])
    : UUID_RE.test(target)
      ? await deps.db
        .select({ userId: orders.userId })
        .from(orders)
        .where(eq(orders.id, asOrderId(target)))
        .limit(1)
        .then((r) => r[0])
      : undefined
  if (!row || row.userId !== user.id) throw Err.forbidden('این کانال مال شما نیست.')
}

export const realtimeRoutes = (deps: RealtimeDeps) =>
  new Elysia({ prefix: '/realtime', tags: ['Realtime'] })
    .use(requireAuth(deps.sessions))
    .get(
      '/stream',
      async ({ set, query, request, server, user }) => {
        const channel = query.channel ?? 'demo'
        if (!CHANNEL_RE.test(channel)) throw Err.forbidden('کانال مجاز نیست.')
        await authorizeChannel(deps, channel, user)

        set.headers['content-type'] = 'text/event-stream'
        set.headers['cache-control'] = 'no-cache'
        set.headers['x-accel-buffering'] = 'no'

        // phase-1: Bun اتصال idle را به‌صورت پیش‌فرض (~۱۰s) می‌بندد — برای SSE خاموشش کن
        // (اگر types نسخه‌ات timeout ندارد، بهم بگو تا cast بدهم)
        server?.timeout(request, 0)

        // ── پل pull-based (الگوی توصیه‌شده‌ی Bun) ──
        // pull() فقط وقتی صدا زده می‌شود که سوکت آماده‌ی دریافت باشد
        // → بک‌پرشر طبیعی؛ صف مقید؛ مشتریِ کند = حافظه‌ی مقید، نه OOM.
        const queue: Uint8Array[] = []
        let waiter: ((chunk: Uint8Array | null) => void) | null = null
        let closed = false

        const push = (chunk: Uint8Array): void => {
          if (closed) return
          if (waiter) {
            const w = waiter
            waiter = null
            w(chunk)
            return
          }
          if (queue.length >= MAX_QUEUE) queue.shift()
          queue.push(chunk)
        }
        const next = (): Promise<Uint8Array | null> =>
          new Promise((resolve) => {
            if (queue.length) {
              resolve(queue.shift() ?? null)
              return
            }
            if (closed) {
              resolve(null)
              return
            }
            waiter = resolve
          })

        let unsubscribe: (() => void) | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null

        const cleanup = () => {
          if (closed) return
          closed = true
          waiter?.(null)
          waiter = null
          unsubscribe?.()
          unsubscribe = null
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
        }

        // قطع شدن کلاینت (Bun سیگنال abort می‌دهد) → cleanup
        request.signal.addEventListener('abort', cleanup)

        unsubscribe = deps.hub.subscribe(channel, (payload) => {
          push(sseChunk(payload.event, payload.data))
        })
        push(sseChunk('connected', { channel, at: new Date().toISOString() }))

        // heartbeat — اتصال را زنده نگه می‌دارد و در پروکسی‌ها dead-detection می‌دهد
        heartbeat = setInterval(() => push(encoder.encode(': ping\n\n')), HEARTBEAT_MS)

        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = await next()
            if (chunk === null) {
              controller.close()
              return
            }
            controller.enqueue(chunk)
          },
          cancel() {
            cleanup()
          },
        })
      },
      {
        query: t.Object({ channel: t.Optional(t.String()), token: t.Optional(t.String()) }),
        detail: {
          summary: 'SSE live stream',
          description:
            'Auth via Bearer header or ?token=. Channel authorization: demo:* = any user; orders:new = admins only; orders:{id} = admins or the order owner. Pull-based stream (backpressure-safe, bounded queue), 15s heartbeat.',
        },
      },
    )

    // ── phase-1: قبلاً هر کاربرِ لاگین‌شده می‌توانست به همه‌ی مشترکان demo:* پیام بفرستد ──
    .post(
      '/publish',
      async ({ body, user }) => {
        if (user.role !== 'admin') throw Err.forbidden('فقط ادمین اصلی.')
        if (!body.channel.startsWith('demo:')) {
          throw Err.forbidden('فقط کانال‌های demo:* قابل publish هستند.')
        }
        deps.hub.publish(body.channel, { event: body.event, data: body.data })
        return { ok: true, subscribers: deps.hub.subscriberCount(body.channel) }
      },
      {
        body: t.Object({ channel: t.String(), event: t.String(), data: t.Unknown() }),
        detail: { summary: 'Demo publish (admin only) — fan-out test' },
      },
    )