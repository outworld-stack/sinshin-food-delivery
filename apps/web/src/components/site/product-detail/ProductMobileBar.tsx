// src/components/site/product-detail/ProductMobileBar.tsx
import { memo } from 'react'
import { Cart } from 'reicon-react'
import { useI18n } from '#/i18n'

interface ProductMobileBarProps {
  totalPrice: number
  originalTotal: number
  hasDiscount: boolean
  quantity: number
  onIncrement: () => void
  onDecrement: () => void
  onAddToCart: () => void
}

// نوار قیمت فیکس موبایل
export const ProductMobileBar = memo(function ProductMobileBar({
  totalPrice, originalTotal, hasDiscount, quantity, onIncrement, onDecrement, onAddToCart,
}: ProductMobileBarProps) {
  const { t, fmt } = useI18n()

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-[#3a151c] shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          {hasDiscount && (
            <span className="text-xs text-gray-400 line-through font-DanaRegular leading-none mb-1">
              {fmt.price(originalTotal)}
            </span>
          )}
          <div className="flex items-baseline gap-1">
            <span className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">
              {fmt.price(totalPrice)}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaMedium">{t['common.toman']}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#2a1015] rounded-xl p-1">
            <button type="button" onClick={onIncrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer">+</button>
            <span className="font-DanaDemiBold text-base text-gray-800 dark:text-white w-6 text-center">{fmt.num(quantity)}</span>
            <button type="button" onClick={onDecrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer">-</button>
          </div>
          <button type="button" onClick={onAddToCart} aria-label={t['pdetail.addToCart']} className="flex items-center justify-center p-3 rounded-xl bg-primary dark:bg-dark-primary text-white transition shadow-sm cursor-pointer">
            <Cart size={24} />
          </button>
        </div>
      </div>
    </div>
  )
})
