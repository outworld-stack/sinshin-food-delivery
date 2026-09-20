// src/components/site/product-detail/ProductInfo.tsx
import { memo } from 'react'
import { Clock } from 'reicon-react'
import type { Product } from '#/server/products'

interface ProductInfoProps {
  product: Product
}

// فقط با تغییر محصول رندر می‌شه
export const ProductInfo = memo(function ProductInfo({ product }: ProductInfoProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <span className="px-3 py-1 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold">
          {product.categoryName || 'دسته‌بندی'}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
          <Clock size={14} />
          آماده‌سازی در {product.prepTime} دقیقه
        </span>
      </div>

      <h1 className="font-MorabbaBold text-3xl md:text-4xl text-gray-900 dark:text-white mb-6">
        {product.name}
      </h1>

      <p className="text-base text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
        {product.description}
      </p>
    </div>
  )
})