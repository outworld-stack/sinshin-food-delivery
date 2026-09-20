// src/components/admin/couriers/CourierCard.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { Bicycle , Route as RouteIcon, ChevronLeft } from 'reicon-react'
import { formatPrice, formatDate, formatTime } from '#/utils/format'
import type { CourierRecord } from '#/server/admin'

interface CourierCardProps {
  courier: CourierRecord
}

// کارت پیک — کلیک → صفحه مخصوص پیک
export const CourierCard = memo(function CourierCard({ courier }: CourierCardProps) {
  const allDeliveries = courier.trips.flatMap(t => t.deliveries)
  const totalEarnings = allDeliveries.reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">
      {/* هدر — لینک به صفحه جزئیات */}
      <Link
        to="/admin/couriers/$courierId"
        params={{ courierId: courier.id }}
        className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-200 dark:border-white/5 text-center sm:text-right hover:border-primary dark:hover:border-dark-primary transition cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
            <Bicycle  size={24} />
          </span>
          <div>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white flex items-center gap-1.5">
              {courier.name}
              <ChevronLeft size={14} className="text-gray-400" />
            </p>
            <p className="text-xs text-gray-400" dir="ltr">{courier.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">سفرها</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">
              {courier.trips.length.toLocaleString('fa-IR')}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">تحویل‌ها</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">
              {allDeliveries.length.toLocaleString('fa-IR')}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مجموع مبالغ</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary">
              {formatPrice(totalEarnings)} ت
            </p>
          </div>
        </div>
      </Link>

      {/* خلاصه سفرها — ۲ سفارش آخر */}
      <div className="space-y-2">
        {allDeliveries.slice(-2).map((d) => (
          <div key={d.orderId} className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-100 dark:border-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <RouteIcon size={14} className="text-primary dark:text-dark-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">{d.orderId}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{d.addressSnapshot}</p>
              </div>
            </div>
            <div className="text-left shrink-0">
              <p className="text-[10px] text-gray-400 font-DanaMedium">{formatDate(d.deliveredAt)} • {formatTime(d.deliveredAt)}</p>
              <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-300">{formatPrice(d.amount)} ت</p>
            </div>
          </div>
        ))}
        {allDeliveries.length > 2 && (
          <Link
            to="/admin/couriers/$courierId"
            params={{ courierId: courier.id }}
            className="text-xs text-primary dark:text-dark-primary hover:underline block text-center py-2 cursor-pointer font-DanaDemiBold"
          >
            مشاهده جزئیات و نمودار عملکرد →
          </Link>
        )}
        {allDeliveries.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">در این بازه سفری ثبت نشده</p>
        )}
      </div>
    </div>
  )
})