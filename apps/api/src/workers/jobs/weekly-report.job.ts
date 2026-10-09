// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/weekly-report.job.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر فاز-۲: همه‌ی کاربران + همه‌ی سفارشات هفته → ZIP + TOKEN پیامکی
// ═══════════════════════════════════════════════════════════════

//src/workers/jobs/weekly-report.job.ts
import type { AppConfig } from '#/infra/config/env'
import type { Db } from '#/infra/db/client'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportService } from '#/domain/report/report.service'
import type { DailyJob } from '#/workers/scheduler'

/**
 * گزارش هفتگی — شنبه ۰۱:۰۵ تهران — فاز-۲:
 * توکن امضاشده + پیامک به ادمین‌های اصلی (فقط TOKEN — SMS.ir لینکِ
 * بسته‌ی ZIP با orders.csv + users.csv هفته را از قالب می‌سازد).
 */
export class WeeklyReportJob implements DailyJob {
  readonly name = 'weekly-report'
  readonly time = '01:05'
  readonly catchUp = false

  constructor(
    private readonly deps: { config: AppConfig; db: Db; sms: SmsService; reports: ReportService },
  ) {}

  async run(): Promise<void> {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      weekday: 'long',
    }).format(new Date())
    if (day !== 'Saturday') {
      console.log('[cron:weekly-report] not Saturday — skipping')
      return
    }
    await this.deps.reports.runWeeklyFlow()
    console.log('[cron:weekly-report] flow complete (weekly ZIP link SMS sent)')
  }
}
