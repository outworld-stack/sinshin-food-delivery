// src/components/admin/ArticleForm.tsx
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { articleCategoriesOptions } from '#/utils/queryOptions'
import { ImageField } from '#/components/shared/ImageField'
import { Link } from '@tanstack/react-router'
import { useToastStore } from '#/stores/toastStore'
import type { ArticleFormProps, ArticleFormData } from '#/types/forms'

export function ArticleForm({ initialData, onSubmit, isSubmitting }: ArticleFormProps) {
  const showToast = useToastStore((state) => state.showToast)
  // دسته‌ها از فکتوری مشترک — همون کش ادیتور دسته‌بندی و لیست مقالات
  const { data: categories } = useQuery(articleCategoriesOptions)

  const [formData, setFormData] = useState<ArticleFormData>({
    title: '',
    author: '', // اضافه شدن استیت نویسنده
    excerpt: '',
    content: '',
    profileImage: '',
    galleryImages: [],
    categoryId: '',
    subCategoryId: null,
    processes: []
  })
  const [processInput, setProcessInput] = useState({ title: '', item: '' })


  useEffect(() => {
    if (initialData) {
      setFormData({
        title: initialData.title || '',
        author: initialData.author || '', // ست شدن مقدار اولیه نویسنده
        excerpt: initialData.excerpt || '',
        content: initialData.content || '',
        profileImage: initialData.profileImage || '',
        galleryImages: initialData.galleryImages || [],
        categoryId: initialData.categoryId || '',
        subCategoryId: initialData.subCategoryId || null,
        processes: initialData.processes?.map((p) => ({ title: p.title, items: p.items || [] })) || []
      })
    }
  }, [initialData])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const addProcess = () => {
    if (!processInput.title.trim()) { showToast('لطفا عنوان روند را وارد کنید', 'error'); return }
    if (!processInput.item.trim()) { showToast('لطفا متن گام را وارد کنید', 'error'); return }

    const existingProcessIndex = formData.processes?.findIndex(p => p.title === processInput.title)

    if (existingProcessIndex !== undefined && existingProcessIndex !== -1 && formData.processes) {
      const newProcesses = [...formData.processes]
      newProcesses[existingProcessIndex].items.push(processInput.item)
      setFormData(prev => ({ ...prev, processes: newProcesses }))
    } else {
      setFormData(prev => ({ ...prev, processes: [...(prev.processes || []), { title: processInput.title, items: [processInput.item] }] }))
    }

    setProcessInput({ title: '', item: '' })
  }

  const removeProcess = (index: number) => {
    setFormData(prev => ({ ...prev, processes: prev.processes?.filter((_, i) => i !== index) || [] }))
  }


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title?.trim() || !formData.content?.trim()) {
      showToast('عنوان و متن مقاله الزامی است', 'error')
      return
    }

    // اگر نام نویسنده خالی بود، پیش‌فرض "سین شین" براش ثبت میشه
    const finalData = {
      ...formData,
      author: formData.author?.trim() || 'سین شین'
    }

    onSubmit(finalData)
  }

  const selectedCat = categories?.find(c => c.id === formData.categoryId)

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">عنوان مقاله</label>
          <input type="text" name="title" value={formData.title} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none" />
        </div>
        {/* فیلد نام نویسنده */}
        <div>
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">نام نویسنده (اختیاری)</label>
          <input type="text" name="author" value={formData.author} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none" placeholder="اگر خالی بگذارید، 'سین شین' ثبت می‌شود" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">دسته‌بندی</label>
          <select name="categoryId" value={formData.categoryId} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none cursor-pointer">
            <option value="">انتخاب کنید...</option>
            {categories?.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      </div>

      {selectedCat?.hasSubCategories && (
        <div>
          <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">ساب‌کتگوری</label>
          <select name="subCategoryId" value={formData.subCategoryId || ''} onChange={e => setFormData(prev => ({ ...prev, subCategoryId: e.target.value || null }))} className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none cursor-pointer">
            <option value="">بدون ساب‌کتگوری</option>
            {(selectedCat.subCategories ?? []).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>) ?? []}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">خلاصه مقاله (Excerpt)</label>
        <textarea name="excerpt" value={formData.excerpt} onChange={handleChange} rows={2} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-none"></textarea>
      </div>

      <div>
        <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">متن کامل مقاله</label>
        <textarea name="content" value={formData.content} onChange={handleChange} rows={6} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-none"></textarea>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* بخش عکس پروفایل */}
        <ImageField
          label="عکس پروفایل (PNG)"
          accept="image/png"
          fileTypeText="PNG"
          images={formData.profileImage ? [formData.profileImage] : []}
          onAdd={(url) => setFormData(prev => ({ ...prev, profileImage: url }))}
          onRemove={() => { setFormData(prev => ({ ...prev, profileImage: '' })); showToast('عکس حذف شد') }}
        />

        {/* بخش گالری عکس‌ها */}
        <ImageField
          label="گالری عکس‌ها (WebP)"
          accept="image/webp"
          multiple
          images={formData.galleryImages ?? []}
          onAdd={(url) => setFormData(prev => ({ ...prev, galleryImages: [...(prev.galleryImages || []), url] }))}
          onRemove={(index) => { setFormData(prev => ({ ...prev, galleryImages: prev.galleryImages?.filter((_, i) => i !== index) || [] })); showToast('عکس حذف شد') }}
        />
      </div>

      {/* سیستم روندها */}
      <div className="border-t border-gray-100 dark:border-white/5 pt-6">
        <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">روندهای مقاله</h3>

        <div className="space-y-3 mb-4">
          {formData.processes?.map((proc, i) => (
            <div key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]">
              <div className="flex items-center justify-between mb-2">
                <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{proc.title}</p>
                <button type="button" onClick={() => removeProcess(i)} className="text-red-400 text-xs hover:bg-red-50 dark:hover:bg-red-500/10 p-1 rounded cursor-pointer">حذف روند</button>
              </div>
              <ul className="list-disc pr-5 space-y-1">
                {proc.items.map((item, idx) => (
                  <li key={idx} className="text-xs text-gray-600 dark:text-gray-400">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-gray-300 dark:border-[#3a151c]">
          <input value={processInput.title} onChange={e => setProcessInput({ ...processInput, title: e.target.value })} placeholder="عنوان روند (مثلا: آماده‌سازی مواد)" className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
          <div className="flex gap-2">
            <input value={processInput.item} onChange={e => setProcessInput({ ...processInput, item: e.target.value })} placeholder="متن گام (اینتر یا دکمه را بزنید)" className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProcess() } }} />
            <button type="button" onClick={addProcess} className="px-4 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs cursor-pointer">افزودن گام</button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
        <Link to="/admin/articles" className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium text-center cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition">انصراف</Link>
        <button type="submit" disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50">
          {isSubmitting ? 'در حال ذخیره...' : 'ذخیره مقاله'}
        </button>
      </div>

    </form>
  )
}