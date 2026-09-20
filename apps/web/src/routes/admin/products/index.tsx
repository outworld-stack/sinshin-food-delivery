// src/routes/admin/products/index.tsx
// ⬅ NEW: فیلترها/صفحه‌بندی شهروند URL شدن (validateSearch + loaderDeps + loader)
// + prefetch روی هاور (defaultPreload: 'intent' روتر)
import { createFileRoute, Link } from '@tanstack/react-router'
import { adminProductsSearchSchema, useAdminProductsPage } from '#/hooks/admin/useAdminProductsPage'
import { adminProductsOptions } from '#/utils/queryOptions'
import { ProductsFilterBox } from '#/components/admin/products/ProductsFilterBox'
import { AdminProductCard } from '#/components/admin/products/AdminProductCard'
import { MainCategoryManager } from '#/components/admin/products/MainCategoryManager'
import { CategoryManager } from '#/components/admin/products/CategoryManager'
import { Pagination } from '#/components/Pagination'
import { AdminProductsPageSkeleton } from '#/components/LoadingSkeletons'
import { ConfirmModal } from '#/components/ConfirmModal'
import { PermissionGate, Can } from '#/components/shared/PermissionGate'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { Plus } from 'reicon-react'

export const Route = createFileRoute('/admin/products/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — هر فیلتری که اینجا باشد، رفرش/back/اشتراک‌گذاری حفظش می‌کند.
  // catch: مقادیر خرابِ دست‌کاری‌شده به پیش‌فرض برمی‌گردند نه خطای روت
  validateSearch: adminProductsSearchSchema,

  // فقط فیلترهای «گسسته» deps محسوب می‌شن — تعویض آن‌ها = اجرای دوباره loader.
  // ⚠ search عمداً اینجا نیست: تایپ پیوسته نباید loader/pending تحریک کند؛
  // کوئریِ خود کامپوننت با placeholderData جریان را نرم نگه می‌دارد.
  // (debounce ۳۰۰ms داخل هوک، قبل از رسیدن search به URL)
  loaderDeps: ({ search }) => ({
    page: search.page, limit: search.limit,
    status: search.status, categoryId: search.categoryId,
  }),

  // ⬅ NEW: prefetch — هاور روی لینک «محصولات» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // نکته: کلید کامل از location.search ساخته می‌شود (نه فقط deps) تا دقیقاً همان
  // کلیدی prefetch شود که کامپوننت مصرف می‌کند — حتی وقتی search در deps نیست.
  // (parse دوباره با zod: تایپ‌دار + strip فیلدهای روت‌های دیگر)
  loader: async ({ context, deps, location }) => {
    const { search } = adminProductsSearchSchema.parse(location.search)
    await context.queryClient.query(adminProductsOptions({
      page: deps.page, limit: deps.limit,
      status: deps.status, categoryId: deps.categoryId,
      search,
    }))
  },

  component: AdminProductsPage,
  pendingComponent: AdminProductsPageSkeleton,

  head: () => ({
    meta: [
      { title: 'مدیریت محصولات | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})

function AdminProductsPage() {
  const page = useAdminProductsPage()
  const { permissions } = usePermissions()


  // در حال بررسی دسترسی → اسکلتون
  if (page.isChecking) {
    return <AdminProductsPageSkeleton />
  }
  if (!page.permissions.productsRead) {
    return <PermissionGate hasAccess={false} pageName="محصولات" />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">مدیریت محصولات</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">لیست محصولات و دسته‌بندی‌ها</p>
        </div>
        <Can allowed={page.permissions.productsWrite}>
          <Link to="/admin/products/new" className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center">
            <Plus size={16} />
            افزودن محصول جدید
          </Link>
        </Can>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex-1 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <ProductsFilterBox
            search={page.state.search}
            status={page.state.status}
            categoryId={page.state.categoryId}
            categories={page.categories}
            onSearch={page.handleSearch}
            onStatus={page.handleStatus}
            onCategory={page.handleCategory}
          />

          {page.isLoading ? (
            <AdminProductsPageSkeleton />
          ) : page.products.length > 0 ? (
            <>
              {/* هدر دسکتاپ */}
              <div className="hidden lg:grid lg:grid-cols-5 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium border-b border-gray-100 dark:border-white/5 pb-2 text-right">
                <div>محصول</div>
                <div>دسته‌بندی</div>
                <div>قیمت</div>
                <div>وضعیت</div>
                <div className="text-left">مدیریت</div>
              </div>

              <div className="space-y-4">
                {page.products.map(product => (
                  <AdminProductCard
                    key={product.id}
                    product={product}
                    categoryName={page.categories.find(c => c.id === product.categoryId)?.name}
                    canWrite={page.permissions.productsWrite}
                    onToggle={page.handleRequestToggle}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">محصولی یافت نشد.</div>
          )}

          {page.total > 0 && (
            <Pagination
              currentPage={page.state.page}
              totalPages={page.totalPages}
              itemsPerPage={page.state.limit}
              totalItems={page.total}
              onPageChange={page.handlePage}
              onItemsPerPageChange={page.handleLimit}
            />
          )}
        </div>

        {/* مدیریت دسته‌های اصلی — گارد read + پراپ write */}
        <PermissionGate hasAccess={permissions.mainCategoriesRead} pageName="دسته‌های اصلی">
          <MainCategoryManager canWrite={permissions.mainCategoriesWrite} />
        </PermissionGate>

        {/* مدیریت دسته‌ها — فقط write (کامپوننت استخراج‌شده) */}
        {page.permissions.productsWrite && (
          <CategoryManager categories={page.categories} />
        )}
      </div>

      <ConfirmModal
        isOpen={!!page.state.confirmToggle}
        title="تایید تغییر وضعیت"
        message={`آیا از ${page.state.confirmToggle?.status === 'ACTIVE' ? 'غیرفعال کردن' : 'فعال کردن'} این محصول مطمئن هستید؟`}
        onConfirm={page.handleConfirmToggle}
        onCancel={page.handleCancelToggle}
      />
    </div>
  )
}