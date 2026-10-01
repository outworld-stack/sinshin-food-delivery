// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 8 از 18
// مسیر مقصد: web/src/routes/products/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/products/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { memo } from 'react'
import { z } from 'zod'
import { CategoryScroller } from '#/components/CategoryScroller'
import { ProductsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ProductsDesktopFilter } from '#/components/site/products/ProductsDesktopFilter'
import { ProductsGrid } from '#/components/site/products/ProductsGrid'
import { ProductsMobileFilter } from '#/components/site/products/ProductsMobileFilter'
import {
	resolveActiveMain,
	sortSchema,
	useProductsPage,
} from '#/hooks/site/useProductsPage'
import { useI18n } from '#/i18n'
import { seoHead } from '#/lib/seo'
import {
	activeMainCategoriesOptions,
	productsByMainOptions,
} from '#/utils/queryOptions'

const ProductsPage = memo(function ProductsPage() {
	const page = useProductsPage()
	const { t } = useI18n()

	if (page.isLoading) {
		return <ProductsPageSkeleton />
	}

	return (
		<div className="py-6 overflow-x-hidden">
			{/* سئو-۷: h1 صفحه — قبل از هر چیز، برای کرالر و وضوح کاربر */}
			<h1 className="font-DanaDemiBold text-2xl sm:text-3xl text-gray-900 dark:text-white mb-6">
				{t['products.title']}
			</h1>

			{/* نوار تب موبایل: اینجا نیست — MainLayout رندرش می‌کنه */}

			<ProductsMobileFilter
				isOpen={page.state.isFilterOpen}
				tempSortBy={page.state.tempSortBy}
				onOpen={page.handleOpenFilter}
				onClose={page.handleCloseFilter}
				onApply={page.handleApplyFilters}
				onTempSortChange={page.handleModalSort}
			/>

			<CategoryScroller items={page.scrollerItems} />

			<div className="flex flex-col md:flex-row gap-8">
				<ProductsDesktopFilter
					sortBy={page.state.sortBy}
					onSortChange={page.handleDesktopSort}
				/>
				<ProductsGrid
					products={page.filteredProducts}
					hasMore={page.hasMore}
					onLoadMore={page.handleLoadMore}
				/>
			</div>
		</div>
	)
})

export const Route = createFileRoute('/products/')({
	validateSearch: z.object({
		category: z.string().optional(),
		tab: z.string().optional(),
		// ⬅ NEW: سورت هم شهروند URL شد — shareable + بک/رفرش حفظش می‌کنه
		sort: sortSchema.optional(),
	}),

	// فقط وقتی «تب» عوض شه loader دوباره اجرا شه — سورت/دسته کلاینتی‌ان
	loaderDeps: ({ search }) => ({ tab: search.tab }),

	// ⬅ NEW: SSR دیتا — قبل از رندر، کوئری‌ها در کش هستن.
	// نتیجه: HTML کامل برای کرالر + هیدریشن بدون فلیک اسکلتون.
	// با defaultPreload: 'intent' → hover روی لینک منو، همین loader پیش‌fetch می‌شه!
	// (query خودش دیتا رو برمی‌گردونه — گت‌دیتای جدا لازم نیست)
	loader: async ({ context, deps }) => {
		const mains = await context.queryClient.query(activeMainCategoriesOptions)
		const activeMain = resolveActiveMain(mains, deps.tab)
		if (activeMain) {
			await context.queryClient.query(productsByMainOptions(activeMain.slug))
		}
	},

	component: ProductsPage,
	pendingComponent: ProductsPageSkeleton,
	errorComponent: RouteError,
	// رارد ۳۸ — سئوی دوزبانه: عنوان/توضیح/keywords/og به زبان فعال +
	// canonical واریانت زبان + هر سه hreflang. canonical «بدون پارامتر tab/sort»
	// (سئو-۶) همچنان برقرار است — seoHead فقط مسیر تمیز /products را می‌سازد.
	head: seoHead('products'),
})
