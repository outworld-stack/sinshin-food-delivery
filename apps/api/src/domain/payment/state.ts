//src/domain/payment/state.ts
import { asPaymentId, type PaymentId } from '#/domain/shared/brand'
import { safeEqual } from '#/domain/shared/crypto'

/**
 * state امضاشده‌ی پرداخت — paymentId + HMAC(secret).
 * جعل‌ناپذیر: ساخت فقط با secret سرور؛ مرز serde این فایل تنها نقطه‌ی cast است.
 */
export function signState(paymentId: PaymentId, secret: string): string {
  const h = new Bun.CryptoHasher('sha256').update(`gwstate:${paymentId}:${secret}`)
  return `${paymentId}.${h.digest('hex').slice(0, 32)}`
}

export function verifyState(token: string, secret: string): PaymentId | null {
  const idx = token.indexOf('.')
  if (idx < 0) return null
  const paymentId = asPaymentId(token.slice(0, idx))
  return safeEqual(signState(paymentId, secret), token) ? paymentId : null
}