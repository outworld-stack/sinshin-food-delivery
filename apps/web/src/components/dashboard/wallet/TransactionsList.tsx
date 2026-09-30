// src/components/dashboard/wallet/TransactionsList.tsx
import { memo, useCallback } from 'react'
import { Pagination } from '#/components/Pagination'
import { TransactionRow } from './TransactionRow'
import { useI18n } from '#/i18n'
import type { TransactionRowData, TransactionSort } from '#/types/dashboard/wallet'

const SORT_KEYS = ['newest', 'oldest', 'highest', 'lowest', 'income', 'expense'] as const

interface TransactionsListProps {
  transactions: TransactionRowData[]
  currentSort: TransactionSort
  currentPage: number
  totalPages: number
  itemsPerPage: number
  onSortChange: (sort: TransactionSort) => void
  onPageChange: (page: number) => void
  onItemsPerPageChange: (limit: number) => void
}

export const TransactionsList = memo(function TransactionsList({
  transactions, currentSort, currentPage, totalPages, itemsPerPage,
  onSortChange, onPageChange, onItemsPerPageChange,
}: TransactionsListProps) {
  const { t } = useI18n()
  // رارد ۳۳ — لیبل سورت از دیکشنری؛ کلیدها ثابت‌اند (مرتب‌سازی منطق کلاینت است)
  const SORT_LABELS: Record<TransactionSort, string> = {
    newest: t['dash.wallet.sort.newest'],
    oldest: t['dash.wallet.sort.oldest'],
    highest: t['dash.wallet.sort.highest'],
    lowest: t['dash.wallet.sort.lowest'],
    income: t['dash.wallet.sort.income'],
    expense: t['dash.wallet.sort.expense'],
  }
  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onSortChange(e.target.value as TransactionSort)
  }, [onSortChange])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-white/5 gap-4">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">{t['dash.wallet.recentTxs']}</h2>
        <select
          value={currentSort}
          onChange={handleSortChange}
          className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none cursor-pointer"
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>{SORT_LABELS[key]}</option>
          ))}
        </select>
      </div>

      {transactions.length > 0 ? (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300">
          <p className="text-sm text-gray-400 font-DanaMedium">{t['dash.wallet.noTxs']}</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            totalItems={transactions.length}
            onPageChange={onPageChange}
            onItemsPerPageChange={onItemsPerPageChange}
            pageSizeOptions={[5, 10]}
          />
        </div>
      )}
    </div>
  )
})