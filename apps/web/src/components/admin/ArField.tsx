// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 28 از 31
// مسیر مقصد: apps/web/src/components/admin/ArField.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/components/admin/ArField.tsx
//
// round-34 — فیلد محتوای عربی برای فرم‌های ادمین.
//
// سه وضعیتِ بج (تصمیم رارد ۳۴):
//  • «ندارد»  (zinc)   — ستون ar خالی است؛ کاربر عربی همان متن فارسی را می‌بیند
//  • «دستی»   (سبز)   — ادمین خودش عربی را نوشته/ویرایش کرده (arAuto=false)
//  • «خودکار» (کهربایی) — مترجم آفلاین رارد ۳۵ پرش کرده (arAuto=true)؛
//    اولین ویرایش دستی ادمین، ذخیره و بج را به «دستی» برمی‌گرداند
//
// عربی هم RTL است — dir="rtl" مثل فارسی؛ فونت/استایل همان زبان فرم ادمین.
//
// round-35 — دکمه‌ی چوب‌جادویی: پیشنهاد ماشینی از مترجم آفلاین (preview —
// بدون نوشتن DB). منبع = متن کامل فارسی (faSource) یا مرجع نمایشی؛ خروجی
// در فیلد قرار می‌گیرد تا ادمین بازبینی و ذخیره کند (ذخیره = بج «دستی»).

import { memo, useCallback, useId, useState } from 'react'
import { Loader, Wand2 } from 'reicon-react'
import { translatePreview } from '#/server/translation'
import { useToastStore } from '#/stores/toastStore'

export type ArBadge = 'none' | 'manual' | 'auto'

/** بج وضعیت ترجمه — از مقدار فعلی + پرچم رکورد محاسبه می‌شود */
export function arBadgeOf(value: string | null | undefined, arAuto?: boolean): ArBadge {
  const v = (value ?? '').trim()
  if (v === '') return 'none'
  return arAuto ? 'auto' : 'manual'
}

const BADGE_STYLES: Record<ArBadge, { label: string; cls: string }> = {
  none: {
    label: 'ندارد',
    cls: 'bg-zinc-100 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  },
  manual: {
    label: 'دستی',
    cls: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  auto: {
    label: 'خودکار',
    cls: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
}

interface ArFieldProps {
  /** برچسب فارسیِ فیلدِ اصلی — پسوند «(عربی)» خودش اضافه می‌شود */
  label: string
  value: string
  onChange: (value: string) => void
  /** پرچم رکورد — بج «خودکار» فقط با true */
  arAuto?: boolean
  /** textarea به‌جای input */
  multiline?: boolean
  rows?: number
  /** متن راهنمای داخل فیلد — پیش‌فرض: «خالی = نمایش همان متن فارسی» */
  placeholder?: string
  maxLength?: number
  /** نمایش متن فارسیِ مرجع زیر برچسب (برای ترجمه‌ی راحت‌تر) */
  faReference?: string
  /** round-35 — متن کامل فارسی برای ترجمه‌ی ماشینی (وقتی faReference کوتاه‌شده است) */
  faSource?: string
  disabled?: boolean
}

const inputCls =
  'w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-sm leading-7'

export const ArField = memo(function ArField({
  label,
  value,
  onChange,
  arAuto,
  multiline,
  rows = 3,
  placeholder = 'خالی = نمایش همان متن فارسی',
  maxLength,
  faReference,
  faSource,
  disabled,
}: ArFieldProps) {
  const badge = arBadgeOf(value, arAuto)
  const badgeStyle = BADGE_STYLES[badge]
  // a11y — label باید به کنترل وصل باشد (useId → یکتا حتی در چند نمونه)
  const fieldId = useId()
  const showToast = useToastStore((s) => s.showToast)

  // round-35 — وضعیت پیشنهاد ماشینی (فقط داخل همین فیلد)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [machineSuggested, setMachineSuggested] = useState(false)
  // منبع ترجمه: متن کامل اگر آمده، وگرنه مرجع نمایشی
  const translateSource = faSource ?? faReference
  const canSuggest = (translateSource ?? '').trim() !== ''

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setMachineSuggested(false) // ویرایش دستی → حالت «پیشنهاد ماشینی» پاک می‌شود
      onChange(e.target.value)
    },
    [onChange],
  )

  // round-35 — پیشنهاد ماشینی: پر کردن فیلد بدون ذخیره؛ بازبینی با ادمین
  const handlePreview = useCallback(async () => {
    const source = (translateSource ?? '').trim()
    if (source === '' || isPreviewing || disabled) return
    setIsPreviewing(true)
    try {
      const translations = await translatePreview([source])
      if (translations[0] !== undefined) {
        onChange(translations[0])
        setMachineSuggested(true)
        showToast('ترجمه‌ی پیشنهادی قرار گرفت — بازبینی و ذخیره کنید')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'خطای ترجمه', 'error')
    } finally {
      setIsPreviewing(false)
    }
  }, [translateSource, isPreviewing, disabled, onChange, showToast])

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <label htmlFor={fieldId} className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
          {label}{' '}
          <span className="text-primary dark:text-dark-primary font-DanaDemiBold">(عربی)</span>
        </label>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-DanaDemiBold ${badgeStyle.cls}`}
            title={
              badge === 'none'
                ? 'ترجمه‌ی عربی ثبت نشده — کاربر عربی متن فارسی می‌بیند'
                : badge === 'auto'
                  ? 'ترجمه‌ی ماشینی (رارد ۳۵) — با ویرایش و ذخیره، دستی می‌شود'
                  : 'ترجمه‌ی دستی ادمین'
            }
          >
            <span aria-hidden className="font-DanaDemiBold">ع</span>
            {badgeStyle.label}
          </span>
          {canSuggest && (
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={disabled || isPreviewing}
              title="ترجمه‌ی خودکار (پیشنهاد ماشینی — قبل از ذخیره بازبینی کنید)"
              aria-label="ترجمه‌ی خودکار (پیشنهاد ماشینی — قبل از ذخیره بازبینی کنید)"
              className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center hover:bg-amber-200 dark:hover:bg-amber-500/20 transition cursor-pointer disabled:opacity-50"
            >
              {isPreviewing ? (
                <Loader size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}
            </button>
          )}
        </div>
      </div>

      {faReference && faReference.trim() !== '' && (
        <p className="mb-2 text-xs text-gray-400 dark:text-gray-500 leading-5 wrap-break-word">
          فارسی: {faReference}
        </p>
      )}

      {multiline ? (
        <textarea
          id={fieldId}
          value={value}
          onChange={handleChange}
          rows={rows}
          dir="rtl"
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className={`${inputCls} resize-y`}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          value={value}
          onChange={handleChange}
          dir="rtl"
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className={inputCls}
        />
      )}

      {machineSuggested && (
        <p className="mt-2 text-xs text-amber-500 dark:text-amber-400 leading-5">
          پیشنهاد ماشینی — هنوز ذخیره نشده؛ بازبینی کنید
        </p>
      )}
    </div>
  )
})
