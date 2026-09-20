// src/routes/admin/orders/index.tsx
// ⬅ NEW: فیلترها/صفحه‌بندی شهروند URL شدن (validateSearch + loaderDeps + loader)
// + prefetch روی هاور (defaultPreload: 'intent' روتر)
import { createFileRoute, Link } from '@tanstack/react-router'
import { memo, useMemo } from 'react'
import { adminOrdersSearchSchema, useAdminOrdersPage } from '#/hooks/admin/useAdminOrdersPage'
import { adminOrdersOptions } from '#/utils/queryOptions'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { OrdersFilterBox, OrdersFilterTrigger } from '#/components/admin/orders/OrdersFilterBox'
import { StatusBadge } from '#/components/shared/StatusBadge'
import { Pagination } from '#/components/Pagination'
import { AdminOrdersPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { formatPrice, formatDate } from '#/utils/format'
import { Eye } from 'reicon-react'
import type { OrderRow } from '#/types/admin/orders'
import { BottomSheet } from '#/components/shared/BottomSheet'


// --- کارت سفارش — موبایل وسط‌چین + دسکتاپ تک‌ردیف ---
const OrderCard = memo(function OrderCard({ order }: { order: OrderRow }) {
  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">

      {/* موبایل/تبلت — وسط‌چین */}
      <div className="lg:hidden grid grid-cols-3 gap-3 text-center w-full items-center">
        <div className="flex flex-col gap-2 items-center justify-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">شناسه</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-xs">{order.id}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">تاریخ</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{formatDate(order.date)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-center justify-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مشتری</p>
            <p className="font-DanaMedium text-gray-600 dark:text-gray-300 text-xs">{order.userName}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مبلغ</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-xs">{formatPrice(order.amount)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-center justify-center">
          <StatusBadge status={order.status} size="sm" perspective="admin" />
          <Link to="/admin/orders/$orderId" params={{ orderId: order.id }} className="p-2 rounded-lg text-gray-500 ..." title="مشاهده جزئیات">
            <Eye size={18} />
          </Link>
        </div>
      </div>

      {/* دسکتاپ — تک‌ردیف */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-4 items-center text-right">
        <div className="flex flex-col">
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{order.id}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500" dir="ltr">{order.userPhone}</p>
        </div>
        <div className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{formatPrice(order.amount)} ت</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(order.date)}</div>
        <div><StatusBadge status={order.status} perspective="admin" /></div>
        <div className="flex items-center justify-end gap-2">
          <Link to="/admin/orders/$orderId" params={{ orderId: order.id }} className="p-2 rounded-lg text-gray-500 ..." title="مشاهده جزئیات">
            <Eye size={18} />
          </Link>
        </div>
      </div>

    </div>
  )
})

// --- صفحه — فقط assemble ---
const AdminOrdersPage = memo(function AdminOrdersPage() {
  const page = useAdminOrdersPage()

  const orders: OrderRow[] = page.data?.orders ?? []
  const total = page.data?.total ?? 0
  const totalPages = Math.ceil(total / page.state.limit)

  // عنوان صفحات — نقش‌محور
  const heading = useMemo(() => ({
    title: page.isMainAdmin ? 'مدیریت سفارشات' : 'سفارشات من',
    sub: page.isMainAdmin ? 'لیست کامل سفارشات سیستم' : 'سفارشاتی که توسط شما تایید شده‌اند',
  }), [page.isMainAdmin])

  const emptyMessage = page.isMainAdmin ? 'سفارشی یافت نشد.' : 'هنوز سفارشی تایید نکرده‌اید.'

  if (page.isLoading) {
    return <AdminOrdersPageSkeleton />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">{heading.title}</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">{heading.sub}</p>
      </div>

      {/* تریگر فیلتر موبایل */}
      <OrdersFilterTrigger onClick={page.handleOpenFilter} />

      {/* فیلتر دسکتاپ */}
      <div className="hidden sm:block bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <OrdersFilterBox
          tempSearch={page.state.tempSearch}
          tempStatus={page.state.tempStatus}
          tempSortDate={page.state.tempSortDate}
          tempSortAmount={page.state.tempSortAmount}
          tempAdmin2={page.state.tempAdmin2}
          tempCourier={page.state.tempCourier}
          showRoleFilters={page.isMainAdmin}
          admin2Options={page.admin2Options}
          courierOptions={page.courierOptions}
          onSearch={page.handleTempSearch}
          onStatus={page.handleTempStatus}
          onSortDate={page.handleTempSortDate}
          onSortAmount={page.handleTempSortAmount}
          onAdmin2={page.handleTempAdmin2}
          onCourier={page.handleTempCourier}
          onApply={page.handleApply}
        />
      </div>

      {/* لیست سفارشات */}
      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        {orders.length > 0 ? (
          <>
            <div className="hidden lg:grid lg:grid-cols-5 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium border-b border-gray-100 dark:border-white/5 pb-2 text-right">
              <div>شناسه و مشتری</div>
              <div>مبلغ</div>
              <div>تاریخ</div>
              <div>وضعیت</div>
              <div className="text-left">مدیریت</div>
            </div>

            <div className="space-y-4">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">
            {emptyMessage}
          </div>
        )}

        {total > 0 && (
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

      {/* مدال فیلتر موبایل */}
      <BottomSheet
        isOpen={page.state.isFilterModalOpen}
        onClose={page.handleCloseFilter}
        title="فیلترهای سفارشات"
        hideOnDesktop="sm:hidden"
      >
        <OrdersFilterBox
          tempSearch={page.state.tempSearch}
          tempStatus={page.state.tempStatus}
          tempSortDate={page.state.tempSortDate}
          tempSortAmount={page.state.tempSortAmount}
          tempAdmin2={page.state.tempAdmin2}
          tempCourier={page.state.tempCourier}
          showRoleFilters={page.isMainAdmin}
          admin2Options={page.admin2Options}
          courierOptions={page.courierOptions}
          isMobileModal
          onSearch={page.handleTempSearch}
          onStatus={page.handleTempStatus}
          onSortDate={page.handleTempSortDate}
          onSortAmount={page.handleTempSortAmount}
          onAdmin2={page.handleTempAdmin2}
          onCourier={page.handleTempCourier}
          onApply={page.handleApply}
        />
      </BottomSheet>
    </div>
  )
})

export const Route = createFileRoute('/admin/orders/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — هر فیلتری که اینجا باشد، رفرش/back/اشتراک‌گذاری حفظش می‌کند.
  // catch: مقادیر خرابِ دست‌کاری‌شده به پیش‌فرض برمی‌گردند نه خطای روت
  validateSearch: adminOrdersSearchSchema,

  // فقط فیلترهای اعمال‌شده deps محسوب می‌شن — تغییر آن‌ها = اجرای دوباره loader
  loaderDeps: ({ search }) => ({
    page: search.page, limit: search.limit,
    search: search.search, status: search.status,
    sortDate: search.sortDate, sortAmount: search.sortAmount,
    admin2: search.admin2, courier: search.courier,
  }),

  // ⬅ NEW: prefetch — هاور روی لینک «سفارشات» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // نکته: دیتا نقش‌محور است — نقش از استور zustand خوانده می‌شود (نه هدر سرور)؛
  // گارد والد (/admin) قبل از این loader اجرا شده و ریدایرکت لازم را انجام داده.
  loader: async ({ context, deps }) => {
    await ensureAuthHydrated()
    const { role, admin2Id } = useAuthStore.getState()
    if (role !== 'admin' && role !== 'admin2') return
    await context.queryClient.query(adminOrdersOptions({ ...deps, role, admin2Id }))
  },

  component: AdminOrdersPage,
  pendingComponent: AdminOrdersPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'مدیریت سفارشات | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})