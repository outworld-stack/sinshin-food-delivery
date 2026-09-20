// src/components/site/product-detail/ProductMobileBar.tsx
import { memo } from 'react'
import { Cart } from 'reicon-react'
import { formatPrice } from '#/utils/format'

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
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-[#3a151c] shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          {hasDiscount && (
            <span className="text-xs text-gray-400 line-through font-DanaRegular leading-none mb-1">
              {formatPrice(originalTotal)}
            </span>
          )}
          <div className="flex items-baseline gap-1">
            <span className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">
              {formatPrice(totalPrice)}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaMedium">تومان</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#2a1015] rounded-xl p-1">
            <button type="button" onClick={onIncrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer">+</button>
            <span className="font-DanaDemiBold text-base text-gray-800 dark:text-white w-6 text-center">{quantity.toLocaleString('fa-IR')}</span>
            <button type="button" onClick={onDecrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer">-</button>
          </div>
          <button type="button" onClick={onAddToCart} className="flex items-center justify-center p-3 rounded-xl bg-primary dark:bg-dark-primary text-white transition shadow-sm cursor-pointer">
            <Cart size={24} />
          </button>
        </div>
      </div>
    </div>
  )
})