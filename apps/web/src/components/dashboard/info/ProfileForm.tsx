// src/components/dashboard/info/ProfileForm.tsx
import { memo, useCallback } from 'react'

interface ProfileFormProps {
  phone: string
  state: { firstName: string; lastName: string; email: string }
  isPending: boolean
  onFieldChange: (field: 'firstName' | 'lastName' | 'email', value: string) => void
  onSubmit: () => void
}

export const ProfileForm = memo(function ProfileForm({
  phone, state, isPending, onFieldChange, onSubmit,
}: ProfileFormProps) {
  const handleFirst = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('firstName', e.target.value), [onFieldChange])
  const handleLast = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('lastName', e.target.value), [onFieldChange])
  const handleEmail = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('email', e.target.value), [onFieldChange])
  const handleSubmit = useCallback((e: React.FormEvent) => { e.preventDefault(); onSubmit() }, [onSubmit])

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary dark:focus:border-dark-primary outline-none transition text-gray-800 dark:text-white'
  const labelCls = 'block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2'

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-6"
    >
      {/* موبایل — قفل (تغییرپذیر نیست) */}
      <div>
        <label className={labelCls}>شماره موبایل</label>
        <input type="tel" value={phone} disabled className="w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-gray-500 dark:text-gray-500 cursor-not-allowed outline-none" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={labelCls}>نام</label>
          <input type="text" value={state.firstName} onChange={handleFirst} className={inputCls} placeholder="مثال: علی" />
        </div>
        <div>
          <label className={labelCls}>نام خانوادگی</label>
          <input type="text" value={state.lastName} onChange={handleLast} className={inputCls} placeholder="مثال: رضایی" />
        </div>
      </div>

      <div>
        <label className={labelCls}>ایمیل</label>
        <input type="email" value={state.email} onChange={handleEmail} className={inputCls} placeholder="example@email.com" dir="ltr" />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition shadow-sm disabled:opacity-50 cursor-pointer"
      >
        {isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
      </button>
    </form>
  )
})