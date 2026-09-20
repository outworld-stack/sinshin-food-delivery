// src/components/admin/couriers/AddCourierModal.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addCourier } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { Plus, X } from 'reicon-react'

interface AddCourierModalProps {
  onClose: () => void
}

interface AddCourierForm {
  name: string
  phone: string
  error: string
}

const EMPTY_FORM: AddCourierForm = { name: '', phone: '', error: '' }

// مودال افزودن پیک — فقط با دسترسی couriersWrite رندر می‌شه (گارد بیرونه)
export const AddCourierModal = memo(function AddCourierModal({ onClose }: AddCourierModalProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [form, setForm] = useState<AddCourierForm>(EMPTY_FORM)
  const set = useCallback((partial: Partial<AddCourierForm>) => {
    setForm(f => ({ ...f, ...partial }))
  }, [])

  const mutation = useMutation({
    mutationFn: (data: { name: string; phone: string }) => addCourier(data),
    onSuccess: () => {
      // ⬅ فکتوری مرکزی به‌جای رشته‌ی خام — قانون طلایی queryKeys.ts
      queryClient.invalidateQueries({ queryKey: qk.adminCouriersAll })
      showToast('پیک جدید اضافه شد')
      onClose()
    },
  })

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    set({ phone: e.target.value.replace(/[^0-9]/g, '') })
  }, [set])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { set({ error: 'نام الزامی است' }); return }
    if (!/^09[0-9]{9}$/.test(form.phone)) { set({ error: 'شماره معتبر نیست (09xxxxxxxxx)' }); return }
    set({ error: '' })
    mutation.mutate({ name: form.name.trim(), phone: form.phone })
  }, [form, set, mutation])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">افزودن پیک</h3>
          <button type="button" onClick={onClose} className="text-gray-500 cursor-pointer p-1">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
            placeholder="نام پیک"
          />
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
          {form.error && <p className="text-red-500 text-sm text-center">{form.error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer">انصراف</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              <Plus size={16} />
              {mutation.isPending ? 'در حال ثبت...' : 'افزودن'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})