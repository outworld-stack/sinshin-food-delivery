// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/types/site/featured-animation.ts
// قرارداد «انیمیشن پس‌زمینه‌ی صفحه‌ی محصول ویژه» — قابل انتخاب توسط
// ادمین اصلی (کلید DB: featured_animation؛ پیش‌فرض/غایب = 'shader'
// یعنی همان انیمیشن WebGL فعلی — بدون تغییرِ رفتارِ نصب‌های موجود).
//   • shader — شیدر موج‌دار WebGL (ShaderBackground — انیمیشن فعلی)
//   • sonar  — شبکه‌ی نقطه‌ای با حلقه‌های پخش‌شونده (SonarGridBackground)
//   • sparks — جرقه‌های پخش‌شونده از دو گوشه (DualSparksBackground)
// ═══════════════════════════════════════════════════════════════

export const FEATURED_ANIMATIONS = ['shader', 'sonar', 'sparks'] as const
export type FeaturedAnimation = (typeof FEATURED_ANIMATIONS)[number]

/** مقدار خام سرور → انیمیشن معتبر؛ هر چیز ناشناخته/غایب = پیش‌فرض shader
 *  (پشتیبانِ ایمن: تنظیمِ دستکاری‌شده هرگز صفحه را نمی‌شکند) */
export function normalizeFeaturedAnimation(raw: unknown): FeaturedAnimation {
	return raw === 'sonar' || raw === 'sparks' ? raw : 'shader'
}
