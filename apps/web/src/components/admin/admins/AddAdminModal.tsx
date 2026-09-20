// src/components/admin/admins/AddAdminModal.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addSubAdmin } from '#/server/admin'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { Plus } from 'reicon-react'

interface AddAdminModalProps {
  onClose: () => void
}

// فرم واحد به‌جای ۴ استیت پراکنده
interface AddAdminForm {
  firstName: string
  lastName: string
  phone: string
  error: string
}

const EMPTY_FORM: AddAdminForm = { firstName: '', lastName: '', phone: '', error: '' }

export const AddAdminModal = memo(function AddAdminModal({ onClose }: AddAdminModalProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [form, setForm] = useState<AddAdminForm>(EMPTY_FORM)
  const set = useCallback((partial: Partial<AddAdminForm>) => {
    setForm(f => ({ ...f, ...partial }))
  }, [])

  const mutation = useMutation({
    mutationFn: (data: { phone: string; firstName: string; lastName: string }) => addSubAdmin(data),
    onSuccess: (res) => {
      if (!res.success) {
        set({ error: res.message ?? 'خطا' })
        return
      }
      // ⬅ NEW: کلید از فکتوری مرکزی — هم‌hash با کوئری صفحه‌ی ادمین‌ها
      queryClient.invalidateQueries({ queryKey: qk.subAdmins })
      showToast('ادمین سطح ۲ جدید اضافه شد')
      onClose()
    },
  })

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    set({ phone: e.target.value.replace(/[^0-9]/g, '') })
  }, [set])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName.trim()) { set({ error: 'نام الزامی است' }); return }
    if (!form.lastName.trim()) { set({ error: 'نام خانوادگی الزامی است' }); return }
    if (!/^09[0-9]{9}$/.test(form.phone)) { set({ error: 'فرمت شماره صحیح نیست (09xxxxxxxxx)' }); return }
    set({ error: '' })
    mutation.mutate({ phone: form.phone, firstName: form.firstName.trim(), lastName: form.lastName.trim() })
  }, [form, set, mutation])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
        <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">افزودن ادمین سطح ۲</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">نام</label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
                placeholder="مثلاً: نریمان"
              />
            </div>
            <div>
              <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">نام خانوادگی</label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
                placeholder="مثلاً: احمدی"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">شماره موبایل</label>
            <input
              type="tel"
              inputMode="numeric"
              dir="ltr"
              value={form.phone}
              onChange={handlePhoneChange}
              maxLength={11}
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-center"
              placeholder="09xxxxxxxxx"
            />
          </div>
          {form.error && <p className="text-red-500 text-sm text-center">{form.error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer">انصراف</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              <Plus size={16} />
              {mutation.isPending ? 'در حال ثبت...' : 'ثبت دسترسی'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})