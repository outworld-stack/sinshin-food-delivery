//src/domain/shared/crypto.ts
/** sha256 با Bun.CryptoHasher — بدون وابستگی node:crypto */
export function sha256(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex')
}

/** توکن تصادفی امن (refresh token) — web crypto بانی */
export function randomToken(bytes = 48): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Buffer.from(buf).toString('base64url')
}

/** مقایسه‌ی زمان-ثابت — جلوگیری از timing attack */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** کد عددی OTP — بدون bias (ردیف‌های >250 دور ریخته می‌شوند) */
export function randomOtpCode(length = 4): string {
  let out = ''
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(16))
    for (const b of buf) {
      if (b < 250) {
        out += String(b % 10)
        if (out.length === length) break
      }
    }
  }
  return out
}