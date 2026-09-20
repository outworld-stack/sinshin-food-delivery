// src/routes/admin/couriers/index.tsx
// ⬅ NEW: فیلترها/صفحه‌بندی شهروند URL شدن (validateSearch + loaderDeps + loader)
// + prefetch روی هاور (defaultPreload: 'intent' روتر)
import { createFileRoute } from '@tanstack/react-router'
import { memo, useState, useCallback } from 'react'
import { adminCouriersSearchSchema, useCouriersPage } from '#/hooks/admin/useCouriersPage'
import { adminCouriersOptions } from '#/utils/queryOptions'
import { CourierCard } from '#/components/admin/couriers/CourierCard'
import { CouriersFilterBox } from '#/components/admin/couriers/CouriersFilterBox'
import { AddCourierModal } from '#/components/admin/couriers/AddCourierModal'
import { Pagination } from '#/components/Pagination'
import { PdfDownloadButton } from '#/components/shared/PdfDownloadButton'
import { Can } from '#/components/shared/PermissionGate'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { formatPrice, faNum } from '#/utils/format'
import { Plus } from 'reicon-react'
import { CouriersPageSkeleton } from '#/components/LoadingSkeletons'



const CouriersPage = memo(function CouriersPage() {

  const page = useCouriersPage()
  const { permissions } = usePermissions()
  const [isAddCourierOpen, setIsAddCourierOpen] = useState(false)

  const handleOpenAdd = useCallback(() => setIsAddCourierOpen(true), [])
  const handleCloseAdd = useCallback(() => setIsAddCourierOpen(false), [])

  const total = page.data?.total ?? 0
  const totalPages = Math.ceil(total / page.state.limit)

  if (page.isLoading) {
    return <CouriersPageSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">مدیریت پیک‌ها</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
            سوابق سفرها و تحویل هر پیک در بازه‌های زمانی
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PdfDownloadButton documentId="couriers-list" documentType="couriers-report" targetSelector="#couriers-list-area" label="خروجی PDF" />
          <Can allowed={permissions.couriersWrite}>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center"
            >
              <Plus size={16} />
              افزودن پیک
            </button>
          </Can>
        </div>
      </div>

      {/* آمار کلی */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">مجموع تحویل‌ها (بازه فعلی)</p>
          <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">
            {faNum(page.stats.totalDeliveries)}
          </p>
        </div>
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">مجموع مبالغ (بازه فعلی)</p>
          <p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">
            {formatPrice(page.stats.totalAmount)} ت
          </p>
        </div>
      </div>

      <CouriersFilterBox
        tempSearch={page.state.tempSearch}
        dateFrom={page.state.dateFrom}
        dateTo={page.state.dateTo}
        onSearchChange={page.handleSearchChange}
        onDateFrom={page.handleDateFrom}
        onDateTo={page.handleDateTo}
        onApply={page.handleApply}
        onReset={page.handleReset}
      />

      <div id="couriers-list-area" className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-4">
        {(page.data?.couriers ?? []).length > 0 ? (
          (page.data?.couriers ?? []).map((courier) => (
            <CourierCard key={courier.id} courier={courier} />
          ))
        ) : (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">
            پیک‌ِی در این بازه یافت نشد.
          </div>
        )}

        {totalPages > 1 && (
          <Pagination
            currentPage={page.state.page}
            totalPages={totalPages}
            itemsPerPage={page.state.limit}
            totalItems={total}
            onPageChange={page.handlePage}
            onItemsPerPageChange={page.handleLimit}
          />
        )}
      </div>

      {/* مودال افزودن پیک — فقط با couriersWrite */}
      {isAddCourierOpen && <AddCourierModal onClose={handleCloseAdd} />}
    </div>
  )
})

export const Route = createFileRoute('/admin/couriers/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — بازه‌ی تاریخ گزارش حالا قابل بوکمارک/اشتراک است.
  // catch: مقادیر خرابِ دست‌کاری‌شده به پیش‌فرض برمی‌گردند نه خطای روت
  validateSearch: adminCouriersSearchSchema,

  // فقط فیلترهای اعمال‌شده deps محسوب می‌شن — تغییر آن‌ها = اجرای دوباره loader
  loaderDeps: ({ search }) => ({
    page: search.page, limit: search.limit,
    search: search.search, dateFrom: search.dateFrom, dateTo: search.dateTo,
  }),

  // ⬅ NEW: prefetch — هاور روی لینک «پیک‌ها» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context, deps }) => {
    await context.queryClient.query(adminCouriersOptions(deps))
  },

  component: CouriersPage,
  pendingComponent: CouriersPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'مدیریت پیک‌ها | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})