// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/coupon-nudge-sms.job.ts
// وضعیت: جایگزینی کامل فایل موجود — همان مسیر قبلی؛ نام کلاس/job
//   coupon-nudge-sms → coupon-nudge (پیامک حذف شد؛ پوش نوتیفیکیشن است)
// ═══════════════════════════════════════════════════════════════

//src/workers/jobs/coupon-nudge-sms.job.ts (بازنویسی فاز-۲)
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { NotificationService } from '#/domain/notification/notification.service'
import { couponNudges, users, coupons } from '#/infra/db/schema'
import type { DailyJob } from '#/workers/scheduler'

const DEADLINE_HOUR = 13 // تهران — بعد از ناهار یادآور بی‌معنی است

/**
 * فاز-۲ — یادآور کوپن «پیش از ناهار» (۱۱:۰۰ تهران) — حالا با پوش
 * نوتیفیکیشن به‌جای پیامک (سیستم کاستوم Web Push + صندوق درون‌بری).
 *
 *  • همان منطق ضد-تکرار نسخه‌ی SMS: فقط scan_date = امروز و
 *    notifiedAt IS NULL؛ اول تصرف بعد ارسال → امن در برابر کرش.
 *  • ستون sms_sent_at (اسکیمای موجود) به‌عنوان «sentAt» بلااستفاده
 *    می‌ماند — ستون جدید نداشتیم تا مهاجرت اضافه لازم نشود؛
 *    «تصرف» با ستون همان جاست و معنایش «یادآور ارسال شد» است.
 *  • کاربر بدون اشتراک پوش: فقط ردیف صندوق درون‌بری (SSE + لیست).
 *  • تکرارناپذیر: یکتایی (user, coupon, scan_date) — بدون تکرار بین رپلیکاها.
 *  • بعد از ۱۳:۰۰ توقف.
 */
export class CouponNudgeJob implements DailyJob {
  readonly name = 'coupon-nudge'
  readonly time: string
  readonly catchUp = false

  constructor(
    private readonly deps: { config: AppConfig; db: Db; notifications: NotificationService },
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

    const pending = await db
      .select({
        nudgeId: couponNudges.id,
        userId: couponNudges.userId,
        couponTitle: coupons.title,
        couponCode: coupons.code,
        discountPercentage: coupons.discountPercentage,
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

      const gap =
        row.missingCount && row.missingCount > 1 ? `${row.missingCount} قدم` : 'یک قدم'
      const title = row.couponTitle ?? row.couponCode

      const res = await this.deps.notifications.notifyUser(row.userId, {
        type: 'coupon_nudge',
        title: '🎁 یک قدم تا کوپن تخفیف!',
        body:
          `${gap} تا رسیدن به کوپن «${title}» ` +
          `(٪${row.discountPercentage} تخفیف) فاصله دارید — سفارش بعدی‌تان را ثبت کنید.`,
        url: '/products',
        data: { couponCode: row.couponCode, missingCount: row.missingCount },
      })
      if (res.id !== null) sent++
    }

    console.log(
      `[cron:coupon-nudge] sent ${sent}/${pending.length} nudge notification(s) ` +
      '(in-app + web push; کاربر بدون اشتراک پوش فقط صندوق درون‌بری)',
    )
  }
}
