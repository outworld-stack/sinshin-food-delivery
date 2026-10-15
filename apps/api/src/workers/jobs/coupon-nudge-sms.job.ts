// ═══════════════════════════════════════════════════════════════
// stage-66 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-sms.job.ts
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

//src/workers/jobs/coupon-nudge-sms.job.ts (بازنویسی فاز-۲ + stage-66)
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { NotificationService } from '#/domain/notification/notification.service'
import type { CouponService } from '#/domain/coupon/coupon.service'
import { couponConditions, couponNudges, users, coupons } from '#/infra/db/schema'
import type { DailyJob } from '#/workers/scheduler'

const DEADLINE_HOUR = 13 // تهران — بعد از ناهار یادآور بی‌معنی است

/** سیاست ۲ — فاصله‌ی واقعی به «واحد خودِ شرط» — اعداد فارسی */
function gapLabel(type: string, remaining: number): string {
  const n = Number(remaining).toLocaleString('fa-IR')
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
 *  • منطق ضد-تکرار: فقط scan_date = امروز و smsSentAt IS NULL؛
 *    اول تصرف بعد ارسال → امن در برابر کرش.
 *  • stage-66 (⑤): اگر notifyUser شکست بخورد (id=null) claim آزاد
 *    می‌شود (releaseNudgeClaim) — retry در اجرای بعدی همان روز ممکن است.
 *  • کاربر بدون اشتراک پوش: فقط ردیف صندوق درون‌بری (SSE + لیست).
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

    // stage-66 (④/③) — re-check در لحظه‌ی ارسال: کوپن بین اسکن (۰۲:۰۰)
    // و ارسال (۱۱:۰۰) غیرفعال/منقضی/پُرشده باشد → یادآورش بی‌معنی و مزاحم
    // است. innerJoin روی missingConditionId امن است (FK cascade — شرط حذف
    // شود، ردیف nudge هم هست).
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
          sql`(${coupons.endsAt} is null or ${coupons.endsAt} > now())`,
          sql`(${coupons.maxUses} = 0 or ${coupons.usedCount} < ${coupons.maxUses})`,
        ),
      )

    let sent = 0
    let released = 0
    for (const row of pending) {
      // تصرف «فقط همین ردیف» (فاز-۱/phase-5 — باگ لیست) — اول claim بعد ارسال
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
      if (claimed.length === 0) continue

      // سیاست ۲ — فاصله‌ی واقعی؛ ردیف قدیمی بدون remaining → «یک قدم»
      const gap =
        row.remainingCount !== null && row.remainingCount !== undefined && row.remainingCount > 0
          ? gapLabel(row.conditionType, row.remainingCount)
          : 'یک قدم'
      const title = row.couponTitle ?? row.couponCode

      const res = await this.deps.notifications.notifyUser(row.userId, {
        type: 'coupon_nudge',
        title: `🎁 ${gap} تا کوپن تخفیف!`,
        body:
          `تا کوپن «${title}» ` +
          `(٪${row.discountPercentage} تخفیف) فاصله دارید — سفارش بعدی‌تان را ثبت کنید.`,
        url: '/products',
        data: {
          couponCode: row.couponCode,
          missingCount: row.missingCount,
          remainingCount: row.remainingCount,
        },
      })
      if (res.id !== null) {
        sent++
      } else {
        // stage-66 (⑤) — notifyUser هرگز throw نمی‌کند؛ شکستِ درج صندوق/پوش
        // را فقط id=null لو می‌دهد. claim آزاد تا retry بعدی (همان ردیف
        // امروز دوباره pending می‌شود؛ سهمِ سقف ۲ هم نمی‌سوزد).
        released++
        console.warn(
          `[cron:coupon-nudge] nudge ${row.nudgeId} failed to notify — claim released for retry`,
        )
        await this.deps.coupons.releaseNudgeClaim(row.nudgeId).catch(() => {
          /* آزادسازی بهترین‌تلاش است — خطایش ردیف را همان‌ claim نگه می‌دارد */
        })
      }
    }

    console.log(
      `[cron:coupon-nudge] sent ${sent}/${pending.length} nudge notification(s), ` +
        `${released} claim(s) released for retry ` +
        '(in-app + web push; کاربر بدون اشتراک پوش فقط صندوق درون‌بری)',
    )
  }
}