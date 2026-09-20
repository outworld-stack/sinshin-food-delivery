//src/workers/jobs/coupon-scan.job.ts
import { and, eq, isNull } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import { couponConditions, couponNudges, coupons } from '#/infra/db/schema'
import type { CouponService } from '#/domain/coupon/coupon.service'
import { asConditionId } from '#/domain/shared/brand'
import type { DailyJob } from '#/workers/scheduler'

/**
 * اسکن شبانه‌ی شایستگی کوپن — ۰۲:۰۰ تهران.
 * کاربرانی که «همه‌ی شرط‌ها به‌جز یکی» دارند و گرنت ندارند → coupon_nudges.
 * اعطای واقعی: لحظه‌ی settle سفارش.
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

    const active = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.isActive, true),
          eq(coupons.isPublic, false),
          isNull(coupons.endsAt),
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

      const candidates = await this.deps.coupons.findNudgeCandidates(coupon.id)

      for (const c of candidates) {
        // شرطِ ناقص برای گزارش — ایندکس امن (kاملپ)
        const idx = Math.max(0, Math.min(c.missingCount - 1, conditions.length - 1))
        const missingCondition = conditions[idx]

        await db
          .insert(couponNudges)
          .values({
            userId: c.userId,
            couponId: coupon.id,
            missingConditionId: asConditionId(missingCondition?.id ?? conditions[0]!.id),
            missingCount: c.missingCount,
            scanDate,
          })
          .onConflictDoNothing()
        totalNudges++
      }

      console.log(
        `[cron:coupon-scan] coupon "${coupon.title ?? coupon.code}": ${candidates.length} nudge candidate(s)`,
      )
    }

    console.log(`[cron:coupon-scan] total ${totalNudges} nudge row(s) for ${scanDate}`)
  }
}