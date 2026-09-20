// src/components/admin/products/ProductsFilterBox.tsx
import { memo, useCallback } from 'react'

interface CategoryItem {
  id: string
  name: string
}

interface ProductsFilterBoxProps {
  search: string
  status: string
  categoryId: string
  categories: CategoryItem[]
  onSearch: (v: string) => void
  onStatus: (v: string) => void
  onCategory: (v: string) => void
}

const INPUT_CLS = 'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary'
const LABEL_CLS = 'block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium'

// فیلتر محصولات — دسکتاپ/تبلت (اینا instant اعمال می‌شن، موکاپ نیست)
export const ProductsFilterBox = memo(function ProductsFilterBox({
  search, status, categoryId, categories,
  onSearch, onStatus, onCategory,
}: ProductsFilterBoxProps) {
  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value), [onSearch])
  const handleStatus = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => onStatus(e.target.value), [onStatus])
  const handleCategory = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => onCategory(e.target.value), [onCategory])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end mb-6">
      <div className="sm:col-span-2 lg:col-span-2">
        <label className={LABEL_CLS}>جستجو (نام محصول)</label>
        <input type="text" value={search} onChange={handleSearch} placeholder="پیتزا..." className={INPUT_CLS} />
      </div>
      <div>
        <label className={LABEL_CLS}>دسته‌بندی</label>
        <select value={categoryId} onChange={handleCategory} className={`${INPUT_CLS} cursor-pointer`}>
          <option value="all">همه دسته‌ها</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>وضعیت</label>
        <select value={status} onChange={handleStatus} className={`${INPUT_CLS} cursor-pointer`}>
          <option value="all">همه</option>
          <option value="ACTIVE">فعال</option>
          <option value="INACTIVE">غیرفعال</option>
        </select>
      </div>
    </div>
  )
})