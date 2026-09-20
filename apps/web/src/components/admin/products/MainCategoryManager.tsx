// src/components/admin/products/MainCategoryManager.tsx
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createMainCategory,
  toggleMainCategory,
  reorderMainCategory,
  deleteMainCategory,
  setDefaultMainCategory,
} from '#/server/products'
import { adminMainCategoriesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { ConfirmModal } from '#/components/ConfirmModal'
import { useToastStore } from '#/stores/toastStore'
import { Toggle } from '#/components/shared/Toggle'
import { Can } from '#/components/shared/PermissionGate'
import { Plus, ChevronUp, ChevronDown, Trash2, X, Star } from 'reicon-react'

// --- مودال ساخت (بدون تغییر) ---
const AddMainModal = memo(function AddMainModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (data: { name: string; slug: string }) => createMainCategory({ data }),
    onSuccess: (res) => {
      if (!res.success) { setError(res.message ?? 'خطا'); return }
      queryClient.invalidateQueries({ queryKey: qk.adminMainCategories })
      queryClient.invalidateQueries({ queryKey: qk.activeMainCategories })
      showToast('دسته اصلی ساخته شد — برای نمایش فعالش کنید')
      onClose()
    },
  })

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('نام الزامی است'); return }
    if (!slug.trim()) { setError('slug الزامی است (مثلا: restaurant)'); return }
    setError('')
    mutation.mutate({ name: name.trim(), slug: slug.trim() })
  }, [name, slug, mutation])

  const handleSlug = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }, [])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">دسته اصلی جدید</h3>
          <button type="button" onClick={onClose} className="text-gray-500 cursor-pointer p-1">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">نام (فارسی)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
              placeholder="مثلاً: کافه"
            />
          </div>
          <div>
            <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">slug (انگلیسی — برای URL)</label>
            <input
              type="text"
              value={slug}
              onChange={handleSlug}
              dir="ltr"
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-center"
              placeholder="cafe"
            />
            <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium">
              این کد در آدرس صفحه می‌آید: /products?tab=cafe
            </p>
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer">انصراف</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              <Plus size={16} />
              {mutation.isPending ? 'در حال ساخت...' : 'ساخت'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})

// --- مدیر Main — canWrite از بیرون ---
interface MainCategoryManagerProps {
  canWrite: boolean   // ⬅️ mainCategoriesWrite از permissions
}

export const MainCategoryManager = memo(function MainCategoryManager({ canWrite }: MainCategoryManagerProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // دسته‌های اصلی از فکتوری مشترک — همون کش فرم دسته‌بندی
  const { data: mains, isLoading } = useQuery(adminMainCategoriesOptions)

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.adminMainCategories })
    queryClient.invalidateQueries({ queryKey: qk.activeMainCategories })
    // لیست محصولات همه‌ی تب‌ها وابسته به دسته‌های فعاله — همه رفرش می‌شن
    queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
  }, [queryClient])

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleMainCategory({ data: { id } }),
    onSuccess: () => { invalidateAll(); showToast('وضعیت تغییر کرد') },
  })

  const defaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultMainCategory({ data: { id } }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidateAll()
      showToast('پیش‌فرض تغییر کرد')
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (data: { id: string; direction: 'up' | 'down' }) => reorderMainCategory({ data }),
    onSuccess: () => invalidateAll(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMainCategory({ data: { id } }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidateAll()
      showToast('حذف شد')
      setConfirmDelete(null)
    },
  })

  const handleOpenAdd = useCallback(() => setIsAddOpen(true), [])
  const handleCloseAdd = useCallback(() => setIsAddOpen(false), [])
  const handleToggle = useCallback((id: string) => toggleMutation.mutate(id), [toggleMutation])
  const handleSetDefault = useCallback((id: string) => defaultMutation.mutate(id), [defaultMutation])
  const handleUp = useCallback((id: string) => reorderMutation.mutate({ id, direction: 'up' }), [reorderMutation])
  const handleDown = useCallback((id: string) => reorderMutation.mutate({ id, direction: 'down' }), [reorderMutation])
  const handleDelete = useCallback((id: string) => setConfirmDelete(id), [])

  const sorted = [...(mains ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="w-full bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm h-fit">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">دسته‌های اصلی</h2>
        {/* افزودن — فقط write */}
        <Can allowed={canWrite}>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="px-3 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaMedium cursor-pointer flex items-center gap-1.5"
          >
            <Plus size={14} />
            افزودن
          </button>
        </Can>
      </div>
      <p className="text-xs text-gray-400 mb-6 font-DanaMedium">
        دسته‌های سطح بالای سایت — فعال = نمایش در سایت | ★ پیش‌فرض = اولین چیزی که کاربر می‌بیند
        {!canWrite && ' (شما فقط دسترسی مشاهده دارید)'}
      </p>

      {isLoading ? (
        <div className="text-center py-8 text-gray-400 font-DanaMedium text-sm">در حال بارگذاری...</div>
      ) : sorted.length > 0 ? (
        <div className="space-y-3">
          {sorted.map((mc, i) => (
            <div key={mc.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                {/* ترتیب — فقط write */}
                <Can allowed={canWrite}>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleUp(mc.id)}
                      disabled={i === 0}
                      className="p-1 text-gray-400 hover:text-primary disabled:opacity-20 cursor-pointer"
                      title="بالا"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDown(mc.id)}
                      disabled={i === sorted.length - 1}
                      className="p-1 text-gray-400 hover:text-primary disabled:opacity-20 cursor-pointer"
                      title="پایین"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </Can>

                <div>
                  <p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white flex items-center gap-2">
                    {mc.isDefault && <Star size={14} className="text-yellow-400" fill="currentColor" />}
                    {mc.name}
                    <span className="text-[10px] text-gray-400 font-DanaMedium" dir="ltr">/{mc.slug}</span>
                  </p>
                  <p className={`text-[10px] mt-0.5 font-DanaMedium ${mc.isActive ? 'text-green-500' : 'text-gray-400'}`}>
                    {mc.isDefault ? 'پیش‌فرض کاربران' : mc.isActive ? 'فعال — نمایش در سایت' : 'غیرفعال — پنهان'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* همه اکشن‌ها — فقط write */}
                <Can allowed={canWrite}>
                  <button
                    type="button"
                    onClick={() => handleSetDefault(mc.id)}
                    disabled={mc.isDefault || !mc.isActive}
                    className={`text-[10px] font-DanaDemiBold px-2.5 py-1 rounded-full transition cursor-pointer ${
                      mc.isDefault
                        ? 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                        : 'bg-gray-100 dark:bg-[#2a1015] text-gray-400 hover:text-yellow-500 disabled:opacity-30 disabled:cursor-not-allowed'
                    }`}
                    title={mc.isDefault ? 'پیش‌فرض فعلی' : mc.isActive ? 'پیش‌فرض این شود' : 'ابتدا فعال کنید'}
                  >
                    {mc.isDefault ? '★ پیش‌فرض' : '★ پیش‌فرض کن'}
                  </button>

                  <Toggle isOn={mc.isActive} onToggle={() => handleToggle(mc.id)} />

                  <button
                    type="button"
                    onClick={() => handleDelete(mc.id)}
                    className="p-1.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"
                    title="حذف"
                  >
                    <Trash2 size={16} />
                  </button>
                </Can>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400 font-DanaMedium text-sm">
          دسته اصلی‌ای ثبت نشده
        </div>
      )}

      {/* مودال ساخت — فقط write */}
      {canWrite && isAddOpen && <AddMainModal onClose={handleCloseAdd} />}

      <ConfirmModal
        isOpen={!!confirmDelete}
        title="حذف دسته اصلی"
        message="آیا از حذف این دسته اصلی مطمئن هستید؟ (دسته‌های زیرمجموعه باید خالی باشند)"
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
})