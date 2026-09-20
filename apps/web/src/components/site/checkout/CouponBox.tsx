// src/components/site/checkout/CouponBox.tsx
import { memo, useCallback } from 'react'
import type { CouponStatus } from '#/types/site/checkout'

interface CouponBoxProps {
  status: CouponStatus
  code: string
  applied: boolean
  onStatusChange: (s: CouponStatus) => void
  onCodeChange: (raw: string) => void
  onApply: () => void
}

export const CouponBox = memo(function CouponBox({ status, code, applied, onStatusChange, onCodeChange, onApply }: CouponBoxProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onCodeChange(e.target.value) // پاک‌سازی داخل هوک انجام می‌شه
  }, [onCodeChange])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">کد تخفیف</h2>
      <div className="flex items-center gap-6 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="coupon" checked={status === 'NONE'} onChange={() => onStatusChange('NONE')} className="w-4 h-4 accent-primary dark:accent-dark-primary" />
          <span className="font-DanaMedium text-gray-600 dark:text-gray-300">ندارم</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="coupon" checked={status === 'HAVE'} onChange={() => onStatusChange('HAVE')} className="w-4 h-4 accent-primary dark:accent-dark-primary" />
          <span className="font-DanaMedium text-gray-600 dark:text-gray-300">دارم</span>
        </label>
      </div>

      {status === 'HAVE' && (
        <div className="flex gap-3">
          <input
            type="text"
            value={code}
            onChange={handleChange}
            disabled={applied}
            maxLength={20}
            className="flex-1 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white font-DanaMedium disabled:opacity-50"
            placeholder="کد تخفیف (مثال: SINSHIN20)"
          />
          <button
            type="button"
            onClick={onApply}
            disabled={applied}
            className="px-6 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaDemiBold border border-primary dark:border-dark-primary hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applied ? 'اعمال شد' : 'اعمال کد'}
          </button>
        </div>
      )}
    </div>
  )
})