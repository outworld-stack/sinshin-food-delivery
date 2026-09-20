// src/routes/admin/orders/$orderId/index.tsx
// ⬅ NEW: رفع باگ رفرش — قبلاً loader مستقیماً دیتا برمی‌گرداند (بدون کش) و
// کامپوننت از Route.useLoaderData می‌خواند؛ یعنی تایید/تغییر پیک در پنل زنده
// هیچ ریفچی روی این صفحه نمی‌ساخت (snapshot کهنه می‌ماند).
// حالا: loader و کامپوننت یک کش مشترک دارند (adminOrderDetailsOptions) =>
// invalidate های پنل زنده، واقعاً این صفحه را به‌روز می‌کنند + پری‌فچ روی هاور.
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { adminOrderDetailsOptions } from '#/utils/queryOptions'
import { StatusBadge } from '#/components/shared/StatusBadge'
import { AdminOrderDetailSkeleton } from '#/components/LoadingSkeletons'
import { PdfDownloadButton } from '#/components/shared/PdfDownloadButton'
import { OrderBreakdownCard } from '#/components/shared/OrderBreakdownCard'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { useHydrated } from '#/hooks/useHydrated'
import { formatPrice, formatDate } from '#/utils/format'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { ChevronRight, Phone } from 'reicon-react'
import type { OrderBreakdown } from '@sinshin/shared'



const OrderDetailPage = memo(function OrderDetailPage() {
  const { orderId } = Route.useParams()
  const showToast = useToastStore((s) => s.showToast)
  const hydrated = useHydrated()
  const { permissions, isMainAdmin } = usePermissions()

  // نقش‌محور: ادمین۲ فقط سفارش خودش (بک: adminId از کوکی)
  const role = useAuthStore((s) => s.role)
  const admin2Id = useAuthStore((s) => s.admin2Id)
  const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined

  // ⬅ NEW: اشتراک در کش مشترک با loader (فکتوری مرکزی) —
  // همان کلیدی که loader با query پر کرده؛
  // invalidate از ConfirmOrderModal (تایید/تغییر پیک) اینجا واقعاً می‌نشیند
  const { data: order } = useQuery(adminOrderDetailsOptions(orderId, viewAdmin2Id))

  // ریز فاکتور — ادمین اصلی همیشه / ادمین۲ با پرمیشن orderDetailsRead
  const canSeeBreakdown = isMainAdmin || permissions.orderDetailsRead

  if (!order) {
    // در حال ریفچ بعد از invalidate یا سفارش خارج از دسترس نقش
    return <RouteNotFound />
  }

  // لینک اسکن پیک — شبیه‌سازی QR چاپی (فاز بک: QR همین مسیر را دارد)
  const scanUrl = `${window.location.origin}/courier/scan/${order.id}${order.courierSecurityEnabled && order.courierId ? `?courier=${order.courierId}` : ''}`

  return (
    <div className="space-y-6">
      <Link to="/admin/orders" className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit cursor-pointer">
        <ChevronRight size={20} />
        بازگشت به لیست سفارشات
      </Link>

      {/* هدر سفارش */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">{order.id}</h1>
            <StatusBadge status={order.status} perspective="admin" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">{formatDate(order.date)}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-left">
            <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">مبلغ کل</p>
            <p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary mt-1">
              {formatPrice(order.amount)} تومان
            </p>
          </div>
          <PdfDownloadButton documentId={order.id} documentType="order-invoice" targetSelector="#order-detail-print" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="order-detail-print">

        {/* ستون راست: اطلاعات سفارش */}
        <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
            اطلاعات سفارش
          </h2>

          <div className="space-y-6">
            <div>
              <p className="text-xs text-gray-400 font-DanaMedium mb-1">مشتری</p>
              <div className="flex flex-col">
                <span className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{order.userName}</span>
                <a href={`tel:${order.userPhone}`} className="text-xs text-gray-400 hover:text-primary transition" dir="ltr">
                  {order.userPhone}
                </a>
              </div>
            </div>

            {order.confirmedByName && (
              <div>
                <p className="text-xs text-gray-400 font-DanaMedium mb-1">ثبت‌کننده سفارش (ادمین سطح ۲)</p>
                <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
                  {order.confirmedByName}
                </p>
              </div>
            )}

            {order.customerNote && (
              <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
                <p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
                  <span className="font-DanaDemiBold">نکته مشتری: </span>
                  {order.customerNote}
                </p>
              </div>
            )}

            {order.internalNote && (
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
                <p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium leading-relaxed">
                  <span className="font-DanaDemiBold">نکته ادمین: </span>
                  {order.internalNote}
                </p>
              </div>
            )}

            {order.courierSecurityEnabled && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10">
                <span className="text-xs text-green-600 dark:text-green-400 font-DanaDemiBold">
                  احراز هویت پیک فعال است
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ستون چپ: اطلاعات تحویل و پیک */}
        <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
            اطلاعات تحویل
          </h2>

          <div className="space-y-6">
            {order.courierName ? (
              <div>
                <p className="text-xs text-gray-400 font-DanaMedium mb-1">پیک</p>
                <div className="flex items-center justify-between bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-lg">
                  <div>
                    <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{order.courierName}</p>
                    {order.courierPhone && (
                      <p className="text-xs text-gray-400" dir="ltr">{order.courierPhone}</p>
                    )}
                  </div>
                  {order.courierPhone && (
                    <a href={`tel:${order.courierPhone}`} className="p-2 rounded-lg bg-green-500 text-white cursor-pointer hover:opacity-90 transition">
                      <Phone size={20} />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e]">
                <p className="text-xs text-gray-400 font-DanaMedium">پیک هنوز تخصیص نیافته</p>
              </div>
            )}

            {order.courierArrivedAt && (
              <div>
                <p className="text-xs text-gray-400 font-DanaMedium mb-1">رسیدن پیک به مغازه</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 font-DanaMedium">
                  {formatDate(order.courierArrivedAt)}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ⬅ ریز مبلغ فاکتور — ادمین اصلی همیشه / ادمین۲ با پرمیشن (بعد از هیدریشن — بدون mismatch) */}
      {hydrated && order.breakdown && canSeeBreakdown && (
        <OrderBreakdownCard breakdown={order.breakdown as OrderBreakdown} title="جزئیات مبلغ سفارش" />

      )}
      {hydrated && order.breakdown && !canSeeBreakdown && (
        <div className="bg-white dark:bg-[#2a1015] p-4 rounded-2xl border border-dashed border-gray-300 dark:border-white/10 text-center">
          <p className="text-xs text-gray-400 font-DanaMedium">
            ریز مبلغ فاکتور — قابل مشاهده با اجازه‌ی مدیر اصلی
          </p>
        </div>
      )}

      {/* لینک اسکن پیک — شبیه‌سازی QR چاپی */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2">لینک اسکن پیک</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-3 leading-relaxed">
          پیک با اسکن QR فاکتور فروش، همین صفحه را روی گوشی خودش باز می‌کند — این لینک برای شبیه‌سازی و اشتراک است.
        </p>
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-xs text-primary dark:text-dark-primary font-DanaMedium break-all mb-3" dir="ltr">
          {scanUrl}
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(scanUrl); showToast('لینک اسکن کپی شد') }}
          className="px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
        >
          کپی لینک اسکن
        </button>
      </div>
    </div>
  )
})

export const Route = createFileRoute('/admin/orders/$orderId/')({
  ssr: false,
  component: OrderDetailPage,

  // ⬅ NEW: prefetch — هاور روی شناسه سفارش در لیست/داشبورد => دیتا در کش؛
  // ناوبری به جزئیات بدون حتی یک اسکلتون.
  // نقش‌محور: ادمین۲ فقط سفارش خودش را پرلیچ می‌کند (همان کلید کامپوننت)
  loader: async ({ context, params }) => {
    await ensureAuthHydrated()
    const { role, admin2Id } = useAuthStore.getState()
    if (role !== 'admin' && role !== 'admin2') return
    const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined
    const order = await context.queryClient.query(
      adminOrderDetailsOptions(params.orderId, viewAdmin2Id),
    )
    if (!order) throw notFound()
  },

  pendingComponent: AdminOrderDetailSkeleton,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,

  head: () => ({
    meta: [
      { title: 'جزئیات سفارش | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})