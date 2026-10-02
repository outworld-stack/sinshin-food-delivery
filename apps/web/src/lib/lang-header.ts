// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 2 از 7
// مسیر مقصد: apps/web/src/lib/lang-header.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

// src/lib/lang-header.ts
/**
 * round-34 — تزریق هدر x-sinshin-lang به همه‌ی تماس‌های API.
 *
 * منبع حقیقت همان کوکی sinshin-lang است (رارد ۳۱):
 *  • مرورگر: document.cookie
 *  • SSR: هدرِ کوکیِ درخواستِ ورودی — از طریق getRequest() تان‌استک
 *
 * round-38 — اولویتِ جدید ?lang= (سئوی دوزبانه): پارامتر URL بالاتر از
 * کوکی خوانده می‌شود — دقیقاً همان قرارداد beforeLoad ریشه. کرالری که
 * /products?lang=ar را می‌گیرد هنوز کوکی ندارد؛ بدون این، داده‌ی SSR
 * (و head داینامیک) فارسی می‌ماند و کل واریانت عربی بی‌اثر می‌شد.
 *
 * round-40 — شاخه‌ی SSR به ماژول سرور server/ssr-request.ts منتقل شد.
 * این فایل در گراف کلاینت است (از مسیر api-fetch ← server/* ← routes)
 * و درون‌ریزیِ پویای مستقیمِ `@tanstack/react-start/server` در هر ماژولِ
 * گراف کلاینت، هشدار import-protection می‌داد (حتی داخل گاردِ زمانِ اجرا).
 * الگوی جدید همان geoGate است: گارد import.meta.env.SSR + درون‌ریزی پویای
 * ماژول محلی که هرگز به باندل/گراف کلاینت راه نمی‌یابد.
 *
 * فقط حالت 'ar' هدر می‌فرستد — fa پیش‌فرضِ سرور است و بدون هدر
 * رفتار قبلی (فارسی) دقیقاً حفظ می‌شود؛ ترافیک قدیمی و کرالرها بی‌تغییر.
 *
 * ادمین/پیک هم اگر کوکی ar داشته باشند هدر می‌فرستند، ولی روت‌های
 * ادمین زبان نمی‌پرسند — بی‌اثر و بی‌خطر.
 */

/** کوکی sinshin-lang را از رشته‌ی کوکی بیرون می‌کشد */
function parseLangCookie(cookie: string): 'fa' | 'ar' {
	return /(?:^|;\s*)sinshin-lang=ar(?:;|$)/.test(cookie) ? 'ar' : 'fa'
}

/** زبان فعالِ این درخواست — مرورگر یا SSR (اول ?lang=، بعد کوکی) */
export async function resolveRequestLang(): Promise<'fa' | 'ar'> {
	if (!import.meta.env.SSR) {
		return parseLangCookie(document.cookie)
	}
	// SSR — الگوی geoGate: ماژول سرور فقط داخل این گارد پویا درون‌ریزی می‌شود؛
	// در بیلد کلاینت import.meta.env.SSR=false → کل شاخه (با درون‌ریزی) حذف.
	try {
		const { ssrRequestLang } = await import('#/server/ssr-request')
		return ssrRequestLang()
	} catch {
		return 'fa'
	}
}

/**
 * هدرهای زبان برای ادغام با هدرهای موجود — {} در حالت فارسی
 * (هیچ تماسی تغییر شکل نمی‌دهد؛ فقط ar هدر اضافه می‌کند).
 */
export async function langHeaders(): Promise<Record<string, string>> {
	const lang = await resolveRequestLang()
	return lang === 'ar' ? { 'x-sinshin-lang': 'ar' } : {}
}