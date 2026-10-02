// ═══════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 5 از 14
// مسیر مقصد: apps/web/src/components/shared/StatusBadge.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════

// src/components/shared/StatusBadge.tsx
import type { OrderStatus } from '@sinshin/shared'
import { memo } from 'react'
import { useI18nSafe } from '#/i18n'

// منبع واحد وضعیت‌های سفارش — شش مقدارِ دیتابیس، مستقیم از قرارداد مشترک.
// «لغو» تنها پایان ناموفق است و برچسب نمایشی‌اش «پرداخت ناموفق» می‌ماند
// (تصمیم پرسش ۴). رارد ۴۳ — مقدار ساختگی‌ای که در دیتابیس وجود نداشت
// حذف شد؛ شکست پرداخت از راه کلید «لغو» به همین برچسب می‌رسد.
export type OrderStatusKey = OrderStatus

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
  const { lang, t } = useI18nSafe()
  const entry = ORDER_STATUS_CONFIG[status as OrderStatusKey]
  // وضعیت ناشناخته → خنثی؛ دیگه وانمودِ «پرداخت شده» نمی‌شه
  let label = entry ? entry[perspective] : 'نامشخص'
  const color = entry?.color ?? 'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-500'

  // رارد ۳۳ — دیدِ مشتری در حالت عربی: دیکشنری. بقیه‌ی حالت‌ها (ادمین/پیک —
  // بدون Provider، یا دید ادمین) همان فارسی‌ی قبل را می‌بینند؛ پنل ادمین
  // Provider ندارد و useI18nSafe فارسی برمی‌گرداند → رفتار صفر-تغییر.
  if (lang === 'ar' && perspective === 'user') {
    const AR_USER: Record<OrderStatusKey, string> = {
      PENDING_PAYMENT: t['status.PENDING_PAYMENT'],
      PAID: t['status.PAID'],
      CONFIRMED: t['status.CONFIRMED'],
      ON_THE_WAY: t['status.ON_THE_WAY'],
      DELIVERED: t['status.DELIVERED'],
      CANCELED: t['status.PAYMENT_FAILED'], // «لغو» → برچسب عربیِ «فشل الدفع» (تصمیم پرسش ۴)
    }
    label = AR_USER[status as OrderStatusKey] ?? t['status.unknown']
  }

  const sizeCls = size === 'sm'
    ? 'text-[10px] font-DanaDemiBold px-2 py-0.5'
    : 'text-xs font-DanaDemiBold px-2 py-1'

  return <span className={`rounded-full ${sizeCls} ${color}`}>{label}</span>
})