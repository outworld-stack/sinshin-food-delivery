// src/components/site/articles/ArticlesFilterContent.tsx
import { memo, useCallback } from 'react'
import type { SortBy } from '#/hooks/site/useArticlesPage'

interface SubCategoryOption {
  id: string
  name: string
  slug: string
}

interface ArticlesFilterContentProps {
  hasSubCategories: boolean
  subCategories: SubCategoryOption[]
  tempSubCategory: string
  tempSortBy: SortBy
  isMobileModal?: boolean
  onTempSub: (v: string) => void
  onTempSort: (v: SortBy) => void
  onApply: () => void
}

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: 'newest', label: 'جدیدترین' },
  { key: 'most-viewed', label: 'پربازدیدترین' },
]

// محتوای فیلتر — مشترک دسکتاپ/مودال موبایل (DRY)
export const ArticlesFilterContent = memo(function ArticlesFilterContent({
  hasSubCategories, subCategories, tempSubCategory, tempSortBy,
  isMobileModal = false,
  onTempSub, onTempSort, onApply,
}: ArticlesFilterContentProps) {

  const handleSort = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onTempSort(e.target.value as SortBy)
  }, [onTempSort])

  const optionCls = 'flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition'
  const inputCls = 'w-4 h-4 accent-primary dark:accent-dark-primary'
  const wrapCls = isMobileModal ? '' : 'space-y-6'

  return (
    <div className={wrapCls}>
      {/* ساب‌کتگوری */}
      {hasSubCategories && (
        <div className="space-y-2">
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-3">دسته‌بندی دقیق‌تر:</h3>
          <label className={optionCls}>
            <input type="radio" name="subCat" checked={tempSubCategory === 'all'} onChange={() => onTempSub('all')} className={inputCls} />
            <span className="font-DanaMedium text-gray-600 dark:text-gray-300">همه موارد</span>
          </label>
          {subCategories.map(sub => (
            <label key={sub.id} className={optionCls}>
              <input type="radio" name="subCat" checked={tempSubCategory === sub.slug} onChange={() => onTempSub(sub.slug)} className={inputCls} />
              <span className="font-DanaMedium text-gray-600 dark:text-gray-300">{sub.name}</span>
            </label>
          ))}
        </div>
      )}

      {/* مرتب‌سازی */}
      <div className={`space-y-2 ${hasSubCategories ? 'pt-4 border-t border-gray-100 dark:border-white/5' : ''}`}>
        <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-3">مرتب‌سازی بر اساس:</h3>
        {SORT_OPTIONS.map(option => (
          <label key={option.key} className={optionCls}>
            <input type="radio" name="sortBy" checked={tempSortBy === option.key} onChange={handleSort} className={inputCls} />
            <span className={`font-DanaMedium ${tempSortBy === option.key ? 'text-primary dark:text-dark-primary' : 'text-gray-600 dark:text-gray-300'}`}>
              {option.label}
            </span>
          </label>
        ))}
      </div>

      {/* دکمه اعمال — فقط در مودال موبایل (دسکتاپ سایدبار persistente) */}
      {isMobileModal && (
        <button type="button" onClick={onApply} className="w-full mt-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer">
          اعمال فیلترها
        </button>
      )}
    </div>
  )
})