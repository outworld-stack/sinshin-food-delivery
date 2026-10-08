// src/domain/shared/net.ts
/**
 * phase-1 — استخراج IP واقعی کلاینت از X-Forwarded-For.
 *
 * XFF به‌ترتیب گذرها چیده می‌شود: هر پروکسی، IP قبلی را به «انتهای» هدر می‌چسباند.
 *   X-Forwarded-For: <هرچه-کلاینت-خواست>, ..., <IP-که-Caddy-دیده>
 * آخرین عضو را نزدیک‌ترین پروکسی معتمد نوشته → قابل جعل نیست.
 * اولین عضو هر چی است که کلاینت فرستاده → قبلاً همین خوانده می‌شد
 * و کل محدودیت نرخ با یک هدر جعلی بایپس می‌شد.
 */
// رارد M11 — تعداد پراکسی‌های معتمدِ انتهای زنجیره (پیش‌فرض ۱ = فقط Caddy).
// با CDN جلوی Caddy فقط همین عدد را در .env عوض کن (TRUSTED_PROXY_COUNT=2).
const TRUSTED_PROXY_COUNT = (() => {
  const raw = Number(process.env.TRUSTED_PROXY_COUNT ?? '1')
  return Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : 1
})()

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/
const IPV6_RE = /^[0-9a-fA-F:.]+$/
const isValidIp = (s: string): boolean => IPV4_RE.test(s) || IPV6_RE.test(s)

export const clientIp = (raw: string | string[] | null | undefined): string | null => {
  const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  // رارد M11 — از انتهای زنجیره N پراکسی معتمد عقب‌تر: IP واقعی.
  // N=1 همان parts.at(-1) قبلی است (رفتار فعلی حفظ می‌شود).
  const candidate = parts[Math.max(0, parts.length - TRUSTED_PROXY_COUNT)]!
  if (isValidIp(candidate)) return candidate
  // سقوط امن: آخرین عضو (نوشته‌ی نزدیک‌ترین پروکسی) اگر فرمتش سالم بود
  const last = parts[parts.length - 1]!
  return isValidIp(last) ? last : null
}