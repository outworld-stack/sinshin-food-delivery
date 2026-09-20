// src/components/site/checkout/RestaurantStatusNotice.tsx
import { memo } from 'react'
import { Clock } from 'reicon-react'

interface RestaurantStatusNoticeProps {
  isOpen: boolean
  nextOpenTime: string
}

// آیتم ۲۲: اگر رستوران بسته بود → اطلاع‌رسانی
export const RestaurantStatusNotice = memo(function RestaurantStatusNotice({ isOpen, nextOpenTime }: RestaurantStatusNoticeProps) {
  if (isOpen) return null

  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
      <span className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-500/20 text-orange-500 flex items-center justify-center shrink-0">
        <Clock size={20} />
      </span>
      <div>
        <p className="font-DanaDemiBold text-orange-600 dark:text-orange-400 text-sm mb-1">رستوران در حال حاضر بسته است</p>
        <p className="text-xs text-orange-500 dark:text-orange-300/80 font-DanaMedium leading-relaxed">
          بعد از پرداخت، سفارش شما در اولین زمان ممکن بعد از باز شدن رستوران برایتان ارسال می‌شود.
        </p>
        <p className="text-xs text-orange-600 dark:text-orange-400 font-DanaDemiBold mt-2 flex items-center gap-1">
          <Clock size={14} />
          ساعت باز شدن: {nextOpenTime}
        </p>
      </div>
    </div>
  )
})