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
export const clientIp = (raw: string | string[] | null | undefined): string | null => {
  const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.at(-1) ?? null
}