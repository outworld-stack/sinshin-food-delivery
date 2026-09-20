// src/components/admin/couriers/CouriersFilterBox.tsx
import { memo, useCallback } from 'react'
import { Search, Restart } from 'reicon-react'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'


interface CouriersFilterBoxProps {
  tempSearch: string
  dateFrom: string
  dateTo: string
  onSearchChange: (v: string) => void
  onDateFrom: (v: string) => void
  onDateTo: (v: string) => void
  onApply: () => void
  onReset: () => void
}

export const CouriersFilterBox = memo(function CouriersFilterBox({
  tempSearch, dateFrom, dateTo, onSearchChange, onDateFrom, onDateTo, onApply, onReset,
}: CouriersFilterBoxProps) {
  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value), [onSearchChange])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <div className="lg:col-span-2">
          <label className="block text-xs text-gray-400 mb-1 font-DanaMedium">جستجو (نام پیک یا موبایل)</label>
          <input
            type="text"
            value={tempSearch}
            onChange={handleSearch}
            placeholder="محمد یا 0912..."
            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1 font-DanaMedium">از تاریخ</label>
          <PersianDatePicker
            value={dateFrom || null}
            onChange={(iso) => onDateFrom(iso ?? '')}
          />
          {/* <input type="text" placeholder="تاریخ (تست)" className="..." /> */}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1 font-DanaMedium">تا تاریخ</label>
          <PersianDatePicker
            value={dateTo || null}
            onChange={(iso) => onDateTo(iso ?? '')}
          />
          {/* <input type="text" placeholder="تاریخ (تست)" className="..." /> */}
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex gap-2 justify-end">
          <button type="button" onClick={onReset} className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-1.5">
            <Restart size={14} />
            پاک‌سازی
          </button>
          <button type="button" onClick={onApply} className="px-6 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center gap-1.5">
            <Search size={14} />
            اعمال فیلتر
          </button>
        </div>
      </div>
    </div>
  )
})