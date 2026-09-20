// src/components/admin/users/UserEditForm.tsx
import { memo, useCallback } from 'react'

interface UserEditFormProps {
  state: {
    firstName: string
    lastName: string
    email: string
    phone: string
    referralCode: string
    isPhoneEditable: boolean
    isReferralEditable: boolean
  }
  onFieldChange: (field: 'firstName' | 'lastName' | 'email' | 'referralCode', value: string) => void
  onPhoneChange: (raw: string) => void
  onRequestUnlockPhone: () => void
  onRequestUnlockReferral: () => void
  onSubmit: () => void
}

// فرم ویرایش کاربر — موبایل/کد معرف قفل با کانفرم unlock (بیرون از فرم)
export const UserEditForm = memo(function UserEditForm({
  state,
  onFieldChange, onPhoneChange,
  onRequestUnlockPhone, onRequestUnlockReferral,
  onSubmit,
}: UserEditFormProps) {
  const handleFirst = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('firstName', e.target.value), [onFieldChange])
  const handleLast = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('lastName', e.target.value), [onFieldChange])
  const handleEmail = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('email', e.target.value), [onFieldChange])
  const handleReferral = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('referralCode', e.target.value), [onFieldChange])
  const handlePhoneInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onPhoneChange(e.target.value), [onPhoneChange])
  const handleSubmit = useCallback((e: React.FormEvent) => { e.preventDefault(); onSubmit() }, [onSubmit])

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white'
  const labelCls = 'block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={labelCls}>نام</label>
          <input type="text" value={state.firstName} onChange={handleFirst} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>نام خانوادگی</label>
          <input type="text" value={state.lastName} onChange={handleLast} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>ایمیل</label>
        <input type="email" value={state.email} onChange={handleEmail} dir="ltr" className={inputCls} />
      </div>

      {/* موبایل — قفل با کانفرم */}
      <div onClick={() => !state.isPhoneEditable && onRequestUnlockPhone()} className={!state.isPhoneEditable ? 'cursor-pointer' : ''}>
        <label className={labelCls}>
          شماره موبایل
          {!state.isPhoneEditable && <span className="text-xs text-red-400 mr-1">(برای ویرایش کلیک کنید)</span>}
        </label>
        <input
          type="tel"
          value={state.phone}
          onChange={handlePhoneInput}
          disabled={!state.isPhoneEditable}
          dir="ltr"
          maxLength={11}
          className={`${inputCls} ${!state.isPhoneEditable ? 'cursor-pointer opacity-70' : ''}`}
        />
      </div>

      {/* کد معرف — قفل با کانفرم */}
      <div onClick={() => !state.isReferralEditable && onRequestUnlockReferral()} className={!state.isReferralEditable ? 'cursor-pointer' : ''}>
        <label className={labelCls}>
          کد معرف (یونیک)
          {!state.isReferralEditable && <span className="text-xs text-red-400 mr-1">(برای ویرایش کلیک کنید)</span>}
        </label>
        <input
          type="text"
          value={state.referralCode}
          onChange={handleReferral}
          disabled={!state.isReferralEditable}
          dir="ltr"
          className={`${inputCls} ${!state.isReferralEditable ? 'cursor-pointer opacity-70' : ''}`}
        />
      </div>
    </form>
  )
})