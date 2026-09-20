// src/routes/admin/index.tsx
// ⬅ NEW: loader پری‌فچ + pendingComponent/errorComponent + head noindex
// (هاور روی «داشبورد» در سایدبار => آمار در کش؛ ناوبری بدون اسکلتون)
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { formatPrice, formatDate } from '#/utils/format'
import { AdminDashboardSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ChartPanel } from '#/components/shared/ChartPanel'
import { buildChartData } from '#/utils/chartData'
import { adminStatsOptions } from '#/utils/queryOptions'
import { Users, CheckCircle, Wallet, ShoppingBag } from 'reicon-react'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
  ssr: false,
  // ⬅ NEW: prefetch — هاور روی «داشبورد» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود. داده پشت گارد نقش است؛ سرور رندرش نمی‌کند
  loader: async ({ context }) => {
    await context.queryClient.query(adminStatsOptions)
  },

  pendingComponent: AdminDashboardSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'داشبورد مدیریت | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})

function AdminDashboard() {
  // آمار داشبورد — فکتوری مرکزی (کلید + staleTime ۳۰s)؛
  // ⬅ NEW: همان کلیدی که loader روت با query پر کرده
  const { data: stats, isLoading } = useQuery(adminStatsOptions)

  // داده‌ی نمودار — ۳۰ روز فروش سرور؛ همه‌ی بازه‌ها از همین یک منبع
  const chartData = useMemo(() => buildChartData(stats?.chartData ?? []), [stats])

  if (isLoading || !stats) {
    return <AdminDashboardSkeleton />
  }

  const statCards = [
    { title: 'کاربران کل', value: stats.totalUsers.toLocaleString('fa-IR'), icon: <Users size={24} />, color: 'bg-blue-100 dark:bg-blue-500/10 text-blue-500' },
    { title: 'کاربران فعال', value: stats.activeUsers.toLocaleString('fa-IR'), icon: <CheckCircle size={24} />, color: 'bg-green-100 dark:bg-green-500/10 text-green-500' },
    { title: 'درآمد کل (تومان)', value: formatPrice(stats.totalRevenue), icon: <Wallet size={24} />, color: 'bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary' },
    { title: 'سفارشات کل', value: stats.totalOrders.toLocaleString('fa-IR'), icon: <ShoppingBag size={24} />, color: 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-500' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">داشبورد مدیریت</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">نمای کلی از وضعیت سیستم سین‌شین</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, idx) => (
          <div key={idx} className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">{card.title}</p>
              <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{card.value}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl ${card.color} flex items-center justify-center shrink-0`}>{card.icon}</div>
          </div>
        ))}
      </div>

      {/* نمودار — پنل مشترک (به‌جای سه تکه: کارت فیلتر + نمودار + مودال موبایل) */}
      <ChartPanel title="نمودار تحلیل سیستم" chartData={chartData} defaultGranularity="daily" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* سفارشات اخیر */}
        <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">سفارشات اخیر</h2>
          <div className="space-y-2">
            {stats.recentOrders.slice(0, 5).map((order) => (
              <Link key={order.id} to="/admin/orders/$orderId" params={{ orderId: order.id }} className="grid grid-cols-3 gap-4 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 hover:border-primary dark:hover:border-dark-primary transition cursor-pointer items-center">
                <div>
                  <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{order.id}</p>
                  <p className="text-xs text-gray-400 mt-1">{order.user}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">{formatDate(order.date)}</p>
                </div>
                <div className="text-left">
                  <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{formatPrice(order.amount)} ت</p>
                </div>
              </Link>
            ))}
          </div>
          <Link to="/admin/orders" className="block text-center mt-6 text-sm text-primary dark:text-dark-primary font-DanaDemiBold hover:underline cursor-pointer">
            مشاهده تمامی سفارشات
          </Link>
        </div>

        {/* آخرین کاربران */}
        <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">آخرین کاربران</h2>
          <div className="space-y-2">
            {stats.latestUsers.slice(0, 5).map((user) => (
              <Link key={user.id} to="/admin/users/$userId" params={{ userId: user.id }} className="grid grid-cols-3 gap-4 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 hover:border-primary dark:hover:border-dark-primary transition cursor-pointer items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-[#2a1015] flex items-center justify-center text-xs text-gray-500 font-DanaDemiBold shrink-0">{user.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="font-DanaMedium text-gray-800 dark:text-white text-sm truncate">{user.name}</p>
                    <p className="text-xs text-gray-400" dir="ltr">{user.phone}</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-DanaMedium text-gray-600 dark:text-gray-300 text-xs">{user.device}</p>
                </div>
                <div className="text-left">
                  <p className="text-xs text-gray-400">{formatDate(user.registeredAt)}</p>
                </div>
              </Link>
            ))}
          </div>
          <Link to="/admin/users" className="block text-center mt-6 text-sm text-primary dark:text-dark-primary font-DanaDemiBold hover:underline cursor-pointer">
            مشاهده تمامی کاربران
          </Link>
        </div>
      </div>
    </div>
  )
}