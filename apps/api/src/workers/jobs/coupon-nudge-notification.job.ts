// ═══════════════════════════════════════════════════════════════
// stage-69 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-notification.job.ts
// ویرایش نقطه‌ای (اسکن post-s67 — F3 + F4):
//   F3 — re-check لحظه‌ی ارسال: فقط users.role = «user» (ادمین/ادمین₂
//        یادآور نمی‌گیرند — همان قرارداد broadcast؛ ردیف‌های legacyِ
//        ساخته‌شده پیش از فیلترِ اسکن هم همین‌جا متوقف می‌شوند)
//   F4 — ارقام متن اعلان یکدست فارسی: «٪۱۵» به‌جای «٪15»
//        (gapLabel از همان faNum قرارداد domain/report/format)
// ترتیب «اول ارسال بعد claim»، ستون sms_sent_at، re-checkهای
// stage-66/67 و بقیه‌ی منطق عیناً دست‌نخورده.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-68 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-notification.job.ts
// وضعیت: فقط rename فایل (خواسته‌ی صریح کارفرما) —
//   coupon-nudge-sms.job.ts → coupon-nudge-notification.job.ts
//   این جاب از فاز-۲ هیچ پیامکی نمی‌فرستد (notifyUser = صندوق درون‌بری
//   + SSE + Web Push)؛ نام قدیمی از دوره‌ی پیامک مانده بود. منطق،
//   ترتیب claim، ستون sms_sent_at و رفتار جاب عیناً دست‌نخورده —
//   فقط نام فایل و ارجاعات import اصلاح شد (نکته‌ی کارفرما + اسکن).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-notification.job.ts
//   (stage-68: نام قدیمی coupon-nudge-sms.job.ts — پیش از rename)
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی stage-66)
// تغییر (ترمیم اسکن کوپن×نوتیفیکیشن):
//   ⑤-باقی‌مانده پنجره‌ی crash: ترتیب عوض شد — «اول ارسال، بعد claim».
//     قبلاً claim (smsSentAt) قبل از notifyUser ست می‌شد؛ کرشِ پروسه بین
//     آن دو یعنی سهمِ سقف-۲ سوخته بدون هیچ اعلانی. حالا claim فقط بعد
//     از موفقیتِ notifyUser ست می‌شود؛ شکست/کرش = ردیف pending می‌ماند
//     (retry ممکن، سهم نمی‌سوزد). هزینه‌ی پنجره‌ی جدیدِ کرش (بین ارسال
//     و claim) حداکثر یک تکرار است — tag پوش 'coupon-nudge' به‌عمد
//     جایگزین‌شونده است، پس بی‌ضرر.
//   M3-اسکن re-check کامل در لحظه‌ی ارسال (علاوه بر فعال/انقضا/ظرفیتِ
//     stage-66): ① کاربر بن شده حذف (users.bannedAt) ② cronEnabled در
//     لحظه‌ی ارسال ③ گرنتِ بین اسکن و ارسال (کاربر از راه دیگری کوپن
//     گرفته — یادآورِ «فاصله تا کوپن» دیگر دروغ است).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-66 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-notification.job.ts
//   (stage-68: نام قدیمی coupon-nudge-sms.job.ts — پیش از rename)
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (راند ترمیم کوپن + هماهنگی با سرویس نوتیفیکیشن):
//   ⑤ شکستِ notifyUser (id=null — هرگز throw نمی‌کند) → آزادسازی claim
//     ردیف (smsSentAt=null) تا اجرای مجدد/دستی همان روز retry کند؛ قبلاً
//     ردیف claim شده و کاربر یادآور را هرگز نمی‌گرفت
//   ④/③ re-check در لحظه‌ی ارسال: غیرفعال/منقضی/ظرفیت‌پُر بعد از اسکن
//     شبانه → ارسال نمی‌شود (innerJoin coupons با فیلتر)
//   سیاست ۲ — پیامِ «پیشرفت واقعی»: remainingCount + نوع شرط ⇒
//   «۳ سفارش تا کوپن…» (اعداد فارسی؛ مبلغ با جداکننده)؛ ردیف‌های قدیمیِ
//   بدون remainingCount → متن جایگزین «یک قدم» همان قبل.
// ═══════════════════════════════════════════════════════════════

//src/workers/jobs/coupon-nudge-notification.job.ts (بازنویسی فاز-۲ + stage-66/67؛ stage-68 rename)
import { and, eq, isNull, notExists, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { NotificationService } from '#/domain/notification/notification.service'
import type { CouponService } from '#/domain/coupon/coupon.service'
import { couponConditions, couponGrants, couponNudges, users, coupons } from '#/infra/db/schema'
// stage-69 (F4) — رقم فارسی متن اعلان (قرارداد واحد domain/report/format)
import { faNum } from '#/domain/report/format'
import type { DailyJob } from '#/workers/scheduler'

const DEADLINE_HOUR = 13 // تهران — بعد از ناهار یادآور بی‌معنی است

/** سیاست ۲ — فاصله‌ی واقعی به «واحد خودِ شرط» — اعداد فارسی */
function gapLabel(type: string, remaining: number): string {
  // stage-69 (F4) — همان خروجی قبلی، حالا از قرارداد واحد faNum
  const n = faNum(remaining)
  switch (type) {
    case 'MIN_TOTAL_SPEND':
      return `${n} تومان خرید`
    case 'MIN_REFERRAL_SPEND':
      return `${n} تومان خرید دوستان`
    case 'REGISTERED_DAYS_AGO':
      return `${n} روز`
    case 'MIN_REFERRALS':
      return `${n} معرفی`
    case 'MIN_REFERRAL_ORDERS':
      return `${n} سفارش دوستان`
    case 'MIN_PRODUCT_ORDERS':
      return `${n} عدد از محصول انتخابی`
    case 'MIN_CATEGORY_ORDERS':
      return `${n} خرید از دسته‌ی انتخابی`
    case 'ORDERS_IN_LAST_DAYS':
    case 'MIN_ORDERS_COUNT':
    default:
      return `${n} سفارش`
  }
}

/**
 * فاز-۲ — یادآور کوپن «پیش از ناهار» (۱۱:۰۰ تهران) — با پوش
 * نوتیفیکیشن به‌جای پیامک (سیستم کاستوم Web Push + صندوق درون‌بری).
 *
 *  • منطق ضد-تکرار: فقط scan_date = امروز و smsSentAt IS NULL.
 *  • stage-67 — «اول ارسال، بعد claim»: claim بعد از notifyUser موفق
 *    ست می‌شود (کامنت سربرگ)؛ ردیفِ شکست‌خورده pending می‌ماند و سهمِ
 *    سقف ۲ را نمی‌سوزاند. releaseNudgeClaim در سرویس به‌عنوان ابزار
 *    عملیاتی (بازنشانی دستی) باقی است.
 *  • کاربر بدون اشتراک پوش: ردیف صندوق (stage-67: صفحه‌ی «صندوق
 *    اعلان‌ها» در پروفایل — مصرف‌کننده‌ی واقعیِ همین ردیف‌ها).
 *  • تکرارناپذیر: یکتایی (user, coupon, scan_date) — بدون تکرار بین رپلیکاها.
 *  • بعد از ۱۳:۰۰ توقف.
 */
export class CouponNudgeJob implements DailyJob {
  readonly name = 'coupon-nudge'
  readonly time: string
  readonly catchUp = false

  constructor(
    private readonly deps: {
      config: AppConfig
      db: Db
      notifications: NotificationService
      coupons: CouponService
    },
  ) {
    this.time = deps.config.couponNudgeTime
  }

  async run(): Promise<void> {
    const hour = Number.parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        hour12: false,
      }).format(new Date()),
      10,
    )
    if (hour >= DEADLINE_HOUR) {
      console.log('[cron:coupon-nudge] past 13:00 Tehran — skipping today')
      return
    }

    const { db } = this.deps

    // تاریخ امروزِ تهران یک‌جا (فاز-۱/phase-5 — نه CURRENT_DATE یعنی UTC)
    const scanDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

    // stage-66 (④/③) + stage-67 (M3) — re-check کامل در لحظه‌ی ارسال.
    // بین اسکن (۰۲:۰۰) و ارسال (۱۱:۰۰) هرکدام از این‌ها رخ داده باشد،
    // یادآور بی‌معنی/مزاحم است و ارسال نمی‌شود:
    //   • کوپن غیرفعال/منقضی/ظرفیت‌پُر شده (stage-66)
    //   • کوپن از فرآیند کرون خارج شده (cronEnabled — stage-67)
    //   • کاربر بن شده (stage-67)
    //   • کاربر از راه دیگری گرنت گرفته — مثلاً تسویه‌ی سفارشِ صبح
    //     (stage-67؛ پیامِ «۳ سفارش تا کوپن» دیگر دروغ است)
    // innerJoin روی missingConditionId: ردیف‌های set-null (ویرایش شرط‌های
    // stage-67) از اینجا به بعد قابل ارسال نیستند — به‌عمد.
    const pending = await db
      .select({
        nudgeId: couponNudges.id,
        userId: couponNudges.userId,
        couponTitle: coupons.title,
        couponCode: coupons.code,
        discountPercentage: coupons.discountPercentage,
        missingCount: couponNudges.missingCount,
        remainingCount: couponNudges.remainingCount,
        conditionType: couponConditions.type,
      })
      .from(couponNudges)
      .innerJoin(users, eq(users.id, couponNudges.userId))
      .innerJoin(coupons, eq(coupons.id, couponNudges.couponId))
      .innerJoin(couponConditions, eq(couponConditions.id, couponNudges.missingConditionId))
      .where(
        and(
          sql`${couponNudges.scanDate} = ${scanDateStr}::date`,
          isNull(couponNudges.smsSentAt),
          eq(coupons.isActive, true),
          eq(coupons.cronEnabled, true),
          sql`(${coupons.endsAt} is null or ${coupons.endsAt} > now())`,
          sql`(${coupons.maxUses} = 0 or ${coupons.usedCount} < ${coupons.maxUses})`,
          // stage-67 (M3) — کاربر بن‌شده: یادآورِ بن‌شده نخرید
          isNull(users.bannedAt),
          // stage-69 (F3) — فقط مشتری: ادمین/ادمین₂ یادآور جذب مشتری
          // نمی‌گیرند (همان قرارداد broadcast؛ ردیف‌های legacyِ پیش از
          // فیلترِ اسکن هم همین‌جا متوقف می‌شوند)
          eq(users.role, 'user'),
          // stage-67 (M3) — گرنتِ تازه: کاربر دیگر کوپن را دارد
          notExists(
            db
              .select({ one: sql`1` })
              .from(couponGrants)
              .where(
                and(
                  eq(couponGrants.couponId, couponNudges.couponId),
                  eq(couponGrants.userId, couponNudges.userId),
                ),
              ),
          ),
        ),
      )

    let sent = 0
    let skipped = 0
    for (const row of pending) {
      // سیاست ۲ — فاصله‌ی واقعی؛ ردیف قدیمی بدون remaining → «یک قدم»
      const gap =
        row.remainingCount !== null && row.remainingCount !== undefined && row.remainingCount > 0
          ? gapLabel(row.conditionType, row.remainingCount)
          : 'یک قدم'
      const title = row.couponTitle ?? row.couponCode

      // stage-67 (⑤) — «اول ارسال، بعد claim»: notifyUser هرگز throw
      // نمی‌کند؛ id=null یعنی درج صندوق/پوش نشد. ردیف همان‌طور pending
      // می‌ماند (smsSentAt=null) — سهمِ سقف ۲ نمی‌سوزد و اجرای مجددِ
      // همان روز (دستی/اصلاح‌شده) دوباره تلاش می‌کند.
      const res = await this.deps.notifications.notifyUser(row.userId, {
        type: 'coupon_nudge',
        title: `🎁 ${gap} تا کوپن تخفیف!`,
        body:
          `تا کوپن «${title}» ` +
          `(٪${faNum(row.discountPercentage)} تخفیف) فاصله دارید — سفارش بعدی‌تان را ثبت کنید.`,
        url: '/products',
        data: {
          couponCode: row.couponCode,
          missingCount: row.missingCount,
          remainingCount: row.remainingCount,
        },
      })
      if (res.id === null) {
        skipped++
        console.warn(
          `[cron:coupon-nudge] nudge ${row.nudgeId} failed to notify — left pending for retry (claim not set)`,
        )
        continue
      }

      // تصرف «فقط همین ردیف» و فقط اگر هنوز کسی نگرفته — پس از ارسالِ
      // موفق. گارد isNull(smsSentAt) در برابر اجرای موازی دومی است.
      const claimed = await db
        .update(couponNudges)
        .set({ smsSentAt: new Date() })
        .where(
          and(
            eq(couponNudges.id, row.nudgeId),
            isNull(couponNudges.smsSentAt),
          ),
        )
        .returning({ id: couponNudges.id })
      if (claimed.length === 0) {
        // قبلاً (بین ارسال و claim) کسی دیگر claim کرد — ارسالِ ما
        // تکرارِ بی‌خطرِ همان پیام بود (tag پوش جایگزین‌شونده است)
        skipped++
        continue
      }
      sent++
    }

    console.log(
      `[cron:coupon-nudge] sent ${sent}/${pending.length} nudge notification(s)` +
        `${skipped > 0 ? `, ${skipped} skipped/pending` : ''} ` +
        '(in-app + web push; کاربر بدون اشتراک پوش فقط صندوق درون‌بری)',
    )
  }
}