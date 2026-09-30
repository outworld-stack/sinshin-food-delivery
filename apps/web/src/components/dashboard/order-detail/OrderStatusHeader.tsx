// src/components/dashboard/order-detail/OrderStatusHeader.tsx
import { memo } from 'react'
import { StatusBadge } from '#/components/shared/StatusBadge'
import type { UserOrder } from '#/server/user'
import { tpl, useI18n } from '#/i18n'

interface OrderStatusHeaderProps {
  order: UserOrder
}

export const OrderStatusHeader = memo(function OrderStatusHeader({ order }: OrderStatusHeaderProps) {
  const { t, fmt } = useI18n()
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{tpl(t['dash.orderNumber'], { n: order.id })}</h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{fmt.date(order.date)}</p>

        {/* آیتم ۱۳: یادداشت مشتری */}
        {order.customerNote && (
          <div className="mt-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 max-w-md">
            <p className="text-xs text-blue-500 font-DanaMedium leading-relaxed">
              <span className="font-DanaDemiBold">{t['dash.orderDetail.yourNote']}</span>
              {order.customerNote}
            </p>
          </div>
        )}
      </div>

      <div className="text-left">
        <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">{t['cart.totalAmount']}</p>
        <p className="font-MorabbaBold text-xl text-primary dark:text-dark-primary mt-1">
          {fmt.price(order.totalAmount)} {t['common.toman']}
        </p>
      </div>
    </div>
  )
})