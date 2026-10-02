// src/lib/browserSupport.ts
// رارد ۳۱ — سنجش مرورگر کاربر با «قانون یکسان ۲ سال» (تصمیم کاربر):
//   هر مرورگری که نسخه‌اش از امروز بیش از ۲۴ ماه گذشته باشد «قدیمی» است —
//   بدون استثنا و بدون متمایز کردن Edge (تصمیم ۴)؛ مثلاً نسخه‌ی ۱۲ یا ۲۳ ماه
//   پیش هیچ هشداری نمی‌گیرد و نسخه‌ی ۲۵ ماه پیش می‌گیرد.
//
// چرا «قانون زمانی» و نه فهرست قابلیت‌ها؟ نسخه‌های حداقلیِ ثابت (مثل Chrome 111)
// با گذر زمان کهنه می‌شوند؛ این‌جا از «لنگرِ نسخه-تاریخ + ریتم انتشار» تخمین
// عمر نسخه زده می‌شود که همیشه با تاریخ روز جاری می‌غلتد و هرگز کهنه نمی‌شود.
//   تخمین ±۱ نسخه خطا دارد — برای مرز ۲۴ ماهه بی‌اثر است.
//
// ایزومورفیک و خالص: نه window نه node — UA همیشه به‌عنوان ورودی داده می‌شود؛
// همین ماژول سمت سرور (beforeLoad با getRequest) و سمت کلاینت (navigator)
// استفاده می‌شود. مرورگر ناشناخته/بدون نسخه = بدون هشدار (شکست = عبور —
// لایه‌ی canary اسکریپت head خرابیِ واقعی را می‌گیرد).

export type BrowserName =
	| 'chrome'
	| 'edge'
	| 'edge-legacy'
	| 'ie'
	| 'opera'
	| 'samsung'
	| 'safari'
	| 'firefox'
	| 'other'

export interface ParsedBrowser {
	name: BrowserName
	/** نسخه‌ی اصلی موتور (major) — برای engineVersion؛ null = ناشناخته */
	major: number | null
	/** نسخه‌ی فرعی — فقط سافاری (تفاوت ۱۸.۰ سپتامبر ۲۰۲۴ با ۱۸.۳ مارس ۲۰۲۵) */
	minor?: number
}

/** لنگرهای نسخه→تاریخ (نقطه‌ی مرجع پاید) + ریتم انتشار تقریبی هر موتور.
 *  طراحی «غلتان»: تاریخ تخمینی از (لنگر − نسخه) × ریتم به دست می‌آید و با
 *  «امروزِ» واقعی مقایسه می‌شود — لنگر کهنه شود هم تخمین نسخه‌های پایین‌تر
 *  خودش درست می‌ماند و نسخه‌های بالاتر از لنگر همیشه «مدرن» تلقی می‌شوند. */
const ANCHORS = {
	// Chrome 141 stable = ۳۰ سپتامبر ۲۰۲۵؛ میانگین انتشار کرومیوم ≈ ۳۳ روز
	chromium: { version: 141, ms: Date.UTC(2025, 8, 30), cadenceDays: 33 },
	// Firefox 141 = ۲۶ اوت ۲۰۲۵؛ ریتم ۴ هفته
	firefox: { version: 141, ms: Date.UTC(2025, 7, 26), cadenceDays: 28 },
	// فقط وقتی توکن Chrome در UA نباشد (نادر) — شماره‌گذاری خودِ اپرا
	operaOwn: { version: 115, ms: Date.UTC(2025, 8, 10), cadenceDays: 28 },
	// فقط وقتی توکن Chrome در UA نباشد — شماره‌گذاری سامسونگ (~۳ نسخه در سال)
	samsungOwn: { version: 27, ms: Date.UTC(2025, 5, 30), cadenceDays: 130 },
} as const

/** سافاری جدول اختصاصی می‌خواهد: اپل از ۱۸ مستقیم به ۲۶ پرید (۱۹ تا ۲۵ هرگز
 *  وجود نداشتند) — برون‌یابی خطی در آن ناحیه تاریخ را ۸ سال جابه‌جا می‌کرد.
 *  نسخه‌های جدول = تاریخ دقیق انتشار major؛ زیر ۱۵ با ریتم سالانه ادامه. */
const SAFARI_RELEASES: Record<number, number> = {
	26: Date.UTC(2025, 8, 15), // سپتامبر ۲۰۲۵
	18: Date.UTC(2024, 8, 16), // سپتامبر ۲۰۲۴
	17: Date.UTC(2023, 8, 18), // سپتامبر ۲۰۲۳
	16: Date.UTC(2022, 8, 15), // سپتامبر ۲۰۲۲
	15: Date.UTC(2021, 8, 20), // سپتامبر ۲۰۲۱
}
const SAFARI_FLOOR = 15
const SAFARI_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** آستانه‌ی «قدیمی» = ۲۴ ماه (تصمیم کاربر: «حداکثر ۲ سال قبل از تاریخ کنونی») */
const OUTDATED_MS = 365 * 2 * 24 * 60 * 60 * 1000

function firstMatch(
	ua: string,
	patterns: [RegExp, RegExp | null][],
): number | null {
	for (const [nameRe, verRe] of patterns) {
		const nameMatch = nameRe.exec(ua)
		if (nameMatch) {
			if (!verRe) return null
			const verMatch = verRe.exec(ua)
			if (!verMatch) return null
			const major = Number.parseInt(verMatch[1], 10)
			return Number.isFinite(major) ? major : null
		}
	}
	return null
}

/**
 * تجزیه‌ی User-Agent — فقط برای سنجه‌ی «قدیمی بودن» طراحی شده، نه آمار.
 * ترتیب مهم است: توکن‌های اختصاصی قبل از Chrome/ مشترک بررسی می‌شوند.
 */
export function parseUserAgent(
	rawUa: string | null | undefined,
): ParsedBrowser | null {
	if (!rawUa) return null
	const ua = rawUa

	// IE و Edge قدیمی (EdgeHTML) — موتورهای مرده؛ همیشه قدیمی‌تر از ۲ سال
	if (/MSIE [\d.]+|Trident\/[\d.]+/.test(ua)) return { name: 'ie', major: null }
	if (/(^|[\s/)])Edge\/[\d.]+/.test(ua) && !/Edg(A|iOS)?\//.test(ua)) {
		return { name: 'edge-legacy', major: null }
	}

	// Edge جدید (کرومیومی) — توکن «Edg/» یا «EdgA/» یا «EdgiOS/»
	if (/Edg(A|iOS)?\//.test(ua)) {
		// توکن Chrome/ در UA هست (نماینده‌ی واقعی موتور) وگرنه خودِ Edg
		const major =
			firstMatch(ua, [
				[/Chrome\//, /Chrome\/(\d+)/],
				[/Edg/, /Edg(?:A|iOS)?\/(\d+)/],
			]) ?? null
		return { name: 'edge', major }
	}

	if (/OPR\/|Opera /.test(ua)) {
		const major =
			firstMatch(ua, [
				[/Chrome\//, /Chrome\/(\d+)/],
				[/OPR\//, /OPR\/(\d+)/],
			]) ?? null
		return { name: 'opera', major }
	}

	if (/SamsungBrowser\//.test(ua)) {
		const major =
			firstMatch(ua, [
				[/Chrome\//, /Chrome\/(\d+)/],
				[/SamsungBrowser\//, /SamsungBrowser\/(\d+)/],
			]) ?? null
		return { name: 'samsung', major }
	}

	// Chrome / Chromium / Chrome-iOS
	if (/(?:Chrome|Chromium|CriOS)\//.test(ua)) {
		const major = firstMatch(ua, [
			[/CriOS\//, /CriOS\/(\d+)/],
			[/Chrome\//, /Chrome\/(\d+)/],
			[/Chromium\//, /Chromium\/(\d+)/],
		])
		return { name: 'chrome', major }
	}

	// Firefox (دسکتاپ + iOS)
	if (/FxiOS\//.test(ua))
		return {
			name: 'firefox',
			major: firstMatch(ua, [[/FxiOS\//, /FxiOS\/(\d+)/]]),
		}
	if (/Firefox\//.test(ua))
		return {
			name: 'firefox',
			major: firstMatch(ua, [[/Firefox\//, /Firefox\/(\d+)/]]),
		}

	// Safari — نسخه از توکن Version/ (نه توکن داخلی Safari/)؛ minor هم
	// گرفته می‌شود چون تفاوت ۱۸.۰ و ۱۸.۳ از یک فاصله‌ی زمانی است
	if (/Version\/[\d.]+ Safari\//.test(ua)) {
		const vm = /Version\/(\d+)(?:\.(\d+))?/.exec(ua)
		if (!vm) return { name: 'safari', major: null }
		const major = Number.parseInt(vm[1] ?? '', 10)
		const minor = vm[2] ? Number.parseInt(vm[2], 10) : 0
		return {
			name: 'safari',
			major: Number.isFinite(major) ? major : null,
			minor: Number.isFinite(minor) ? minor : 0,
		}
	}

	return null
}

function engineAnchor(
	parsed: ParsedBrowser,
): { version: number; ms: number; cadenceDays: number } | null {
	switch (parsed.name) {
		case 'chrome':
		case 'edge':
			return ANCHORS.chromium
		case 'opera':
			return ANCHORS.chromium // وقتی توکن Chrome موجود بود ( حالت عادی)
		case 'samsung':
			return ANCHORS.chromium
		case 'firefox':
			return ANCHORS.firefox
		case 'safari':
			return null // سافاری با جدول اختصاصی زیر — نه لنگر خطی
		default:
			return null
	}
}

/** تخمین تاریخ انتشار سافاری — جدول دقیق major ها + ~۶۰ روز به ازای هر
 *  minor (اپل سالانه ~۵ minor می‌دهد)؛ ۱۹ تا ۲۵ هرگز وجود نداشتند
 *  (پرش اپل) → ناشناخته = عبور در شکست؛ زیر ۱۵ برون‌یابی سالانه. */
function safariReleaseMs(major: number, minor: number): number | null {
	if (major > 26) return null // از جدول جدیدتر — قطعاً مدرن
	const base = SAFARI_RELEASES[major]
	if (base !== undefined) return base + minor * 60 * 24 * 60 * 60 * 1000
	if (major >= 19 && major <= 25) return null // نسخه‌ی ساختگی/ناشناخته
	if (major < 1) return null
	// زیر کف جدول — هر major یک سال (تقریب کافی برای آستانه‌ی ۲۴ ماه)
	return SAFARI_RELEASES[SAFARI_FLOOR] - (SAFARI_FLOOR - major) * SAFARI_YEAR_MS
}

/** آیا این UA مرورگری «قدیمی‌تر از ۲ سال» است؟ (قانون یکسان همه‌ی مرورگرها) */
export function isBrowserOutdated(
	rawUa: string | null | undefined,
	now = new Date(),
): boolean {
	const parsed = parseUserAgent(rawUa)
	if (!parsed) return false
	// موتورهای مرده — همیشه قدیمی
	if (parsed.name === 'ie' || parsed.name === 'edge-legacy') return true
	if (parsed.major === null) return false // نسخه‌ی ناشناخته — عبور در شکست

	// سافاری: جدول اختصاصی (پرش نسخه‌ی اپل)
	if (parsed.name === 'safari') {
		if (parsed.major === null) return false
		const release = safariReleaseMs(parsed.major, parsed.minor ?? 0)
		if (release === null) return false // جدیدتر از جدول یا ناشناخته
		return now.getTime() - release > OUTDATED_MS
	}

	let anchor = engineAnchor(parsed)
	// opera/samsung بدون توکن Chrome → لنگر شماره‌گذاری خودشان
	if (parsed.name === 'opera' && !/Chrome\//.test(rawUa ?? ''))
		anchor = ANCHORS.operaOwn
	if (parsed.name === 'samsung' && !/Chrome\//.test(rawUa ?? ''))
		anchor = ANCHORS.samsungOwn
	if (!anchor) return false

	// نسخه‌ی جدیدتر از لنگر → قطعاً مدرن
	if (parsed.major >= anchor.version) return false

	// تخمین تاریخ انتشار: لنگر منهای (فاصله‌ی نسخه × ریتم انتشار)
	const versionGap = anchor.version - parsed.major
	const estimatedReleaseMs =
		anchor.ms - versionGap * anchor.cadenceDays * 24 * 60 * 60 * 1000
	return now.getTime() - estimatedReleaseMs > OUTDATED_MS
}

/** برچسب خوانای مرورگر برای لیست دستگاه‌ها — «Chrome 141» / «Edge 118» */
export function browserLabel(rawUa: string | null | undefined): string | null {
	const parsed = parseUserAgent(rawUa)
	if (!parsed) return null
	const names: Record<BrowserName, string> = {
		chrome: 'Chrome',
		edge: 'Edge',
		'edge-legacy': 'Edge قدیمی',
		ie: 'IE',
		opera: 'Opera',
		samsung: 'Samsung Internet',
		safari: 'Safari',
		firefox: 'Firefox',
		other: 'مرورگر',
	}
	return parsed.major === null
		? names[parsed.name]
		: `${names[parsed.name]} ${parsed.major}`
}

/**
 * جمعِ منطق بنر لندینگ (رارد ۳۱):
 *   هشدار = مرورگر قدیمی‌تر از ۲ سال + کاربر قبلاً نبسته باشد.
 * (معافیت کرالرها قبل از فراخوانی این تابع در beforeLoad اعمال می‌شود.)
 */
export function shouldShowOutdatedBanner(input: {
	ua: string | null | undefined
	dismissed: boolean
	now?: Date
}): boolean {
	if (input.dismissed) return false
	return isBrowserOutdated(input.ua, input.now)
}