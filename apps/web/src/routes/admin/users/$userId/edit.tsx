// src/routes/admin/users/$userId/edit.tsx
// ⬅ NEW: کوئری از فکتوری مشترک (adminUserDetailsOptions) + loader پری‌فچ —
// قبلاً کلید خام ['admin-user-details', userId] بود (هم‌hash ولی بدون فکتوری)؛
// حالا با صفحه‌ی جزئیات یک کش مشترک و به‌روز رسانی متقابل (بعد از ویرایش،
// برگشت به پروفایل کاربر آنی از کش تازه است).
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { adminUserDetailsOptions } from '#/utils/queryOptions'
import { useAdminUserEditPage } from '#/hooks/admin/useAdminUserEditPage'
import { UserEditForm } from '#/components/admin/users/UserEditForm'
import { AdminUserEditSkeleton } from '#/components/LoadingSkeletons'
import { ConfirmModal } from '#/components/ConfirmModal'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { ChevronRight } from 'reicon-react'



const AdminUserEditPage = memo(function AdminUserEditPage() {
  const { userId } = Route.useParams()
  const { permissions, isChecking } = usePermissions()

  const { data: user } = useQuery(adminUserDetailsOptions(userId))

  const page = useAdminUserEditPage(userId, user)

  // گارد — ویرایش فقط با usersWrite
  if (isChecking) {
    return <AdminUserEditSkeleton />
  }
  if (!permissions.usersWrite) {
    return <PermissionGate hasAccess={false} pageName="ویرایش کاربر" />
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link to="/admin/users/$userId" params={{ userId }} className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit">
        <ChevronRight size={20} />
        بازگشت به پروفایل کاربر
      </Link>

      <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white mb-6">ویرایش اطلاعات کاربر</h1>

        <UserEditForm
          state={page.state}
          onFieldChange={page.handleFieldChange}
          onPhoneChange={page.handlePhoneChange}
          onRequestUnlockPhone={page.handleRequestUnlockPhone}
          onRequestUnlockReferral={page.handleRequestUnlockReferral}
          onSubmit={page.handleSubmit}
        />

        {/* اکشن‌ها */}
        <div className="flex gap-3 pt-6">
          <Link to="/admin/users/$userId" params={{ userId }} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium text-center cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition">
            انصراف
          </Link>
          <button
            type="button"
            onClick={page.handleSubmit}
            disabled={page.updateMutation.isPending}
            className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
          >
            {page.updateMutation.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </button>
        </div>
      </div>

      {/* کانفرم unlock موبایل */}
      <ConfirmModal
        isOpen={page.state.confirmUnlockPhone}
        title="ویرایش شماره موبایل"
        message="آیا از تغییر شماره موبایل این کاربر مطمئن هستید؟ این تغییر حساس است."
        onConfirm={page.handleUnlockPhone}
        onCancel={page.handleCloseUnlockPhone}
      />

      {/* کانفرم unlock کد معرف */}
      <ConfirmModal
        isOpen={page.state.confirmUnlockReferral}
        title="ویرایش کد معرف"
        message="آیا از تغییر کد معرف این کاربر مطمئن هستید؟"
        onConfirm={page.handleUnlockReferral}
        onCancel={page.handleCloseUnlockReferral}
      />
    </div>
  )
});

export const Route = createFileRoute('/admin/users/$userId/edit')({
  ssr: false,
  component: AdminUserEditPage,
  // ⬅ NEW: prefetch — دیتای کاربر معمولاً از قبل در کش است (نavigation از
  // صفحه‌ی جزئیات)؛ این loader فقط برای deep-link/رفرش مستقیم تضمین می‌کند
  loader: async ({ context, params }) => {
    await context.queryClient.query(adminUserDetailsOptions(params.userId))
  },
  pendingComponent: AdminUserEditSkeleton,
  head: () => ({
    meta: [
      { title: 'ویرایش کاربر | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});