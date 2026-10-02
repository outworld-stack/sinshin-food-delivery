//src/domain/payment/http-util.ts
// فراخوانی HTTP مشترک درگاه‌ها — منبع واحد رارد ۴۸ (اسکن A11).
// پیش از این، همین الگوی «POST با هدر JSON + مهلت کانفیگی + پاسخ
// غیر-JSON یعنی null» در شش نقطه‌ی چهار آداپتر تکرار می‌شد.

/** POST با بدنه‌ی JSON؛ پاسخ غیر-JSON (صفحه‌ی خطای HTML شاپرک) = null، نه کرش */
export async function postGatewayJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T | null> {
  const res = await Bun.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // رارد ۴۵ — مهلت از کانفیگ (PAYMENT_TIMEOUT_MS)
    signal: AbortSignal.timeout(timeoutMs),
  })
  return (await res.json().catch(() => null)) as T | null
}

/**
 * چک تطابق مبلغ پاسخ verify با مبلغ پرداخت (ریال).
 * مبلغ غایب = قبول (همه‌ی درگاه‌ها مبلغ را برنمی‌گردانند)؛ ناهم‌خوانی
 * فقط وقتی لاگ می‌شود که درگاه خودش موفق اعلام کرده (روی شکستِ از قبل
 * اعلام‌شده نویز نمی‌سازد).
 */
export function amountMatches(p: {
  gatewayAmount: unknown
  expectedRial: number
  successReported: boolean
  tag: string
}): boolean {
  const ok = p.gatewayAmount === undefined || Number(p.gatewayAmount) === p.expectedRial
  if (p.successReported && !ok) {
    console.error(
      `[${p.tag}] مبلغ verify (${p.gatewayAmount}) با مبلغ پرداخت (${p.expectedRial}) نمی‌خواند`,
    )
  }
  return ok
}