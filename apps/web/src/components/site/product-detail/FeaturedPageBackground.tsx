// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/site/product-detail/FeaturedPageBackground.tsx
// دیسپچرِ «انیمیشن پس‌زمینه‌ی صفحه‌ی محصول ویژه» — ادمین اصلی از پنل
// (تنظیمات → انیمیشن محصول ویژه) یکی از سه انیمیشن را انتخاب می‌کند:
//   • shader (پیش‌فرض) — ShaderBackground (WebGL موج‌دار — انیمیشن فعلی)
//   • sonar  — SonarGridBackground (شبکه‌ی نقطه‌ای + حلقه‌های پخش‌شونده)
//   • sparks — DualSparksBackground (جرقه‌های دوطرفه از گوشه‌ها)
// مقدار از GET /menu/featured-animation (عمومی، کش‌شده با ETag)؛ غایب/خطا
// ⇒ پیش‌فرض shader — یعنی هیچ نصبی با این تغییر رفتارش عوض نمی‌شود.
// ═══════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query'
import { DualSparksBackground } from '#/components/site/product-detail/DualSparksBackground'
import { ShaderBackground } from '#/components/site/product-detail/ShaderBackground'
import { SonarGridBackground } from '#/components/site/product-detail/SonarGridBackground'
import { featuredAnimationOptions } from '#/utils/queryOptions'

export function FeaturedPageBackground() {
	// کوئری سبکِ عمومی (staleTime بلند) — تا رسیدن پاسخ، همان پیش‌فرضِ
	// shader رندر می‌شود (رفتارِ امروز، بدون فلیک)
	const { data } = useQuery(featuredAnimationOptions)
	const animation = data ?? 'shader'

	if (animation === 'sonar') return <SonarGridBackground />
	if (animation === 'sparks') return <DualSparksBackground />
	return <ShaderBackground />
}
