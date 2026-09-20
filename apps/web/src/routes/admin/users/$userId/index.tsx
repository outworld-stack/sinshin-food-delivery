// src/routes/admin/users/$userId/index.tsx
// ⬅ NEW: رفع باگ رفرش — قبلاً loader مستقیماً دیتا برمی‌گرداند (بدون کش) و
// کامپوننت از Route.useLoaderData می‌خواند؛ یعنی invalidate میوتیشن ترمینیت
// هیچ ریفچی نمی‌ساخت و لیست دستگاه‌ها کهنه می‌ماند.
// حالا: loader و کامپوننت یک کش مشترک دارند (adminUserDetailsOptions) =>
// ترمینیت دستگاه، واقعاً UI را به‌روز می‌کند + پری‌فچ روی هاورِ لینک کاربر.
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { terminateDevice } from '#/server/admin'
import { AdminUserDetailSkeleton } from '#/components/LoadingSkeletons'
import { formatPrice, formatDate } from '#/utils/format'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { adminUserDetailsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { PermissionGate, Can } from '#/components/shared/PermissionGate'
import { ChartPanel } from '#/components/shared/ChartPanel'
import { OrdersBox } from '#/components/admin/user-detail/OrdersBox'
import { ReferralsBox } from '#/components/admin/user-detail/ReferralsBox'
import { LogsBox } from '#/components/admin/user-detail/LogsBox'
import { AddressesBox } from '#/components/admin/user-detail/AddressesBox'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { ChevronRight, Pen, Monitor } from 'reicon-react'

export const Route = createFileRoute('/admin/users/$userId/')({
  ssr: false,
  component: AdminUserDetailPage,

  // ⬅ NEW: prefetch — هاور روی نام کاربر در لیست/داشبورد => دیتا در کش؛
  // ناوبری به صفحه جزئیات بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context, params }) => {
    await context.queryClient.query(adminUserDetailsOptions(params.userId))
  },

  pendingComponent: AdminUserDetailSkeleton,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function AdminUserDetailPage() {
  const { userId } = Route.useParams()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  const { permissions, isChecking } = usePermissions()

  // ⬅ NEW: اشتراک در کش مشترک با loader (فکتوری مرکزی).
  // حالا invalidate زیر، واقعاً این useQuery را ریفچ می‌کند —
  // بعد از ترمینیت دستگاه، لیست همان لحظه به‌روز می‌شود
  const { data: user } = useQuery(adminUserDetailsOptions(userId))

  const terminateMutation = useMutation({
    mutationFn: (deviceId: string) => terminateDevice({ data: { userId, deviceId } }),
    onSuccess: () => {
      // ⬅ NEW: کلید از فکتوری — همان کلیدی که useQuery بالا مصرف می‌کند
      queryClient.invalidateQueries({ queryKey: qk.adminUserDetails(userId) })
      showToast('دستگاه با موفقیت ترمینیت شد')
    }
  })

  // گارد صفحه — usersRead
  if (isChecking) {
    return <AdminUserDetailSkeleton />
  }
  if (!permissions.usersRead) {
    return <PermissionGate hasAccess={false} pageName="جزئیات کاربر" />
  }

  if (!user) {
    return <RouteNotFound />
  }

  return (
    <div className="space-y-6">
      <Link to="/admin/users" className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit">
        <ChevronRight size={20} />
        بازگشت به لیست کاربران
      </Link>

      {/* هدر کاربر */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start gap-4">
        <div className="text-right w-full md:w-auto">
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">{user.firstName ?? ''} {user.lastName ?? ''}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium text-right" dir="ltr">{user.phone}</p>
        </div>
        {/* دکمه ویرایش — فقط usersWrite */}
        <Can allowed={permissions.usersWrite}>
          <Link to="/admin/users/$userId/edit" params={{ userId: user.id }} className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 shrink-0">
            <Pen size={16} />
            ویرایش کاربر
          </Link>
        </Can>
      </div>

      {/* کارت‌های آماری */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">کد معرف</p>
          <p className="font-MorabbaBold text-xl text-gray-800 dark:text-white">{user.referralCode ?? '—'}</p>
          <div className="mt-2 text-xs">
            {user.referrerId ? (
              <Link to="/admin/users/$userId" params={{ userId: user.referrerId }} className="text-primary dark:text-dark-primary hover:underline cursor-pointer">
                زیرمجموعه {user.referrerId} (مشاهده پروفایل)
              </Link>
            ) : (
              <span className="text-gray-400">ثبت‌نام خام (بدون معرف)</span>
            )}
          </div>
        </div>
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">موجودی کیف پول</p>
          <p className="font-MorabbaBold text-xl text-gray-800 dark:text-white">{formatPrice(user.walletBalance)} ت</p>
        </div>
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">مجموع خرید</p>
          <p className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">{formatPrice(user.totalSpent)} ت</p>
        </div>
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">تعداد زیرمجموعه‌ها</p>
          <p className="font-MorabbaBold text-xl text-gray-800 dark:text-white">{user.referralsCount.toLocaleString('fa-IR')}</p>
        </div>
      </div>

      {/* دستگاه‌های متصل */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">دستگاه‌های متصل</h2>
        <div className="space-y-3">
          {user.devices.map(dev => (
            <div key={dev.id} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-[#2a1015] flex items-center justify-center text-gray-500">
                  <Monitor size={20} />
                </div>
                <div>
                  <p className="font-DanaMedium text-gray-800 dark:text-white text-sm">{dev.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">آخرین فعالیت: {formatDate(dev.lastActiveAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {dev.isCurrent && (
                  <span className="text-xs text-green-500 font-DanaDemiBold px-3 py-1 rounded-full bg-green-100 dark:bg-green-500/10">فعلی</span>
                )}
                <button onClick={() => terminateMutation.mutate(dev.id)} className="text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition cursor-pointer font-DanaMedium">ترمینیت</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* نمودار */}
      <ChartPanel title="نمودار سفارشات" chartData={user.chartData} defaultGranularity="weekly" />

      {/* لیست‌ها */}
      <div className="grid grid-cols-1 gap-6">
        <OrdersBox orders={user.orders} addresses={user.addresses} />
        <ReferralsBox referrals={user.referrals} />
      </div>
      <AddressesBox addresses={user.addresses} userId={userId} />

      <LogsBox logs={user.logs} />
    </div>
  )
}