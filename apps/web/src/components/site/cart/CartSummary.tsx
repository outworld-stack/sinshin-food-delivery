// src/components/site/cart/CartSummary.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useI18n } from '#/i18n'

interface CartSummaryProps {
  totalItems: number
  total: number
  totalSavings: number
}

export const CartSummary = memo(function CartSummary({ totalItems, total, totalSavings }: CartSummaryProps) {
  const { t, fmt } = useI18n()

  return (
    <div className="lg:col-span-1 hidden lg:block">
      <div className="sticky top-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">{t['cart.summary']}</h2>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
            <span>{t['cart.itemCount']}</span>
            <span>{fmt.num(totalItems)} {t['common.pcs']}</span>
          </div>
          <div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
            <span>{t['cart.totalAmount']}</span>
            <span>{fmt.price(total)} {t['common.toman']}</span>
          </div>
          {totalSavings > 0 && (
            <div className="flex justify-between font-DanaRegular text-green-600 dark:text-green-400">
              <span>{t['cart.savings']}</span>
              <span>{fmt.price(totalSavings)} {t['common.toman']}</span>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-white/5 mb-6">
          <span className="font-DanaDemiBold text-gray-800 dark:text-white">{t['cart.finalAmount']}</span>
          <span className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">{fmt.price(total)}</span>
        </div>

        <Link
          to="/checkout"
          className="block w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30 text-center cursor-pointer"
        >
          {t['cart.continue']}
        </Link>
      </div>
    </div>
  )
})
