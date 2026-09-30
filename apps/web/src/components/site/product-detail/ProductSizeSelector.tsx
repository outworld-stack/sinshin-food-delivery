// src/components/site/product-detail/ProductSizeSelector.tsx
import { memo } from 'react'
import type { ProductSize } from '#/server/products'
import { useI18n } from '#/i18n'

interface ProductSizeSelectorProps {
  sizes: ProductSize[]
  selectedSizeId: string | null
  onSelect: (sizeId: string) => void
}

export const ProductSizeSelector = memo(function ProductSizeSelector({
  sizes, selectedSizeId, onSelect,
}: ProductSizeSelectorProps) {
  const { t, fmt } = useI18n()
  if (sizes.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-2">{t['pdetail.sizeSelect']}</p>
      <div className="flex flex-wrap gap-2">
        {sizes.map(size => {
          const isSelected = size.id === selectedSizeId
          return (
            <button
              key={size.id}
              type="button"
              onClick={() => onSelect(size.id)}
              className={`px-4 py-2.5 rounded-xl text-sm font-DanaDemiBold transition cursor-pointer flex items-center gap-2 ${
                isSelected
                  ? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
              }`}
            >
              {size.name}
              <span className={`text-[11px] font-DanaMedium ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                {fmt.price(size.price)} {t['common.tomanShort']}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
