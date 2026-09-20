// src/routes/admin/admin2/dashboard/index.tsx
// ⬅ NEW: کوئری‌ها از فکتوری‌های مرکزی (admin2SessionOptions + admin2StatsOptions)
// + loader پری‌فچ زنجیره‌ای (اول سشن، بعد آمارِ ادمینِ لاگین‌شده) + pendingComponent
import { createFileRoute, Link } from '@tanstack/react-router'
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { admin2SessionOptions, admin2StatsOptions } from '#/utils/queryOptions'
import { Admin2StatCards } from '#/components/admin/admin2/Admin2StatCards'
import { ChartPanel } from '#/components/shared/ChartPanel'
import { Admin2RecentOrders } from '#/components/admin/admin2/Admin2RecentOrders'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { Skeleton } from '#/components/LoadingSkeletons'

// اسکلتون اختصاصی — هم pendingComponent، هم حالت‌های isLoading
function Admin2DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  )
}

const Admin2Dashboard = memo(function Admin2Dashboard() {
  // سشن — گارد لود: تا نیامده اسکلتون (نه «ابتدا وارد شوید») — رفع باگ رفرش.
  // ⬅ NEW: فکتوری مشترک با usePermissions/AdminLayout/پنل زنده (staleTime ۱۵s)
  const { data: session, isLoading: sessionLoading } = useQuery(admin2SessionOptions)

  const adminId = session?.admin?.userId ?? ''

  // ⬅ NEW: فکتوری مرکزی — قبلاً کلید خام ['admin2-stats', adminId] بود (هم‌hash)
  const { data: stats, isLoading: statsLoading } = useQuery({
    ...admin2StatsOptions(adminId),
    enabled: !!adminId,
  })

  // ⬅ اول لود، بعد چک ورود
  if (sessionLoading) {
    return <Admin2DashboardSkeleton />
  }

  if (!session?.isAdmin2LoggedIn) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-gray-500 font-DanaMedium">ابتدا از پنل سفارشات زنده وارد شوید</p>
        <Link
          to="/login"
          className="inline-block px-6 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium cursor-pointer"
        >
          رفتن به صفحه ورود
        </Link>
      </div>
    )
  }

  if (statsLoading || !stats) {
    return <Admin2DashboardSkeleton />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">داشبورد مدیریتی من</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
          {session.admin?.firstName} {session.admin?.lastName} — آمار عملکرد شخصی
        </p>
      </div>

      <Admin2StatCards totalOrders={stats.totalOrders} totalAmount={stats.totalAmount} />
      <ChartPanel title="نمودار عملکرد من" chartData={stats.chartData} defaultGranularity="weekly" />
      <Admin2RecentOrders orders={stats.recentOrders} />
    </div>
  )
});

export const Route = createFileRoute('/admin/admin2/dashboard/')({
  component: Admin2Dashboard,
  ssr: false,
  // ⬅ NEW: prefetch زنجیره‌ای — هاور روی «داشبورد من» در سایدبار =>
  // اول سشن در کش پر می‌شود؛ اگر ادمین۲ لاگین است، آمارش هم همین‌جا پر می‌شود
  // => ناوبری بدون حتی یک اسکلتون.
  loader: async ({ context }) => {
    const session = await context.queryClient.query(admin2SessionOptions)
    if (session?.isAdmin2LoggedIn && session.admin?.userId) {
      await context.queryClient.query(admin2StatsOptions(session.admin.userId))
    }
  },

  pendingComponent: Admin2DashboardSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'داشبورد من | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});