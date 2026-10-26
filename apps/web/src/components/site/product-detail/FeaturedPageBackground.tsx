// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/site/product-detail/FeaturedPageBackground.tsx
// دیسپچرِ «انیمیشن پس‌زمینه‌ی صفحه‌ی محصول ویژه»:
//   • shader (پیش‌فرض) — ShaderBackground (WebGL موج‌دار — انیمیشن فعلی)
//   • sonar  — SonarGridBackground (شبکه‌ی نقطه‌ای + حلقه‌های پخش‌شونده)
//   • sparks — DualSparksBackground (جرقه‌های دوطرفه از گوشه‌ها)
// ═══ stage-101 — انیمیشن «اختصاصیِ هر محصول» ═══
// ادمین اصلی همان‌جا که محصول را ویژه می‌کند (فرم محصول) انیمیشنِ همان
// محصول را هم انتخاب می‌کند (ستون products.featured_animation). اینجا:
//   ۱. propِ animation (مقدار اختصاصی محصول) اگر بیاید ⇒ همان لحظه همان
//      رندر می‌شود (کوئری سراسری حتی اجرا نمی‌شود).
//   ۲. غایب/NULL ⇒ ارث از تنظیم سراسری (GET /menu/featured-animation —
//      کش ETag؛ انتخابِ پیش‌فرض در کارت تنظیمات).
//   ۳. خطا/ناشناخته ⇒ پیش‌فرض shader — هیچ نصبی رفتارش عوض نمی‌شود.
// ═══════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query'
import { DualSparksBackground } from '#/components/site/product-detail/DualSparksBackground'
import { ShaderBackground } from '#/components/site/product-detail/ShaderBackground'
import { SonarGridBackground } from '#/components/site/product-detail/SonarGridBackground'
import type { FeaturedAnimation } from '#/types/site/featured-animation'
import { featuredAnimationOptions } from '#/utils/queryOptions'

interface FeaturedPageBackgroundProps {
	/** stage-101 — انیمیشن اختصاصی همین محصول (نیامد = ارث از تنظیم سراسری) */
	animation?: FeaturedAnimation
}

export function FeaturedPageBackground({
	animation,
}: FeaturedPageBackgroundProps) {
	// کوئری سبکِ عمومی (staleTime بلند) فقط وقتی لازم است: محصولِ ویژه‌ای که
	// انیمیشن اختصاصی ندارد از پیش‌فرضِ سراسری پیروی می‌کند. تا رسیدن پاسخ،
	// همان پیش‌فرضِ shader رندر می‌شود (رفتارِ امروز، بدون فلیک)
	const { data } = useQuery({
		...featuredAnimationOptions,
		enabled: animation === undefined,
	})
	const effective: FeaturedAnimation = animation ?? data ?? 'shader'

	if (effective === 'sonar') return <SonarGridBackground />
	if (effective === 'sparks') return <DualSparksBackground />
	return <ShaderBackground />
}
