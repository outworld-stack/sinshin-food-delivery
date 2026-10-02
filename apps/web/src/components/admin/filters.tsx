// src/components/admin/filters.ts
// اجزای مشترک جعبه‌های فیلتر ادمین — منبع واحد رارد ۴۸ (اسکن B10+B15).
// کلاس‌های فیلد، گزینه‌های مرتب‌سازی و دکمه‌ی بازکردن مودال موبایل قبلاً
// در ۵+ فایل کپی می‌شدند و CouriersFilterBox حتی دریفت هم کرده بود.

import { memo } from 'react'
import { SliderHorizontal } from 'reicon-react'

import { ORDER_STATUS_CONFIG } from '#/components/shared/StatusBadge'

/** کلاس فیلد ورودی فیلترها — یکسان در همه‌ی جعبه‌ها */
export const FILTER_INPUT_CLS =
  'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary'

/** کلاس برچسب فیلد */
export const FILTER_LABEL_CLS =
  'block text-xs text-gray-400 dark:text-gray-500 mb-1 font-DanaMedium'

/** گزینه‌های مرتب‌سازی تاریخ */
export const DATE_SORT_OPTIONS = [
  { value: 'newest', label: 'جدیدترین' },
  { value: 'oldest', label: 'قدیمی‌ترین' },
] as const

/** گزینه‌های مرتب‌سازی مبلغ */
export const AMOUNT_SORT_OPTIONS = [
  { value: 'none', label: 'بدون مرتب‌سازی' },
  { value: 'highest', label: 'بیشترین' },
  { value: 'lowest', label: 'کمترین' },
] as const

/**
 * گزینه‌های وضعیت سفارش در فیلترها — از همان پیکربندی بج وضعیت
 * (منبع واحد برچسب‌ها) با چشم‌انداز ادمین؛ PENDING_PAYMENT عمداً کنار
 * است (سفارش پرداخت‌نشده در فیلتر ادمین معنا ندارد — همان قبل).
 * نکته‌ی رارد ۴۸: برچسب PAID حالا «در انتظار تایید» است (برچسب ادمین) —
 * قبلاً dropdown «پرداخت شده» می‌گفت ولی بجِ همان ردیف «در انتظار تایید»؛
 * یکسان‌سازی dropdown با بج کنارش.
 */
export const ORDER_STATUS_FILTER_OPTIONS = (
  Object.entries(ORDER_STATUS_CONFIG) as Array<
    [keyof typeof ORDER_STATUS_CONFIG, (typeof ORDER_STATUS_CONFIG)[keyof typeof ORDER_STATUS_CONFIG]]
  >
)
  .filter(([key]) => key !== 'PENDING_PAYMENT')
  .map(([key, cfg]) => ({ value: key as string, label: cfg.admin }))

interface MobileFilterTriggerProps {
  label: string
  onClick: () => void
  /** کلاس والد — مثلاً 'sm:hidden mb-4' یا 'md:hidden' */
  wrapperCls?: string
}

/** دکمه‌ی بازکردن مودال فیلتر در موبایل — همان دکمه‌ای که ۴ بار کپی شده بود */
export const MobileFilterTrigger = memo(function MobileFilterTrigger({
  label,
  onClick,
  wrapperCls = 'md:hidden',
}: MobileFilterTriggerProps) {
  return (
    <div className={wrapperCls}>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-white dark:bg-[#2a1015] text-gray-800 dark:text-white font-DanaMedium border border-gray-200 dark:border-[#3a151c] shadow-sm cursor-pointer"
      >
        <span>{label}</span>
        <SliderHorizontal size={24} />
      </button>
    </div>
  )
})