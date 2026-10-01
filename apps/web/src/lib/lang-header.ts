// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 5 از 18
// مسیر مقصد: web/src/lib/lang-header.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ⚠ حیاتی — بدون این، داده‌ی SSR صفحات ?lang=ar فارسی می‌ماند
// ═══════════════════════════════════════════════════════════════

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
 * round-38 — اولویتِ جدید ?lang= (سئوی دوزبانه): پارامتر URL بالاتر از
 * کوکی خوانده می‌شود — دقیقاً همان قرارداد beforeLoad ریشه. کرالری که
 * /products?lang=ar را می‌گیرد هنوز کوکی ندارد؛ بدون این، داده‌ی SSR
 * (و head داینامیک) فارسی می‌ماند و کل واریانت عربی بی‌اثر می‌شد.
 *
 * فقط حالت 'ar' هدر می‌فرستد — fa پیش‌فرضِ سرور است و بدون هدر
 * رفتار قبلی (فارسی) دقیقاً حفظ می‌شود؛ ترافیک قدیمی و کرالرها بی‌تغییر.
 *
 * ادمین/پیک هم اگر کوکی ar داشته باشند هدر می‌فرستند، ولی روت‌های
 * ادمین زبان نمی‌پرسند — بی‌اثر و بی‌خطر.
 */
import { langFromUrl } from '#/i18n'

/** کوکی sinshin-lang را از رشته‌ی cookie بیرون می‌کشد */
function parseLangCookie(cookie: string): 'fa' | 'ar' {
  return /(?:^|;\s*)sinshin-lang=ar(?:;|$)/.test(cookie) ? 'ar' : 'fa'
}

/** زبان فعالِ این درخواست — مرورگر یا SSR (اول ?lang=، بعد کوکی) */
export async function resolveRequestLang(): Promise<'fa' | 'ar'> {
  if (typeof window !== 'undefined') {
    return parseLangCookie(document.cookie)
  }
  // SSR — همان الگوی geoGate/__root: import پویای ماژول سرور
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const req = getRequest()
    const urlLang = langFromUrl(req?.url)
    if (urlLang) return urlLang
    return parseLangCookie(req?.headers.get('cookie') ?? '')
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
