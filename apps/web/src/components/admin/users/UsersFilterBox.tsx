// src/components/admin/users/UsersFilterBox.tsx
import { memo, useCallback } from 'react'
import { SliderHorizontal } from 'reicon-react'
import type { AdminUserFilterProps } from '#/types/shared/ui'

interface UsersFilterBoxProps extends AdminUserFilterProps {
  isMobileModal?: boolean
}

const INPUT_CLS = 'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary'

// محتوای فیلتر کاربران — مشترک دسکتاپ/مودال (DRY)
export const UsersFilterBox = memo(function UsersFilterBox({
  tempSearch, setTempSearch, tempDevice, setTempDevice,
  tempStatus, setTempStatus, tempSortDate, setTempSortDate,
  tempSortWallet, setTempSortWallet, tempSortSpent, setTempSortSpent,
  applyFilters, isMobileModal = false,
}: UsersFilterBoxProps) {
  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setTempSearch(e.target.value), [setTempSearch])
  const handleDevice = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setTempDevice(e.target.value), [setTempDevice])
  const handleStatus = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setTempStatus(e.target.value), [setTempStatus])
  const handleDate = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setTempSortDate(e.target.value), [setTempSortDate])
  const handleWallet = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setTempSortWallet(e.target.value), [setTempSortWallet])
  const handleSpent = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setTempSortSpent(e.target.value), [setTempSortSpent])

  const selectCls = `${INPUT_CLS} cursor-pointer`
  const labelCls = 'block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium'

  return (
    <div className={isMobileModal
      ? 'grid grid-cols-2 gap-4 items-end'
      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 items-end'
    }>
      <div className={isMobileModal ? 'col-span-2' : 'sm:col-span-2 lg:col-span-2 xl:col-span-2'}>
        <label className={labelCls}>جستجو (نام یا شماره)</label>
        <input type="text" value={tempSearch} onChange={handleSearch} placeholder="0912..." className={INPUT_CLS} />
      </div>
      <div>
        <label className={labelCls}>دستگاه</label>
        <select value={tempDevice} onChange={handleDevice} className={selectCls}>
          <option value="all">همه دستگاه‌ها</option>
          <option value="iPhone 16 Pro">iPhone 16 Pro</option>
          <option value="Samsung S24 Ultra">Samsung S24 Ultra</option>
          <option value="MacBook Pro">MacBook Pro</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>وضعیت</label>
        <select value={tempStatus} onChange={handleStatus} className={selectCls}>
          <option value="all">همه</option>
          <option value="ACTIVE">فعال</option>
          <option value="SUSPENDED">مسدود</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>تاریخ ثبت‌نام</label>
        <select value={tempSortDate} onChange={handleDate} className={selectCls}>
          <option value="none">بدون مرتب‌سازی</option>
          <option value="newest">جدیدترین</option>
          <option value="oldest">قدیمی‌ترین</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>موجودی کیف پول</label>
        <select value={tempSortWallet} onChange={handleWallet} className={selectCls}>
          <option value="none">بدون مرتب‌سازی</option>
          <option value="highest">بیشترین</option>
          <option value="lowest">کمترین</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>مبلغ پرداختی</label>
        <select value={tempSortSpent} onChange={handleSpent} className={selectCls}>
          <option value="none">بدون مرتب‌سازی</option>
          <option value="highest">بیشترین</option>
          <option value="lowest">کمترین</option>
        </select>
      </div>
      <div className={isMobileModal ? 'col-span-2' : 'sm:col-span-2 lg:col-span-1 xl:col-span-1'}>
        <button
          type="button"
          onClick={applyFilters}
          className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
        >
          اعمال فیلتر
        </button>
      </div>
    </div>
  )
})

// تریگر موبایل — جدا
export const UsersFilterTrigger = memo(function UsersFilterTrigger({ onClick }: { onClick: () => void }) {
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-white dark:bg-[#2a1015] text-gray-800 dark:text-white font-DanaMedium border border-gray-200 dark:border-[#3a151c] shadow-sm cursor-pointer"
      >
        <span>فیلترهای کاربران</span>
        <SliderHorizontal size={24} />
      </button>
    </div>
  )
})