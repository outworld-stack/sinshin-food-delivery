// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/routes/dashboard/orders/index.tsx
// تغییر: صفحه‌بندی سروریِ «سفارشات من» — دیتا/آمار از GET /orders
//        (page/limit/sort؛ پاکت orders/total/totalSpent)؛ سورت و برش
//        کلاینتی حذف شد؛ پروفایل فقط برای باکس معرف می‌ماند
// ═══════════════════════════════════════════════════════════════

// src/routes/dashboard/orders/index.tsx
// ⬅ NEW: سورت + صفحه‌بندی شهروند URL شدن (validateSearch)
// + loader پری‌فچ — هاور روی «سفارشات» در سایدبار => صفحه/پروفایل در کش
//
// قبلاً currentPage/sortBy در useState بودند:
//   ✗ رفرش = برگشت به صفحه ۱ و سورت پیش‌فرض
//   ✗ «گران‌ترین‌ها، صفحه ۲» قابل اشتراک‌گذاری نبود
//
// رارد ۳۳ — دوزبانه: رشته‌ها از t، اعداد/تاریخ از fmt؛ توست خطای API از
// apiError (نقشه‌ی رارد ۳۳ — فارسی همان پیام سرور، عربی از نقشه).

import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback } from 'react'
import { z } from 'zod'
import { myOrdersOptions, userProfileOptions } from '#/utils/queryOptions'
import { pageField, limitField } from '#/utils/searchSchema'
import { tpl, useI18n } from '#/i18n'
import { Pagination } from '#/components/Pagination'
import { DashboardOrdersSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ShoppingBag, Wallet, Check } from 'reicon-react'
import { StatusBadge } from '#/components/shared/StatusBadge'
import { confirmOrderDelivery } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'

// --- اسکیمای search: سورت تاریخچه + شماره صفحه + تعداد در صفحه ---
// stage-56 — limit هم شهروند URL شد؛ صفحه/حد/سورت مستقیم به سرور می‌روند
export const dashboardOrdersSearchSchema = z.object({
  sort: z.enum(['newest', 'oldest', 'expensive', 'cheap'])
    .catch('newest').default('newest'),
  page: pageField,
  limit: limitField(5),
})
type DashboardOrdersSort = z.infer<typeof dashboardOrdersSearchSchema>['sort']

const OrdersPage = memo(function OrdersPage() {
  const search = useSearch({ from: '/dashboard/orders/' })
  const navigate = useNavigate({ from: '/dashboard/orders/' })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const { t, fmt, apiError } = useI18n()

  // stage-56 — سفارشات از سرور با همان صفحه/حد/مرتب‌سازیِ URL؛
  // keepPreviousData از فکتوری ⇒ چرخش صفحه بدون پرش/سوسو
  const { data: ordersData, isLoading } = useQuery(
    myOrdersOptions(search.page, search.limit, search.sort),
  )

  // پروفایل — فقط برای باکس معرف (کد/سود)؛ دیگر منبع لیست/آمار سفارشات نیست
  const { data: user } = useQuery(userProfileOptions)

  // round-13 — «تحویل گرفتم» روی هر ردیف: سفارش سبز (DELIVERED) می‌شود؛
  // با تحویل همه، نشانگر چشمک‌زن سبز هدر هم خودش خاموش می‌شود
  // (invalidation پریفکس ['user-profile'] → حالت light هدر هم رفرش می‌شود).
  const deliverMutation = useMutation({
    mutationFn: (orderId: string) => confirmOrderDelivery({ data: { orderId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      // stage-56 — لیست/آمار از سرور می‌آید → پریفکس my-orders (همه‌ی صفحات/سورت‌ها)
      queryClient.invalidateQueries({ queryKey: qk.myOrdersPrefix })
      showToast(t['dash.orders.deliverToast'])
    },
    onError: (err) => {
      showToast(apiError(err, t['dash.orders.deliverFailed']), 'error')
    },
  })

  // stage-56 — سورت سروری است (query key شامل search.sort) →
  // useMemo محلی حذف شد؛ سرور با همان enum مرتب می‌کند.

  // --- هندلرها — سورت جدید = ریست صفحه (همان منطق reducer قبلی) ---
  const handleSortChange = useCallback((sort: DashboardOrdersSort) => {
    navigate({ search: { ...search, sort, page: 1 } })
  }, [navigate, search])

  const handlePage = useCallback((page: number) => {
    navigate({ search: { ...search, page } })
  }, [navigate, search])

  // stage-56 — تغییر تعداد در صفحه ⇒ ریست به صفحه ۱ (همان الگوی کیف پول)
  const handleLimit = useCallback((limit: number) => {
    navigate({ search: { ...search, limit, page: 1 } })
  }, [navigate, search])

  // استفاده از اسکلتون اختصاصی
  if (isLoading || !user) {
    return <DashboardOrdersSkeleton />
  }

  // stage-56 — پاکت سروری: ردیف‌های همین صفحه + کلِ سفارش‌ها (بدون سقف
  // پروفایل) + جمع مبلغ از SQL — نه length/reduce روی ردیف‌های سقف‌دار
  const orders = ordersData?.orders ?? [];
  const total = ordersData?.total ?? 0;
  const totalSpent = ordersData?.totalSpent ?? 0;

  const totalPages = Math.ceil(total / search.limit);

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
                <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{fmt.num(total)}</p>
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

            {/* stage-56 — «خالی» فقط وقتی هیچ سفارشی نیست (total=0)؛
                صفحه‌ی تهیِ صفحات بالایی = لیست بدون ردیف، نه حالت خالی */}
            {total > 0 ? (
              <div className="space-y-4">
                {orders.map((order) => {
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

            {/* stage-56 — صفحه‌بندی سروری: «نمایش X از Y» + انتخاب تعداد در صفحه
                (با limit-select حتی تک‌صفحه فعال است — الگوی admin/orders) */}
            {total > 0 && (
              <Pagination
                currentPage={search.page}
                totalPages={totalPages}
                itemsPerPage={search.limit}
                totalItems={total}
                onPageChange={handlePage}
                onItemsPerPageChange={handleLimit}
                pageSizeOptions={[5, 10, 20]}
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
  // ⬅ NEW: قرارداد URL — سورت/صفحه/تعداد؛ shareable + back/refresh-safe
  validateSearch: dashboardOrdersSearchSchema,

  // stage-56 — صفحه/حد/مرتب‌سازی سروری‌اند → داخل loaderDeps؛ تغییرشان
  // loader را دوباره اجرا می‌کند و پری‌فچِ هاور همان صفحه‌ی مقصد را می‌گیرد.
  loaderDeps: ({ search }) => ({
    page: search.page, limit: search.limit, sort: search.sort,
  }),

  // ⬅ NEW: پری‌فچ روی هاور — گارد والد (/dashboard) قبل از این loader اجرا شده.
  // سفارشات با همان پارامترهای URL؛ پروفایل فقط برای باکس معرف (مستقل از لیست).
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.query(myOrdersOptions(deps.page, deps.limit, deps.sort)),
      context.queryClient.query(userProfileOptions),
    ])
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