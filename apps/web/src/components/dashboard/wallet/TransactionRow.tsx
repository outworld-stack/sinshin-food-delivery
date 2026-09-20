// src/components/dashboard/wallet/TransactionRow.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp } from 'reicon-react'
import { formatPrice, formatDate } from '#/utils/format'
import type { TransactionRowData } from '#/types/dashboard/wallet'

interface TransactionRowProps {
  tx: TransactionRowData
}

export const TransactionRow = memo(function TransactionRow({ tx }: TransactionRowProps) {
  const isDeposit = tx.type === 'DEPOSIT'

  // محتوا — تراکنش سفارش‌دار → لینک به سفارش
  const content = (
    <>
      <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
        isDeposit
          ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
          : 'bg-red-100 dark:bg-red-500/10 text-red-500'
      }`}>
        {isDeposit ? <ArrowDown size={20} /> : <ArrowUp size={20} />}
      </span>
      <div>
        <p className="font-DanaMedium text-gray-800 dark:text-white text-sm">{tx.description}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(tx.date)}</p>
      </div>
    </>
  )

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 ${
      tx.orderId ? 'hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer' : ''
    }`}>
      {tx.orderId ? (
        <Link to="/dashboard/orders/$orderId" params={{ orderId: tx.orderId }} className="flex items-center gap-3 flex-1">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3 flex-1">{content}</div>
      )}

      <span className={`font-DanaDemiBold ${isDeposit ? 'text-green-500' : 'text-red-500'}`}>
        {isDeposit ? '+ ' : '- '}{formatPrice(tx.amount)} ت
      </span>
    </div>
  )
})