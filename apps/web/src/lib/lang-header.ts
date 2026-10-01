// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 24 از 49
// مسیر مقصد: apps/web/src/lib/lang-header.ts
// وضعیت: فایل جدید
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/lib/lang-header.ts
/**
 * round-34 — تزریق هدر x-sinshin-lang به همه‌ی تماس‌های API.
 *
 * منبع حقیقت همان کوکی sinshin-lang است (رارد ۳۱):
 *  • مرورگر: document.cookie
 *  • SSR: هدر cookie درخواستِ ورودی — از طریق getRequest() تان‌استک
 *    (همان الگوی geoGate.ts؛ import پویا تا باندل کلاینت آلوده نشود)
 *
 * فقط حالت 'ar' هدر می‌فرستد — fa پیش‌فرضِ سرور است و بدون هدر
 * رفتار قبلی (فارسی) دقیقاً حفظ می‌شود؛ ترافیک قدیمی و کرالرها بی‌تغییر.
 *
 * ادمین/پیک هم اگر کوکی ar داشته باشند هدر می‌فرستند، ولی روت‌های
 * ادمین زبان نمی‌پرسند — بی‌اثر و بی‌خطر.
 */

/** کوکی sinshin-lang را از رشته‌ی cookie بیرون می‌کشد */
function parseLangCookie(cookie: string): 'fa' | 'ar' {
  return /(?:^|;\s*)sinshin-lang=ar(?:;|$)/.test(cookie) ? 'ar' : 'fa'
}

/** زبان فعالِ این درخواست — مرورگر یا SSR */
export async function resolveRequestLang(): Promise<'fa' | 'ar'> {
  if (typeof window !== 'undefined') {
    return parseLangCookie(document.cookie)
  }
  // SSR — همان الگوی geoGate/__root: import پویای ماژول سرور
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const cookie = getRequest()?.headers.get('cookie') ?? ''
    return parseLangCookie(cookie)
  } catch {
    return 'fa'
  }
}

/**
 * هدرهای زبان برای merge با هدرهای موجود — {} در حالت فارسی
 * (هیچ تماسی تغییر شکل نمی‌دهد؛ فقط ar هدر اضافه می‌کند).
 */
export async function langHeaders(): Promise<Record<string, string>> {
  const lang = await resolveRequestLang()
  return lang === 'ar' ? { 'x-sinshin-lang': 'ar' } : {}
}
