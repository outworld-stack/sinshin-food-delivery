// src/components/site/product-detail/ProductPriceBox.tsx
import { memo } from 'react'
import { Cart } from 'reicon-react'
import { formatPrice } from '#/utils/format'

interface ProductPriceBoxProps {
  totalPrice: number
  originalTotal: number
  hasDiscount: boolean
  quantity: number
  onIncrement: () => void
  onDecrement: () => void
  onAddToCart: () => void
}

export const ProductPriceBox = memo(function ProductPriceBox({
  totalPrice, originalTotal, hasDiscount, quantity, onIncrement, onDecrement, onAddToCart,
}: ProductPriceBoxProps) {
  return (
    <div className="hidden lg:flex mt-auto p-6 bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-300 dark:border-[#3a151c] shadow-sm flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          {hasDiscount && (
            <span className="text-sm text-gray-400 line-through font-DanaMedium">
              {formatPrice(originalTotal)} تومان
            </span>
          )}
          <div className="flex items-baseline gap-1">
            <span className="font-MorabbaBold text-3xl text-primary dark:text-dark-primary">
              {formatPrice(totalPrice)}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">تومان</span>
          </div>
        </div>

        {/* کنترل تعداد */}
        <div className="flex items-center gap-3 bg-gray-100 dark:bg-[#1a0a0e] rounded-xl p-1">
          <button
            type="button"
            onClick={onIncrement}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#3a151c] transition font-DanaBold text-lg cursor-pointer"
          >
            +
          </button>
          <span className="font-DanaDemiBold text-xl text-gray-800 dark:text-white w-8 text-center">
            {quantity.toLocaleString('fa-IR')}
          </span>
          <button
            type="button"
            onClick={onDecrement}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#3a151c] transition font-DanaBold text-lg cursor-pointer"
          >
            -
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onAddToCart}
        className="w-full py-4 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-lg hover:opacity-90 transition shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30 flex items-center justify-center gap-2 cursor-pointer"
      >
        <Cart size={24} />
        افزودن به سبد خرید
      </button>
    </div>
  )
})