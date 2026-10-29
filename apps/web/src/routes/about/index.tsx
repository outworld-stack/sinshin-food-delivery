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
import { AboutContentView } from '#/components/site/about/AboutContentView'
import { seoHead } from '#/lib/seo'
import { aboutContentOptions } from '#/utils/queryOptions'

const AboutPage = memo(function AboutPage() {
	// فکتوری مرکزی — کلید/staleTime یکدست با بقیه‌ی سایت
	const { data: content, error } = useQuery(aboutContentOptions)
	if (error && !content) throw error

	if (!content) return <AboutPageSkeleton />

	return <AboutContentView content={content} />
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
