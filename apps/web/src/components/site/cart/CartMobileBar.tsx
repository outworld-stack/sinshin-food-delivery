// src/components/site/cart/CartMobileBar.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useI18n } from '#/i18n'

interface CartMobileBarProps {
  total: number
}

export const CartMobileBar = memo(function CartMobileBar({ total }: CartMobileBarProps) {
  const { t, fmt } = useI18n()

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-[#3a151c] shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">{t['cart.finalAmount']}</span>
          <div className="flex items-baseline gap-1">
            <span className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">{fmt.price(total)}</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaMedium">{t['common.toman']}</span>
          </div>
        </div>
        <Link
          to="/checkout"
          className="flex-1 max-w-[60%] py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold transition shadow-sm text-center cursor-pointer"
        >
          {t['cart.continue']}
        </Link>
      </div>
    </div>
  )
})
