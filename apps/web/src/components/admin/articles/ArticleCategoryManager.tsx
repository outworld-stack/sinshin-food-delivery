// src/components/admin/articles/ArticleCategoryManager.tsx
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createArticleCategory, updateArticleCategory, deleteArticleCategory, type ArticleCategory } from '#/server/articles'
import { articleCategoriesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Toggle } from '#/components/shared/Toggle'
import { Pen, Trash2, X } from 'reicon-react'

// فرم واحد به‌جای ۷ استیت پراکنده
interface ArticleCategoryFormState {
  isModalOpen: boolean
  editingId: string | null
  name: string
  hasSub: boolean
  subTags: string[]
  subInput: string
  confirmDeleteId: string | null
}

const EMPTY_FORM: ArticleCategoryFormState = {
  isModalOpen: false,
  editingId: null,
  name: '',
  hasSub: false,
  subTags: [],
  subInput: '',
  confirmDeleteId: null,
}

export const ArticleCategoryManager = memo(function ArticleCategoryManager() {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [form, setForm] = useState<ArticleCategoryFormState>(EMPTY_FORM)
  const set = useCallback((partial: Partial<ArticleCategoryFormState>) => {
    setForm(f => ({ ...f, ...partial }))
  }, [])

  const { data: categories } = useQuery(articleCategoriesOptions)

  const createMut = useMutation({
    mutationFn: (data: { name: string; hasSubCategories: boolean; subCategories: string[] }) => createArticleCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.articleCategories })
      set({ isModalOpen: false })
      showToast('دسته‌بندی ایجاد شد')
    },
  })

  const updateMut = useMutation({
    mutationFn: (data: { id: string; name: string; hasSubCategories: boolean; subCategories: string[] }) => updateArticleCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.articleCategories })
      set({ isModalOpen: false })
      showToast('ویرایش شد')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteArticleCategory(id),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.invalidateQueries({ queryKey: qk.articleCategories })
      showToast('حذف شد')
      set({ confirmDeleteId: null })
    },
  })

  const openModal = useCallback((cat?: ArticleCategory) => {
    if (cat) {
      set({
        isModalOpen: true,
        editingId: cat.id,
        name: cat.name,
        hasSub: cat.hasSubCategories,
        subTags: (cat.subCategories ?? []).map(s => s.name),
        subInput: '',
      })
    } else {
      set({ isModalOpen: true, editingId: null, name: '', hasSub: false, subTags: [], subInput: '' })
    }
  }, [set])

  const closeModal = useCallback(() => set({ isModalOpen: false }), [set])

  const handleSubKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && form.subInput.trim()) {
      e.preventDefault()
      const tag = form.subInput.trim()
      if (!form.subTags.includes(tag)) set({ subTags: [...form.subTags, tag], subInput: '' })
    }
  }, [form.subInput, form.subTags, set])

  const removeSubTag = useCallback((tag: string) => {
    set({ subTags: form.subTags.filter(t => t !== tag) })
  }, [form.subTags, set])

  const handleSave = useCallback(() => {
    if (!form.name.trim()) { showToast('نام دسته را وارد کنید', 'error'); return }
    const payload = { name: form.name.trim(), hasSubCategories: form.hasSub, subCategories: form.subTags }
    if (form.editingId) updateMut.mutate({ id: form.editingId, ...payload })
    else createMut.mutate(payload)
  }, [form, showToast, updateMut, createMut])

  return (
    <div className="w-full bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm h-fit">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">دسته‌بندی‌های مقالات</h2>
        <button onClick={() => openModal()} className="px-3 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaMedium cursor-pointer">افزودن دسته</button>
      </div>

      <div className="space-y-3">
        {categories?.map(cat => (
          <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]">
            <div>
              <span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">{cat.name}</span>
              {cat.hasSubCategories && <span className="text-[10px] text-primary dark:text-dark-primary block mt-1">ساب‌کتگوری‌ها: {(cat.subCategories ?? []).map(s => s.name).join('، ')}</span>}
            </div>
            <div className="flex gap-1">
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
              <label className="block text-xs text-gray-400 mb-1">نام دسته</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]">
              <span className="text-sm text-gray-700 dark:text-gray-300">فعال کردن ساب‌کتگوری</span>
              <Toggle isOn={form.hasSub} onToggle={() => set({ hasSub: !form.hasSub })} />
            </div>

            {form.hasSub && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">ساب‌کتگوری‌ها (تایپ و اینتر)</label>
                <input
                  value={form.subInput}
                  onChange={(e) => set({ subInput: e.target.value })}
                  onKeyDown={handleSubKeyDown}
                  className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {form.subTags.map(t => (
                    <div key={t} className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs">
                      {t}
                      <button type="button" onClick={() => removeSubTag(t)} className="hover:opacity-70 cursor-pointer"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 text-sm cursor-pointer">انصراف</button>
              <button onClick={handleSave} className="flex-1 py-2 rounded-lg bg-primary text-white text-sm cursor-pointer">ذخیره</button>
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