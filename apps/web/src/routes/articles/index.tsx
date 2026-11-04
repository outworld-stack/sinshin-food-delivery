// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 6 از 7
// مسیر مقصد: apps/web/src/routes/articles/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

// src/routes/articles/index.tsx
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { Filter } from 'reicon-react'
import { z } from 'zod'
import { ArticleCard } from '#/components/ArticleCard'
import { CategoryScroller } from '#/components/CategoryScroller'
import { EmptyState } from '#/components/EmptyState'
import {
	ArticleCardSkeleton,
	ArticlesPageSkeleton,
} from '#/components/LoadingSkeletons'
import { BottomSheet } from '#/components/shared/BottomSheet'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { ArticlesFilterContent } from '#/components/site/articles/ArticlesFilterContent'
import { ARTICLES_PAGE_SIZE, orderArticles, useArticlesPage } from '#/hooks/site/useArticlesPage'
import { useI18n } from '#/i18n'
import { alternateLinks, headLang, langUrl, seoHead } from '#/lib/seo'
import { articleCategoriesOptions, articlesOptions } from '#/utils/queryOptions'

function archivePath(search: { category?: string; subCategory?: string; sort?: string; page?: number }) {
	const query = new URLSearchParams()
	if (search.category && search.category !== 'all') query.set('category', search.category)
	if (search.subCategory && search.subCategory !== 'all') query.set('subCategory', search.subCategory)
	if (search.sort === 'most-viewed') query.set('sort', search.sort)
	if (search.page && search.page > 1) query.set('page', String(search.page))
	return `/articles${query.size ? `?${query}` : ''}`
}

const ArticlesPage = memo(function ArticlesPage() {
	const page = useArticlesPage()
	const { t } = useI18n()

	// تریگر موبایل — هندلر پایدار
	const handleOpenMobileFilter = useCallback(
		() => page.handleOpenFilter(),
		[page.handleOpenFilter],
	)

	return (
		<div className="py-6">
			{/* سئو-۷: h1 صفحه — مقالات ایندکس‌شونده‌اند و ساختار عنوان لازم دارند */}
			<h1 className="font-DanaDemiBold text-2xl sm:text-3xl text-gray-900 dark:text-white mb-6">
				{t['articles.title']}
			</h1>

			{/* تریگر فیلتر موبایل */}
			<div className="md:hidden mb-4">
				<button
					type="button"
					onClick={handleOpenMobileFilter}
					className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-white dark:bg-[#2a1015] text-gray-800 dark:text-white font-DanaMedium border border-gray-200 dark:border-[#3a151c] shadow-sm cursor-pointer"
				>
					<span>{t['articles.filterSort']}</span>
					<Filter size={24} />
				</button>
			</div>

			{/* اسکرولر دسته‌ها */}
			<CategoryScroller items={page.scrollerItems} />

			<div className="flex flex-col md:flex-row gap-8 mt-8">
				{/* سایدبار دسکتاپ */}
				<aside className="hidden md:block w-64 shrink-0">
					<div className="sticky top-6 bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-300 dark:border-[#4a1a24] shadow-sm">
						<ArticlesFilterContent
							hasSubCategories={page.hasSubCategories}
							subCategories={page.subCategories}
							tempSubCategory={page.subCategory}
							tempSortBy={page.state.appliedSortBy}
							onTempSub={page.handleSubCategoryChange}
							onTempSort={page.handleSortChange}
							onApply={page.handleApplyFilters}
						/>
					</div>
				</aside>

				{/* گرید مقالات */}
				<div className="flex-1">
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
						{page.isLoading ? (
							Array.from({ length: 6 }).map((_, index) => (
								<ArticleCardSkeleton key={`skeleton-${index}`} />
							))
						) : page.visibleArticles.length > 0 ? (
							page.visibleArticles.map((article) => (
								<ArticleCard
									// رارد ۴۰ — key هر آیتم تا هشدار «unique key prop» کنسول نباشد
									key={article.id}
									article={{
										...article,
										profileImage: article.profileImage ?? null,
										// رارد ۴۷ — publishedAt قراردادِ required شد؛
										// پشتیبانِ «امروز» برای تاریخ گمشده حذف شد
										publishedAt: new Date(article.publishedAt),
									}}
								/>
							))
						) : (
							<EmptyState
								title={t['articles.emptyTitle']}
								description={t['articles.emptyDesc']}
							/>
						)}
					</div>

					{/* Links expose every archive page to crawlers and work without JavaScript. */}
					{page.currentPage > 1 && (
						<div className="mt-6 text-center">
							<Link to="/articles" search={page.previousPageSearch} rel="prev" className="font-DanaMedium text-primary dark:text-dark-primary">
								{t['articles.previousPage']}
							</Link>
						</div>
					)}
					{page.hasMore && !page.isLoading && (
						<div className="mt-10 text-center">
							<Link
								to="/articles"
								search={page.nextPageSearch}
								rel="next"
								preload={false}
								onClick={(event) => {
									// Keep the existing append interaction; modified clicks follow the URL.
									if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
									event.preventDefault()
									page.handleLoadMore()
								}}
								className="inline-block px-8 py-3 rounded-xl bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer border border-gray-200 dark:border-white/10"
							>
								{t['articles.loadMore']}
							</Link>
						</div>
					)}
				</div>
			</div>

			{/* مودال فیلتر موبایل */}
			<BottomSheet
				isOpen={page.state.isFilterOpen}
				onClose={page.handleCloseFilter}
				title={t['articles.filtersTitle']}
			>
				<ArticlesFilterContent
					hasSubCategories={page.hasSubCategories}
					subCategories={page.subCategories}
					tempSubCategory={page.state.tempSubCategory}
					tempSortBy={page.state.tempSortBy}
					isMobileModal
					onTempSub={page.handleTempSub}
					onTempSort={page.handleTempSort}
					onApply={page.handleApplyFilters}
				/>
			</BottomSheet>
		</div>
	)
})

export const Route = createFileRoute('/articles/')({
	validateSearch: z.object({
		lang: z.enum(['fa', 'ar']).optional().catch(undefined),
		category: z.string().trim().max(60).transform(value => value || undefined).optional().catch(undefined),
		subCategory: z.string().trim().max(60).transform(value => value || undefined).optional().catch(undefined),
		// ⬅ NEW: سورت در URL — shareable + back/refresh-safe
		sort: z.enum(['newest', 'most-viewed']).optional().catch(undefined),
		page: z.coerce.number().int().min(1).max(1_000_000).optional().catch(undefined),
	}),

	// Revalidate the archive boundary when its ordering or page changes.
	loaderDeps: ({ search }) => ({
		category: search.category,
		subCategory: search.subCategory,
		sort: search.sort,
		page: search.page,
	}),

	// ⬅ NEW: SSR — کرالر محتوای واقعی می‌گیره نه اسکلتون
	loader: async ({ context, deps }) => {
		const [, articles, allArticles] = await Promise.all([
			context.queryClient.query(articleCategoriesOptions),
			context.queryClient.query(
				articlesOptions(deps.category ?? 'all', deps.subCategory ?? 'all'),
			),
			context.queryClient.query(articlesOptions('all', 'all')),
		])
		const page = deps.page ?? 1
		const total = orderArticles(articles, allArticles, deps.category ?? 'all', deps.subCategory ?? 'all', deps.sort ?? 'newest').length
		if (page > 1 && (page - 1) * ARTICLES_PAGE_SIZE >= total) throw notFound()
		return { page }
	},

	component: ArticlesPage,
	pendingComponent: ArticlesPageSkeleton,
	errorComponent: RouteError,
	notFoundComponent: RouteNotFound,
	// رارد ۳۸ — سئوی دوزبانه + canonical/hreflang (سئو-۶ قبلی حفظ شد)
	head: (ctx) => {
		const base = seoHead('articles')(ctx)
		if (!ctx.loaderData) return { meta: [...base.meta, { name: 'robots', content: 'noindex, follow' }] }
		const lang = headLang(ctx.matches)
		const path = archivePath(ctx.match.search)
		const canonical = langUrl(path, lang)
		const page = ctx.loaderData.page
		const filtered = !!(ctx.match.search.category && ctx.match.search.category !== 'all') ||
			!!(ctx.match.search.subCategory && ctx.match.search.subCategory !== 'all') || ctx.match.search.sort === 'most-viewed'
		return {
			meta: [
				...base.meta.map((meta) => {
					if ('title' in meta && page > 1) return { title: `${meta.title} | ${page}` }
					if ('property' in meta && meta.property === 'og:url') return { ...meta, content: canonical }
					return meta
				}),
				...(filtered ? [{ name: 'robots', content: 'noindex, follow' }] : []),
			],
			links: [{ rel: 'canonical', href: canonical }, ...alternateLinks(path)],
		}
	},
})
