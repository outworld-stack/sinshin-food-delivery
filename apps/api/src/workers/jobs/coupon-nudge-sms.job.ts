//src/workers/jobs/coupon-nudge-sms.job.ts
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import { couponNudges, users, coupons } from '#/infra/db/schema'
import type { DailyJob } from '#/workers/scheduler'

const DEADLINE_HOUR = 13 // تهران — بعد از ناهار nudge بی‌معنی است

/**
 * پیامک nudge پیش از ناهار (۱۱:۰۰ تهران — قبل از اوج).
 * idempotent به‌کلیت ساختار:
 *  - فقط scan_date = امروز و sms_sent_at IS NULL
 *  - اول claim (فلیپ sms_sent_at) بعد ارسال → crash-safe
 *  - unique (user, coupon, scan_date) → بدون تکرار بین رپلیکاها
 *  - بعد از ۱۳:۰۰ توقف
 */
export class CouponNudgeSmsJob implements DailyJob {
  readonly name = 'coupon-nudge-sms'
  readonly time: string
  readonly catchUp = false

  constructor(
    private readonly deps: { config: AppConfig; db: Db; sms: SmsService },
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

    // phase-5: تاریخ امروزِ تهران یک‌جا — قبلاً pending با CURRENT_DATE
    // (در PG یعنی UTC!) و claim با رشته‌ی تهران بود؛ ناسازگار در ۰۰:۰۰–۰۳:۳۰ تهران
    const scanDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

    const pending = await db
      .select({
        nudgeId: couponNudges.id,
        phone: users.phone,
        couponTitle: coupons.title,
        couponCode: coupons.code,
        missingCount: couponNudges.missingCount,
      })
      .from(couponNudges)
      .innerJoin(users, eq(users.id, couponNudges.userId))
      .innerJoin(coupons, eq(coupons.id, couponNudges.couponId))
      .where(
        and(sql`${couponNudges.scanDate} = ${scanDateStr}::date`, isNull(couponNudges.smsSentAt)),
      )

    let sent = 0
    for (const row of pending) {
      // ── phase-5 (باگ لیست): claim «فقط همین ردیف» ──
      // قبلاً nudgeId در WHERE نبود → دور اول همه‌ی pending های امروز را
      // claim می‌کرد؛ فقط یک SMS می‌رفت و بقیه بی‌پیامک مارک می‌شدند!
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

      const gap =
        row.missingCount && row.missingCount > 1 ? `${row.missingCount} قدم` : 'یک قدم'

      const ok = await this.deps.sms.send(
        row.phone,
        `${gap} تا رسیدن به کوپن تخفیف «${row.couponTitle ?? row.couponCode}» فاصله دارید! ` +
        'سفارش بعدی‌تان را ثبت کنید تا شانس دریافت کوپن را از دست ندهید.',
      )
      if (ok) sent++
    }

    console.log(
      `[cron:coupon-nudge] sent ${sent}/${pending.length} nudge SMS (gateway: ${this.deps.sms.describe()})`,
    )
  }
}