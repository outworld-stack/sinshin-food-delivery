// src/routes/dashboard/orders/index.tsx
// ⬅ NEW: سورت + صفحه‌بندی شهروند URL شدن (validateSearch)
// + loader پری‌فچ — هاور روی «سفارشات» در سایدبار => پروفایل در کش
//
// قبلاً currentPage/sortBy در useState بودند:
//   ✗ رفرش = برگشت به صفحه ۱ و سورت پیش‌فرض
//   ✗ «گران‌ترین‌ها، صفحه ۲» قابل اشتراک‌گذاری نبود
//
// رارد ۳۳ — دوزبانه: رشته‌ها از t، اعداد/تاریخ از fmt؛ توست خطای API از
// apiError (نقشه‌ی رارد ۳۳ — فارسی همان پیام سرور، عربی از نقشه).

import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useMemo } from 'react'
import { z } from 'zod'
import { userProfileOptions } from '#/utils/queryOptions'
import { pageField } from '#/utils/searchSchema'
import { tpl, useI18n } from '#/i18n'
import { Pagination } from '#/components/Pagination'
import { DashboardOrdersSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ShoppingBag, Wallet, Check } from 'reicon-react'
import { StatusBadge } from '#/components/shared/StatusBadge'
import { confirmOrderDelivery } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'

// --- اسکیمای search: سورت تاریخچه + شماره صفحه ---
export const dashboardOrdersSearchSchema = z.object({
  sort: z.enum(['newest', 'oldest', 'expensive', 'cheap'])
    .catch('newest').default('newest'),
  page: pageField,
})
type DashboardOrdersSort = z.infer<typeof dashboardOrdersSearchSchema>['sort']

const ITEMS_PER_PAGE = 5;

const OrdersPage = memo(function OrdersPage() {
  const search = useSearch({ from: '/dashboard/orders/' })
  const navigate = useNavigate({ from: '/dashboard/orders/' })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const { t, fmt, apiError } = useI18n()

  // پروفایل — staleTime از فکتوری (۶۰s)؛ loader همین کلید را روی هاور پر کرده
  const { data: user, isLoading } = useQuery(userProfileOptions)

  // round-13 — «تحویل گرفتم» روی هر ردیف: سفارش سبز (DELIVERED) می‌شود؛
  // با تحویل همه، نشانگر چشمک‌زن سبز هدر هم خودش خاموش می‌شود
  // (invalidation پریفکس ['user-profile'] → حالت light هدر هم رفرش می‌شود).
  const deliverMutation = useMutation({
    mutationFn: (orderId: string) => confirmOrderDelivery({ data: { orderId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      showToast(t['dash.orders.deliverToast'])
    },
    onError: (err) => {
      showToast(apiError(err, t['dash.orders.deliverFailed']), 'error')
    },
  })

  const sortedOrders = useMemo(() => {
    if (!user) return [];
    const orders = [...user.allOrders];
    switch (search.sort) {
      case 'newest': return orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      case 'oldest': return orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      case 'expensive': return orders.sort((a, b) => b.totalAmount - a.totalAmount);
      case 'cheap': return orders.sort((a, b) => a.totalAmount - b.totalAmount);
      default: return orders;
    }
  }, [user, search.sort]);

  // --- هندلرها — سورت جدید = ریست صفحه (همان منطق reducer قبلی) ---
  const handleSortChange = useCallback((sort: DashboardOrdersSort) => {
    navigate({ search: { ...search, sort, page: 1 } })
  }, [navigate, search])

  const handlePage = useCallback((page: number) => {
    navigate({ search: { ...search, page } })
  }, [navigate, search])

  // استفاده از اسکلتون اختصاصی
  if (isLoading || !user) {
    return <DashboardOrdersSkeleton />
  }

  const totalOrders = user.allOrders.length;
  const totalSpent = user.allOrders.reduce((sum, order) => sum + order.totalAmount, 0);

  const totalPages = Math.ceil(sortedOrders.length / ITEMS_PER_PAGE);
  const currentOrders = sortedOrders.slice((search.page - 1) * ITEMS_PER_PAGE, search.page * ITEMS_PER_PAGE);

  return (
    <div className="max-w-6xl">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-2">{t['dash.nav.orders']}</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium">{t['dash.orders.subtitle']}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ستون اصلی: لیست سفارشات */}
        <div className="lg:col-span-2 space-y-6">

          {/* باکس‌های آماری */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">{t['dash.orders.count']}</p>
                <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{fmt.num(totalOrders)}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center text-primary dark:text-dark-primary">
                <ShoppingBag size={20} />
              </div>
            </div>
            <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">{t['dash.orders.totalSpent']}</p>
                <p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">{fmt.price(totalSpent)} <span className="text-sm">{t['common.tomanShort']}</span></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/10 flex items-center justify-center text-green-500">
                <Wallet size={20} />
              </div>
            </div>
          </div>

          {/* باکس لیست سفارشات با فیلتر */}
          <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-white/5 gap-4">
              <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">{t['dash.orders.history']}</h2>
              <select
                value={search.sort}
                onChange={(e) => handleSortChange(e.target.value as DashboardOrdersSort)}
                className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer"
              >
                <option value="newest">{t['dash.orders.sort.newest']}</option>
                <option value="oldest">{t['dash.orders.sort.oldest']}</option>
                <option value="expensive">{t['dash.orders.sort.expensive']}</option>
                <option value="cheap">{t['dash.orders.sort.cheap']}</option>
              </select>
            </div>

            {currentOrders.length > 0 ? (
              <div className="space-y-4">
                {currentOrders.map((order) => {
                  // امن-۷: فقط CONFIRMED/ON_THE_WAY قابل تایید تحویل است
                  const canDeliver =
                    order.status === 'CONFIRMED' || order.status === 'ON_THE_WAY'
                  return (
                    <div
                      key={order.id}
                      className="flex flex-col md:flex-row md:items-center justify-between p-5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/5 hover:shadow-md transition gap-4"
                    >
                      <Link
                        to="/dashboard/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="flex items-center gap-4 cursor-pointer min-w-0"
                      >
                        <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center text-primary dark:text-dark-primary shrink-0">
                          <ShoppingBag size={24} />
                        </div>
                        <div>
                          <p className="font-DanaDemiBold text-gray-800 dark:text-white">{tpl(t['dash.orderNumber'], { n: order.id })}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{fmt.date(order.date)} • {tpl(t['dash.itemCount'], { n: fmt.num(order.itemCount) })}</p>
                        </div>
                      </Link>

                      <div className="flex items-center justify-between md:justify-end gap-6">
                        <div className="text-right">
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-1">{t['dash.orders.status']}</p>
                          <StatusBadge status={order.paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : order.status} />
                        </div>
                        <div className="text-left">
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-1">{t['dash.col.amount']}</p>
                          <p className="font-DanaDemiBold text-gray-900 dark:text-white">{fmt.price(order.totalAmount)} {t['common.tomanShort']}</p>
                        </div>
                      </div>

                      {/* round-13 — دکمه تحویل گرفتم، خارج از لینک (بدون تداخل کلیک) */}
                      {canDeliver && (
                        <button
                          type="button"
                          onClick={() => deliverMutation.mutate(order.id)}
                          disabled={deliverMutation.isPending && deliverMutation.variables === order.id}
                          className="shrink-0 px-5 py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-DanaDemiBold cursor-pointer transition disabled:opacity-50 flex items-center justify-center gap-2 w-full md:w-auto"
                        >
                          <Check size={18} />
                          {deliverMutation.isPending && deliverMutation.variables === order.id
                            ? t['dash.orders.submitting']
                            : t['dash.orders.confirmDelivery']}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-16 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
                <p className="text-gray-400 dark:text-gray-500 font-DanaMedium">{t['dash.orders.empty']}</p>
              </div>
            )}

            {/* صفحه‌بندی فقط برای بالای ۵ آیتم فعال می‌شه */}
            {totalPages > 1 && (
              <Pagination
                currentPage={search.page}
                totalPages={totalPages}
                onPageChange={handlePage}
              />
            )}
          </div>
        </div>

        {/* ستون سمت چپ: باکس سود معرف */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">{t['dash.orders.referralProfitTitle']}</h2>
            {user.referrerCode ? (
              <div className="p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium mb-2">{t['dash.orders.referralProfitDesc']}</p>
                <p className="font-MorabbaBold text-2xl text-green-600 dark:text-green-400">{fmt.price(user.totalReferralProfit)} <span className="text-sm font-DanaMedium">{t['common.toman']}</span></p>
                <div className="mt-4 pt-4 border-t border-green-200 dark:border-green-500/20">
                  {/* اصلاح کلمه بلاابهام: "کد معرف شما" یعنی نفر بالایی */}
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t['dash.orders.yourReferrerCode']}</p>
                  <p className="font-DanaDemiBold text-gray-800 dark:text-white tracking-wider mt-1" dir="ltr">{user.referrerCode}</p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-dashed border-gray-300 dark:border-white/5 text-center">
                <p className="text-sm text-gray-400 dark:text-gray-500 font-DanaMedium">{t['dash.common.noReferrer']}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

export const Route = createFileRoute('/dashboard/orders/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — سورت تاریخچه + صفحه؛ shareable + back/refresh-safe
  validateSearch: dashboardOrdersSearchSchema,

  // ⬅ NEW: پری‌فچ روی هاور — گارد والد (/dashboard) قبل از این loader اجرا شده.
  // سورت/صفحه کلاینتی‌اند (مشتق از پروفایل کش‌شده) → loaderDeps لازم نیست؛
  // تغییرشان loader را دوباره اجرا نمی‌کند.
  loader: async ({ context }) => {
    await context.queryClient.query(userProfileOptions)
  },

  component: OrdersPage,
  pendingComponent: DashboardOrdersSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'سفارشات من | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})
