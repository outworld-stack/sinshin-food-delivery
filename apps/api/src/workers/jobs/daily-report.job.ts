//src/workers/jobs/daily-report.job.ts
import type { AppConfig } from '#/infra/config/env'
import type { Db } from '#/infra/db/client'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportService } from '#/domain/report/report.service'
import type { DailyJob } from '#/workers/scheduler'

/** گزارش روزانه — ۰۱:۰۰ — پیامک لینک صفحه‌ی زنده (داده از DB لحظه‌ی باز شدن) */
export class DailyReportJob implements DailyJob {
  readonly name = 'daily-report'
  readonly time = '01:00'
  readonly catchUp = true

  constructor(
    private readonly deps: { config: AppConfig; db: Db; sms: SmsService; reports: ReportService },
  ) {}

  async run(): Promise<void> {
    await this.deps.reports.smsReportLink('daily')
    console.log('[cron:daily-report] SMS sent')
  }
}