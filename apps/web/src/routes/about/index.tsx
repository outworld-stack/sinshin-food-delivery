// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 13 از 18
// مسیر مقصد: web/src/routes/about/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/about/index.tsx

import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { memo } from 'react'
import { AboutPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { useI18n } from '#/i18n'
import { seoHead } from '#/lib/seo'
import { aboutContentOptions } from '#/utils/queryOptions'

const AboutPage = memo(function AboutPage() {
	// فکتوری مرکزی — کلید/staleTime یکدست با بقیه‌ی سایت
	const { data: content } = useQuery(aboutContentOptions)
	const { t } = useI18n()

	if (!content) return <AboutPageSkeleton />

	return (
		<article className="py-10 lg:py-20">
			<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
				{/* HERO — داستان برند */}
				<section className="flex flex-col md:flex-row items-start gap-8 mb-24">
					<div className="w-full md:w-2/5 shrink-0">
						<div
							className={`h-69.25 md:h-101 w-full rounded-3xl bg-linear-to-br ${content.heroGradient}`}
							role="img"
							aria-label={t['about.heroAlt']}
						/>
					</div>
					<div className="w-full flex items-center">
						<div className="w-full">
							<h1 className="font-DanaDemiBold text-4xl lg:text-5xl text-black dark:text-white mb-9 max-lg:text-center">
								{content.heroTitle}
							</h1>
							<p className="font-DanaRegular text-lg lg:text-xl leading-8 text-gray-500 dark:text-gray-400 max-w-2xl mx-auto md:mx-0 text-justify lg:pl-10">
								{content.heroText}
							</p>
						</div>
					</div>
				</section>

				{/* TEAM */}
				<section className="py-14 lg:py-24">
					<h2 className="font-DanaDemiBold text-4xl text-center text-gray-800 dark:text-white mb-14 font-bold">
						{content.teamTitle}
					</h2>
					<div
						className={`h-69.25 md:h-101 w-full rounded-3xl bg-linear-to-br ${content.teamGradient}`}
						role="img"
						aria-label={content.teamAlt}
					/>
				</section>
			</div>
		</article>
	)
})

export const Route = createFileRoute('/about/')({
	component: AboutPage,
	// SSR — محتوای درباره‌ما در کش قبل از رندر؛ صفحه‌ی ایندکس‌شونده‌ی مهم
	loader: ({ context }) => context.queryClient.query(aboutContentOptions),
	errorComponent: RouteError,
	pendingComponent: AboutPageSkeleton,
	// رارد ۳۸ — سئوی دوزبانه: og:type=article و og:locale از دیکشنری/ریشه
	// می‌آید؛ عنوان/توضیح/keywords/og + canonical + hreflang به زبان فعال.
	head: seoHead('about'),
})
