//src/domain/shared/phone.ts
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** تبدیل ارقام فارسی/عربی به لاتین */
export function toEnglishDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const fa = FA_DIGITS.indexOf(ch)
    if (fa >= 0) {
      out += String(fa)
      continue
    }
    const ar = AR_DIGITS.indexOf(ch)
    if (ar >= 0) {
      out += String(ar)
      continue
    }
    out += ch
  }
  return out
}

/**
 * نرمال‌سازی شماره موبایل ایران به شکل 09xxxxxxxxx
 * ورودی‌های پذیرفته‌شده:
 *   09123456789 / +989123456789 / 00989123456789 / 989123456789 / 9123456789
 * خروجی: شماره نرمال‌شده یا null
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  let s = toEnglishDigits(input).replace(/[\s\-().]/g, '')
  if (s.startsWith('+98')) s = '0' + s.slice(3)
  else if (s.startsWith('0098')) s = '0' + s.slice(4)
  else if (/^98\d{10}$/.test(s)) s = '0' + s.slice(2)
  else if (/^9\d{9}$/.test(s)) s = '0' + s
  return /^09\d{9}$/.test(s) ? s : null
}