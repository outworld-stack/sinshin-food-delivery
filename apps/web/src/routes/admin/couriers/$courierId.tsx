// src/routes/admin/couriers/$courierId.tsx
// ⬅ NEW: کش مشترک loader/کامپوننت (فکتوری adminCourierDetailsOptions) —
// قبلاً loader مستقیم برمی‌گردوند + یک کوئری جدا با کلید خام ['courier-role-view']
// برای نمای ادمین۲؛ حالا هر دو از یک فکتوری نقش‌محور می‌آیند:
// نقش از استور تعیین می‌شه، کلید شامل admin2Id است فقط برای ادمین۲.
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { memo, useReducer, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminCourierDetailsOptions } from '#/utils/queryOptions'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ChartPanel } from '#/components/shared/ChartPanel'
import { PdfDownloadButton } from '#/components/shared/PdfDownloadButton'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { CourierDetailSkeleton } from '#/components/LoadingSkeletons'
import { formatPrice, formatDate, formatTime, faNum } from '#/utils/format'
import { Bicycle, Phone, Route as RouteIcon, ChevronDown, ChevronUp, Package } from 'reicon-react'

// --- reducer: فقط آکاردئون سفرها ---
interface TripState {
  expandedTripId: string | null
}

type TripAction = { type: 'TOGGLE_TRIP'; payload: string }

const initialTripState: TripState = { expandedTripId: null }

function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case 'TOGGLE_TRIP':
      return { ...state, expandedTripId: state.expandedTripId === action.payload ? null : action.payload }
    default: return state
  }
}

const CourierDetailPage = memo(function CourierDetailPage() {
  const { courierId } = Route.useParams()

  // نقش‌محور: ادمین۲ → فقط تحویل‌های سفارشات خودش
  const role = useAuthStore((s) => s.role)
  const admin2Id = useAuthStore((s) => s.admin2Id)
  const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined

  // ⬅ NEW: کش مشترک با loader — همان کلید نقش‌محور؛
  // قبلاً دو منبع جدا بودند (loaderData + کوئری کلید خام role-view)
  const { data: viewData } = useQuery(adminCourierDetailsOptions(courierId, viewAdmin2Id))

  const [state, dispatch] = useReducer(tripReducer, initialTripState)
  const handleToggleTrip = useCallback((id: string) => dispatch({ type: 'TOGGLE_TRIP', payload: id }), [])

  if (!viewData) {
    return <CourierDetailSkeleton />
  }

  return (
    <div className="space-y-6" id="courier-detail-print">
      <Link to="/admin/couriers" className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit cursor-pointer">
        بازگشت به پیک‌ها
      </Link>

      {/* هدر پیک */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="w-14 h-14 rounded-2xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
            <Bicycle size={28} />
          </span>
          <div>
            <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{viewData.courier.name}</h1>
            <a href={`tel:${viewData.courier.phone}`} className="text-xs text-gray-400 hover:text-primary transition flex items-center gap-1" dir="ltr">
              <Phone size={12} /> {viewData.courier.phone}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">کل تحویل‌ها</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">{faNum(viewData.totalDeliveries)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مجموع مبالغ</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary">{formatPrice(viewData.totalAmount)} ت</p>
          </div>
          <PdfDownloadButton documentId={viewData.courier.id} documentType="courier-report" targetSelector="#courier-detail-print" />
        </div>
      </div>

      {/* نمودار عملکرد — پنل مشترک */}
      <ChartPanel title="آمار عملکرد" chartData={viewData.chartData} defaultGranularity="weekly" />

      {/* سفرها */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
          <RouteIcon size={20} className="text-primary dark:text-dark-primary" />
          سفرهای پیک
        </h2>
        <p className="text-xs text-gray-400 mb-6 font-DanaMedium">
          {role === 'admin2' ? 'سفارشاتی که توسط شما به این پیک تخصیص داده شده' : 'هر سفر = یک خروج با یک یا چند سفارش'}
        </p>

        {role === 'admin2' && viewData.totalDeliveries === 0 ? (
          <div className="text-center py-12 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300">
            <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-[#2a1015] text-gray-400 mb-4">
              <Package size={32} />
            </span>
            <p className="text-gray-400 font-DanaMedium">سفارشی تحویل این پیک نداده‌اید</p>
          </div>
        ) : (
          <div className="space-y-3">
            {viewData.trips.map((trip) => {
              const isExpanded = state.expandedTripId === trip.id
              return (
                <div key={trip.id} className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleToggleTrip(trip.id)}
                    className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2a1015] transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
                        <RouteIcon size={20} />
                      </span>
                      <div className="text-right">
                        <p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
                          سفر {trip.id.replace('trip-', '')} — {faNum(trip.deliveries.length)} سفارش
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDate(trip.startedAt)} • {formatTime(trip.startedAt)} تا {trip.completedAt ? formatTime(trip.completedAt) : '—'}
                        </p>
                      </div>
                    </div>
                    <span className="text-gray-400">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-2 border-t border-gray-200 dark:border-white/5 pt-3">
                      {trip.deliveries.map((d) => (
                        <Link
                          key={d.orderId}
                          to="/admin/orders/$orderId"
                          params={{ orderId: d.orderId }}
                          className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-100 dark:border-white/5 hover:border-primary transition cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">{d.orderId}</p>
                            <p className="text-xs text-gray-400 truncate">{d.addressSnapshot}</p>
                          </div>
                          <div className="text-left shrink-0">
                            <p className="text-[10px] text-gray-400">{formatTime(d.deliveredAt)}</p>
                            <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-300">{formatPrice(d.amount)} ت</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {viewData.trips.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">سفری ثبت نشده</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export const Route = createFileRoute('/admin/couriers/$courierId')({
  component: CourierDetailPage,
  ssr: false,
  // ⬅ NEW: prefetch + کش مشترک — هاور روی نام پیک در لیست => دیتا در کش.
  // نقش‌محور: ادمین۲ فقط تحویل‌های خودش را پرلیچ می‌کند (همان کلید کامپوننت)
  loader: async ({ context, params }) => {
    await ensureAuthHydrated()
    const { role, admin2Id } = useAuthStore.getState()
    if (role !== 'admin' && role !== 'admin2') return
    const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined
    const courier = await context.queryClient.query(
      adminCourierDetailsOptions(params.courierId, viewAdmin2Id),
    )
    if (!courier) throw notFound()
  },
  pendingComponent: CourierDetailSkeleton,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  head: () => ({ meta: [{ title: 'جزئیات پیک | سین شین' }, { name: 'robots', content: 'noindex, nofollow' }] }),
})