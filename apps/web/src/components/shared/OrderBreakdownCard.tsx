// src/components/shared/OrderBreakdownCard.tsx
import { memo } from 'react'
import type { OrderBreakdown } from '@sinshin/shared'
import { useI18nSafe } from '#/i18n'


interface OrderBreakdownCardProps {
  breakdown: OrderBreakdown
  title?: string
}

// ریز مبلغ فاکتور — واحد (مشتری / ادمین اصلی / ادمین۲ با اجازه)
// رارد ۳۳ — دوزبانه با useI18nSafe: ادمین/ادمین₂ (بدون Provider) همان
// فارسیِ قبل؛ داشبورد مشتری و چک‌اوت دوزبانه. title پاس‌داده‌شده از بیرون
// (داشبورد = دیکشنری، ادمین = رشته‌ی فارسی) بدون تغییر رندر می‌شود.
export const OrderBreakdownCard = memo(function OrderBreakdownCard({ breakdown, title }: OrderBreakdownCardProps) {
  const { t, fmt } = useI18nSafe()
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        {title ?? t['bd.defaultTitle']}
      </h2>
      <div className="space-y-2.5">
        <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
          <span>{t['checkout.foodAmount']}</span>
          <span>{fmt.price(breakdown.foodTotal)} {t['common.toman']}</span>
        </div>
        {breakdown.discount > 0 && (
          <div className="flex justify-between font-DanaRegular text-green-500 text-sm">
            <span>{t['checkout.couponDiscount']}</span>
            <span>- {fmt.price(breakdown.discount)} {t['common.toman']}</span>
          </div>
        )}
        {breakdown.walletDeduction > 0 && (
          <div className="flex justify-between font-DanaRegular text-blue-500 text-sm">
            <span>{t['checkout.walletLine']}</span>
            <span>- {fmt.price(breakdown.walletDeduction)} {t['common.toman']}</span>
          </div>
        )}
        <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
          <span>{t['checkout.deliveryFee']}</span>
          <span>{breakdown.deliveryFee > 0 ? `${fmt.price(breakdown.deliveryFee)} ${t['common.toman']}` : t['bd.free']}</span>
        </div>
        {/* stage-10: بسته‌بندی per-product — پیک و بیرون‌بر؛ سرو در محل صفر است */}
        {breakdown.packagingFee > 0 && (
          <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300 text-sm">
            <span>{t['checkout.packagingFee']}</span>
            <span>{fmt.price(breakdown.packagingFee)} {t['common.toman']}</span>
          </div>
        )}
        <div className="flex justify-between font-DanaDemiBold text-gray-800 dark:text-white pt-2 border-t border-gray-100 dark:border-white/5">
          <span>{t['cart.totalAmount']}</span>
          <span>{fmt.price(breakdown.totalAmount)} {t['common.toman']}</span>
        </div>
        <div className="flex justify-between items-center bg-primary dark:bg-dark-primary text-white p-3 rounded-xl mt-2">
          <span className="font-DanaMedium text-sm">{t['bd.paidOnline']}</span>
          <span className="font-MorabbaBold text-lg">{fmt.price(breakdown.amountPaidOnline)} {t['common.toman']}</span>
        </div>
      </div>
    </div>
  )
})
