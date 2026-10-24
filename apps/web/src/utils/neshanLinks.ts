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
//     پینِ قرمزِ مقصد دقیقاً روی نقطه + خط مسیر از «موقعیت کنونیِ» کاربر
//     (خودِ نشان مبدأ را از موقعیت مرورگر/گوشی می‌گیرد) — همان چیزی که
//     منوی راست‌کلیکِ خودِ نشان با «مسیریابی به اینجا» می‌سازد. با مبدأِ
//     صریح هم کار می‌کند:
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
 * پیوند «مسیریابی از موقعیت من» — مقصد = پین روی نقطهٔ انتخابی؛
 * مبدأ = موقعیتِ کنونیِ کاربر؛ پنل و خط مسیر خودکار باز می‌شود.
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
