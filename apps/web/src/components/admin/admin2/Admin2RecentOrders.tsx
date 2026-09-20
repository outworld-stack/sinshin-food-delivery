// src/components/admin/admin2/Admin2RecentOrders.tsx
import { memo } from 'react'
import { formatPrice, formatDate } from '#/utils/format'
import type { LiveOrder } from '#/server/admin'

interface Admin2RecentOrdersProps {
  orders: LiveOrder[]
}

// سفارشات اخیر — فقط خود ادمین (بدون کاربران اخیر — درخواست کارفرما)
export const Admin2RecentOrders = memo(function Admin2RecentOrders({ orders }: Admin2RecentOrdersProps) {
  if (orders.length === 0) {
    return (
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm text-center py-12">
        <p className="text-gray-400 font-DanaMedium text-sm">هنوز سفارشی تایید نکرده‌اید</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        سفارشات اخیر من
      </h2>
      <div className="space-y-2">
        {orders.map((order) => (
          <div key={order.id} className="grid grid-cols-3 gap-4 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 items-center">
            <div className="min-w-0">
              <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm truncate">{order.id}</p>
              <p className="text-xs text-gray-400 truncate">{order.userName}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400">{formatDate(order.date)}</p>
              <p className="text-[10px] mt-0.5 font-DanaDemiBold text-green-500">تاییدشده</p>
            </div>
            <div className="text-left">
              <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{formatPrice(order.amount)} ت</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})