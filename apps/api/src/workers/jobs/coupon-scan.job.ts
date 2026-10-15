// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-scan.job.ts
// ویرایش نقطه‌ای: گارد «پنجره‌ی ارسال گذشته» — این جاب catchUp=true است؛
// بوتِ دیرهنگام (مثلاً ۱۵:۰۰ بعد از قطعِ شبانه) اسکن را جبران می‌کرد و
// ردیف‌های امروز را می‌ساخت در حالی که جابِ ارسال (۱۱:۰۰، catchUp=false،
// ددلاین ۱۳) دیگر هرگز امروز اجرا نمی‌شود ⇒ ردیف‌های مرده (تا ۹۰ روز
// در جدول می‌ماندند). حالا اگر ساعتِ تهران از COUPON_NUDGE_TIME گذشته
// باشد، اسکن امروز را رد می‌کند — اسکنِ فردا با همان نامزدها پر می‌شود.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-66 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-scan.job.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (راند ترمیم کوپن):
//   ④ isNull(endsAt) → «بدون انقضا یا آینده» — قبلاً کوپن‌های تاریخ‌دارِ
//     آینده از کرون حذف می‌شدند (یادآور و اعطای کرونی برایشان هیچ‌وقت
//     اجرا نمی‌شد)
//   ③ ظرفیت: کوپنِ پرشده (maxUses رسیده) اسکن نمی‌شود — یادآورِ کوپنی
//     که دیگر اعطا نمی‌شود، مزاحم است
//   نامزدها حالا «شرط ناقص واقعی» + «فاصله‌ی واقعی» دارند (سرویس
//   findNudgeCandidates بازنویسی شد — N4/سیاست ۲) و ذخیره‌ی remainingCount
//   در ردیف nudge برای پیام «۳ سفارش تا کوپن» در جابِ ارسال.
//   سقف ۲ یادآور به‌ازای کاربر-کوپن (سیاست ۳) داخل کوئری نامزدهاست.
// ═══════════════════════════════════════════════════════════════

//src/workers/jobs/coupon-scan.job.ts
import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import { couponConditions, couponNudges, coupons } from '#/infra/db/schema'
import type { CouponService } from '#/domain/coupon/coupon.service'
import { asConditionId } from '#/domain/shared/brand'
import type { DailyJob } from '#/workers/scheduler'

/**
 * اسکن شبانه‌ی شایستگی کوپن — ۰۲:۰۰ تهران.
 * کاربرانی که «همه‌ی شرط‌ها به‌جز یکی» دارند و گرنت ندارند → coupon_nudges.
 * اعطای واقعی: لحظه‌ی تسویه سفارش.
 */
export class CouponScanJob implements DailyJob {
  readonly name = 'coupon-eligibility-scan'
  readonly time: string
  readonly catchUp = true

  constructor(
    private readonly deps: { config: AppConfig; db: Db; coupons: CouponService },
  ) {
    this.time = deps.config.couponScanTime
  }

  async run(): Promise<void> {
    const { db } = this.deps

    // stage-67 — گارد پنجره‌ی ارسال (کامنت سربرگ): اگر الان در تهران
    // گذشته‌تر از ساعتِ ارسالِ یادآور (COUPON_NUDGE_TIME) است، ردیف‌های
    // امروز دیگر فرستاده نمی‌شوند — اسکنِ «همین حالا» فقط ردیف مرده
    // می‌سازد. مقایسه‌ی رشته‌ای HH:MM صفر-پَدشده ترتیب زمانی درست می‌دهد.
    const nowHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())
    if (nowHm >= this.deps.config.couponNudgeTime) {
      console.log(
        `[cron:coupon-scan] ${nowHm} Tehran is past nudge time (${this.deps.config.couponNudgeTime}) — ` +
          'skipping today (rows would never be sent; tomorrow\'s scan covers them)',
      )
      return
    }

    // stage-48 — فقط کوپن‌هایی که با سوییچِ فرم وارد فرآیند کرون شده‌اند
    // (cronEnabled=false ⇒ اسکن/یادآور برایش اجرا نمی‌شود — اعطای لحظه‌ی
    // تسویه جدا از این فرآیند است و دست‌نخورده می‌ماند).
    // stage-66 (④/③) — «فعال» یعنی: روشن + شروع‌شده + منقضی‌نشده + ظرفیتِ
    // باقی‌مانده. قبلاً isNull(endsAt) کوپن‌های تاریخ‌دارِ آینده را کامل حذف
    // می‌کرد و ظرفیت هم چک نمی‌شد.
    const active = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.isActive, true),
          eq(coupons.isPublic, false),
          eq(coupons.cronEnabled, true),
          sql`(${coupons.endsAt} is null or ${coupons.endsAt} > now())`,
          sql`(${coupons.maxUses} = 0 or ${coupons.usedCount} < ${coupons.maxUses})`,
        ),
      )

    if (active.length === 0) {
      console.log('[cron:coupon-scan] no active private coupons — nothing to do')
      return
    }

    const scanDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

    let totalNudges = 0

    for (const coupon of active) {
      const conditions = await db
        .select()
        .from(couponConditions)
        .where(eq(couponConditions.couponId, coupon.id))
      if (conditions.length === 0) continue

      // stage-66 — نامزد با «اولین شرطِ ناقصِ واقعی» (قطعی — نه ایندکس
      // دلبخواهی) + فاصله‌ی واقعی تا سقف همان شرط (remainingCount).
      const candidates = await this.deps.coupons.findNudgeCandidates(coupon.id)

      // رارد ۴۸ (اسکن C8) — درج دسته‌ای (۵۰۰تایی) به‌جای یک INSERT به‌ازای
      // هر کاندید؛ سقف کاندیدها ۵۰۰۰ است و شبانه تا هزاران رفت‌وبرگشت می‌شد.
      // یکتایی (userId,couponId,scanDate) با onConflictDoNothing همان قبل حفظ می‌شود.
      const values = candidates.map((c) => ({
        userId: c.userId,
        couponId: coupon.id,
        missingConditionId: asConditionId(c.missingConditionId),
        missingCount: c.missingCount,
        remainingCount: c.remainingCount,
        scanDate,
      }))
      for (let i = 0; i < values.length; i += 500) {
        await db
          .insert(couponNudges)
          .values(values.slice(i, i + 500))
          .onConflictDoNothing()
      }
      totalNudges += values.length

      console.log(
        `[cron:coupon-scan] coupon "${coupon.title ?? coupon.code}": ${candidates.length} nudge candidate(s)`,
      )
    }

    console.log(`[cron:coupon-scan] total ${totalNudges} nudge row(s) for ${scanDate}`)
  }
}