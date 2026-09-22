// src/components/admin/user-detail/ReferralsBox.tsx
import { memo, useState, useCallback, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Pagination } from '#/components/Pagination'
import { formatDate } from '#/utils/format'
import { useToastStore } from '#/stores/toastStore'
import { useAppliedFilters } from '#/hooks/shared/useAppliedFilters'
import { RowHorizontal, Copy } from 'reicon-react'
import type { AdminUserDetails } from '#/server/admin'

type ReferralRow = AdminUserDetails['referrals'][number]

const DEFAULT_FILTERS = {
  searchPhone: '',
  sortDate: 'newest' as 'newest' | 'oldest',
  sortOrders: 'none' as 'none' | 'most' | 'least',
}

interface ReferralsBoxProps {
  referrals: ReferralRow[]
}

export const ReferralsBox = memo(function ReferralsBox({ referrals }: ReferralsBoxProps) {
  const showToast = useToastStore((s) => s.showToast)
  const { temp, applied, setField, apply } = useAppliedFilters(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(5)

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setField('searchPhone', e.target.value)
  }, [setField])
  const handleSortDate = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('sortDate', e.target.value as 'newest' | 'oldest')
  }, [setField])
  const handleSortOrders = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('sortOrders', e.target.value as 'none' | 'most' | 'least')
  }, [setField])
  const handleApplyFilters = useCallback(() => {
    apply()
    setPage(1)
  }, [apply])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('کپی شد')
    } catch {
      showToast('کپی ناموفق بود', 'error')
    }
  }, [showToast])

  const filtered = useMemo(() => {
    let res = referrals.filter(r => r.phone.includes(applied.searchPhone))
    // round-13 — رفع کرش getTime: روی سیم JSON تاریخ‌ها رشته‌اند (مثل OrdersBox)
    if (applied.sortDate === 'newest') res = [...res].sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime())
    if (applied.sortDate === 'oldest') res = [...res].sort((a, b) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime())
    if (applied.sortOrders === 'most') res = [...res].sort((a, b) => b.totalOrders - a.totalOrders)
    if (applied.sortOrders === 'least') res = [...res].sort((a, b) => a.totalOrders - b.totalOrders)
    return res
  }, [referrals, applied])

  const totalPages = Math.ceil(filtered.length / limit)
  const safePage = Math.min(page, totalPages || 1)
  const current = filtered.slice((safePage - 1) * limit, safePage * limit)

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">زیرمجموعه‌ها</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 items-end mb-4">
        <div className="sm:col-span-2 lg:col-span-2 xl:col-span-2">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">جستجوی شماره موبایل</label>
          <input value={temp.searchPhone} onChange={handleSearch} placeholder="0912..." className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary" dir="rtl" />
        </div>
        <div className="sm:col-span-1 lg:col-span-1 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">مرتب‌سازی تاریخ</label>
          <select value={temp.sortDate} onChange={handleSortDate} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="newest">جدیدترین</option>
            <option value="oldest">قدیمی‌ترین</option>
          </select>
        </div>
        <div className="sm:col-span-1 lg:col-span-1 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">مرتب‌سازی سفارش</label>
          <select value={temp.sortOrders} onChange={handleSortOrders} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="none">بدون مرتب‌سازی</option>
            <option value="most">بیشترین سفارش</option>
            <option value="least">کمترین سفارش</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4 xl:col-span-1">
          <button onClick={handleApplyFilters} className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer">اعمال فیلتر</button>
        </div>
      </div>

      <div className="space-y-2">
        {current.length > 0 ? (
          current.map(r => (
            <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-transparent hover:border-primary dark:hover:border-dark-primary transition">
              <Link to="/admin/users/$userId" params={{ userId: r.id }} className="flex flex-col cursor-pointer">
                <span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300" dir="ltr">{r.phone}</span>
                <span className="text-xs text-gray-400 mt-1">{formatDate(r.registeredAt)}</span>
              </Link>

              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">{r.totalOrders} سفارش</span>

                <details className="relative">
                  <summary className="cursor-pointer list-none p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#2a1015] transition">
                    <RowHorizontal size={18} />
                  </summary>

                  <div className="absolute left-0 mt-2 w-48 bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] rounded-xl shadow-lg z-20 p-2 max-h-60 overflow-y-auto">
                    <p className="text-xs text-gray-400 font-DanaMedium p-2 text-center border-b border-gray-100 dark:border-white/5 mb-2">سفارشات این کاربر (کلیک برای کپی)</p>
                    {r.orderIds?.map((id: string) => (
                      <button key={id} onClick={() => copyToClipboard(id)} className="w-full text-right px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a0a0e] text-xs text-gray-700 dark:text-gray-300 flex justify-between items-center cursor-pointer">
                        <span>{id}</span>
                        <Copy size={14} />
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
            زیرمجموعه‌ای با این شماره یافت نشد.
          </div>
        )}
      </div>

      <div className="mt-4">
        {totalPages > 1 && (
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            itemsPerPage={limit}
            totalItems={filtered.length}
            onPageChange={setPage}
            onItemsPerPageChange={(v) => { setLimit(v); setPage(1) }}
            pageSizeOptions={[5, 10]}
          />
        )}
      </div>
    </div>
  )
})