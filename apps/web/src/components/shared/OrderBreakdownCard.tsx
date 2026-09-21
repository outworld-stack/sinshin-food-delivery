// src/components/shared/OrderBreakdownCard.tsx
import { memo } from 'react'
import { formatPrice } from '#/utils/format'
import type { OrderBreakdown } from '@sinshin/shared'


interface OrderBreakdownCardProps {
  breakdown: OrderBreakdown
  title?: string
}

// ریز مبلغ فاکتور — واحد (مشتری / ادمین اصلی / ادمین۲ با اجازه)
export const OrderBreakdownCard = memo(function OrderBreakdownCard({ breakdown, title = 'ریز مبلغ فاکتور' }: OrderBreakdownCardProps) {
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        {title}
      </h2>
      <div className="space-y-2.5">
        <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
          <span>مبلغ غذاها</span>
          <span>{formatPrice(breakdown.foodTotal)} تومان</span>
        </div>
        {breakdown.discount > 0 && (
          <div className="flex justify-between font-DanaRegular text-green-500 text-sm">
            <span>تخفیف کوپن</span>
            <span>- {formatPrice(breakdown.discount)} تومان</span>
          </div>
        )}
        {breakdown.walletDeduction > 0 && (
          <div className="flex justify-between font-DanaRegular text-blue-500 text-sm">
            <span>کسر از کیف پول</span>
            <span>- {formatPrice(breakdown.walletDeduction)} تومان</span>
          </div>
        )}
        <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
          <span>هزینه ارسال</span>
          <span>{breakdown.deliveryFee > 0 ? `${formatPrice(breakdown.deliveryFee)} تومان` : 'رایگان'}</span>
        </div>
        {/* stage-10: بسته‌بندی per-product — پیک و بیرون‌بر؛ سرو در محل صفر است */}
        {breakdown.packagingFee > 0 && (
          <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
            <span>هزینه بسته‌بندی</span>
            <span>{formatPrice(breakdown.packagingFee)} تومان</span>
          </div>
        )}
        <div className="flex justify-between font-DanaDemiBold text-gray-800 dark:text-white pt-2 border-t border-gray-100 dark:border-white/5">
          <span>مبلغ کل</span>
          <span>{formatPrice(breakdown.totalAmount)} تومان</span>
        </div>
        <div className="flex justify-between items-center bg-primary dark:bg-dark-primary text-white p-3 rounded-xl mt-2">
          <span className="font-DanaMedium text-sm">پرداخت آنلاین:</span>
          <span className="font-MorabbaBold text-lg">{formatPrice(breakdown.amountPaidOnline)} تومان</span>
        </div>
      </div>
    </div>
  )
})