// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// ═══════════════════════════════════════════════════════════════

// src/domain/notification/notification.service.ts
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { notifications, pushSubscriptions, users } from '#/infra/db/schema'
import type { NotificationType } from '#/infra/db/schema/notifications'
import type { AppConfig } from '#/infra/config/env'
import type { SseHub } from '#/infra/realtime/sse-hub'
import { sendWebPush } from '#/infra/push/web-push'

/**
 * فاز-۲ — سیستم نوتیفیکیشن مرکزی.
 *
 * سه کانال تحویل، یک منبع حقیقت (جدول notifications):
 *  ۱) DB — صندوق درون‌بری: لیست، خوانده‌نشده، علامت‌گذاری خوانده‌شده
 *  ۲) SSE زنده — کانال notify:{userId} (فقط مالک؛ گارد در realtime.routes)
 *  ۳) Web Push — به همه‌ی اشتراک‌های فعال کاربر (مرورگر بسته هم می‌رسد)
 *
 * ضد-کرش (قانون طلایی: نوتیفیکیشن هرگز مسیر اصلی را زمین نمی‌زند):
 *  • notifyUser/notifyUsers/broadcast هرگز throw نمی‌کنند — خطا فقط لاگ.
 *  • پوش اشتراکی که 404/410 داد → غیرفعال (disabledAt) و بعداً پاک‌سازی.
 *  • ارسال پوش فان‌اوت با سقف هم‌زمانی؛ هر اشتراک مستقل try/catch.
 */

export interface NotifyInput {
  type: NotificationType
  title: string
  body: string
  url?: string
  data?: Record<string, unknown>
}

export interface NotificationDto {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  data: Record<string, unknown>
  createdAt: Date
  readAt: Date | null
}

/** سقف هم‌زمانی ارسال پوش — فشار لحظه‌ای روی حلقه‌ی رویداد نمی‌سازد */
const PUSH_CONCURRENCY = 25
/** chunk درج broadcast — تراکنش کوچک و پایدار */
const INSERT_CHUNK = 500

export class NotificationService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      hub: SseHub
    },
  ) {}

  // ═══ ارسال ═══

  /**
   * نوتیفیکیشن به یک کاربر — insert + SSE + push.
   * هرگز throw نمی‌کند؛ خروجی آمار تحویل است.
   */
  async notifyUser(userId: string, input: NotifyInput): Promise<{
    id: string | null
    pushed: number
    pushGone: number
  }> {
    let id: string | null = null
    try {
      const [row] = await this.deps.db
        .insert(notifications)
        .values({
          userId,
          type: input.type,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 300),
          url: input.url?.slice(0, 300) ?? null,
          data: input.data ?? {},
        })
        .returning({ id: notifications.id })
      id = row?.id ?? null
    } catch (err) {
      console.error(`[notify] insert برای ${userId} ناموفق:`, err)
      return { id: null, pushed: 0, pushGone: 0 }
    }

    // SSE زنده — فقط اگر تبِ کاربر باز باشد
    this.publishSse(userId, {
      id,
      type: input.type,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
      data: input.data ?? {},
      createdAt: new Date().toISOString(),
    })

    // Web Push — مرورگر بسته هم می‌گیرد
    const { delivered, gone } = await this.pushToUser(userId, id, input)
    return { id, pushed: delivered, pushGone: gone }
  }

  /** نوتیفیکیشن به چند کاربر — batch با هم‌زمانی سقف‌دار */
  async notifyUsers(userIds: string[], input: NotifyInput): Promise<{ notified: number }> {
    const unique = [...new Set(userIds)].filter((u) => UUID_OK(u))
    let notified = 0
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50)
      const results = await Promise.all(
        batch.map((u) => this.notifyUser(u, input).then((r) => r.id !== null)),
      )
      notified += results.filter(Boolean).length
    }
    return { notified }
  }

  /**
   * پخش عمومی — به همه‌ی کاربران (نه ادمین‌ها). ردیف نوتیفیکیشن برای
   * همه ساخته می‌شود (صندوق درون‌بری)؛ پوش فقط به مشترکان می‌رود.
   * خروجی: تعداد کاربران هدف.
   */
  async broadcast(input: NotifyInput): Promise<{ targeted: number }> {
    let ids: string[] = []
    try {
      // فقط کاربر عادی — ادمین‌ها از پنل خودشان همه‌چیز را می‌بینند
      const rows = await this.deps.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'user'), isNull(users.bannedAt)))
        .orderBy(desc(users.createdAt))
        .limit(50_000)
      ids = rows.map((r) => r.id)
    } catch (err) {
      console.error('[notify] broadcast: خواندن کاربران ناموفق:', err)
      return { targeted: 0 }
    }
    if (ids.length === 0) return { targeted: 0 }

    // درج chunked — بدون تراکنش غول‌پیکر
    let inserted = 0
    for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
      const chunk = ids.slice(i, i + INSERT_CHUNK)
      try {
        await this.deps.db.insert(notifications).values(
          chunk.map((userId) => ({
            userId,
            type: input.type,
            title: input.title.slice(0, 120),
            body: input.body.slice(0, 300),
            url: input.url?.slice(0, 300) ?? null,
            data: input.data ?? {},
          })),
        )
        inserted += chunk.length
      } catch (err) {
        console.error('[notify] broadcast: درج chunk ناموفق:', err)
      }
    }

    // SSE برای آنلاین‌ها + پوش به مشترکان — بدون ردیف‌یابی مجدد
    this.publishSse('broadcast', {
      type: input.type,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
      data: input.data ?? {},
      createdAt: new Date().toISOString(),
    })
    await this.pushToSubscribedUsers(input)
    return { targeted: inserted }
  }

  // ═══ صندوق درون‌بری ═══

  async list(userId: string, limit: number): Promise<NotificationDto[]> {
    const rows = await this.deps.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(Math.max(1, limit), 50))
    return rows.map(toDto)
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    return r[0]?.count ?? 0
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const rows = await this.deps.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
    return rows.length > 0
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.deps.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
    return rows.length
  }

  // ═══ اشتراک‌های پوش ═══

  /**
   * ثبت/تازه‌سازی اشتراک — upsert روی endpoint (یونیک).
   * اگر endpoint از کاربر دیگری باشد → مالکش همین کاربر می‌شود
   * (لاگین روی مرورگر جدید؛ رفتار درستِ Web Push).
   * سقف اشتراک فعال هر کاربر — قدیمی‌ترین غیرفعال می‌شود.
   */
  async registerSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!sub.endpoint.startsWith('https://') || sub.endpoint.length > 2048) {
      return { ok: false, reason: 'endpoint-invalid' }
    }
    if (sub.p256dh.length < 40 || sub.auth.length < 8) {
      return { ok: false, reason: 'keys-invalid' }
    }
    try {
      await this.deps.db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh.slice(0, 255),
          auth: sub.auth.slice(0, 255),
          userAgent: sub.userAgent?.slice(0, 300) ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: sub.p256dh.slice(0, 255),
            auth: sub.auth.slice(0, 255),
            userAgent: sub.userAgent?.slice(0, 300) ?? null,
            lastSeenAt: new Date(),
            failures: 0,
            // بازگشت کاربر (مثلاً پس از پاک‌شدن دستی) — دوباره فعال
            disabledAt: null,
          },
        })
      await this.capUserSubscriptions(userId)
      return { ok: true }
    } catch (err) {
      console.error('[notify] ثبت اشتراک پوش ناموفق:', err)
      return { ok: false, reason: 'db' }
    }
  }

  /** حذف اشتراک (unsubscribe از مرورگر یا دکمه‌ی خاموش) */
  async removeSubscription(userId: string, endpoint: string): Promise<boolean> {
    const rows = await this.deps.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
      .returning({ id: pushSubscriptions.id })
    return rows.length > 0
  }

  /** کلید عمومی VAPID برای pushManager.subscribe مرورگر */
  vapidPublicKey(): string {
    return this.deps.config.push.vapidPublicKey
  }

  /** وضعیت اشتراک پوش کاربر (برای UI) */
  async pushStatus(userId: string): Promise<{ subscriptions: number }> {
    const r = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
    return { subscriptions: r[0]?.count ?? 0 }
  }

  // ═══ نگهداشت (RetentionJob صدا می‌زند) ═══

  /** پاک‌سازی دوره‌ای: نوتیفیکیشن خوانده‌شده‌ی ۹۰ روز + اشتراک مرده‌ی ۳۰ روز */
  async prune(): Promise<{ notifications: number; subscriptions: number }> {
    let n = 0
    let s = 0
    try {
      const cut90 = new Date(Date.now() - 90 * 86400_000)
      const rows1 = await this.deps.db
        .delete(notifications)
        .where(
          and(
            sql`${notifications.readAt} is not null`,
            lt(notifications.readAt, cut90),
          ),
        )
        .returning({ id: notifications.id })
      n = rows1.length
    } catch (err) {
      console.error('[notify] prune notifications ناموفق:', err)
    }
    try {
      const cut30 = new Date(Date.now() - 30 * 86400_000)
      const rows2 = await this.deps.db
        .delete(pushSubscriptions)
        .where(
          and(
            sql`${pushSubscriptions.disabledAt} is not null`,
            lt(pushSubscriptions.disabledAt, cut30),
          ),
        )
        .returning({ id: pushSubscriptions.id })
      s = rows2.length
    } catch (err) {
      console.error('[notify] prune subscriptions ناموفق:', err)
    }
    return { notifications: n, subscriptions: s }
  }

  // ═══ داخلی ═══

  private publishSse(userId: string, payload: Record<string, unknown>): void {
    try {
      // کانال شخصی؛ broadcast از مسیر فرانت (refetch) خوانده می‌شود نه SSE عمومی
      if (userId !== 'broadcast') {
        this.deps.hub.publish(`notify:${userId}`, { event: 'notification', data: payload })
      }
    } catch (err) {
      console.error('[notify] SSE publish ناموفق:', err)
    }
  }

  /** پوش به همه‌ی اشتراک‌های فعال یک کاربر — هم‌زمانی سقف‌دار */
  private async pushToUser(
    userId: string,
    notificationId: string | null,
    input: NotifyInput,
  ): Promise<{ delivered: number; gone: number }> {
    let delivered = 0
    let gone = 0
    try {
      const subs = await this.deps.db
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
      if (subs.length === 0) return { delivered: 0, gone: 0 }

      const pushPayload = {
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        url: input.url,
        tag: input.type === 'coupon_nudge' ? 'coupon-nudge' : input.type,
        data: input.data,
      }

      let attempted = 0
      const outcomes: Array<{ subId: string; outcome: Awaited<ReturnType<typeof sendWebPush>> }> = []
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (sub) => ({
            subId: sub.id,
            outcome: await sendWebPush(this.deps.config, sub, pushPayload),
          })),
        )
        outcomes.push(...results)
      }

      for (const { subId, outcome } of outcomes) {
        attempted++
        if (outcome.kind === 'ok') delivered++
        if (outcome.kind === 'gone') {
          gone++
          await this.disableSubscription(subId)
        }
      }

      // آمار تحویل روی ردیف نوتیفیکیشن
      if (notificationId) {
        await this.deps.db
          .update(notifications)
          .set({ pushAttempted: attempted, pushDelivered: delivered })
          .where(eq(notifications.id, notificationId))
          .catch(() => { /* آماری است — شکست مهم نیست */ })
      }
    } catch (err) {
      console.error(`[notify] pushToUser برای ${userId} ناموفق:`, err)
    }
    return { delivered, gone }
  }

  /** پوش به همه‌ی مشترکان فعال (broadcast) — بدون ساخت ردیف اضافه */
  private async pushToSubscribedUsers(input: NotifyInput): Promise<void> {
    try {
      const subs = await this.deps.db
        .select()
        .from(pushSubscriptions)
        .where(isNull(pushSubscriptions.disabledAt))
        .limit(20_000)
      const pushPayload = {
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        url: input.url,
        tag: input.type,
        data: input.data,
      }
      const goneIds: string[] = []
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (sub) => ({
            sub,
            outcome: await sendWebPush(this.deps.config, sub, pushPayload),
          })),
        )
        for (const { sub, outcome } of results) {
          if (outcome.kind === 'gone') goneIds.push(sub.id)
        }
      }
      // غیرفعال‌سازی اشتراک‌های مرده — دسته‌ای
      if (goneIds.length > 0) {
        await this.deps.db
          .update(pushSubscriptions)
          .set({ disabledAt: new Date() })
          .where(inArray(pushSubscriptions.id, goneIds))
          .catch(() => { /* آماری است */ })
        console.log(`[notify] broadcast: ${goneIds.length} اشتراک مرده غیرفعال شد`)
      }
    } catch (err) {
      console.error('[notify] pushToSubscribedUsers ناموفق:', err)
    }
  }

  private async disableSubscription(subId: string): Promise<void> {
    try {
      await this.deps.db
        .update(pushSubscriptions)
        .set({ disabledAt: new Date() })
        .where(eq(pushSubscriptions.id, subId))
    } catch {
      /* سکوت — دفعه‌ی بعد دوباره غیرفعال می‌شود */
    }
  }

  /** سقف اشتراک فعال — قدیمی‌ترین‌ها غیرفعال (نه حذف؛ تاریخچه بماند) */
  private async capUserSubscriptions(userId: string): Promise<void> {
    try {
      const subs = await this.deps.db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
        .orderBy(desc(pushSubscriptions.lastSeenAt))
      const excess = subs.slice(this.deps.config.push.maxSubsPerUser).map((s) => s.id)
      if (excess.length > 0) {
        await this.deps.db
          .update(pushSubscriptions)
          .set({ disabledAt: new Date() })
          .where(inArray(pushSubscriptions.id, excess))
      }
    } catch (err) {
      console.error('[notify] cap subscriptions ناموفق:', err)
    }
  }
}

// ── helpers ──

const UUID_OK = (s: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

function toDto(row: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}
