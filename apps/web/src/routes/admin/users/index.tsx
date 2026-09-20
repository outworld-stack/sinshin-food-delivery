// src/routes/admin/users/index.tsx
// ⬅ NEW: فیلترها/صفحه‌بندی شهروند URL شدن (validateSearch + loaderDeps + loader)
// + prefetch روی هاور (defaultPreload: 'intent' روتر)
import { createFileRoute } from '@tanstack/react-router'
import { memo } from 'react'
import { adminUsersSearchSchema, useAdminUsersPage } from '#/hooks/admin/useAdminUsersPage'
import { adminUsersOptions } from '#/utils/queryOptions'
import { UsersFilterBox, UsersFilterTrigger } from '#/components/admin/users/UsersFilterBox'
import { UserCard } from '#/components/admin/users/UserCard'
import { Pagination } from '#/components/Pagination'
import { AdminUsersListSkeleton } from '#/components/LoadingSkeletons'
import { ConfirmModal } from '#/components/ConfirmModal'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { BottomSheet } from '#/components/shared/BottomSheet'


const AdminUsersPage = memo(function AdminUsersPage() {
  const page = useAdminUsersPage()

  const users = page.data?.users ?? []
  const total = page.data?.total ?? 0
  const totalPages = Math.ceil(total / page.state.limit)

  // گارد صفحه — usersRead
  if (page.isChecking || page.isLoading) {
    return <AdminUsersListSkeleton />
  }
  if (!page.permissions.usersRead) {
    return <PermissionGate hasAccess={false} pageName="کاربران" />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">مدیریت کاربران</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">لیست کامل کاربران و فیلترها</p>
      </div>

      {/* تریگر موبایل */}
      <UsersFilterTrigger onClick={page.handleOpenFilter} />

      {/* فیلتر دسکتاپ */}
      <div className="hidden md:block bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <UsersFilterBox
          tempSearch={page.state.tempSearch}
          setTempSearch={page.handleTempSearch}
          tempDevice={page.state.tempDevice}
          setTempDevice={page.handleTempDevice}
          tempStatus={page.state.tempStatus}
          setTempStatus={page.handleTempStatus}
          tempSortDate={page.state.tempSortDate}
          setTempSortDate={page.handleTempSortDate}
          tempSortWallet={page.state.tempSortWallet}
          setTempSortWallet={page.handleTempSortWallet}
          tempSortSpent={page.state.tempSortSpent}
          setTempSortSpent={page.handleTempSortSpent}
          applyFilters={page.handleApplyFilters}
        />
      </div>

      {/* لیست */}
      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        {users.length > 0 ? (
          <>
            {/* هدر دسکتاپ */}
            <div className="hidden lg:grid lg:grid-cols-6 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium border-b border-gray-100 dark:border-white/5 pb-2 text-right">
              <div>نام و موبایل</div>
              <div>دستگاه</div>
              <div>موجودی</div>
              <div>مجموع خرید</div>
              <div>تاریخ ثبت‌نام</div>
              <div className="text-left">مدیریت</div>
            </div>

            <div className="space-y-4">
              {users.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  canToggle={page.permissions.usersWrite}
                  onToggle={page.handleRequestToggle}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">کاربری یافت نشد.</div>
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

      {/* مودال فیلتر موبایل */}
      <BottomSheet isOpen={page.state.isFilterModalOpen} onClose={page.handleCloseFilter} title="فیلترهای کاربران">
        <UsersFilterBox
          tempSearch={page.state.tempSearch}
          setTempSearch={page.handleTempSearch}
          tempDevice={page.state.tempDevice}
          setTempDevice={page.handleTempDevice}
          tempStatus={page.state.tempStatus}
          setTempStatus={page.handleTempStatus}
          tempSortDate={page.state.tempSortDate}
          setTempSortDate={page.handleTempSortDate}
          tempSortWallet={page.state.tempSortWallet}
          setTempSortWallet={page.handleTempSortWallet}
          tempSortSpent={page.state.tempSortSpent}
          setTempSortSpent={page.handleTempSortSpent}
          applyFilters={page.handleApplyFilters}
          isMobileModal
        />
      </BottomSheet>

      {/* مودال مسدودسازی/فعال‌سازی */}
      <ConfirmModal
        isOpen={!!page.state.confirmToggle}
        title="تایید تغییر وضعیت"
        message={`آیا از ${page.state.confirmToggle?.status === 'ACTIVE' ? 'مسدودسازی' : 'فعال‌سازی'} این کاربر مطمئن هستید؟`}
        onConfirm={page.handleConfirmToggle}
        onCancel={page.handleCancelToggle}
      />
    </div>
  )
});

export const Route = createFileRoute('/admin/users/')({
    ssr: false,
  // ⬅ NEW: قرارداد URL — هر فیلتری که اینجا باشد، رفرش/back/اشتراک‌گذاری حفظش می‌کند.
  // catch: مقادیر خرابِ دست‌کاری‌شده به پیش‌فرض برمی‌گردند نه خطای روت
  validateSearch: adminUsersSearchSchema,

  // فقط فیلترهای اعمال‌شده deps محسوب می‌شن — تغییر آن‌ها = اجرای دوباره loader
  loaderDeps: ({ search }) => ({
    page: search.page, limit: search.limit,
    search: search.search, device: search.device, status: search.status,
    sortDate: search.sortDate, sortWallet: search.sortWallet, sortSpent: search.sortSpent,
  }),

  // ⬅ NEW: prefetch — هاور روی لینک «کاربران» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context, deps }) => {
    await context.queryClient.query(adminUsersOptions(deps))
  },

  component: AdminUsersPage,
  pendingComponent: AdminUsersListSkeleton,

  head: () => ({
    meta: [
      { title: 'مدیریت کاربران | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});