// src/components/admin/admins/PermissionsEditor.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateSubAdminPermissions, type SubAdminPermissions, type SubAdminRecord } from '#/server/admin'
import { qk } from '#/utils/queryKeys'
import { Toggle } from '#/components/shared/Toggle'
import { useToastStore } from '#/stores/toastStore'
import { Shield } from 'reicon-react'
import type { SubAdminPermissionsDto } from '@sinshin/shared'

interface PermissionsEditorProps {
  admin: SubAdminRecord
}

// لیبل‌ها — ثابت بیرون کامپوننت
// فقط PERMISSION_LABELS — دو تا جدید (بقیه فایل بدون تغییر):
const PERMISSION_LABELS: { key: keyof SubAdminPermissions; label: string }[] = [
  { key: 'productsRead', label: 'مشاهده محصولات' },
  { key: 'productsWrite', label: 'افزودن/ویرایش محصولات' },
  { key: 'usersRead', label: 'مشاهده کاربران' },
  { key: 'usersWrite', label: 'ویرایش کاربران' },
  { key: 'couriersRead', label: 'مشاهده پیک‌ها' },
  { key: 'couriersWrite', label: 'افزودن پیک' },
  { key: 'mainCategoriesRead', label: 'مشاهده دسته‌های اصلی' },
  { key: 'mainCategoriesWrite', label: 'مدیریت دسته‌های اصلی' },
  { key: 'orderDetailsRead', label: 'مشاهده ریز فاکتور سفارش' },
]
// ویرایش دسترسی‌های ادمین۲ — توسط ادمین اصلی
export const PermissionsEditor = memo(function PermissionsEditor({ admin }: PermissionsEditorProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const [perms, setPerms] = useState<SubAdminPermissions>(admin.permissions)

  const mutation = useMutation({
    mutationFn: (data: { id: string; permissions: SubAdminPermissions }) =>
      updateSubAdminPermissions(data as { id: string; permissions: Partial<SubAdminPermissionsDto> & Record<string, boolean> }),

    onSuccess: () => {
      // ⬅ NEW: کلیدها از فکتوری مرکزی —
      // پریفکس: هر صفحه‌ی جزئیات ادمین۲ که باز است رفرش می‌شود
      queryClient.invalidateQueries({ queryKey: qk.subAdminDetailsAll })
      // لیست ادمین‌ها (خلاصه‌ی دسترسی‌ها ممکنه نمایش داده شه)
      queryClient.invalidateQueries({ queryKey: qk.subAdmins })
      // سشن سایدبار ادمین۲ هم ریفرش شه — دسترسی فوری اعمال می‌شه
      queryClient.invalidateQueries({ queryKey: qk.admin2Session })
      showToast('دسترسی‌ها ذخیره شد')
    },
  })

  const handleToggle = useCallback((key: keyof SubAdminPermissions) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSave = useCallback(() => {
    mutation.mutate({ id: admin.userId, permissions: perms })
  }, [admin.userId, perms, mutation])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
        <Shield size={20} className="text-primary dark:text-dark-primary" />
        دسترسی‌ها
      </h2>
      <p className="text-xs text-gray-400 font-DanaMedium mb-6">
        دسترسی‌های این ادمین سطح ۲ — تغییرات فوراً پس از ذخیره اعمال می‌شوند
      </p>
      <div className="space-y-3">
        {PERMISSION_LABELS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e]">
            <span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">{label}</span>
            <Toggle isOn={perms[key] ?? false} onToggle={() => handleToggle(key)} />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={mutation.isPending}
        className="mt-6 w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
      >
        {mutation.isPending ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
      </button>
    </div>
  )
})