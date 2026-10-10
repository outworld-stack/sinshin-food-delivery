// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: جلوگیری از تسخیر اشتراک پوش توسط کاربر دیگر + escape جستجو
//        + آمار پوش دسته‌ای (۲۰k اشتراک ⇒ ۲۰k UPDATE → حداکثر ۳)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-52 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی stage-50)
// تغییر (خواسته‌ی stage-52): سفارش جدید در «صف زنده» علاوه بر پنلِ SSE،
//        به‌صورت Web Push «فقط به ادمین‌های سطح ۲» هم می‌رود — متد جدید
//        notifyAdmin2sNewOrder(). کلیک روی نوتیف ⇒ /admin/admin2/live-orders
//        (هندلر notificationclick از قبل در sw-push.js و sw.template.js هست).
// ═══════════════════════════════════════════════════════════════
// stage-50 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (اسکن عمیق): نرمال‌سازی limit/offset صفحه‌بندی تاریخچه —
//        هر دو از یک مقدار نرمال‌شده استفاده می‌کنند (قبلاً offset با
//        limitِ خامِ فراخواننده ضرب می‌شد — ناسازگاری بالقوه).
//        (فیکس ریشه‌ای رمزنگاری پوش در infra/push/web-push.ts است.)
// ═══════════════════════════════════════════════════════════════

// src/domain/notification/notification.service.ts
import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { notificationLog, notifications, orderItems, orders, pushSubscriptions, users } from '#/infra/db/schema'
import type { NotificationType } from '#/infra/db/schema/notifications'
import type { AppConfig } from '#/infra/config/env'
import type { SseHub } from '#/infra/realtime/sse-hub'
import { sendWebPush, type PushPayload } from '#/infra/push/web-push'
import { likePattern } from '#/domain/shared/pg'

/**
 * فاز-۲ — سیستم نوتیفیکیشن مرکزی.
 *
 * سه کانال تحویل، یک منبع حقیقت (جدول notifications):
 *  ۱) DB — صندوق درون‌بری: لیست، خوانده‌نشده، علامت‌گذاری خوانده‌شده
 *  ۲) SSE زنده — کانال notify:{userId} (فقط مالک؛ گارد در realtime.routes)
 *  ۳) Web Push — به همه‌ی اشتراک‌های فعال کاربر (مرورگر بسته هم می‌رسد)
 *
 * stage-52 — کانال چهارم (اختصاصی): notifyAdmin2sNewOrder
 *  سفارش جدید صف زنده ⇒ پوشِ «فقط ادمین سطح ۲» (ادمین اصلی همان پنل
 *  زنده + SSE را دارد؛ طبق خواسته، پوش نمی‌گیرد). بدون ردیف صندوق و بدون
 *  تاریخچه — پنل زنده خودش منبع نمایش سفارش است؛ این کانال فقط «زنگ» است.
 *
 * ضد-کرش (قانون طلایی: نوتیفیکیشن هرگز مسیر اصلی را زمین نمی‌زند):
 *  • notifyUser/notifyUsers/broadcast/notifyAdmin2sNewOrder هرگز throw
 *    نمی‌کنند — خطا فقط لاگ.
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

/** stage-48 — فرستنده‌ی یک ارسال گروهی (برای تاریخچه) */
export interface NotifySender {
  role: 'admin' | 'admin2' | 'system'
  name?: string | null
}

/** stage-48 — فیلترهای تاریخچه‌ی ارسال (پنل ادمین/ادمین۲) */
export interface NotificationHistoryFilter {
  search?: string
  type?: string
  senderRole?: string
  from?: Date
  to?: Date
  page: number
  limit: number
}

export interface NotificationLogDto {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  audience: number
  senderRole: string
  senderName: string | null
  createdAt: Date
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

/** stage-52 — آمار پوش سفارش زنده (برای لاگ و فراخوان‌های آینده) */
export interface LiveOrderPushStats {
  /** اشتراک‌های فعال ادمین‌های سطح ۲ که پوش برایشان ارسال شد */
  targeted: number
  /** تحویل موفق (201 از سرور پوش) */
  delivered: number
  /** اشتراک مرده (404/410) — همین‌جا غیرفعال شد */
  gone: number
}

/** سقف هم‌زمانی ارسال پوش — فشار لحظه‌ای روی حلقه‌ی رویداد نمی‌سازد */
const PUSH_CONCURRENCY = 25
/** chunk درج broadcast — تراکنش کوچک و پایدار */
const INSERT_CHUNK = 500
/** stage-48 — شکستِ پیاپی پوش قبل از غیرفعال‌کردن اشتراک */
const PUSH_MAX_FAILURES = 5

// ── stage-52 — ثابت‌های کانال «سفارش زنده → پوش ادمین۲» ──

/** مقصد کلیک روی نوتیف (SW با data.url باز می‌کند — مسیر پنل زنده‌ی ادمین۲) */
const ADMIN2_LIVE_ORDERS_URL = '/admin/admin2/live-orders'
/**
 * برچسب ثابت پوش سفارش: اعلان‌های جدید جای قبلی را می‌گیرند (tag یکسان)
 * و renotify در SW باعث می‌شود هر سفارشِ تازه دوباره «با صدا» بیاید —
 * ساعت پیک‌کاری ۵۰ اعلان روی هم انبار نمی‌شود، همیشه آخرین سفارش دیده است.
 */
const LIVE_ORDER_TAG = 'new-order'
/**
 * TTL اختصاصی این کانال (پیش‌فرض کلی ۲۴ ساعت است): سفارشِ ربع ساعت پیش
 * دیگر «زنده» نیست — پوشِ دیرهنگام فقط نویز است؛ مشتری صفحه‌ی خودش را دارد.
 */
const LIVE_ORDER_PUSH_TTL = 900
/** سقف اشتراک در یک ارسال — واقعیت: چند ادمین۲ × چند مرورگر/گوشی */
const LIVE_ORDER_PUSH_MAX_SUBS = 500

/** برچسب فارسی نوع ارسال — همان واژگان پنل زنده */
const DELIVERY_LABELS: Record<'DELIVERY' | 'PICKUP' | 'DINE_IN', string> = {
  DELIVERY: 'ارسال با پیک',
  PICKUP: 'بیرون‌بر',
  DINE_IN: 'سرو در سالن',
}

/** stage-55 — آیتم نتیجه‌ی ارسال پوش (برای آمارداری/غیرفعال‌سازی دسته‌ای) */
type PushOutcomeItem = {
  sub: { id: string }
  outcome: Awaited<ReturnType<typeof sendWebPush>>
}

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
   * stage-48 — هر پخش یک ردیف در notification_log (تاریخچه‌ی پنل) می‌گیرد؛
   * sender برای گزارش «چه کسی فرستاد» است (ادمین/ادمین۲/سیستم).
   * خروجی: تعداد کاربران هدف.
   */
  async broadcast(input: NotifyInput, sender?: NotifySender): Promise<{ targeted: number }> {
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
    if (ids.length === 0) {
      // stage-48 — پخش بدون گیرنده هم لاگ می‌شود (ردپای عملیات ادمین)
      await this.logBroadcast(input, 0, sender).catch(() => {})
      return { targeted: 0 }
    }

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

    // stage-48 — تاریخچه‌ی ارسال (fail-soft — پخش موفق نباید گیر لاگ بکند)
    await this.logBroadcast(input, inserted, sender).catch(() => {})

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

  /**
   * stage-52 — سفارش جدید وارد «صف زنده» شد ⇒ Web Push فقط به ادمین‌های
   * سطح ۲. فراخوان: چک‌اوت تمام-کیف‌پول (order.routes) و نهایی‌شدن موفق
   * پرداخت درگاهی (payment.service.finalize) — همان دو جایی که رویداد
   * SSE ‏order-created روی orders:new منتشر می‌شود؛ یعنی دقیقاً لحظه‌ای
   * که سفارش در پنل زنده ظاهر می‌شود.
   *
   *  • هدف: اشتراک‌های فعالِ کاربران role=admin2 (غیربن) — ادمین اصلی
   *    عمداً خارج است (خواسته‌ی صریح؛ او همان پنل زنده + SSE را دارد).
   *  • فقط «پوش» است: ردیف صندوق نه (unread بی‌پایان برای هر سفارش =
   *    اسپم)، SSE نه (پنل زنده خودش مشترک orders:new است)، ردیف
   *    notification_log نه (تاریخچه با هر سفارش پر می‌شد).
   *  • کلیک ⇒ /admin/admin2/live-orders — notificationclick در SW با
   *    data.url تب را فوکوس/ناو یا پنجره‌ی تازه باز می‌کند.
   *  • urgency=high (RFC 8030) + TTL اختصاصی ۱۵ دقیقه — سفارشِ قدیمی
   *    دیگر خبر فوری نیست.
   *  • قانون طلایی: هرگز throw نمی‌کند؛ چک‌اوت/پرداخت هرگز زمین نمی‌خورد.
   */
  async notifyAdmin2sNewOrder(input: { displayId: string }): Promise<LiveOrderPushStats> {
    const stats: LiveOrderPushStats = { targeted: 0, delivered: 0, gone: 0 }
    try {
      // ۱) خلاصه‌ی سبک سفارش (نوع ارسال/جمع اقلام/مبلغ) — شکست = بدنه‌ی ساده
      const summary = await this.liveOrderSummary(input.displayId)

      // ۲) اشتراک‌های فعال ادمین‌های سطح ۲ (join با users برای نقش/بن)
      const subs = await this.deps.db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .innerJoin(users, eq(users.id, pushSubscriptions.userId))
        .where(
          and(
            eq(users.role, 'admin2'),
            isNull(users.bannedAt),
            isNull(pushSubscriptions.disabledAt),
          ),
        )
        .limit(LIVE_ORDER_PUSH_MAX_SUBS)
      if (subs.length === 0) return stats

      const pushPayload: PushPayload = {
        title: `🔔 سفارش جدید (${input.displayId})`,
        body: liveOrderPushBody(input.displayId, summary),
        url: ADMIN2_LIVE_ORDERS_URL,
        tag: LIVE_ORDER_TAG,
        urgency: 'high',
        ttl: LIVE_ORDER_PUSH_TTL,
        data: {
          kind: 'live-order',
          displayId: input.displayId,
          ...(summary
            ? { deliveryType: summary.deliveryType, totalAmount: summary.totalAmount }
            : {}),
        },
      }

      // ۳) فان‌آوت سقف‌دار + همان آمار/غیرفعال‌سازی بقیه‌ی مسیرهای پوش:
      //    ok ⇒ failures صفر؛ fail ⇒ شمارنده (سقف ۵ ⇒ غیرفعال)؛
      //    gone (404/410) ⇒ همان‌جا غیرفعال.
      // stage-55 — شمارنده‌ها همان‌قدر دقیق؛ UPDATEها دسته‌ای.
      const outcomes: PushOutcomeItem[] = []
      const goneIds: string[] = []
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (sub) => ({
            sub,
            outcome: await sendWebPush(this.deps.config, sub, pushPayload),
          })),
        )
        outcomes.push(...results)
      }
      for (const { sub, outcome } of outcomes) {
        stats.targeted++
        if (outcome.kind === 'ok') stats.delivered++
        if (outcome.kind === 'gone') {
          stats.gone++
          goneIds.push(sub.id)
        }
      }
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)
      console.log(
        `[notify] سفارش زنده ${input.displayId}: پوش به ${stats.targeted} اشتراک ادمین۲ ` +
          `(تحویل ${stats.delivered}${stats.gone > 0 ? `، مرده ${stats.gone}` : ''})`,
      )
    } catch (err) {
      console.error(`[notify] پوش سفارش زنده ${input.displayId} ناموفق:`, err)
    }
    return stats
  }

  /** stage-48 — تاریخچه‌ی ارسال‌های گروهی با فیلتر پیشرفته (پنل) */
  async listHistory(
    filter: NotificationHistoryFilter,
  ): Promise<{ items: NotificationLogDto[]; total: number }> {
    const conditions = []
    if (filter.search) {
      // stage-55 — escape کراکترهای wildcard (% _ \) تا الگوی جستجوی
      // کاربر کل جدول را اسکن نکند (likePattern خودش % دورش می‌گذارد)
      const q = likePattern(filter.search)
      conditions.push(or(ilike(notificationLog.title, q), ilike(notificationLog.body, q)))
    }
    if (filter.type && filter.type !== 'all') {
      conditions.push(eq(notificationLog.type, filter.type))
    }
    if (filter.senderRole && filter.senderRole !== 'all') {
      conditions.push(eq(notificationLog.senderRole, filter.senderRole))
    }
    if (filter.from) conditions.push(gte(notificationLog.createdAt, filter.from))
    if (filter.to) conditions.push(lte(notificationLog.createdAt, filter.to))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const total = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationLog)
      .where(where)
      .then((r) => r[0]?.count ?? 0)

    // stage-50 — حد و صفحه را یک بار نرمال کن و در limit/offset «هر دو»
    // همان مقدار را بگذار (قبلاً offset با limit خام ضرب می‌شد — با
    // مقدار نامعتبر، صفحه‌ها بی‌دلیل جلو می‌پریدند)
    const limit = Math.min(Math.max(1, filter.limit), 100)
    const page = Math.max(1, filter.page)
    const rows = await this.deps.db
      .select()
      .from(notificationLog)
      .where(where)
      .orderBy(desc(notificationLog.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)
    return { items: rows.map(toLogDto), total }
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
   * stage-55 — اگر endpoint از قبل به کاربر دیگری تعلق داشته باشد، ثبت
   * رد می‌شود (reason=owned-by-other): بدون مدرک مالکیت، انتقال اشتراک
   * ممنوع است (قبلاً upsert بی‌صدا مالک را عوض می‌کرد و قربانی دیگر
   * نمی‌توانست اشتراکش را حذف کند).
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
      // stage-55 — جلوگیری از «تسخیر اشتراک پوش»: اگر endpoint از قبل به
      // کاربر دیگری تعلق دارد، بدون مدرکِ مالکیت (proof-of-possession)
      // انتقال ممنوع است. قبلاً onConflictDoUpdate بی‌صدا مالک را عوض
      // می‌کرد و قربانی دیگر نمی‌توانست اشتراکش را حذف کند.
      // (داخل try: شکست DB همان reason='db' قبلی را می‌دهد، نه 500)
      const [existing] = await this.deps.db
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, sub.endpoint))
        .limit(1)
      if (existing && existing.userId !== userId) return { ok: false, reason: 'owned-by-other' }
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

  /**
   * stage-52 — خلاصه‌ی سبک سفارش برای متن پوش (fail-soft):
   * یک کوئری join + تجمیع اقلام؛ شکست (سفارش تازه هنوز commit نشده و…) ⇒
   * null ⇒ بدنه‌ی ساده بدون جزئیات. گروه‌بندی روی PK سفارش مجاز است
   * (وابستگی تابعی در Postgres) و leftJoin یعنی سفارش بدون قلم هم می‌آید.
   */
  private async liveOrderSummary(
    displayId: string,
  ): Promise<{
    deliveryType: 'DELIVERY' | 'PICKUP' | 'DINE_IN'
    totalAmount: number
    pieces: number
  } | null> {
    try {
      const [row] = await this.deps.db
        .select({
          deliveryType: orders.deliveryType,
          totalAmount: orders.totalAmount,
          pieces: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
        })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(eq(orders.displayId, displayId))
        .groupBy(orders.id)
        .limit(1)
      return row ?? null
    } catch (err) {
      console.error(`[notify] خلاصه‌ی سفارش ${displayId} خوانده نشد:`, err)
      return null
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
      const outcomes: PushOutcomeItem[] = []
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (sub) => ({
            sub,
            outcome: await sendWebPush(this.deps.config, sub, pushPayload),
          })),
        )
        outcomes.push(...results)
      }

      // stage-48 — آمار پیاپی/غیرفعال‌سازی: ok ⇒ صفر + lastPushAt؛
      // fail ⇒ شمارنده بالا (تا ۵) و بعد از سقف غیرفعال؛ gone ⇒ همیشه غیرفعال.
      // stage-55 — شمارنده‌ها همان‌قدر دقیق؛ UPDATEها دسته‌ای (حداکثر ۳).
      const goneIds: string[] = []
      for (const { sub, outcome } of outcomes) {
        attempted++
        if (outcome.kind === 'ok') delivered++
        if (outcome.kind === 'gone') {
          gone++
          goneIds.push(sub.id)
        }
      }
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)

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
      const outcomes: PushOutcomeItem[] = []
      const goneIds: string[] = []
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (sub) => ({
            sub,
            outcome: await sendWebPush(this.deps.config, sub, pushPayload),
          })),
        )
        outcomes.push(...results)
      }
      for (const { sub, outcome } of outcomes) {
        if (outcome.kind === 'gone') goneIds.push(sub.id)
      }
      // stage-48 — همان آمار خطای پیاپی (تلاش مجدد دوره‌ای بعدی تصمیم می‌گیرد)
      // stage-55 — آمار دسته‌ای + غیرفعال‌سازی مرده‌ها دسته‌ای (حداکثر ۳ کوئری)
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)
      if (goneIds.length > 0) {
        console.log(`[notify] broadcast: ${goneIds.length} اشتراک مرده غیرفعال شد`)
      }
    } catch (err) {
      console.error('[notify] pushToSubscribedUsers ناموفق:', err)
    }
  }

  /**
   * stage-55 — آمار پوشِ دسته‌ای: قبلاً به‌ازای هر اشتراک یک UPDATE
   * مستقل (۲۰k اشتراک = ۲۰k کوئری)؛ حالا حداکثر ۳ کوئری.
   *  • ok ⇒ failures=0 + lastPushAt (سلامت اشتراک تأیید شد)
   *  • fail (شبکه/429/5xx — خطای موقت) ⇒ failures+1؛ با رسیدن به سقف،
   *    اشتراک غیرفعال می‌شود تا فان‌آوت‌های بعدی مسدود نمانند.
   */
  private async recordPushOutcomesBatch(outcomes: PushOutcomeItem[]): Promise<void> {
    if (outcomes.length === 0) return
    const okIds: string[] = []
    const failIds: string[] = []
    for (const { sub, outcome } of outcomes) {
      if (outcome.kind === 'ok') okIds.push(sub.id)
      else if (outcome.kind === 'fail') failIds.push(sub.id)
    }
    try {
      if (okIds.length > 0) {
        await this.deps.db
          .update(pushSubscriptions)
          .set({ failures: 0, lastPushAt: new Date() })
          .where(inArray(pushSubscriptions.id, okIds))
      }
      if (failIds.length > 0) {
        const rows = await this.deps.db
          .update(pushSubscriptions)
          .set({ failures: sql`${pushSubscriptions.failures} + 1` })
          .where(inArray(pushSubscriptions.id, failIds))
          .returning({ id: pushSubscriptions.id, failures: pushSubscriptions.failures })
        const over = rows.filter((r) => (r.failures ?? 0) >= PUSH_MAX_FAILURES).map((r) => r.id)
        if (over.length > 0) {
          console.warn(`[notify] ${over.length} اشتراک بعد از شکست پیاپی غیرفعال شد`)
          await this.disableSubscriptionsBatch(over)
        }
      }
    } catch {
      /* آماری است — سکوت */
    }
  }

  /**
   * stage-55 — غیرفعال‌سازی دسته‌ای (هم‌ارزِ disableSubscription قبلی:
   * فقط disabledAt — تاریخچه می‌ماند؛ prune بعدی پاک می‌کند).
   */
  private async disableSubscriptionsBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    try {
      await this.deps.db
        .update(pushSubscriptions)
        .set({ disabledAt: new Date() })
        .where(inArray(pushSubscriptions.id, ids))
    } catch {
      /* سکوت — دفعه‌ی بعد دوباره غیرفعال می‌شود */
    }
  }

  /** stage-48 — درج ردیف تاریخچه‌ی ارسال (notification_log) */
  private async logBroadcast(
    input: NotifyInput,
    audience: number,
    sender?: NotifySender,
  ): Promise<void> {
    await this.deps.db.insert(notificationLog).values({
      type: input.type,
      title: input.title.slice(0, 120),
      body: input.body.slice(0, 300),
      url: input.url?.slice(0, 300) ?? null,
      audience,
      senderRole: sender?.role ?? 'system',
      senderName: sender?.name?.slice(0, 120) ?? null,
    })
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

/**
 * stage-52 — متن پوش سفارش زنده (بدنه‌ی نوتیف):
 * با خلاصه ⇒ «ارسال با پیک • ۳ قلم • ۲۵۰٬۰۰۰ تومان — در صف سفارشات زنده…»
 * بی‌خلاصه (کوئری شکست خورد) ⇒ جمله‌ی ساده — پوش هرگز به خاطر متن نمی‌افتد.
 * اعداد فارسی با toLocaleString('fa-IR') — همان قرارداد domain/report/format.
 */
function liveOrderPushBody(
  displayId: string,
  summary: { deliveryType: 'DELIVERY' | 'PICKUP' | 'DINE_IN'; totalAmount: number; pieces: number } | null,
): string {
  if (!summary) {
    return `سفارش ${displayId} در صف سفارشات زنده ثبت شد — برای مدیریت کلیک کنید.`
  }
  const parts: string[] = [DELIVERY_LABELS[summary.deliveryType] ?? 'سفارش']
  if (summary.pieces > 0) parts.push(`${summary.pieces.toLocaleString('fa-IR')} قلم`)
  parts.push(`${summary.totalAmount.toLocaleString('fa-IR')} تومان`)
  return `در صف سفارشات زنده: ${parts.join(' • ')} — برای مدیریت کلیک کنید.`
}

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

/** stage-48 — ردیف تاریخچه → DTO پنل */
function toLogDto(row: typeof notificationLog.$inferSelect): NotificationLogDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    audience: row.audience,
    senderRole: row.senderRole,
    senderName: row.senderName,
    createdAt: row.createdAt,
  }
}