// src/components/admin/admin2/Admin2StatCards.tsx
import { memo } from 'react'
import { ShoppingCart, Wallet } from 'reicon-react'
import { formatPrice } from '#/utils/format'
import { faNum } from '#/utils/format'

interface Admin2StatCardsProps {
  totalOrders: number
  totalAmount: number
}

// دو باکس اختصاصی — فقط سفارشات خود ادمین (درخواست کارفرما)
export const Admin2StatCards = memo(function Admin2StatCards({ totalOrders, totalAmount }: Admin2StatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">سفارشات کل من</p>
          <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">{faNum(totalOrders)}</p>
        </div>
        <span className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-500/10 text-blue-500 flex items-center justify-center">
          <ShoppingCart size={24} />
        </span>
      </div>
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-2">درآمد کل من</p>
          <p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">{formatPrice(totalAmount)} ت</p>
        </div>
        <span className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
          <Wallet size={24} />
        </span>
      </div>
    </div>
  )
})