// src/routes/articles/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { memo, useCallback } from 'react'
import { useArticlesPage } from '#/hooks/site/useArticlesPage'
import { articleCategoriesOptions, articlesOptions } from '#/utils/queryOptions'
import { ArticlesFilterContent } from '#/components/site/articles/ArticlesFilterContent'
import { ArticleCard } from '#/components/ArticleCard'
import { CategoryScroller } from '#/components/CategoryScroller'
import { EmptyState } from '#/components/EmptyState'
import { ArticlesPageSkeleton, ArticleCardSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { Filter } from 'reicon-react'
import { BottomSheet } from '#/components/shared/BottomSheet'


const ArticlesPage = memo(function ArticlesPage() {
  const page = useArticlesPage()

  // تریگر موبایل — هندلر پایدار
  const handleOpenMobileFilter = useCallback(() => page.handleOpenFilter(), [page.handleOpenFilter])

  return (
    <div className="py-6">
      {/* تریگر فیلتر موبایل */}
      <div className="md:hidden mb-4">
        <button
          type="button"
          onClick={handleOpenMobileFilter}
          className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-white dark:bg-[#2a1015] text-gray-800 dark:text-white font-DanaMedium border border-gray-200 dark:border-[#3a151c] shadow-sm cursor-pointer"
        >
          <span>فیلتر و مرتب‌سازی</span>
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
              tempSubCategory={page.state.tempSubCategory}
              tempSortBy={page.state.tempSortBy}
              onTempSub={page.handleTempSub}
              onTempSort={page.handleTempSort}
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
                <ArticleCard article={{
                  ...article,
                  profileImage: article.profileImage ?? null,
                  publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
                }} />
              ))
            ) : (
              <EmptyState
                title="مقاله‌ای یافت نشد"
                description="در حال حاضر مقاله‌ای در این دسته‌بندی وجود ندارد."
              />
            )}
          </div>

          {/* لود بیشتر */}
          {page.hasMore && !page.isLoading && (
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={page.handleLoadMore}
                className="px-8 py-3 rounded-xl bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer border border-gray-200 dark:border-white/10"
              >
                مشاهده مقالات بیشتر
              </button>
            </div>
          )}
        </div>
      </div>

      {/* مودال فیلتر موبایل */}
      <BottomSheet isOpen={page.state.isFilterOpen} onClose={page.handleCloseFilter} title="فیلترهای مقالات">
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
    category: z.string().optional(),
    subCategory: z.string().optional(),
    // ⬅ NEW: سورت در URL — shareable + back/refresh-safe
    sort: z.enum(['newest', 'most-viewed']).optional(),
  }),

  // فقط category/sub دیتا رو عوض می‌کنن — سورت کلاینتیه
  loaderDeps: ({ search }) => ({
    category: search.category,
    subCategory: search.subCategory,
  }),

  // ⬅ NEW: SSR — کرالر محتوای واقعی می‌گیره نه اسکلتون
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.query(articleCategoriesOptions),
      context.queryClient.query(articlesOptions(deps.category ?? 'all', deps.subCategory ?? 'all')),
    ])
  },

  component: ArticlesPage,
  pendingComponent: ArticlesPageSkeleton,
  errorComponent: RouteError,
  // SEO — صفحه عمومی ایندکس‌شونده
  head: () => ({
    meta: [
      { title: 'مقالات | سین شین' },
      { name: 'description', content: 'مقالات آموزشی و معرفی محصولات فودپارک سین شین — دستورپخت، نکات و راهنمای سفارش.' },
    ],
  }),
})