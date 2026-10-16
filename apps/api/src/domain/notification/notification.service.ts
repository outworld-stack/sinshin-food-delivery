// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// وضعیت: ویرایش فایل موجود (تصمیم کارفرما «الف» + ترمیم اسکن کوپن×نوتیف):
//   ① صندوق اعلان‌ها TTL هفت‌روزه شد (تصمیم کارفرما): هر ردیف از لحظه‌ی
//      «به‌وجودآمدن» (createdAt) ۷ روز در صندوق می‌ماند — چه خوانده‌شده چه
//      خوانده‌نشده؛ بعدش از list/unreadCount حذف و توسط prune پاک می‌شود.
//      این همان بستنِ «رشد بی‌سقف جدول notifications» است (M1 اسکن):
//      قبلاً فقط خوانده‌شده‌ی ۹۰ روز پاک می‌شد و هیچ کلاینتی read نمی‌زد.
//   ② notifyUsers (مرده از stage-49) حذف شد — صفر فراخوان در کل ریپو.
//   ③ گارد تسخیر اشتراک اتمیک شد (سرانجام همان ① stage-64 که فقط کامنت
//      بود): upsert با setWhere(user_id=درخواست‌دهنده) + returning —
//      رقابتِ دو درخواستِ هم‌زمان دیگر نمی‌تواند مالکیت را عوض کند؛
//      SELECT-then-reject قبلی بین دو کوئری قابل شکست بود (TOCTOU).
//   ④ مخاطب پوشِ broadcast دقیقاً هم‌راستای صندوق: همان مرتب‌سازی
//      desc(users.createdAt) + برشِ همان ۵۰k کاربر اول (cutoff از
//      broadcast پاس می‌شود) — قبلاً پوش بی‌order بود و زیرمجموعه‌ی
//      متفاوتی می‌گرفت (یافته‌ی کم‌اهمیت اسکن).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-64 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/notification/notification.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی stage-55)
// تغییر (ممیزی عمیق سرویس نوتیفیکیشن — اسکن کارفرما + اسکن ما):
//   ① گارد تسخیر اشتراک اتمیک شد (TOCTOU بسته شد): upsert با
//      setWhere(user_id=درخواست‌دهنده) — رقابتِ دو درخواستِ هم‌زمان
//      دیگر نمی‌تواند مالکیت را بی‌صدا عوض کند؛ قبلاً SELECT سپس
//      INSERT بینِ دو کوئری قابل شکست بود.
//   ② پوشِ «سفارش جدید صف زنده» به ادمینِ اصلی هم می‌رسد (قبلاً فقط
//      admin2 — خواسته‌ی جدید کارفرما). notifyAdmin2sNewOrder →
//      notifyAdminsNewOrder (admin + admin2، غیربن).
//   ③ مخاطب پوشِ broadcast هم‌راستای صندوق شد: join با users و فیلتر
//      role='user' + bannedAt IS NULL (قبلاً همه‌ی اشتراک‌های فعال —
//      حتی ادمین/بن‌شده — پوش می‌گرفتند ولی ردیف صندوق نداشتند)؛ سقف
//      هم با صندوق ۵۰k شد. فان‌اوت فایر-اند-فورگت (پاسخ HTTP منتظر
//      ده‌ها هزار پوش نمی‌ماند — هم‌زمان با stage-52 الگوی سفارش).
//   ④ برچسب (tag) پوش‌های broadcast/تخفیف یکتا شد (type-logId) — دو
//      اطلاعیه‌ی متفاوت دیگر جای هم را نمی‌گیرند؛ coupon_nudge و
//      new-order عمداً ثابت ماندند (جایگزینیِ یادآور/سفارش = طراحی).
//   ⑤ معنای آمار: «تحویل» → «acceptedByPushService» (پذیرشِ ۲۰۱ از
//      سرور پوش — نمایشِ واقعی روی دستگاه فقط از سمت مرورگر قابل
//      اثبات است) + گزارش غنی‌تر: شناسه، تعداد هدف، پذیرش، مرده،
//      خطاها، مدت‌زمان.
//   ⑥ تشدیدِ خودکارِ شکست نرم شد: خطای «موقت» (شبکه/مهلت/429/5xx)
//      دیگر شمارنده‌ی failures را بالا نمی‌برد — فقط خطای قطعیِ ۴xx
//      (400/401/403/413…) شمرده می‌شود. قبلاً ۵ پخشِ ناموفق (مثلاً
//      اختلال موقت مسیر خروجی ایران↔FCM) همه‌ی اشتراک‌ها را از کار
//      می‌انداخت و بازیابی فقط با باز شدن دوباره‌ی سایت بود.
//   ⑦ sendTestPush — اعتبارسنجیِ سرِتا‌سرِ خط پوش (پرامپت مبتنی بر
//      کلیک + دکمه‌ی «پوش تستی» در پنل): پوش واقعی به اشتراک‌های
//      خودِ کاربر، بدون ردیف صندوق/تاریخچه.
//   ⑧ فراخوانِ مرده‌ی publishSse('broadcast') حذف شد (هیچ کلاینتی
//      مشترک کانال broadcast نبود؛ صندوق با refetch تازه می‌شود).
//
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
 *     (stage-67 — مصرف‌کننده: صفحه‌ی «صندوق اعلان‌ها» در پروفایل کاربر؛
 *     TTL هفت‌روزه از createdAt — تصمیم کارفرما)
 *  ۲) SSE زنده — کانال notify:{userId} (فقط مالک؛ گارد در realtime.routes)
 *  ۳) Web Push — به همه‌ی اشتراک‌های فعال کاربر (مرورگر بسته هم می‌رسد)
 *
 * stage-52 — کانال چهارم (اختصاصی): notifyAdminsNewOrder
 *  سفارش جدید صف زنده ⇒ پوشِ «ادمین اصلی + سطح ۲» (stage-64: ادمین
 *  اصلی هم می‌گیرد). بدون ردیف صندوق و بدون تاریخچه — پنل زنده خودش
 *  منبع نمایش سفارش است؛ این کانال فقط «زنگ» است.
 *
 * ضد-کرش (قانون طلایی: نوتیفیکیشن هرگز مسیر اصلی را زمین نمی‌زند):
 *  • notifyUser/broadcast/notifyAdminsNewOrder هرگز throw
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

/**
 * stage-52 — آمار پوش سفارش زنده (برای لاگ و فراخوان‌های آینده).
 * stage-64 — معنای «delivered» به «acceptedByPushService» تغییر کرد: 201 از
 * سرور پوش یعنی پیام «پذیرفته و تحویلِ سرور پوش» شده؛ نمایشِ روی دستگاه
 * فقط از سمت مرورگر/SW قابل اثبات است (پوش تستی همین را می‌سنجد).
 */
export interface LiveOrderPushStats {
  /** اشتراک‌های فعال ادمین‌ها (اصلی + سطح ۲) که پوش برایشان ارسال شد */
  targeted: number
  /** پذیرش موفق سرور پوش (201/200) — نه ضمانتِ نمایش */
  acceptedByPushService: number
  /** اشتراک مرده (404/410) — همین‌جا غیرفعال شد */
  gone: number
  /** مدت‌زمان کل فان‌اوت (میلی‌ثانیه) — برای گزارش/مانیتورینگ */
  durationMs: number
}

/**
 * stage-64 — نتیجه‌ی پوش تستی (POST /notifications/test-push):
 * اعتبارسنجی سرِتا‌سرِ خط پوش برای اشتراک‌های خودِ کاربر.
 */
export interface TestPushStats {
  /** اشتراک‌های فعال خودِ کاربر که پوش برایشان ارسال شد */
  targeted: number
  /** پذیرش سرور پوش (201/200) */
  acceptedByPushService: number
  /** اشتراک مرده (404/410) — غیرفعال شد */
  gone: number
  /** مدت‌زمان فان‌اوت */
  durationMs: number
}

/** سقف هم‌زمانی ارسال پوش — فشار لحظه‌ای روی حلقه‌ی رویداد نمی‌سازد */
const PUSH_CONCURRENCY = 25
/** chunk درج broadcast — تراکنش کوچک و پایدار */
const INSERT_CHUNK = 500
/** stage-48 — شکستِ پیاپی پوش قبل از غیرفعال‌کردن اشتراک */
const PUSH_MAX_FAILURES = 5
/**
 * stage-67 — عمر صندوق اعلان‌ها (تصمیم کارفرما «الف»): هر اعلان ۷ روز
 * از لحظه‌ی ایجاد در صندوق کاربر می‌ماند؛ تایمرِ حذف مستقل از
 * خوانده‌شدن است و از createdAt هر ردیف محاسبه می‌شود. ۷ روز بعد:
 *  • list/unreadCount دیگر برنمی‌گردانندش (حتی قبل از اجرای prune)
 *  • prune (اجرای روزانه‌ی RetentionJob) ردیف را فیزیکی پاک می‌کند
 */
export const NOTIFICATION_TTL_DAYS = 7
/**
 * stage-64 — سقف مشترکِ مخاطبِ broadcast — هم‌راستای سقف صندوق (۵۰k):
 * قبلاً ۲۰k بود و بی‌صدا مازاد را می‌انداخت؛ همین ثابت در هر دو مسیر
 * (درج صندوق + پوش) استفاده می‌شود تا مخاطب‌ها هرگز از هم جدا نشوند.
 */
const BROADCAST_MAX_AUDIENCE = 50_000

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
   * هرگز throw نمی‌کند؛ خروجی آمار پوش است.
   * stage-64 — «pushed» → «pushAccepted»: پذیرشِ سرور پوش (201/200)،
   * نه ضمانتِ نمایش روی دستگاه (مصرف‌کننده‌ها فقط id را می‌خوانند).
   */
  async notifyUser(userId: string, input: NotifyInput): Promise<{
    id: string | null
    pushAccepted: number
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
      return { id: null, pushAccepted: 0, pushGone: 0 }
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
    const { accepted, gone } = await this.pushToUser(userId, id, input)
    return { id, pushAccepted: accepted, pushGone: gone }
  }

  /**
   * پخش عمومی — به همه‌ی کاربران (نه ادمین‌ها). ردیف نوتیفیکیشن برای
   * همه ساخته می‌شود (صندوق درون‌بری)؛ پوش فقط به مشترکان می‌رود.
   * stage-48 — هر پخش یک ردیف در notification_log (تاریخچه‌ی پنل) می‌گیرد؛
   * sender برای گزارش «چه کسی فرستاد» است (ادمین/ادمین۲/سیستم).
   * stage-64 — ① پوش هم‌زمان صندوق نیست: فایر-اند-فورگت (پاسخ HTTP
   * منتظر فان‌اوت ده‌ها هزار پوش نمی‌ماند؛ خطا داخلی لاگ می‌شود).
   * ② tag پوش یکتا = type-logId (اطلاعیه‌های متفاوت جای هم را نمی‌گیرند).
   * ③ فراخوان مرده‌ی publishSse('broadcast') حذف شد — هیچ کلاینتی
   * مشترک آن کانال نبود؛ صندوق با refetch تازه می‌شود.
   * خروجی: تعداد کاربران هدف.
   */
  async broadcast(input: NotifyInput, sender?: NotifySender): Promise<{ targeted: number }> {
    let ids: string[] = []
    // stage-67 — cutoff برشِ مخاطب صندوق (کامنت پایین‌تر — داخل try پر می‌شود)
    let audienceCutoff: Date | null = null
    try {
      // فقط کاربر عادی — ادمین‌ها از پنل خودشان همه‌چیز را می‌بینند
      // stage-67 — createdAt هم انتخاب می‌شود (برشِ cutoff مخاطب پوش)
      const rows = await this.deps.db
        .select({ id: users.id, createdAt: users.createdAt })
        .from(users)
        .where(and(eq(users.role, 'user'), isNull(users.bannedAt)))
        .orderBy(desc(users.createdAt))
        .limit(BROADCAST_MAX_AUDIENCE)
      ids = rows.map((r) => r.id)
      // stage-67 — cutoff مخاطب صندوق: createdAt آخرین ردیفِ سقف‌خورده
      // (جدیدترین‌ها به‌ترتیب desc(users.createdAt)). فقط وقتی به سقف رسیده‌ایم
      // معنا دارد؛ به پوش پاس می‌شود تا «مخاطبِ پوش» دقیقاً زیرمجموعه‌ی همین
      // ۵۰k بماند — قبلاً پوش بی‌order بود و کاربران بیرون از برشِ صندوق هم
      // پوش می‌گرفتند بدون ردیف صندوق (ناهماهنگی زیرمجموعه‌ی ۵۰k).
      if (rows.length >= BROADCAST_MAX_AUDIENCE) {
        audienceCutoff = rows[rows.length - 1]?.createdAt ?? null
      }
    } catch (err) {
      console.error('[notify] broadcast: خواندن کاربران ناموفق:', err)
      return { targeted: 0 }
    }
    if (ids.length === 0) {
      // stage-48 — پخش بدون گیرنده هم لاگ می‌شود (ردپای عملیات ادمین)
      await this.logBroadcast(input, 0, sender).catch(() => {})
      return { targeted: 0 }
    }

    // stage-67 — cutoff مخاطب صندوق (محاسبه در try بالا) — برش ۵۰k مشترک
    // بین صندوق و پوش
    const cutoff = audienceCutoff

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
    // stage-64 — شناسه‌ی ردیف تاریخچه برگردانده می‌شود: tag یکتای پوش
    const logId = await this.logBroadcast(input, inserted, sender).catch(() => null)

    // stage-64 — پوش به مشترکانِ همان مخاطبانِ صندوق — فایر-اند-فورگت
    // (خطاها داخل pushToSubscribedUsers لاگ می‌شوند؛ پاسخ مسیر نمی‌ماند)
    // stage-67 — cutoff برشِ مخاطب پاس می‌شود (کامنت بالا)
    void this.pushToSubscribedUsers(input, logId, cutoff).catch(() => {})

    // stage-77 (N2) — زنده‌سازی صندوقِ «باز»: پخش قبلاً هیچ SSE نداشت —
    // کاربرِ روی صفحه‌ی اعلان‌ها (یا داشبورد با بج) تا focus/navigation
    // هیچ چیز نمی‌دید در حالی که پوشِ سطح-مرورگر می‌رسید. کانال عمومیِ
    // notify:all (auth=هر کاربرِ لاگین‌شده، realtime.routes) یک پیامِ
    // «شاید اعلان تازه داری» می‌دهد؛ مشتری خودش invalidate/رفچ می‌زند.
    // فایر-اند-فورگت + try/catch — قانون طلایی.
    try {
      this.deps.hub.publish('notify:all', { event: 'notification', data: { reason: 'broadcast' } })
    } catch (err) {
      console.error('[notify] broadcast: publish notify:all ناموفق:', err)
    }
    return { targeted: inserted }
  }

  /**
   * stage-52 — کانال چهارم (اختصاصی): notifyAdminsNewOrder
   * سفارش جدید صف زنده ⇒ Web Push به ادمین‌های اصلی و سطح ۲.
   * stage-64 — ادمینِ اصلی هم دریافت می‌کند (خواسته‌ی صریح کارفرما؛
   * قبلاً فقط admin2 بود). فراخوان: چک‌اوت تمام-کیف‌پول (order.routes)
   * و نهایی‌شدن موفق پرداخت درگاهی (payment.service.finalize) — همان
   * دو جایی که رویداد SSE ‏order-created روی orders:new منتشر می‌شود.
   *
   *   • هدف: اشتراک‌های فعالِ کاربران role=admin یا admin2 (غیربن).
   *   • فقط «پوش» است: ردیف صندوق نه (unread بی‌پایان برای هر سفارش =
   *     اسپم)، SSE نه (پنل زنده خودش مشترک orders:new است)، ردیف
   *     notification_log نه (تاریخچه با هر سفارش پر می‌شد).
   *   • کلیک ⇒ /admin/admin2/live-orders — notificationclick در SW با
   *     data.url تب را فوکوس/ناو یا پنجره‌ی تازه باز می‌کند.
   *   • urgency=high (RFC 8030) + TTL اختصاصی ۱۵ دقیقه — سفارشِ قدیمی
   *     دیگر خبر فوری نیست.
   *   • قانون طلایی: هرگز throw نمی‌کند؛ چک‌اوت/پرداخت هرگز زمین نمی‌خورد.
   */
  async notifyAdminsNewOrder(input: { displayId: string }): Promise<LiveOrderPushStats> {
    const stats: LiveOrderPushStats = {
      targeted: 0,
      acceptedByPushService: 0,
      gone: 0,
      durationMs: 0,
    }
    const startedAt = Date.now()
    try {
      // ۱) خلاصه‌ی سبک سفارش (نوع ارسال/جمع اقلام/مبلغ) — شکست = بدنه‌ی ساده
      const summary = await this.liveOrderSummary(input.displayId)

      // ۲) اشتراک‌های فعال ادمین‌ها — اصلی و سطح ۲ (join با users برای نقش/بن)
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
            inArray(users.role, ['admin', 'admin2']),
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
        if (outcome.kind === 'ok') stats.acceptedByPushService++
        if (outcome.kind === 'gone') {
          stats.gone++
          goneIds.push(sub.id)
        }
      }
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)
      stats.durationMs = Date.now() - startedAt
      console.log(
        `[notify] سفارش زنده ${input.displayId}: پوش به ${stats.targeted} اشتراک ادمین‌ها ` +
          `(پذیرش سرور پوش ${stats.acceptedByPushService}${stats.gone > 0 ? `، مرده ${stats.gone}` : ''}` +
          `، ${stats.durationMs}ms)`,
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

  /**
   * stage-67 — برشِ TTL: فقط ردیف‌های «۷ روز اخیر» دیده می‌شوند.
   * تایمرِ حذف از createdAt هر ردیف است (تصمیم کارفرما) — مستقل از
   * خوانده‌شدن؛ پس prune قبل از اجرا هم، ردیفِ منقضی هرگز لیست نمی‌شود.
   */
  private inboxCutoff(): Date {
    return new Date(Date.now() - NOTIFICATION_TTL_DAYS * 86_400_000)
  }

  async list(userId: string, limit: number): Promise<NotificationDto[]> {
    const rows = await this.deps.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, this.inboxCutoff())))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(Math.max(1, limit), 50))
    return rows.map(toDto)
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          // stage-67 — هم‌راستا با list: بج شمرده‌نشده فقط ردیف‌های ۷ روز اخیر
          gte(notifications.createdAt, this.inboxCutoff()),
        ),
      )
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
    // stage-77 (N5) — همان پنجره‌ی ۷ روزه‌ی list/unreadCount: قبلاً بدون
    // cutoff بود ⇒ «همه را خواندم» ردیف‌های نامرئیِ (>۷ روز) را هم علامت
    // می‌زد و عددِ marked از بجِ خوانده‌نشده بیشتر می‌شد (ناهماهنگی قرارداد).
    const rows = await this.deps.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          gte(notifications.createdAt, this.inboxCutoff()),
        ),
      )
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
   * stage-67 — گارد «اتمیک» شد (سرانجامِ ① stage-64 که فقط کامنت بود):
   * قبلاً SELECT سپس INSERT دو کوئری بود و در رقابتِ هم‌زمانِ دو درخواست
   * (هر دو SELECTِ خالی می‌دیدند) onConflictDoUpdateِ دومی بی‌صدا مالکیت
   * را می‌دزدید (TOCTOU). حالا یک کوئری: INSERT ... ON CONFLICT DO UPDATE
   * با setWhere(user_id=درخواست‌دهنده) — اگر ردیف موجود مالِ دیگری باشد،
   * WHERE رد می‌شود، هیچ ردیفی آپدیت/برنمی‌گردد ⇒ 409 همان قبلی.
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
      // stage-67 — اتمیک:Returning خالی یعنی conflictِ مالِ دیگری بود
      // (شرطِ setWhere رد شد). مسیر خوش‌بینانه (ردیف تازه یا مال خودم)
      // دقیقاً یک ردیف برمی‌گرداند.
      const rows = await this.deps.db
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
          // stage-67 — قلبِ گارد اتمیک: آپدیتِ تسخیری فقط وقتی مجاز که
          // ردیفِ موجود از قبل مالِ «همین درخواست‌دهنده» باشد
          setWhere: eq(pushSubscriptions.userId, userId),
        })
        .returning({ userId: pushSubscriptions.userId })
      if (rows.length === 0) return { ok: false, reason: 'owned-by-other' }
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

  /** وضعیت اشتراک پوش کاربر (برای UI)
   *  stage-58 — endpoints هم برگردانده می‌شود تا فرانتِ فلوی خودکار بتواند
   *  «سرور از قبل همین اشتراک را دارد؟» را بپرسد و فقط در نبودش POST بزند
   *  (سقف نرخ ۲۰/دقیقه/IP روی NATهای اداری/رستوران با POSTهای بی‌فایده
   *  پر نمی‌شود). فقط مالکِ خودِ کاربر و پشت requireAuth دیده می‌شود. */
  async pushStatus(
    userId: string,
  ): Promise<{ subscriptions: number; endpoints: string[] }> {
    const rows = await this.deps.db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
      .limit(20)
    return { subscriptions: rows.length, endpoints: rows.map((r) => r.endpoint) }
  }

  // ═══ نگهداشت (RetentionJob صدا می‌زند) ═══

  /**
   * پاک‌سازی دوره‌ای — stage-67 (تصمیم کارفرما «الف» + M1 اسکن):
   * هر ردیفِ notifications که ۷ روز از «ایجادش» گذشته حذف می‌شود —
   * خوانده‌شده یا نه (تایمر حذف از createdAt است، نه readAt). قبلاً فقط
   * «خوانده‌شده‌ی ۹۰ روز» پاک می‌شد و چون هیچ کلاینتی read نمی‌زد، جدول
   * بی‌سقف رشد می‌کرد. اشتراک مرده‌ی ۳۰ روز هم مثل قبل پاک می‌شود.
   * شمارش با SELECT جدا (بدون returningِ عظیم — بدون ریسک حافظه) و حذف
   * تک‌کوئری؛ RetentionJob روزانه صدا می‌زند.
   */
  async prune(): Promise<{ notifications: number; subscriptions: number }> {
    let n = 0
    let s = 0
    try {
      const cut = this.inboxCutoff()
      const [row] = await this.deps.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(lt(notifications.createdAt, cut))
      n = row?.count ?? 0
      if (n > 0) {
        await this.deps.db
          .delete(notifications)
          .where(lt(notifications.createdAt, cut))
      }
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

  /** پوش به همه‌ی اشتراک‌های فعال یک کاربر — هم‌زمانی سقف‌دار
   *  stage-64 — tag یکتا به‌ازای ردیف نوتیف (type-notificationId):
   *  دو اطلاعیه‌ی شخصیِ متفاوت دیگر جای هم را نمی‌گیرند؛ فقط
   *  coupon_nudge عمداً ثابت است (یادآورهای تکراری جای هم را بگیرند). */
  private async pushToUser(
    userId: string,
    notificationId: string | null,
    input: NotifyInput,
  ): Promise<{ accepted: number; gone: number }> {
    let accepted = 0
    let gone = 0
    const startedAt = Date.now()
    try {
      const subs = await this.deps.db
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
      if (subs.length === 0) return { accepted: 0, gone: 0 }

      const pushPayload = {
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        url: input.url,
        tag:
          input.type === 'coupon_nudge'
            ? 'coupon-nudge'
            : notificationId
              ? `${input.type}-${notificationId}`
              : input.type,
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
        if (outcome.kind === 'ok') accepted++
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
          .set({ pushAttempted: attempted, pushDelivered: accepted })
          .where(eq(notifications.id, notificationId))
          .catch(() => { /* آماری است — شکست مهم نیست */ })
      }

      // stage-64 — گزارش غنی: شناسه/هدف/پذیرش/مرده/مدت + نمونه‌ی خطاها
      if (outcomes.length > 0) {
        const errors = summarizeOutcomeErrors(outcomes)
        console.log(
          `[notify] پوش شخصی (${input.type}/${notificationId ?? 'no-id'}): ` +
            `هدف ${attempted}، پذیرش سرور پوش ${accepted}` +
            `${gone > 0 ? `، مرده ${gone}` : ''}، ${Date.now() - startedAt}ms` +
            `${errors ? `، خطاها: ${errors}` : ''}`,
        )
      }
    } catch (err) {
      console.error(`[notify] pushToUser برای ${userId} ناموفق:`, err)
    }
    return { accepted, gone }
  }

  /**
   * پوش به مشترکانِ فعالِ مخاطبانِ broadcast — بدون ساخت ردیف اضافه.
   * stage-64 — مخاطب دقیقاً هم‌راستای صندوق شد: join با users و فیلتر
   * role='user' + bannedAt IS NULL (قبلاً همه‌ی اشتراک‌های فعال — حتی
   * ادمین/کاربرِ بن‌شده — پوش می‌گرفتند در حالی که ردیف صندوق نداشتند؛
   * پیامِ نمایش‌داده‌شده بدون ردیف صندوق ناهماهنگی داده می‌ساخت).
   * tag یکتا = type-logId — اطلاعیه‌های متفاوت جای هم را نمی‌گیرند.
   * stage-67 — هم‌راستاییِ کامل با برشِ صندوق: همان مرتب‌سازی
   * desc(users.createdAt) + (در صورت سقفِ ۵۰k) فیلترِ cutoff که خودِ
   * broadcast از آخرین ردیفِ مخاطب حساب کرد — قبلاً پوش بی‌order بود و
   * زیرمجموعه‌ی کاربرانِ متفاوتی از صندوق می‌گرفت.
   */
  private async pushToSubscribedUsers(
    input: NotifyInput,
    logId?: string | null,
    audienceCutoff?: Date | null,
  ): Promise<void> {
    const startedAt = Date.now()
    try {
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
            isNull(pushSubscriptions.disabledAt),
            eq(users.role, 'user'),
            isNull(users.bannedAt),
            // stage-67 — برشِ همان ۵۰k کاربرِ صندوق (فقط وقتی به سقف رسیدیم)
            ...(audienceCutoff ? [gte(users.createdAt, audienceCutoff)] : []),
          ),
        )
        // stage-67 — هم‌ترتیب با صندوق: desc(users.createdAt)
        .orderBy(desc(users.createdAt))
        .limit(BROADCAST_MAX_AUDIENCE)
      if (subs.length === 0) return
      const pushPayload = {
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        url: input.url,
        tag: logId ? `${input.type}-${logId}` : input.type,
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
      let accepted = 0
      for (const { sub, outcome } of outcomes) {
        if (outcome.kind === 'ok') accepted++
        if (outcome.kind === 'gone') goneIds.push(sub.id)
      }
      // stage-48 — همان آمار خطای پیاپی (تلاش مجدد دوره‌ای بعدی تصمیم می‌گیرد)
      // stage-55 — آمار دسته‌ای + غیرفعال‌سازی مرده‌ها دسته‌ای (حداکثر ۳ کوئری)
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)
      // stage-64 — گزارش غنی: هدف/پذیرش/مرده/مدت + خطاها
      const errors = summarizeOutcomeErrors(outcomes)
      console.log(
        `[notify] broadcast push (${input.type}/${logId ?? 'no-id'}): هدف ${outcomes.length}، ` +
          `پذیرش سرور پوش ${accepted}${goneIds.length > 0 ? `، مرده ${goneIds.length}` : ''}، ` +
          `${Date.now() - startedAt}ms${errors ? `، خطاها: ${errors}` : ''}`,
      )
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
   *  • fail قطعی (۴xx غیر از 429 — 400/401/403/413…) ⇒ failures+1؛ با
   *    رسیدن به سقف، اشتراک غیرفعال می‌شود تا فان‌آوت‌های بعدی مسدود نمانند.
   *  • stage-64 — fail «موقت» (شبکه/مهلت/429/5xx) دیگر شمرده نمی‌شود:
   *    اختلالِ مسیر خروجی (ایران↔FCM) چند ساعت طول می‌کشید و ۵ پخشِ
   *    ناموفق همه‌ی اشتراک‌ها را از کار می‌انداخت؛ بازیابی فقط با
   *    باز شدن دوباره‌ی سایت (reconcile) بود. اشتراکِ واقعاً خراب بالاخره
   *    404/410 (gone) یا 4xx قطعی می‌دهد و همان مسیرها او را می‌گیرند.
   */
  private async recordPushOutcomesBatch(outcomes: PushOutcomeItem[]): Promise<void> {
    if (outcomes.length === 0) return
    const okIds: string[] = []
    const failIds: string[] = []
    for (const { sub, outcome } of outcomes) {
      if (outcome.kind === 'ok') okIds.push(sub.id)
      else if (outcome.kind === 'fail' && isPermanentPushFailure(outcome)) failIds.push(sub.id)
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

  /**
   * stage-48 — درج ردیف تاریخچه‌ی ارسال (notification_log)
   * stage-64 — شناسه‌ی ردیف برگردانده می‌شود: tag یکتای پوشِ broadcast
   * (type-logId) — اطلاعیه‌های متفاوت جای هم را نمی‌گیرند.
   */
  private async logBroadcast(
    input: NotifyInput,
    audience: number,
    sender?: NotifySender,
  ): Promise<string | null> {
    const [row] = await this.deps.db
      .insert(notificationLog)
      .values({
        type: input.type,
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        url: input.url?.slice(0, 300) ?? null,
        audience,
        senderRole: sender?.role ?? 'system',
        senderName: sender?.name?.slice(0, 120) ?? null,
      })
      .returning({ id: notificationLog.id })
    return row?.id ?? null
  }

  /**
   * stage-64 — پوش تستی: اعتبارسنجیِ سرِتا‌سرِ خط پوش برای «خودِ کاربر».
   *
   * هدفِ ممیزی: بعد از فلوی مجوزِ مبتنی بر کلیک (بنر PushAutoPrompt)،
   * ادمین/کاربر بتواند فوراً بفهمد «اشتراک ثبت شده؟ رمزنگاری درست؟ سرور
   * پوش قبول می‌کند؟» — بدون ساخت ردیف صندوق/تاریخچه (این یک عیب‌یابی
   * است، نه اطلاعیه).
   *
   *  • فقط اشتراک‌های فعالِ خودِ کاربر هدف‌اند (نرخ‌سقف IP هم روی روت).
   *  • tag ثابت 'test-push': پوش‌های تستی جای هم را می‌گیرند (اسپم نمی‌سازند)
   *    و renotify در SW باعث زنگ دوباره می‌شود.
   *  • TTL کوتاه (۵ دقیقه): پیام تستیِ دیررس معنا ندارد.
   *  • قانون طلایی: هرگز throw نمی‌کند؛ آمار برمی‌گردد تا UI راهنمایی کند.
   */
  async sendTestPush(userId: string): Promise<TestPushStats> {
    const stats: TestPushStats = {
      targeted: 0,
      acceptedByPushService: 0,
      gone: 0,
      durationMs: 0,
    }
    const startedAt = Date.now()
    try {
      const subs = await this.deps.db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
        .limit(20)
      if (subs.length === 0) {
        stats.durationMs = Date.now() - startedAt
        return stats
      }

      const pushPayload: PushPayload = {
        title: '🔔 پوش تستی سین‌شین',
        body: 'اگر این پیام را روی دستگاه می‌بینید، خط پوش این دستگاه سالم است ✅',
        url: '/products',
        tag: 'test-push',
        ttl: 300,
        data: { kind: 'test-push', at: new Date().toISOString() },
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
        stats.targeted++
        if (outcome.kind === 'ok') stats.acceptedByPushService++
        if (outcome.kind === 'gone') {
          stats.gone++
          goneIds.push(sub.id)
        }
      }
      await this.recordPushOutcomesBatch(outcomes)
      await this.disableSubscriptionsBatch(goneIds)
      stats.durationMs = Date.now() - startedAt
      const errors = summarizeOutcomeErrors(outcomes)
      console.log(
        `[notify] پوش تستی برای ${userId}: هدف ${stats.targeted}، ` +
          `پذیرش سرور پوش ${stats.acceptedByPushService}${stats.gone > 0 ? `، مرده ${stats.gone}` : ''}` +
          `، ${stats.durationMs}ms${errors ? `، خطاها: ${errors}` : ''}`,
      )
    } catch (err) {
      console.error(`[notify] پوش تستی برای ${userId} ناموفق:`, err)
      stats.durationMs = Date.now() - startedAt
    }
    return stats
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

/**
 * stage-64 — شکستِ «قطعی» پوش؟ فقط ۴xxِ غیر از 429 (اشتراک/کلید خراب —
 * 400/401/403/413…). خطای بی‌وضعیت (شبکه/مهلت)، 429 و 5xx «موقت»ند و
 * شمارنده‌ی failures را بالا نمی‌برند (توضیح کامل در recordPushOutcomesBatch).
 */
function isPermanentPushFailure(outcome: { kind: 'fail'; status?: number; error?: string }): boolean {
  if (outcome.status === undefined) return false // شبکه/مهلت — موقت
  if (outcome.status === 429 || outcome.status >= 500) return false // شلوغی/سرور — موقت
  return outcome.status >= 400 // ۴xx قطعی (به‌جز ۴۰۴/۴۱۰ که gone هستند)
}

/**
 * stage-64 — نمونه‌ی خطاهای فان‌اوت برای گزارش غنی: «HTTP 401×2, timeout×1».
 * فقط برای لاگ/مشخصه‌های روت test-push است — مسیر اصلی هرگز گیرش نمی‌کند.
 */
function summarizeOutcomeErrors(outcomes: PushOutcomeItem[]): string {
  const counts = new Map<string, number>()
  for (const { outcome } of outcomes) {
    if (outcome.kind !== 'fail') continue
    const label =
      outcome.status !== undefined ? `HTTP ${outcome.status}` : outcome.error ?? 'network'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  if (counts.size === 0) return ''
  return [...counts.entries()].map(([label, n]) => `${label}×${n}`).join(', ')
}

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