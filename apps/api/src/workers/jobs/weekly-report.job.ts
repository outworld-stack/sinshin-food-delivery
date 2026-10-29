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
 * اجرای ازدست‌رفته تا پایان همان هفته جبران می‌شود؛ اجرای موفق تکرار نمی‌شود.
 */
export class WeeklyReportJob implements DailyJob {
  readonly name = 'weekly-report'
  readonly time = '01:05'
  readonly catchUp = true
  readonly recovery = { weekday: 6 as const }

  constructor(
    private readonly deps: { config: AppConfig; db: Db; sms: SmsService; reports: ReportService },
  ) {}

  async run(): Promise<void> {
    // The scheduler deduplicates the Saturday–Friday period and allows recovery
    // later in that week when the API or Redis was unavailable on Saturday.
    await this.deps.reports.runWeeklyFlow()
    console.log('[cron:weekly-report] flow complete (weekly ZIP link SMS sent)')
  }
}
