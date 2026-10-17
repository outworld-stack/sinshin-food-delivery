//src/domain/payment/http-util.ts
// فراخوانی HTTP مشترک درگاه‌ها — منبع واحد رارد ۴۸ (اسکن A11).
// پیش از این، همین الگوی «POST با هدر JSON + مهلت کانفیگی + پاسخ
// غیر-JSON یعنی null» در شش نقطه‌ی چهار آداپتر تکرار می‌شد.
// stage-74 — fetch سراسری (در Bun همان Bun.fetch است؛ رفتار production
// یکسان) تا در تست‌ها mock-پذیر باشد — تست‌های آداپتور بدون شبکه‌ی واقعی.

import { Err } from '#/domain/shared/errors'

/** Convert only valid whole toman amounts; never round or coerce money. */
export function amountInRial(toman: number): number {
  if (!Number.isSafeInteger(toman) || toman <= 0 || !Number.isSafeInteger(toman * 10)) {
    throw Err.validation('مبلغ پرداخت باید عدد صحیح مثبت و در محدوده مجاز باشد.')
  }
  return toman * 10
}

/** POST با بدنه‌ی JSON؛ پاسخ غیر-JSON (صفحه‌ی خطای HTML شاپرک) = null، نه کرش */
export async function postGatewayJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // رارد ۴۵ — مهلت از کانفیگ (PAYMENT_TIMEOUT_MS)
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as T | null
}

/**
 * چک تطابق مبلغ پاسخ verify با مبلغ پرداخت (ریال).
 * مبلغ باید عدد صحیح مثبت یا رشته‌ی رقمی و دقیقاً برابر مبلغ مورد انتظار
 * باشد؛ مبلغ غایب پذیرفته نیست. ناهم‌خوانی فقط وقتی لاگ می‌شود که درگاه
 * خودش موفق اعلام کرده تا روی شکستِ از قبل اعلام‌شده نویز نسازد.
 */
export function amountMatches(p: {
  gatewayAmount: unknown
  expectedRial: number
  successReported: boolean
  tag: string
}): boolean {
  const raw = p.gatewayAmount
  const numeric = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  const ok = Number.isSafeInteger(numeric) && numeric > 0 && numeric === p.expectedRial
  if (p.successReported && !ok) {
    console.error(
      `[${p.tag}] مبلغ verify (${p.gatewayAmount}) با مبلغ پرداخت (${p.expectedRial}) نمی‌خواند`,
    )
  }
  return ok
}
