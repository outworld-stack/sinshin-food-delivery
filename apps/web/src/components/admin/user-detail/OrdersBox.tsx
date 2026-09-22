// src/components/admin/user-detail/OrdersBox.tsx
import { memo, useState, useCallback, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Pagination } from '#/components/Pagination'
import { formatPrice } from '#/utils/format'
import { useAppliedFilters } from '#/hooks/shared/useAppliedFilters'
import type { AdminUserDetails } from '#/server/admin'

type OrderRow = AdminUserDetails['orders'][number]
type AddressRow = AdminUserDetails['addresses'][number]

const DEFAULT_FILTERS = {
  search: '',
  filterAddr: 'all',
  sortDate: 'newest' as 'newest' | 'oldest',
  sortAmount: 'none' as 'none' | 'highest' | 'lowest',
}

interface OrdersBoxProps {
  orders: OrderRow[]
  addresses: AddressRow[]
}

export const OrdersBox = memo(function OrdersBox({ orders, addresses }: OrdersBoxProps) {
  const { temp, applied, setField, apply } = useAppliedFilters(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(5)

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setField('search', e.target.value)
  }, [setField])
  const handleAddr = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('filterAddr', e.target.value)
  }, [setField])
  const handleSortDate = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('sortDate', e.target.value as 'newest' | 'oldest')
  }, [setField])
  const handleSortAmount = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('sortAmount', e.target.value as 'none' | 'highest' | 'lowest')
  }, [setField])
  const handleApply = useCallback(() => {
    apply()
    setPage(1)
  }, [apply])

  const filtered = useMemo(() => {
    // رفع F-61: «تحویل حضوری» (null) قبلاً هیچ‌وقت جواب نمی‌داد
    let res = orders.filter(o =>
      o.id.includes(applied.search)
      && (
        applied.filterAddr === 'all'
        || (applied.filterAddr === 'null' ? o.addressId === null : o.addressId === applied.filterAddr)
      )
    )
    // round-13 — رفع کرش «b.date.getTime is not a function»:
    // DTO این فیلدها را Date اعلام کرده ولی روی سیم JSON رشته است؛
    // new Date() هر دو را می‌پوشاند (الگوی dashboard/orders).
    if (applied.sortDate === 'newest') res = [...res].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    if (applied.sortDate === 'oldest') res = [...res].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    if (applied.sortAmount === 'highest') res = [...res].sort((a, b) => b.amount - a.amount)
    if (applied.sortAmount === 'lowest') res = [...res].sort((a, b) => a.amount - b.amount)
    return res
  }, [orders, applied])

  const totalPages = Math.ceil(filtered.length / limit)
  const safePage = Math.min(page, totalPages || 1)
  const current = filtered.slice((safePage - 1) * limit, safePage * limit)

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">سفارشات کاربر</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 items-end mb-4">
        <div className="sm:col-span-2 lg:col-span-2 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">جستجو (شناسه سفارش)</label>
          <input value={temp.search} onChange={handleSearch} placeholder="ord-..." className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary" />
        </div>
        <div className="sm:col-span-1 lg:col-span-1 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">فیلتر آدرس</label>
          <select value={temp.filterAddr} onChange={handleAddr} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="all">همه آدرس‌ها</option>
            <option value="null">تحویل حضوری</option>
            {addresses.map(a => <option key={a.id} value={a.id}>{a.address}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1 lg:col-span-1 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">مرتب‌سازی تاریخ</label>
          <select value={temp.sortDate} onChange={handleSortDate} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="newest">جدیدترین</option>
            <option value="oldest">قدیمی‌ترین</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-1 xl:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">مرتب‌سازی مبلغ</label>
          <select value={temp.sortAmount} onChange={handleSortAmount} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="none">بدون مرتب‌سازی</option>
            <option value="highest">بیشترین مبلغ</option>
            <option value="lowest">کمترین مبلغ</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <button onClick={handleApply} className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer">اعمال فیلتر</button>
        </div>
      </div>

      <div className="space-y-2">
        {current.map(o => (
          <Link key={o.id} to="/admin/orders/$orderId" params={{ orderId: o.id }} className="flex justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] hover:border-primary border border-transparent transition cursor-pointer">
            <span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">{o.id}</span>
            <span className="text-sm font-DanaDemiBold text-primary dark:text-dark-primary">{formatPrice(o.amount)} ت</span>
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          itemsPerPage={limit}
          totalItems={filtered.length}
          onPageChange={setPage}
          onItemsPerPageChange={(v) => { setLimit(v); setPage(1) }}
          pageSizeOptions={[5, 10]}
        />
      </div>
    </div>
  )
})