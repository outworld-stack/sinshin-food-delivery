// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 1 از 7
// مسیر مقصد: apps/web/src/server/ssr-request.ts
// وضعیت: فایل جدید — ایجاد شود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

// src/server/ssr-request.ts
/**
 * round-40 — تنها نقطه‌ی مجازِ خواندن مستقیم درخواست SSR (الگوی geoGate).
 *
 * چرا این فایل وجود دارد: تا رارد ۳۹ سه مصرف‌کننده (lang-header، ریشه،
 * لندینگ) داخل ماژول‌های ایزومورفیک، مستقیماً `@tanstack/react-start/server`
 * را پویا import می‌کردند. پلاگین import-protection تان‌استک هر specifier
 * ممنوعه را در «هر ماژولی که به گراف کلاینت راه پیدا کند» علامت می‌زند —
 * حتی وقتی import داخل گاردِ runtime است (typeof document/window) و هرگز
 * در مرورگر اجرا نمی‌شود؛ نتیجه: سه هشدار [vite] (client) warning در
 * کنسولِ `bun run dev` (گزارش کاربر، رارد ۴۰).
 *
 * قرارداد — دقیقاً همان geoGate.ts که از ابتدا بی‌هشدار بود:
 *   • این ماژول فقط از داخل گارد `import.meta.env.SSR` و با import پویا
 *     صدا زده می‌شود:
 *       – dev: در مرورگر import.meta.env.SSR falsy است → شاخه هرگز اجرا
 *         نمی‌شود → مرورگر این فایل را request نمی‌کند → هرگز به‌عنوان
 *         ماژول کلاینت ترنسفورم نمی‌شود → اسکن نمی‌شود.
 *       – build کلاینت: import.meta.env.SSR → false و کل شاخه (با import)
 *         DCE می‌شود → این فایل وارد باندل تولیدی هم نمی‌شود.
 *   • پس import ایستای `@tanstack/react-start/server` اینجا امن و مجاز است.
 *
 * هیچ فایل ایزومورفیکی (چیزی که مسیرش به routes/… می‌رسد) نباید این
 * ماژول را import ایستا کند — فقط import پویا داخل گارد SSR.
 */
import { isTrustedCrawlerUserAgent } from '@sinshin/shared'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { LANG_COOKIE, LANG_COOKIE_RE, type Lang, langFromUrl } from '#/i18n'
import { shouldShowOutdatedBanner } from '#/lib/browserSupport'

/** کوکی بسته‌شدن بنر مرورگر قدیمی (sinshin-obs=1) در هدر cookie درخواست؟ */
const OBS_COOKIE_RE = /(?:^|;\s*)sinshin-obs=1(?:;|$)/

/**
 * زبان فعالِ درخواست SSR — اول ?lang= بعد کوکی (قرارداد رارد ۳۸).
 * مصرف‌کننده: lang-header.ts → هدر x-sinshin-lang تماس‌های API.
 */
export function ssrRequestLang(): Lang {
	const req = getRequest()
	const fromUrl = langFromUrl(req?.url)
	if (fromUrl) return fromUrl
	const m = LANG_COOKIE_RE.exec(req?.headers.get('cookie') ?? '')
	return m ? (m[1] as Lang) : 'fa'
}

/**
 * زبان ریشه — مثل ssrRequestLang، ولی وقتی ?lang= آمده باشد کوکی را هم
 * هم‌راستا می‌کند (کرالر کوکی ندارد و فقط از طریق URL به واریانت عربی
 * می‌رسد — لینک‌های hreflang/sitemap به ?lang=ar اشاره می‌کنند؛ نوشتن
 * کوکی یعنی ناوبری‌های بعدیِ همان نشست در همان زبان می‌مانند).
 */
export function ssrResolveRootLang(): Lang {
	const req = getRequest()
	const fromUrl = langFromUrl(req?.url)
	if (fromUrl) {
		setCookie(LANG_COOKIE, fromUrl, {
			path: '/',
			maxAge: 31536000,
			sameSite: 'lax',
		})
		return fromUrl
	}
	const m = LANG_COOKIE_RE.exec(req?.headers.get('cookie') ?? '')
	return m ? (m[1] as Lang) : 'fa'
}

/**
 * رأی بنر مرورگر قدیمیِ لندینگ در SSR — UA از هدر درخواست + کوکی بستن.
 * کرالرهای معتبر معافند تا اسکرین‌شات نتایج جستجو تمیز بماند (سئو-۱).
 */
export function ssrLandingOldBrowserVote(): boolean {
	const req = getRequest()
	const ua = req?.headers.get('user-agent') ?? null
	if (isTrustedCrawlerUserAgent(ua)) return false
	return shouldShowOutdatedBanner({
		ua,
		dismissed: OBS_COOKIE_RE.test(req?.headers.get('cookie') ?? ''),
	})
}
