// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 10 از 31
// مسیر مقصد: apps/api/src/domain/translation/translate-client.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/domain/translation/translate-client.ts
/**
 * round-35 — کلاینت HTTP سرویس مترجم آفلاین (services/translator).
 *
 * کانتینر مترجم (NLLB-200 int8 با CTranslate2) در شبکه‌ی داخلی compose
 * روی TRANSLATOR_URL (پیش‌فرض http://translator:8300) گوش می‌دهد.
 * جهت ترجمه در کل سیستم ثابت است: فارسی (pes) → عربی (arb) — همین
 * یک جهت اینجا هاردکد شده و قرارداد بیرونی ساده می‌ماند.
 *
 * خطاها:
 *  • ۴xx از مترجم = ورودی بد → AppError اعتبارسنجی (بدون retry)
 *  • قطعی/تایم‌اوت/۵xx → ۲ بار retry با فاصله؛ سپس SERVICE_UNAVAILABLE
 *    (صف ترجمه این خطا را «مترجم پایین» تفسیر می‌کند و تلاش را
 *    نمی‌سوزاند — نگاه کنید به translation.service.ts)
 */
import type { AppConfig } from '#/infra/config/env'
import { AppError, Err } from '#/domain/shared/errors'

/** کدهای زبان سطح API (کانتینر خودش به کدهای FLORES کامل نگاشت می‌کند) */
const SRC = 'pes'
const TGT = 'arb'

/** سقف انتظار برای هر فراخوانی — مقاله‌ی بلند با ده‌ها قطعه طول می‌کشد */
const TIMEOUT_MS = 45_000
const RETRIES = 2
/** سقف texts هر درخواست (کانتینر: ۶۴) — مقاله‌ی بلند → چند دسته‌ی پیوسته */
const BATCH_SIZE = 48

interface TranslateResponse {
  translations?: unknown
}

interface HealthResponse {
  ready?: boolean
  model?: string
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class TranslateClient {
  constructor(private readonly deps: { config: AppConfig }) {}

  private get base(): string {
    // env.ts خودش اسلش انتهایی را می‌چیند
    return this.deps.config.translatorUrl
  }

  /** سلامت مترجم — هرگز throw نمی‌کند (برای بج آنلاین/آفلاین پنل) */
  async health(): Promise<{ up: boolean; model: string }> {
    try {
      const res = await fetch(`${this.base}/health`, {
        signal: AbortSignal.timeout(4_000),
      })
      if (!res.ok) return { up: false, model: '' }
      const body = (await res.json()) as HealthResponse
      return { up: body.ready === true, model: typeof body.model === 'string' ? body.model : '' }
    } catch {
      return { up: false, model: '' }
    }
  }

  /**
   * ترجمه‌ی دسته‌ای — ورودی/خروجی هم‌طول. متن‌های چندخطی مجازند؛
   * کانتینر هر متن را خط‌به‌خط ترجمه و با حفظ ساختار بازچینی می‌کند.
   * ورودی‌های بیشتر از BATCH_SIZE به دسته‌های پیوسته شکسته می‌شوند.
   */
  async translate(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return []
    const out: string[] = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.translateBatch(texts.slice(i, i + BATCH_SIZE))))
    }
    return out
  }

  private async translateBatch(batch: string[]): Promise<string[]> {
    let lastError: unknown = null
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await sleep(attempt * 1_500)
      try {
        const res = await fetch(`${this.base}/translate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texts: batch, source: SRC, target: TGT }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        // ورودی بد — retry بی‌فایده است
        if (res.status === 400 || res.status === 422) {
          throw Err.validation('متن ارسالی برای مترجم معتبر نیست.')
        }
        if (!res.ok) throw new Error(`translator responded ${res.status}`)
        const body = (await res.json()) as TranslateResponse
        const out = body.translations
        if (!Array.isArray(out) || out.length !== batch.length) {
          throw new Error('translator malformed response')
        }
        return out.map((v) => (typeof v === 'string' ? v : ''))
      } catch (err) {
        // AppError عمدی (اعتبارسنجی) را بالا بده — retry نشود
        if (err instanceof AppError) throw err
        lastError = err
      }
    }
    void lastError // فقط برای دیباگ؛ پیام عمومی کافی است
    throw Err.serviceUnavailable('مترجم آفلاین در دسترس نیست — کمی بعد دوباره تلاش کنید.')
  }
}
