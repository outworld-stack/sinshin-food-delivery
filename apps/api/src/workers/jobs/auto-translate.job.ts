// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 13 از 31
// مسیر مقصد: apps/api/src/workers/jobs/auto-translate.job.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/workers/jobs/auto-translate.job.ts
import type { IntervalJob } from '#/workers/scheduler'
import type { TranslationService } from '#/domain/translation/translation.service'

/**
 * round-35 — کارگرِ صف ترجمه‌ی خودکار.
 *
 * هر ۳۰ ثانیه (با قفل Redis بین رپلیکاها — الگوی بقیه‌ی کارهای بازه‌ای):
 *  ۱) نجات کارهای گیرکرده: running ای که بیشتر از ۱۰ دقیقه از
 *     started_at گذشته (کرش وسط اجرا) → به وضعیتِ در انتظار برمی‌گردد.
 *  ۲) حلقه‌ی پردازش با بودجه‌ی ۴ دقیقه: تا وقتی کار هست و مترجم
 *     بالاست ادامه می‌دهد؛ گلوگاه خودِ مترجم است (قفل تک‌دسته‌ای
 *     کانتینر) پس فشاری وارد نمی‌کنیم — یک کار در هر لحظه.
 *
 * مترجم پایین: اولین خطای SERVICE_UNAVAILABLE حلقه را می‌بندد؛
 * تلاشِ آن کار بازگردانده می‌شود (نگاه کنید به translation.service)
 * و تیک بعدی دوباره می‌آید — صف فقط در انتظار می‌ماند، چیزی از کار
 * نمی‌افتد.
 */
export class AutoTranslateJob implements IntervalJob {
  readonly name = 'auto-translate'
  readonly everySeconds = 30

  /** پنجره‌ی «گیرکرده» — بزرگ‌تر از بدترین ترجمه‌ی تک‌موجودیت منطقی */
  private static readonly STUCK_MS = 10 * 60 * 1000
  /** بودجه‌ی هر تیک — بعد از آن، تیک بعدی ادامه می‌دهد */
  private static readonly BUDGET_MS = 4 * 60 * 1000

  constructor(private readonly deps: { translation: TranslationService }) {}

  async run(): Promise<void> {
    const reaped = await this.deps.translation.reapStuck(AutoTranslateJob.STUCK_MS)
    if (reaped > 0) {
      console.log(`[cron:auto-translate] ${reaped} job گیر‌کرده به صف برگشت`)
    }

    const t0 = Date.now()
    let processed = 0
    let done = 0
    let failed = 0
    while (Date.now() - t0 < AutoTranslateJob.BUDGET_MS) {
      const r = await this.deps.translation.processNext()
      if (r === 'empty') break
      if (r === 'translator-down') {
        console.warn('[cron:auto-translate] مترجم در دسترس نیست — این تیک رها شد')
        break
      }
      processed++
      if (r === 'done') done++
      else failed++
    }
    if (processed > 0) {
      console.log(
        `[cron:auto-translate] ${processed} job در ${((Date.now() - t0) / 1000).toFixed(0)}s — موفق: ${done}، ناموفق: ${failed}`,
      )
    }
  }
}