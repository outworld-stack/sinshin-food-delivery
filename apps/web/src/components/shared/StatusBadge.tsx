// src/components/shared/StatusBadge.tsx
import { memo } from 'react'

// منبع واحد وضعیت‌های سفارش — همه‌جا فقط از همین خونده شه
// نکته: «لغو» دیگه وجود نداره — تنها پایان ناموفق، «پرداخت ناموفق»ئه (تصمیم پرسش ۴)
export type OrderStatusKey =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'PAYMENT_FAILED'
  | 'CANCELED' // داده‌های موک — نمایشش همون «پرداخت ناموفق»ئه

interface StatusEntry {
  user: string
  admin: string
  color: string
}

export const ORDER_STATUS_CONFIG: Record<OrderStatusKey, StatusEntry> = {
  PENDING_PAYMENT: {
    user: 'در انتظار پرداخت',
    admin: 'در انتظار پرداخت',
    color: 'bg-gray-100 text-gray-600 dark:bg-gray-500/10 dark:text-gray-400',
  },
  PAID: {
    user: 'پرداخت شده',
    admin: 'در انتظار تایید',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  },
  CONFIRMED: {
    user: 'تایید شد',
    admin: 'تایید شده',
    color: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400',
  },
  ON_THE_WAY: {
    user: 'در مسیر',
    admin: 'در مسیر',
    color: 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
  },
  DELIVERED: {
    user: 'تحویل شد',
    admin: 'تحویل شده',
    color: 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  },
  PAYMENT_FAILED: {
    user: 'پرداخت ناموفق',
    admin: 'پرداخت ناموفق',
    color: 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  },
  CANCELED: {
    user: 'پرداخت ناموفق',
    admin: 'پرداخت ناموفق',
    color: 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  },
}

interface StatusBadgeProps {
  status: string
  perspective?: 'user' | 'admin'
  size?: 'sm' | 'md'
}

export const StatusBadge = memo(function StatusBadge({
  status,
  perspective = 'user',
  size = 'md',
}: StatusBadgeProps) {
  const entry = ORDER_STATUS_CONFIG[status as OrderStatusKey]
  // وضعیت ناشناخته → خنثی؛ دیگه وانمودِ «پرداخت شده» نمی‌شه
  const label = entry ? entry[perspective] : 'نامشخص'
  const color = entry?.color ?? 'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-500'

  const sizeCls = size === 'sm'
    ? 'text-[10px] font-DanaDemiBold px-2 py-0.5'
    : 'text-xs font-DanaDemiBold px-2 py-1'

  return <span className={`rounded-full ${sizeCls} ${color}`}>{label}</span>
})