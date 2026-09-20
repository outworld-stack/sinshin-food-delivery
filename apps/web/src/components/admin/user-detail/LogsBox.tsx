// src/components/admin/user-detail/LogsBox.tsx
import { memo, useState, useCallback, useMemo } from 'react'
import { Pagination } from '#/components/Pagination'
import { formatDate } from '#/utils/format'
import { useAppliedFilters } from '#/hooks/shared/useAppliedFilters'
import type { AdminUserDetails } from '#/server/admin'

type LogRow = AdminUserDetails['logs'][number]

// مقادیر اولیه — بیرون کامپوننت (هویت پایدار)
const DEFAULT_FILTERS = { type: 'all', sortBy: 'newest' as 'newest' | 'oldest' }

interface LogsBoxProps {
  logs: LogRow[]
}

export const LogsBox = memo(function LogsBox({ logs }: LogsBoxProps) {
  const { temp, applied, setField, apply } = useAppliedFilters(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(5)

  const handleType = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('type', e.target.value)
  }, [setField])

  const handleSort = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setField('sortBy', e.target.value as 'newest' | 'oldest')
  }, [setField])

  const handleApply = useCallback(() => {
    apply()
    setPage(1)
  }, [apply])

  const filtered = useMemo(() => {
    let res = logs.filter(l => applied.type === 'all' || l.type === applied.type)
    if (applied.sortBy === 'newest') res = [...res].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    if (applied.sortBy === 'oldest') res = [...res].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return res
  }, [logs, applied])

  const totalPages = Math.ceil(filtered.length / limit)
  const safePage = Math.min(page, totalPages || 1)
  const current = filtered.slice((safePage - 1) * limit, safePage * limit)

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">تاریخچه تغییرات</h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-6">
        <div className="sm:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">نوع تغییرات</label>
          <select value={temp.type} onChange={handleType} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="all">همه تغییرات</option>
            <option value="NAME">تغییر نام</option>
            <option value="EMAIL">تغییر ایمیل</option>
            <option value="PHONE">تغییر موبایل</option>
            <option value="STATUS">تغییر وضعیت</option>
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium">مرتب‌سازی</label>
          <select value={temp.sortBy} onChange={handleSort} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer">
            <option value="newest">جدیدترین</option>
            <option value="oldest">قدیمی‌ترین</option>
          </select>
        </div>
        <div className="sm:col-span-1">
          <button onClick={handleApply} className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer">اعمال فیلتر</button>
        </div>
      </div>

      <div className="space-y-4">
        {current.map(log => (
          <div key={log.id} className="flex gap-3">
            <div className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary mt-1.5"></div>
            <div>
              <p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">{log.action}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatDate(log.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-6">
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
      )}
    </div>
  )
})