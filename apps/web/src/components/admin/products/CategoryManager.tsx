// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 32 از 49
// مسیر مقصد: apps/web/src/components/admin/products/CategoryManager.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/components/admin/products/CategoryManager.tsx
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createCategory, updateCategory, deleteCategory, type Category } from '#/server/products'
import { adminMainCategoriesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { ConfirmModal } from '#/components/ConfirmModal'
import { ArField } from '#/components/admin/ArField'
import { Toggle } from '#/components/shared/Toggle'
import { Pen, Trash2, X } from 'reicon-react'

// فرم واحد به‌جای ۸ استیت پراکنده
interface CategoryFormState {
  isModalOpen: boolean
  editingId: string | null
  name: string
  /** round-34 — نام عربی دسته */
  nameAr: string
  mainCategoryId: string
  hasSizes: boolean
  sizeTags: string[]
  /** round-34 — قالب نام سایزهای عربی (موازی با sizeTags) */
  sizeTagsAr: string[]
  sizeInput: string
  confirmDeleteId: string | null
}

const EMPTY_FORM: CategoryFormState = {
  isModalOpen: false,
  editingId: null,
  name: '',
  nameAr: '',
  mainCategoryId: '',
  hasSizes: false,
  sizeTags: [],
  sizeTagsAr: [],
  sizeInput: '',
  confirmDeleteId: null,
}

interface CategoryManagerProps {
  categories: Category[]     // ⬅ تایپ واقعی (قبلاً any بود)
}

export const CategoryManager = memo(function CategoryManager({ categories }: CategoryManagerProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM)
  const set = useCallback((partial: Partial<CategoryFormState>) => {
    setForm(f => ({ ...f, ...partial }))
  }, [])

  // دسته‌های اصلی از فکتوری مشترک — همون کش MainCategoryManager
  const { data: allMains } = useQuery(adminMainCategoriesOptions)

  const createMut = useMutation({
    mutationFn: (data: {
      name: string
      nameAr?: string | null
      mainCategoryId: string
      hasSizes: boolean
      sizeNames: string[]
      sizeNamesAr?: string[] | null
    }) => createCategory({ data }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.categories })
      set({ isModalOpen: false })
      showToast('دسته‌بندی افزوده شد')
    },
  })

  const updateMut = useMutation({
    mutationFn: (data: {
      id: string
      name: string
      nameAr?: string | null
      mainCategoryId: string
      hasSizes: boolean
      sizeNames: string[]
      sizeNamesAr?: string[] | null
    }) => updateCategory({ data }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.categories })
      // phase-3: جابه‌جایی والد دسته → محصولات بین main ها حرکت می‌کنند
      queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
      set({ isModalOpen: false })
      showToast('دسته‌بندی ویرایش شد')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCategory({ data: { id } }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.categories })
      showToast('دسته‌بندی حذف شد')
      set({ confirmDeleteId: null })
    },
  })

  // باز کردن مودال — ساخت یا ویرایش (والد هم هیدرات می‌شه — رفع F-58)
  const openModal = useCallback((cat?: Category) => {
    if (cat) {
      set({
        isModalOpen: true,
        editingId: cat.id,
        name: cat.name,
        nameAr: cat.nameAr ?? '',
        mainCategoryId: cat.mainCategoryId,
        hasSizes: cat.hasSizes,
        sizeTags: cat.sizeNames ?? [],
        sizeTagsAr: cat.sizeNamesAr ?? [],
        sizeInput: '',
      })
    } else {
      set({ isModalOpen: true, editingId: null, name: '', nameAr: '', mainCategoryId: '', hasSizes: false, sizeTags: [], sizeTagsAr: [], sizeInput: '' })
    }
  }, [set])

  const closeModal = useCallback(() => set({ isModalOpen: false }), [set])

  // افزودن سایز با اینتر
  const handleSizeKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && form.sizeInput.trim()) {
      e.preventDefault()
      const tag = form.sizeInput.trim()
      if (!form.sizeTags.includes(tag)) set({ sizeTags: [...form.sizeTags, tag], sizeTagsAr: [...form.sizeTagsAr, ''], sizeInput: '' })
    }
  }, [form.sizeInput, form.sizeTags, form.sizeTagsAr, set])

  const removeSizeTag = useCallback((tag: string) => {
    const idx = form.sizeTags.indexOf(tag)
    set({
      sizeTags: form.sizeTags.filter(t => t !== tag),
      // round-34 — جفت عربی هم‌ایندکس حذف می‌شود
      sizeTagsAr: idx === -1 ? form.sizeTagsAr : form.sizeTagsAr.filter((_, i) => i !== idx),
    })
  }, [form.sizeTags, form.sizeTagsAr, set])

  // round-34 — ویرایش نام عربی سایزِ ایندکس n (کنار همان چیپ)
  const setSizeTagAr = useCallback((index: number, value: string) => {
    set({ sizeTagsAr: form.sizeTagsAr.map((t, i) => (i === index ? value : t)) })
  }, [form.sizeTagsAr, set])

  const handleSave = useCallback(() => {
    if (!form.name.trim()) { showToast('لطفا نام دسته را وارد کنید', 'error'); return }
    if (!form.mainCategoryId) { showToast('دسته اصلی را انتخاب کنید', 'error'); return }
    // round-34 — آرایه‌ی عربی موازی با sizeNames؛ سرور جفت خالی را نادیده می‌گیرد (پشتیبان)
    const sizeNamesAr = form.sizeTagsAr.map(s => s.trim())
    const payload = {
      name: form.name.trim(),
      nameAr: form.nameAr.trim() || null,
      mainCategoryId: form.mainCategoryId,
      hasSizes: form.hasSizes,
      sizeNames: form.sizeTags,
      sizeNamesAr,
    }
    if (form.editingId) updateMut.mutate({ id: form.editingId, ...payload })
    else createMut.mutate(payload)
  }, [form, showToast, updateMut, createMut])

  return (
    <div className="w-full bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm h-fit">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">دسته‌بندی‌ها</h2>
        <button onClick={() => openModal()} className="px-3 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaMedium cursor-pointer">افزودن دسته</button>
      </div>

      <div className="space-y-3">
        {categories.map(cat => (
          <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]">
            <div className="flex flex-col">
              <span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">{cat.name}</span>
              {cat.hasSizes && <span className="text-[10px] text-primary dark:text-dark-primary mt-0.5">سایز بندی فعال</span>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => openModal(cat)} className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer"><Pen size={16} /></button>
              <button onClick={() => set({ confirmDeleteId: cat.id })} className="p-1.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      {form.isModalOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal}></div>
          <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md space-y-4">
            <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">{form.editingId ? 'ویرایش دسته' : 'دسته جدید'}</h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1">دسته اصلی (والد)</label>
              <select
                value={form.mainCategoryId}
                onChange={(e) => set({ mainCategoryId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
              >
                <option value="">انتخاب کنید...</option>
                {(allMains ?? []).map(mc => (
                  <option key={mc.id} value={mc.id}>{mc.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">نام دسته</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
            </div>

            {/* round-34 — نام عربی دسته (خالی = پشتیبان فارسی) */}
            <ArField
              label="نام دسته"
              value={form.nameAr}
              onChange={(v) => set({ nameAr: v })}
              faReference={form.name}
              maxLength={60}
            />

            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]">
              <span className="text-sm text-gray-700 dark:text-gray-300">فعال کردن سایز بندی (مثلا پیتزا)</span>
              <Toggle isOn={form.hasSizes} onToggle={() => set({ hasSizes: !form.hasSizes })} />
            </div>

            {form.hasSizes && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">نام سایزها (تایپ کنید و اینتر بزنید)</label>
                <input
                  value={form.sizeInput}
                  onChange={(e) => set({ sizeInput: e.target.value })}
                  onKeyDown={handleSizeKeyDown}
                  placeholder="مثلا: کوچک"
                  className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
                />
                <div className="space-y-2 mt-3">
                  {form.sizeTags.map((tag, i) => (
                    <div key={tag} className="flex items-center gap-2">
                      <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary text-xs shrink-0">
                        {tag}
                        <button type="button" onClick={() => removeSizeTag(tag)} className="hover:opacity-70 cursor-pointer">
                          <X size={12} />
                        </button>
                      </div>
                      {/* round-34 — نام عربی همین سایز */}
                      <input
                        value={form.sizeTagsAr[i] ?? ''}
                        onChange={(e) => setSizeTagAr(i, e.target.value)}
                        dir="rtl"
                        placeholder="نام عربی (اختیاری)"
                        maxLength={40}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-xs outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm cursor-pointer">انصراف</button>
              <button onClick={handleSave} className="flex-1 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm cursor-pointer">ذخیره</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={form.confirmDeleteId !== null}
        title="حذف دسته‌بندی"
        message="آیا از حذف این دسته‌بندی مطمئن هستید؟"
        onConfirm={() => { if (form.confirmDeleteId) deleteMut.mutate(form.confirmDeleteId) }}
        onCancel={() => set({ confirmDeleteId: null })}
      />
    </div>
  )
})