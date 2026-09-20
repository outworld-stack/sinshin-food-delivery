// src/components/site/products/ProductsGrid.tsx
import { memo } from 'react'
import { ProductCard } from '#/components/ProductCard'
import { EmptyState } from '#/components/EmptyState'
import type { Product } from '#/server/products'

interface ProductsGridProps {
  products: Product[]
  hasMore: boolean
  onLoadMore: () => void
}

export const ProductsGrid = memo(function ProductsGrid({ products, hasMore, onLoadMore }: ProductsGridProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        title="محصولی در این دسته یافت نشد"
        description="در حال حاضر محصولی برای این دسته‌بندی موجود نیست."
      />
    )
  }

  return (
    <div className="flex-1">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="px-8 py-3 rounded-xl bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer border border-gray-200 dark:border-white/10"
          >
            مشاهده محصولات بیشتر
          </button>
        </div>
      )}
    </div>
  )
})