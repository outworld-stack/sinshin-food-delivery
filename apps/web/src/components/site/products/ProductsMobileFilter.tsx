// src/components/site/products/ProductsMobileFilter.tsx
import { memo } from 'react'
import { BottomSheet } from '#/components/shared/BottomSheet'
import { SORT_OPTIONS, type SortKey } from '#/hooks/site/useProductsPage'
import { SliderHorizontal } from 'reicon-react'

interface ProductsMobileFilterProps {
  isOpen: boolean
  tempSortBy: SortKey
  onOpen: () => void
  onClose: () => void
  onApply: () => void
  onTempSortChange: (key: SortKey) => void
}

export const ProductsMobileFilter = memo(function ProductsMobileFilter({
  isOpen, tempSortBy, onOpen, onClose, onApply, onTempSortChange,
}: ProductsMobileFilterProps) {
  return (
    <>
      {/* تریگر موبایل */}
      <div className="md:hidden mb-4">
        <button
          type="button"
          onClick={onOpen}
          className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-white dark:bg-[#2a1015] text-gray-800 dark:text-white font-DanaMedium border border-gray-200 dark:border-[#3a151c] shadow-sm cursor-pointer"
        >
          <span>فیلتر و مرتب‌سازی</span>
          <SliderHorizontal size={24} />
        </button>
      </div>

      {/* شیت پایین — نسخه مشترک (Escape + قفل اسکرول داره) */}
      <BottomSheet isOpen={isOpen} onClose={onClose} title="فیلتر و مرتب‌سازی" hideOnDesktop="md:hidden">
        <div className="space-y-4">
          <h3 className="font-DanaDemiBold text-base text-gray-800 dark:text-white">مرتب‌سازی بر اساس:</h3>
          <div className="flex flex-col gap-2">
            {SORT_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition">
                <input
                  type="radio"
                  name="sortByModal"
                  checked={tempSortBy === option.key}
                  onChange={() => onTempSortChange(option.key)}
                  className="w-4 h-4 accent-primary dark:accent-dark-primary"
                />
                <span className={`font-DanaMedium ${tempSortBy === option.key ? 'text-primary dark:text-dark-primary' : 'text-gray-600 dark:text-gray-300'}`}>
                  {option.label}
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={onApply}
            className="w-full mt-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium cursor-pointer"
          >
            اعمال فیلتر
          </button>
        </div>
      </BottomSheet>
    </>
  )
})