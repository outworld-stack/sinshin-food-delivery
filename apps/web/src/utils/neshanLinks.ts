// src/utils/neshanLinks.ts
// ═══════════════════════════════════════════════════════════════
// stage-92 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/utils/neshanLinks.ts (فایل جدید)
// دیپ‌لینک‌های «نقشه نشان» — تنها منبعِ حقیقت برای هر پیوندِ بیرونیِ نقشه.
//
// هر دو فرمت به‌صورت تجربی روی خودِ وب‌اپِ neshan.org/maps راستی‌آزمایی
// شدند (نشستِ تازه، با خواندنِ مرکزِ واقعیِ نقشه از منوی راست‌کلیک →
// «مسیریابی به اینجا/از اینجا» که مختصات را در URL رمزگذاری می‌کند):
//   · نمای مکان:  /maps/@{lat},{lng},{zoom}z
//     نقشه در «مرکزِ نقطه» باز می‌شود. فرمت @ در بارگذاریِ تازه خوانده
//     می‌شود؛ اما هشِ #c{lat}-{lng}-{zoom}z حالتِ SPA-درونی است و در
//     بارگذاریِ تازه نادیده گرفته می‌شود (آزمون شد — هرگز استفاده نشود).
//   · مسیریابی:    /maps/routing/car/destination/{lat},{lng}
//     پینِ قرمزِ مقصد دقیقاً روی نقطه؛ در نشستِ تازه مبدأ را کاربر باید
//     انتخاب کند. برای مسیر از GPS، مبدأ را با neshanRouteFromUrl صریح
//     می‌فرستیم. فرمتِ وب با مبدأِ صریح هم کار می‌کند:
//     /maps/routing/car/origin/{oLat},{oLng}/destination/{lat},{lng}
// ═══════════════════════════════════════════════════════════════

/** هم‌عرضِ گرد‌کردنِ نرمالایزرِ API (۶ رقم) — خروجیِ پایدار، بدون نمادِ علمی */
const fmtCoord = (value: number): string => value.toFixed(6)

/** مختصاتِ قابل‌استفاده؟ (همان محدودهٔ اعتبارسنجیِ بلوک موقعیت: ±۹۰/۱۸۰) */
export function isNeshanCoord(lat: number, lng: number): boolean {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lng) &&
		lat >= -90 &&
		lat <= 90 &&
		lng >= -180 &&
		lng <= 180
	)
}

/**
 * پیوند «مشاهده روی نقشه» — نشان در مرکزِ نقطهٔ انتخابی باز می‌شود.
 * (زوم را خودِ اپ نشان مدیریت می‌کند؛ پسوند همان ۱۵ قدیمی می‌ماند.)
 */
export function neshanViewUrl(lat: number, lng: number, zoom = 15): string {
	return `https://neshan.org/maps/@${fmtCoord(lat)},${fmtCoord(lng)},${zoom}z`
}

/**
 * Documented point link for the installed Neshan app and its web fallback.
 * Use this when the origin is unknown: destination-only routing query links
 * drop the destination, and website routing paths are not the app contract.
 * https://platform.neshan.org/FAQ/
 */
export function neshanPointUrl(lat: number, lng: number): string {
	return `https://nshn.ir/?lat=${fmtCoord(lat)}&lng=${fmtCoord(lng)}`
}

/**
 * Website-only routing view. For an app handoff without an origin, use
 * neshanPointUrl instead; the native app need not understand website paths.
 */
export function neshanRouteUrl(lat: number, lng: number): string {
	return `https://neshan.org/maps/routing/car/destination/${fmtCoord(lat)},${fmtCoord(lng)}`
}

/**
 * stage-98 — لینکِ رسمیِ «مسیریابی با مبدأِ صریح» — nshn.ir (هوشمند):
 * اپِ نصب‌شدهٔ نشان را باز می‌کند وگرنه به وبِ کامل 301 می‌شود
 * (راستی‌آزماییِ زندهٔ استیج-۹۷: → neshan.org/maps/routing/d/origin/…/destination/…).
 * vehicle=d (ماشین) — پیش‌فرضِ رسمیِ خودِ نشان؛ مبدا/مقصد = مختصاتِ ۶رقمی.
 * منبع: پلتفرم رسمی نشان (بخش دیپ‌لینک FAQ) — «مبدأ خودکار» در داکیومنت
 * وجود ندارد؛ پس سایت باید GPS بخواند و مبدأ را صریح در لینک بگذارد.
 */
export function neshanRouteFromUrl(
	oLat: number,
	oLng: number,
	dLat: number,
	dLng: number,
): string {
	return `https://nshn.ir?origin=${fmtCoord(oLat)},${fmtCoord(oLng)}&destination=${fmtCoord(dLat)},${fmtCoord(dLng)}&vehicle=d`
}

export type NeshanTarget = 'web' | 'app'
export type NeshanPlatform = 'android' | 'ios' | 'other'
export interface NeshanOrigin {
	lat: number
	lng: number
}

/** Explicit website route: do not send the website choice through app links. */
export function neshanWebDirectionsUrl(
	lat: number,
	lng: number,
	origin: NeshanOrigin | null,
): string {
	return origin
		? `https://neshan.org/maps/routing/car/origin/${fmtCoord(origin.lat)},${fmtCoord(origin.lng)}/destination/${fmtCoord(lat)},${fmtCoord(lng)}`
		: neshanRouteUrl(lat, lng)
}

/**
 * Neshan's official FAQ documents the HTTPS Android links and iOS schemes.
 * The Android package is linked by https://neshan.org/ (Google Play/Bazaar).
 * Chrome's intent fallback opens the same route if that package is absent.
 */
export function neshanAppDirectionsUrl(
	lat: number,
	lng: number,
	origin: NeshanOrigin | null,
	platform: NeshanPlatform,
): string {
	if (platform === 'ios') {
		return origin
			? `neshan://?origin=${fmtCoord(origin.lat)},${fmtCoord(origin.lng)}&destination=${fmtCoord(lat)},${fmtCoord(lng)}&vehicle=d`
			: `neshan://?ll=${fmtCoord(lat)},${fmtCoord(lng)}`
	}
	const appLink = origin
		? neshanRouteFromUrl(origin.lat, origin.lng, lat, lng)
		: neshanPointUrl(lat, lng)
	if (platform !== 'android') return appLink
	const fallback = encodeURIComponent(neshanWebDirectionsUrl(lat, lng, origin))
	return `${appLink.replace('https://', 'intent://')}#Intent;scheme=https;package=org.rajman.neshan.traffic.tehran.navigator;S.browser_fallback_url=${fallback};end`
}

export function neshanPlatform(
	device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
): NeshanPlatform {
	if (/Android/i.test(device.userAgent)) return 'android'
	if (
		/iPad|iPhone|iPod/i.test(device.userAgent) ||
		(device.platform === 'MacIntel' && device.maxTouchPoints > 1)
	)
		return 'ios'
	return 'other'
}

const NESHAN_PREFERENCE_KEY = 'sinshin.neshan-directions-target.v1'

/** Store a destination preference only; never persist location coordinates. */
export function readNeshanPreference(): NeshanTarget | null {
	try {
		const value = window.localStorage.getItem(NESHAN_PREFERENCE_KEY)
		return value === 'web' || value === 'app' ? value : null
	} catch {
		return null
	}
}

export function saveNeshanPreference(value: NeshanTarget | null): void {
	try {
		if (value) window.localStorage.setItem(NESHAN_PREFERENCE_KEY, value)
		else window.localStorage.removeItem(NESHAN_PREFERENCE_KEY)
	} catch {
		/* Private browsing/storage restrictions must not block directions. */
	}
}
