// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/realtime.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: GET /realtime/menu-stream — استریم عمومیِ کانال menu:live
//        (بدون auth؛ حتی مهمانِ سبد‌دار) برای به‌روزرسانی درجای موجودی/
//        حالت ارسال در سبد و چک‌اوت. سقف به‌ازای IP + سقف کلی.
// ═══════════════════════════════════════════════════════════════

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
import { UUID_RE } from '#/domain/shared/ids'
import { DISPLAY_RE } from '#/domain/shared/ids'
import { clientIp } from '#/domain/shared/net'

const encoder = new TextEncoder()
const sseChunk = (event: string, data: unknown): Uint8Array =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

// ── phase-1: کانال‌های مجاز (سفت‌تر از قبل) ──
// demo:* (تست) | orders:new (پنل) | orders:{displayId یا uuid} (ردیابی)
// فاز-۲: notify:{uuid} — صندوق نوتیفیکیشن زنده‌ی خودِ کاربر (فقط مالک)
const CHANNEL_RE =
  /^(demo:[A-Za-z0-9_-]{1,40}|orders:new|orders:(ord-[a-z0-9]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|notify:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

const HEARTBEAT_MS = 15_000
const MAX_QUEUE = 128 // سقف صفِ هر اتصال — بک‌پرشر: بیشتر نشود، قدیمی‌ترین می‌افتد

// ── round-28 — سقف تعداد اتصال SSE ──
// auth لازم است ولی auth سقفِ «تعداد» نیست: هر کاربر لاگین‌شده می‌توانست
// هزاران اتصال هم‌زمان باز کند (هر کدام تایمر + صف + سوکت) و بدون حتی یک
// exception منابع را تخلیه کند. سقفِ به‌ازای-کاربر سوءاستفاده را می‌بندد و سقف
// global محافظت حافظه‌ی کل پروسه است.
const MAX_STREAMS_PER_USER = 5
const MAX_STREAMS_TOTAL = 500

// stage-48 — استریم عمومی menu:live: مهمان هم مشترک می‌شود (سبد بدون لاگین) →
// سقف به‌ازای IP (نه کاربر) + سهم از سقف کلی.
const MAX_MENU_STREAMS_PER_IP = 3

// مانند index.ts — شمارنده‌ها بین بارگذاری‌های دوباره روی globalThis زنده می‌مانند
// تا شمارش سرگردان نشود (اتصال‌های قدیمی closure خودشان را کم می‌کنند)
const capsGlobal = globalThis as {
  __sinshin_sse_caps?: { byUser: Map<string, number>; total: number }
  /** stage-48 — شمارنده‌ی استریم عمومی menu:live به‌ازای IP */
  __sinshin_menu_stream_ips?: Map<string, number>
}
const caps = (capsGlobal.__sinshin_sse_caps ??= { byUser: new Map(), total: 0 })
const menuIps = (capsGlobal.__sinshin_menu_stream_ips ??= new Map())

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

  // فاز-۲ — notify:{userId}: صندوق شخصی؛ فقط مالکِ همان شناسه
  if (channel.startsWith('notify:')) {
    if (channel.slice('notify:'.length) !== user.id) {
      throw Err.forbidden('این کانال مال شما نیست.')
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

export const realtimeRoutes = (deps: RealtimeDeps) => {
  // ── استریم‌های احرازشده (کانال شخصی/پنلی) ──
  const authed = new Elysia({ prefix: '/realtime', tags: ['Realtime'] })
    .use(requireAuth(deps.sessions))
    .get(
      '/stream',
      async ({ set, query, request, server, user }) => {
        const channel = query.channel ?? 'demo'
        if (!CHANNEL_RE.test(channel)) throw Err.forbidden('کانال مجاز نیست.')
        await authorizeChannel(deps, channel, user)

        // ── round-28 — سقف اتصال (بعد از authorize، قبل از باز کردن استریم) ──
        const userStreams = caps.byUser.get(user.id) ?? 0
        if (userStreams >= MAX_STREAMS_PER_USER || caps.total >= MAX_STREAMS_TOTAL) {
          throw Err.rateLimited(
            'تعداد اتصال‌های زنده‌ی شما زیاد است؛ تب‌های اضافه را ببندید.',
            60,
          )
        }
        caps.byUser.set(user.id, userStreams + 1)
        caps.total += 1

        set.headers['content-type'] = 'text/event-stream'
        set.headers['cache-control'] = 'no-cache'
        set.headers['x-accel-buffering'] = 'no'

        // phase-1: Bun اتصال بیکار را به‌صورت پیش‌فرض (~۱۰ ثانیه) می‌بندد — برای SSE خاموشش کن
        // (اگر تایپ‌های نسخه‌ات زمان انتظار ندارد، بهم بگو تا تبدیل نوع بدهم)
        server?.timeout(request, 0)

        // ── پل کششی (الگوی توصیه‌شده‌ی Bun) ──
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
          // round-28 — سقف اتصال: جای این اتصال آزاد شود
          caps.total -= 1
          const n = (caps.byUser.get(user.id) ?? 1) - 1
          if (n <= 0) caps.byUser.delete(user.id)
          else caps.byUser.set(user.id, n)
        }

        // قطع شدن کلاینت (Bun سیگنال abort می‌دهد) → cleanup
        request.signal.addEventListener('abort', cleanup)

        unsubscribe = deps.hub.subscribe(channel, (payload) => {
          push(sseChunk(payload.event, payload.data))
        })
        push(sseChunk('connected', { channel, at: new Date().toISOString() }))

        // ضربان — اتصال را زنده نگه می‌دارد و در پروکسی‌ها تشخیصِ قطع‌شدن می‌دهد
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
        // رارد H5 — token از query حذف شد؛ فقط هدر Authorization
        query: t.Object({ channel: t.Optional(t.String()) }),
        detail: {
          summary: 'SSE live stream',
          description:
            'Auth via Bearer header only (fetch-based SSE on the frontend — tokens never travel in URLs). Channel authorization: demo:* = any user; orders:new = admins only; orders:{id} = admins or the order owner. Pull-based stream (backpressure-safe, bounded queue), 15s heartbeat. Connection caps: 5 per user, 500 total (round-28).',
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

  // ── stage-48 — استریم عمومی menu:live (بدون auth) ──
  // سبد خرید مهمان هم زنده به‌روز می‌شود: ناموجود شدن / تغییر حالت ارسال
  // محصول → رویداد «menu» → کلاینت جزئیات سبد/پیش‌نمایش چک‌اوت را رفرش
  // می‌کند. کانال فقط همین یکی است (نه پارامتر)؛ سقف به‌ازای IP.
  // دروازه‌ی ژئو (app.ts onRequest) همچنان اعمال می‌شود.
  const menuStream = new Elysia({ prefix: '/realtime', tags: ['Realtime'] })
    .get(
      '/menu-stream',
      async ({ set, request, server }) => {
        const ip = clientIp(request.headers.get('x-forwarded-for')) ?? 'unknown'
        const perIp = menuIps.get(ip) ?? 0
        if (perIp >= MAX_MENU_STREAMS_PER_IP || caps.total >= MAX_STREAMS_TOTAL) {
          throw Err.rateLimited('تعداد اتصال‌های زنده‌ی شما زیاد است؛ تب‌های اضافه را ببندید.', 60)
        }
        menuIps.set(ip, perIp + 1)
        caps.total += 1

        set.headers['content-type'] = 'text/event-stream'
        set.headers['cache-control'] = 'no-cache'
        set.headers['x-accel-buffering'] = 'no'
        server?.timeout(request, 0)

        // همان پل کششی بک‌پرشر-امن استریم اصلی
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
          caps.total -= 1
          const n = (menuIps.get(ip) ?? 1) - 1
          if (n <= 0) menuIps.delete(ip)
          else menuIps.set(ip, n)
        }

        request.signal.addEventListener('abort', cleanup)

        unsubscribe = deps.hub.subscribe('menu:live', (payload) => {
          push(sseChunk(payload.event, payload.data))
        })
        push(sseChunk('connected', { channel: 'menu:live', at: new Date().toISOString() }))

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
        detail: {
          summary: 'Public menu live stream (menu:live channel — no auth)',
          description:
            'stage-48: استریم عمومی کانال menu:live — رویدادهای «menu» (ناموجودی/تغییر حالت ارسال/وضعیت محصول) ' +
            'برای به‌روزرسانی درجای سبد خرید و چک‌اوت، حتی برای کاربر مهمان. pull-based + 15s heartbeat. ' +
            'سقف: ۳ اتصال به‌ازای IP و ۵۰۰ کلی. دروازه‌ی ژئو همچنان فعال است.',
        },
      },
    )

  return new Elysia({ prefix: '/realtime' }).use(authed).use(menuStream)
}