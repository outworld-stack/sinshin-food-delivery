// src/components/dashboard/order-detail/OrderDetails.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { formatPrice } from '#/utils/format'
import type { UserOrderItem as OrderItem, OrderBreakdown } from '@sinshin/shared'
import { OrderBreakdownCard } from '#/components/shared/OrderBreakdownCard'


interface OrderDetailsProps {
  items: OrderItem[]
  breakdown?: OrderBreakdown | null
}

// جزئیات سفارش — اقلام + ریز مبلغ فاکتور (نام قبلی: اقلام سفارش)
export const OrderDetails = memo(function OrderDetails({ items, breakdown }: OrderDetailsProps) {
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        جزئیات سفارش
      </h2>
      <div className="space-y-4">
        {items.map((item) => (
          <Link
            key={`${item.productId}|${item.sizeId ?? ''}`}
            to="/products/$productId"
            params={{ productId: item.productId ?? '' }} className="flex items-center justify-between p-3 -mx-3 rounded-xl hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-[#1a0a0e] flex items-center justify-center text-xs font-DanaDemiBold text-gray-500 shrink-0">
                {item.quantity.toLocaleString('fa-IR')}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-DanaMedium text-gray-700 dark:text-gray-200 hover:text-primary dark:hover:text-dark-primary transition">
                  {item.name}
                </p>
                {item.sizeName && (
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-[10px] font-DanaDemiBold">
                    {item.sizeName}
                  </span>
                )}
              </div>
            </div>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
              {formatPrice(item.price * item.quantity)} ت
            </p>
          </Link>
        ))}
      </div>

      {breakdown && <OrderBreakdownCard breakdown={breakdown} title="ریز مبلغ سفارش" />}

    </div>
  )
})