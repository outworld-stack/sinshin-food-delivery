// ═══════════════════════════════════════════════════════════════
// round-39 — sinshin-food-delivery — فایل 1 از 5
// مسیر مقصد: apps/web/src/i18n/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-five
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 4 از 18
// مسیر مقصد: web/src/i18n/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/i18n/index.tsx
// رارد ۳۱ — زیرساخت دوزبانه fa/ar (تصمیم‌های ۱ تا ۵ کاربر).
//
// معماری «کوکی‌محور» (بدون تغییر URL):
//   • کوکی sinshin-lang منبع حقیقت است — سرور آن را در beforeLoad ریشه می‌خواند
//     (SSR از همان بایت اول عربی رندر می‌کند؛ بدون فلش) و کلاینت هنگام
//     hydration همان کوکی را می‌خواند → رندر دو طرف بایت‌به‌بایت یکی است.
//   • Provider در «ریشه‌ی هر لایه‌ی ترجمه‌شونده» قرار می‌گیرد (لندینگ، ورود؛
//     بعداً لایوت سایت و داشبورد) — نه در ریشه‌ی کل اپ. نتیجه: فایل‌های
//     ادمین/ادمین₂/پیک حتی سهمی از این زیرساخت نمی‌بینند؛ فارسیِ خالص می‌مانند.
//   • ارقام عربی ٠١٢٣ با locale آرژانتینِ مصر (ar-EG) — تصویب کاربر (تصمیم ۲)؛
//     تاریخ در نسخه‌ی عربی میلادی با ماه‌های عربی (تصمیم کاربر در رارد ۳۰).
//
// fmt: فارسی دقیقاً همان توابع utils/format موجود (رفتار صفر-تغییر)؛
// عربی قرینه‌ی ar-EG همان‌ها. صفحاتی که ترجمه نمی‌شوند همچنان از توابع
// قدیمی مستقیم استفاده می‌کنند — دست‌نخورده.
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from 'react'
import {
	faNum,
	formatDate,
	formatDuration,
	formatPrice,
	formatRelative,
	formatTime,
} from '#/utils/format'
import { langSensitiveKeys } from '#/utils/queryKeys'
import { arApiErrorMessage } from './apiErrors'
import { ar } from './ar'
import { type Dict, fa } from './fa'

export type Lang = 'fa' | 'ar'
export const LANG_COOKIE = 'sinshin-lang'

export const DICTS: Record<Lang, Dict> = { fa, ar }

/** جایگزینی {n} در الگوی دیکشنری — «ارسال مجدد کد تا {n} ثانیه دیگر» */
export function tpl(template: string, vars: { n: string | number }): string {
	return template.replace('{n}', String(vars.n))
}

// ── کوکی ──

/** رارد ۳۸ — الگوی مشترک خواندن کوکی زبان (root beforeLoad هم از همین استفاده می‌کند) */
export const LANG_COOKIE_RE = /(?:^|;\s*)sinshin-lang=(fa|ar)(?:;|$)/

/** رارد ۳۸ — زبان از پارامتر ?lang= یک URL (fa|ar؛ هر چیز دیگر = null) */
export function langFromUrl(url: string | null | undefined): Lang | null {
	if (!url) return null
	try {
		const q = new URL(url).searchParams.get('lang')
		return q === 'fa' || q === 'ar' ? q : null
	} catch {
		return null
	}
}

export function readLangCookie(): Lang | null {
	if (typeof document === 'undefined') return null
	const m = LANG_COOKIE_RE.exec(document.cookie)
	return m ? (m[1] as Lang) : null
}

/** رارد ۳۸ — عمومی شد: root beforeLoad (سمت سرورِ ?lang=) هم کوکی می‌نویسد */
export function writeLangCookie(lang: Lang): void {
	// biome-ignore lint/suspicious/noDocumentCookie: همان الگوی themeStore موجود — Cookie Store API هنوز در همه‌ی مرورگرهای هدف نیست
	document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`
}

// ── خطای API چندزبانه (رارد ۳۳) ──

/** متن خطا از هر شکلی که پرتاب می‌شود — Error، رشته، یا { message } */
function errTextOf(err: unknown, fallback: string): string {
	if (typeof err === 'string' && err) return err
	const m = (err as { message?: unknown } | null | undefined)?.message
	if (typeof m === 'string' && m) return m
	return fallback
}

function errCodeOf(err: unknown): string | undefined {
	const c = (err as { code?: unknown } | null | undefined)?.code
	return typeof c === 'string' ? c : undefined
}

// ── فرمترهای چندزبانه ──

export interface Fmt {
	price: (n: number) => string
	num: (n: number) => string
	date: (d: Date | string) => string
	time: (d: Date | string) => string
	duration: (ms: number) => string
	relative: (d: Date | string) => string
}

const arNum = (n: number): string => n.toLocaleString('ar-EG')

const arDate = (d: Date | string): string => {
	const dd = d instanceof Date ? d : new Date(d)
	return Number.isNaN(dd.getTime())
		? '—'
		: dd.toLocaleDateString('ar-EG', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
}

const arTime = (d: Date | string): string => {
	const dd = d instanceof Date ? d : new Date(d)
	return Number.isNaN(dd.getTime())
		? '—'
		: dd.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
}

const arDuration = (ms: number): string => {
	if (ms < 1000) return `${arNum(Math.round(ms))} م.ث`
	const seconds = ms / 1000
	if (seconds < 10) return `${arNum(Math.round(seconds * 10) / 10)} ثانية`
	if (seconds < 60) return `${arNum(Math.round(seconds))} ثانية`
	const minutes = seconds / 60
	if (minutes < 60) return `${arNum(Math.round(minutes))} دقيقة`
	const hours = minutes / 60
	if (hours < 48) return `${arNum(Math.round(hours))} ساعة`
	return `${arNum(Math.round(hours / 24))} يوم`
}

const arRelative = (d: Date | string): string => {
	const dd = d instanceof Date ? d : new Date(d)
	if (Number.isNaN(dd.getTime())) return '—'
	const seconds = Math.round((Date.now() - dd.getTime()) / 1000)
	if (seconds < 45) return 'الآن'
	if (seconds < 3600)
		return `قبل ${arNum(Math.max(1, Math.round(seconds / 60)))} دقيقة`
	if (seconds < 86400) return `قبل ${arNum(Math.round(seconds / 3600))} ساعة`
	return `قبل ${arNum(Math.round(seconds / 86400))} يوم`
}

const faFmt: Fmt = {
	price: formatPrice,
	num: faNum,
	date: formatDate,
	time: formatTime,
	duration: formatDuration,
	relative: formatRelative,
}

const arFmt: Fmt = {
	price: arNum,
	num: arNum,
	date: arDate,
	time: arTime,
	duration: arDuration,
	relative: arRelative,
}

function makeFmt(lang: Lang): Fmt {
	return lang === 'ar' ? arFmt : faFmt
}

// ── Provider ──

interface I18nValue {
	lang: Lang
	t: Dict
	fmt: Fmt
	setLang: (next: Lang) => void
	/** رارد ۳۳ — پیام خطای API به زبان کاربر: عربی از نقشه‌ی apiErrors،
	 *  فارسی همان پیام سرور (رفتار صفر-تغییر). fallback وقتی err متنی ندارد. */
	apiError: (err: unknown, fallback?: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

/**
 * رارد ۳۲ — مقدار جایگزینِ امن برای کامپوننت‌های «مشترک» بین سایت و ادمین
 * (ProductCard در فرم محصول ادمین به‌عنوان پیش‌نمایش، ConfirmModal و…):
 * خارج از Provider (یعنی در ادمین/ادمین₂/پیک) دقیقاً فارسیِ خالص برمی‌گرداند —
 * همان رفتار قبل از دوزبانه شدن؛ هیچ خطایی نمی‌دهد و هیچ چیزی عربی نمی‌شود.
 */
const I18N_FALLBACK: I18nValue = {
	lang: 'fa',
	t: DICTS.fa,
	fmt: faFmt,
	setLang: () => {
		/* خارج از سایت، تغییر زبان معنا ندارد — noop */
	},
	apiError: (err, fallback) => errTextOf(err, fallback ?? 'خطا'),
}

/**
 * initialLang از beforeLoad ریشه (سمت سرور از کوکی درخواست) می‌آید.
 * مقدار اولیه state سمت کلاینت «اول کوکی، بعد context» است — کوکیِ کلاینت
 * هنگام hydration همان کوکیِ درخواست سرور است → رندر یکسان، بدون mismatch.
 * ناوبری سمت کلاینت به لندینگ/ورود همیشه کوکی تازه را می‌خواند.
 */
export function I18nProvider({
	initialLang = 'fa',
	children,
}: {
	initialLang?: Lang
	children: ReactNode
}) {
	const [lang, setLangState] = useState<Lang>(
		() => readLangCookie() ?? initialLang,
	)

	// رارد ۳۹ — ابزارهای فوری‌سازی تعویض زبانِ داده‌های محتوایی:
	// کوئری‌کلاینت برای cancel/invalidate کلیدهای حساس به زبان، و روتر
	// برای اجرای دوباره‌ی لودرها (صفحات جزئیات که با loaderData رندر
	// می‌شوند) + beforeLoad ریشه (context.lang → عنوان/متا/توکن‌های سند).
	// Provider فقط داخل درخت روتر می‌نشیند، پس هر دو همیشه در دسترس‌اند.
	const queryClient = useQueryClient()
	const router = useRouter()

	const setLang = useCallback(
		(next: Lang) => {
			// کلیک روی زبانِ فعال — بی‌اثر؛ قبلاً کوکی/state همان مقدار بازنویسی
			// می‌شد که حالا با invalidation پرهزینه هم بود.
			if (next === lang) return
			writeLangCookie(next)
			setLangState(next)
			// اتریبیوت زبان سند — پنل ادمین/پیک هرگز Provider ندارد و همیشه fa می‌ماند
			try {
				document.documentElement.lang = next
			} catch {
				/* noop */
			}
			// رارد ۳۹ — ریشه‌ی باگ «تأخیر ترجمه» همین‌جا بسته شد: رشته‌های UI
			// از دیکشنری کلاینت همان لحظه عوض می‌شدند، اما داده‌ی محتوایی
			// (اسم غذاها، توضیحات، منوها، محتویات، مقاله‌ها، گالری، درباره،
			// قوانین، سبد…) در کشِ React Query با کلیدِ بدونِ زبان می‌ماند و
			// فقط بعد از staleTime + رفرش/رفکوس دوباره فچ می‌شد → «با تأخیر
			// زیاد عربی/فارسی می‌شد». ترتیب مهم است — کوکی از قبل نوشته شده،
			// پس فچ‌های زیر هدر x-sinshin-lang تازه می‌فرستند (langHeaders از
			// همان کوکی می‌خواند):
			//   ① cancel — فچ در-پروازِ زبانِ قبل، نتیجه‌ی قدیمی ننویسد
			//   ② invalidate — کوئری‌های فعال همان لحظه ریفچ؛ غیرفعال‌ها stale
			//      می‌شوند و در مونت/ناوبری بعدی تازه می‌آیند
			//   ③ router.invalidate — لودرهای روت‌های فعال (جزئیات محصول/مقاله)
			//      و beforeLoad ریشه دوباره اجرا می‌شوند (کوکی تازه را می‌خوانند)
			try {
				for (const key of langSensitiveKeys) {
					queryClient.cancelQueries({ queryKey: key })
				}
				for (const key of langSensitiveKeys) {
					queryClient.invalidateQueries({ queryKey: key })
				}
				router.invalidate()
			} catch {
				/* noop — تعویض زبان هرگز نباید خطا بدهد */
			}
		},
		[lang, queryClient, router],
	)

	const value = useMemo<I18nValue>(
		() => ({
			lang,
			t: DICTS[lang],
			fmt: makeFmt(lang),
			setLang,
			apiError: (err, fallback) => {
				const msg = errTextOf(err, fallback ?? DICTS[lang]['common.error'])
				return lang === 'ar' ? arApiErrorMessage(errCodeOf(err), msg) : msg
			},
		}),
		[lang, setLang],
	)

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
	const v = useContext(I18nContext)
	if (!v) throw new Error('useI18n باید داخل I18nProvider استفاده شود')
	return v
}

/** رارد ۳۲ — نسخه‌ی امن برای کامپوننت‌های مشترک سایت/ادمین؛ خارج از Provider = فارسی خالص */
export function useI18nSafe(): I18nValue {
	return useContext(I18nContext) ?? I18N_FALLBACK
}
