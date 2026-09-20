// src/components/site/products/ProductsDesktopFilter.tsx
import { memo } from 'react'
import { SORT_OPTIONS, type SortKey } from '#/hooks/site/useProductsPage'

interface ProductsDesktopFilterProps {
  sortBy: SortKey
  onSortChange: (key: SortKey) => void
}

export const ProductsDesktopFilter = memo(function ProductsDesktopFilter({ sortBy, onSortChange }: ProductsDesktopFilterProps) {
  return (
    <aside className="hidden md:block w-64 shrink-0">
      <div className="sticky top-6 bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-300 dark:border-[#4a1a24] shadow-sm">
        <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">مرتب‌سازی بر اساس:</h3>
        <div className="flex flex-col gap-2">
          {SORT_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition">
              <input
                type="radio"
                name="sortByDesktop"
                checked={sortBy === option.key}
                onChange={() => onSortChange(option.key)}
                className="w-4 h-4 accent-primary dark:accent-dark-primary"
              />
              <span className={`font-DanaMedium ${sortBy === option.key ? 'text-primary dark:text-dark-primary' : 'text-gray-600 dark:text-gray-300'}`}>
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </aside>
  )
})