// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/daily-report.job.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر فاز-۲: جریان کامل — لاگ داکر + سفارشات + کاربران جدید →
//   بسته‌ی ZIP + پیامک TOKEN (قالب SMS.ir) + پاک‌سازی لاگ سرور
// ═══════════════════════════════════════════════════════════════

//src/workers/jobs/daily-report.job.ts
import type { AppConfig } from '#/infra/config/env'
import type { Db } from '#/infra/db/client'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportService } from '#/domain/report/report.service'
import type { DailyJob } from '#/workers/scheduler'

/**
 * گزارش روزانه — ۰۱:۰۰ تهران — فاز-۲:
 *  ۱) لاگ‌های داکر از آخرین اجرا جمع + آرشیو می‌شوند
 *  ۲) بسته‌ی ZIP روی دیسک ذخیره و بررسی می‌شود
 *  ۳) پیامک لینک دانلود به ادمین‌های اصلی ارسال می‌شود
 *  ۴) نشانگر جمع‌آوری بعد از ارسال جلو می‌رود؛ چرخش لاگ را داکر انجام می‌دهد
 * شکست تولید بسته یا ارسال به همه‌ی گیرنده‌ها با تأخیر دوباره امتحان می‌شود.
 */
export class DailyReportJob implements DailyJob {
  readonly name = 'daily-report'
  readonly time = '01:00'
  readonly catchUp = true
  readonly recovery = {}

  constructor(
    private readonly deps: { config: AppConfig; db: Db; sms: SmsService; reports: ReportService },
  ) {}

  async run(): Promise<void> {
    await this.deps.reports.runDailyFlow()
    console.log('[cron:daily-report] flow complete (report saved, ZIP link SMS sent)')
  }
}
