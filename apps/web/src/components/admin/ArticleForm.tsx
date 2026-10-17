// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 29 از 31
// مسیر مقصد: apps/web/src/components/admin/ArticleForm.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/components/admin/ArticleForm.tsx
import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { articleCategoriesOptions } from '#/utils/queryOptions'
import { ImageField } from '#/components/shared/ImageField'
import { Toggle } from '#/components/shared/Toggle'
import { Brush, Star } from 'reicon-react'
import { ArField } from '#/components/admin/ArField'
import { Link } from '@tanstack/react-router'
import { useToastStore } from '#/stores/toastStore'
import type { ArticleFormProps, ArticleFormData } from '#/types/forms'
import { ArticlePageBuilder } from '#/components/admin/articles/builder/ArticlePageBuilder'
import {
  blocksToPlainText,
  emptyDoc,
  plainTextToDoc,
} from '#/components/admin/articles/builder/blockModel'
import type { ArticleBlocksDoc } from '@sinshin/shared'

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
    processes: [],
    // stage-60 — پرچم «ویژه/سنجاق‌شده»
    isFeatured: false,
    // stage-82 — سند بلوکی صفحه‌ساز (null = حالت متن ساده)
    blocks: null,
    // round-34 — فیلدهای عربی (خالی = پشتیبان فارسی)
    titleAr: '',
    excerptAr: '',
    contentAr: '',
    processesAr: [],
  })
  const [processInput, setProcessInput] = useState({ title: '', item: '' })

  // stage-82 — حالتِ ویرایش: مقاله‌ی بلوکی → صفحه‌ساز؛ متنی → متن ساده
  // (مقاله‌ی تازه از صفحه‌ساز شروع می‌شود — تجربه‌ی اصلی این استیج)
  const [builderMode, setBuilderMode] = useState<'builder' | 'plain'>(
    () => (initialData ? (initialData.blocks != null ? 'builder' : 'plain') : 'builder'),
  )


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
        // stage-60 — پرچم «ویژه» (نیامد = خاموش)
        isFeatured: initialData.isFeatured ?? false,
        processes: initialData.processes?.map((p) => ({ title: p.title, items: p.items || [] })) || [],
        // stage-82 — سند بلوکی ذخیره‌شده (null = مقاله‌ی متنی قدیمی)
        blocks: initialData.blocks ?? null,
        // round-34 — مقادیر عربی ذخیره‌شده (روندها: موازی با ایندکس processes)
        titleAr: initialData.titleAr || '',
        excerptAr: initialData.excerptAr || '',
        contentAr: initialData.contentAr || '',
        processesAr: initialData.processesAr?.map((p) => ({ title: p.title || '', items: p.items || [] })) || [],
      })
    }
  }, [initialData])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  // stage-82 — جابجاییِ حالت ویرایش (بلوکی ⇄ متنی):
  //  · متنی → بلوکی: پاراگراف‌های content به بلوک تبدیل می‌شوند (پلِ مهاجرت)
  //  · بلوکی → متنی: بلوک‌ها حفظ می‌شوند تا اگر برگشتیدی از دست نروند؛
  //    اما ذخیره در حالتِ متنی یعنی سند پاک شود (null) — ادمینِ تصمیم‌گیر
  const switchMode = (to: 'builder' | 'plain') => {
    if (to === builderMode) return
    if (to === 'builder') {
      setFormData(prev => ({
        ...prev,
        blocks: prev.blocks ?? plainTextToDoc(prev.content),
      }))
    }
    setBuilderMode(to)
  }

  // متنِ زنده — در حالتِ بلوکی از سند مشتق می‌شود (منبع واحد؛
  // لیست/سئو/ترجمه روی content سوارند)
  const liveContent = useMemo(
    () => (builderMode && formData.blocks ? blocksToPlainText(formData.blocks) : formData.content),
    [builderMode, formData.blocks, formData.content],
  )

  const setBlocks = (blocks: ArticleBlocksDoc) => {
    setFormData(prev => ({ ...prev, blocks }))
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
      // round-34 — روندهای عربی موازی با ایندکس حفظ می‌شوند (ورودی خالی = پشتیبان فارسی)
      setFormData(prev => ({
        ...prev,
        processes: [...(prev.processes || []), { title: processInput.title, items: [processInput.item] }],
        processesAr: [...(prev.processesAr || []), { title: '', items: [] }],
      }))
    }

    setProcessInput({ title: '', item: '' })
  }

  const removeProcess = (index: number) => {
    // round-34 — حذف هر دو نسخه (فارسی + عربی) با هم — ایندکس‌ها هم‌راستا می‌مانند
    setFormData(prev => ({
      ...prev,
      processes: prev.processes?.filter((_, i) => i !== index) || [],
      processesAr: prev.processesAr?.filter((_, i) => i !== index) || [],
    }))
  }

  // round-34 — ویرایش روند عربیِ ایندکس n (هر خط textarea = یک گام)
  const updateProcessAr = (index: number, patch: Partial<{ title: string; itemsText: string }>) => {
    setFormData(prev => {
      const next = [...(prev.processesAr || [])]
      const cur = next[index] ?? { title: '', items: [] }
      next[index] = {
        title: patch.title !== undefined ? patch.title : cur.title,
        items: patch.itemsText !== undefined
          ? patch.itemsText.split('\n').map(l => l.trim()).filter(Boolean)
          : cur.items,
      }
      return { ...prev, processesAr: next }
    })
  }


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // stage-82 — در حالتِ بلوکی، content از بلوک‌ها مشتق می‌شود؛
    // سندِ بدونِ بلوکِ متنی = مقاله‌ای بدون متن (ردِ صریح با پیام)
    let content = formData.content
    let blocks = formData.blocks
    if (builderMode) {
      const derived = blocksToPlainText(formData.blocks)
      if (!derived.trim()) {
        showToast('در حالت صفحه‌ساز، حداقل یک بلوک متنی (پاراگراف/تیتر/فهرست/نقل‌قول) لازم است', 'error')
        return
      }
      content = derived
    } else {
      // حالتِ متنی: ذخیره یعنی تصمیمِ ادمین — سندِ بلوکی پاک می‌شود
      blocks = null
    }

    if (!formData.title?.trim() || !content.trim()) {
      showToast('عنوان و متن مقاله الزامی است', 'error')
      return
    }

    // اگر نام نویسنده خالی بود، پیش‌فرض "سین شین" براش ثبت میشه
    const finalData = {
      ...formData,
      content,
      blocks,
      author: formData.author?.trim() || 'سین شین'
    }

    onSubmit(finalData)
  }

  const selectedCat = categories?.find(c => c.id === formData.categoryId)
  const selectedSub = selectedCat?.subCategories?.find(s => s.id === formData.subCategoryId)

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

      {/* stage-60 — مقاله ویژه (سنجاق‌شده): همیشه جزو ۴ آیتم اول + Aurora */}
      <div className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition ${formData.isFeatured ? 'border-primary bg-primary/5 dark:border-dark-primary dark:bg-dark-primary/5' : 'border-gray-200 dark:border-[#3a151c]'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${formData.isFeatured ? 'bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary' : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500'}`}>
            <Star size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">مقاله ویژه (سنجاق‌شده)</p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
              این مقاله فارغ از فیلتر دسته/زیردسته و مرتب‌سازی، همیشه در ۴ آیتم اول لیست می‌نشیند و کارتش پس‌زمینه‌ی Aurora می‌گیرد.
            </p>
          </div>
        </div>
        <Toggle
          isOn={formData.isFeatured}
          onToggle={() => setFormData(prev => ({ ...prev, isFeatured: !prev.isFeatured }))}
          label="مقاله ویژه (سنجاق‌شده)"
        />
      </div>

      <div>
        <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">خلاصه مقاله (Excerpt)</label>
        <textarea name="excerpt" value={formData.excerpt} onChange={handleChange} rows={2} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-none"></textarea>
      </div>

      {/* round-34 — عنوان و خلاصه عربی */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ArField
          label="عنوان مقاله"
          value={formData.titleAr}
          onChange={(v) => setFormData(prev => ({ ...prev, titleAr: v }))}
          arAuto={initialData?.arAuto}
          faReference={formData.title}
          maxLength={160}
        />
        <ArField
          label="خلاصه مقاله"
          value={formData.excerptAr}
          onChange={(v) => setFormData(prev => ({ ...prev, excerptAr: v }))}
          arAuto={initialData?.arAuto}
          faReference={formData.excerpt}
          multiline
          rows={2}
          maxLength={1000}
        />
      </div>

      {/* ═══ stage-82 — بدنه‌ی مقاله: صفحه‌سازِ بلوکی ⇄ متن ساده ═══ */}
      <div className="rounded-2xl border border-gray-200 dark:border-[#3a151c] overflow-hidden">
        {/* سوییچِ حالت */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-[#1a0a0e] border-b border-gray-200 dark:border-[#3a151c]">
          <span className="flex items-center gap-1.5 text-sm font-DanaDemiBold text-gray-700 dark:text-gray-200">
            <Brush size={16} className="text-primary dark:text-dark-primary" />
            بدنه‌ی مقاله
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c]">
            <button
              type="button"
              aria-pressed={builderMode === 'builder'}
              onClick={() => switchMode('builder')}
              className={`px-3 py-1.5 rounded-md text-xs font-DanaDemiBold cursor-pointer transition ${builderMode ? 'bg-primary dark:bg-dark-primary text-white' : 'text-gray-500 dark:text-gray-400'}`}
            >
              صفحه‌ساز بلوکی
            </button>
            <button
              type="button"
              aria-pressed={builderMode === 'plain'}
              onClick={() => switchMode('plain')}
              className={`px-3 py-1.5 rounded-md text-xs font-DanaDemiBold cursor-pointer transition ${!builderMode ? 'bg-primary dark:bg-dark-primary text-white' : 'text-gray-500 dark:text-gray-400'}`}
            >
              متن ساده
            </button>
          </div>
        </div>

        {/* بدنه */}
        <div className="p-4">
          {builderMode ? (
            <>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                بلوک‌ها را از «افزودن بلوک» انتخاب کنید، با دسته‌ی ⠿ یا ↑/↓ جابجا کنید و برای هر بلوک
                رنگ، عرض (۵۰٪/۷۰٪/پهن/تمام‌عرض)، انیمیشن ورود و فاصله تعیین کنید. متنِ مقاله به‌صورت
                خودکار از بلوک‌های متنی ساخته می‌شود (لیست/سئو/ترجمه همیشه هم‌گام می‌مانند).
              </p>
              <ArticlePageBuilder
                doc={formData.blocks ?? emptyDoc()}
                onChange={setBlocks}
              />
            </>
          ) : (
            <>
              <textarea name="content" value={formData.content} onChange={handleChange} rows={8} required className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-y" />
              {formData.blocks && (
                <p className="mt-2 text-[11px] text-amber-500 leading-relaxed">
                  این مقاله سندِ بلوکی دارد — ذخیره در حالتِ «متن ساده» آن را پاک می‌کند (صفحه‌ی عمومی
                  همان متن ساده را نشان می‌دهد). با «صفحه‌ساز بلوکی» برگردید تا بلوک‌ها حفظ شوند.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* round-34 — متن کامل عربی (پشتیبان: خالی = همان فارسی در حالت عربی) */}
      <ArField
        label="متن کامل مقاله"
        value={formData.contentAr}
        onChange={(v) => setFormData(prev => ({ ...prev, contentAr: v }))}
        arAuto={initialData?.arAuto}
        faReference={liveContent.slice(0, 160) + (liveContent.length > 160 ? '…' : '')}
        faSource={liveContent}
        multiline
        rows={6}
      />

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
          {formData.processes?.map((proc, i) => {
            const procAr = formData.processesAr?.[i] ?? { title: '', items: [] }
            return (
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
                {/* round-34 — ترجمه‌ی عربی همین روند (عنوان + هر خط = یک گام) */}
                <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-white/10 space-y-2">
                  <p className="text-[11px] text-gray-400 font-DanaMedium">
                    عربی این روند <span className="text-gray-300">(خالی = همان فارسی)</span>
                  </p>
                  <input
                    value={procAr.title}
                    onChange={(e) => updateProcessAr(i, { title: e.target.value })}
                    dir="rtl"
                    placeholder={`عنوان عربی (فارسی: ${proc.title})`}
                    maxLength={120}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary"
                  />
                  <textarea
                    value={procAr.items.join('\n')}
                    onChange={(e) => updateProcessAr(i, { itemsText: e.target.value })}
                    dir="rtl"
                    rows={Math.min(6, Math.max(2, proc.items.length))}
                    placeholder={'هر خط = معرب یک گام از همین روند...'}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary resize-y"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-gray-300 dark:border-[#3a151c]">
          <input value={processInput.title} onChange={e => setProcessInput({ ...processInput, title: e.target.value })} placeholder="عنوان روند (مثلا: آماده‌سازی مواد)" className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
          <div className="flex gap-2">
            <input value={processInput.item} onChange={e => setProcessInput({ ...processInput, item: e.target.value })} placeholder="متن گام (اینتر یا دکمه را بزنید)" className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProcess() } }} />
            <button type="button" onClick={addProcess} className="px-4 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs cursor-pointer">افزودن گام</button>
          </div>
        </div>
      </div>

      {/* round-13 — بج دسته‌بندی و ساب‌کتگوری فعلی مقاله، بالای ردیف انصراف/ذخیره */}
      {(selectedCat || selectedSub) && (
        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
          <span className="text-[11px] text-gray-400 font-DanaMedium">دسته‌بندی‌های این مقاله:</span>
          {selectedCat && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold">
              {selectedCat.name}
            </span>
          )}
          {selectedSub && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-DanaDemiBold">
              {selectedSub.name}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
        <Link to="/admin/articles" className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium text-center cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition">انصراف</Link>
        <button type="submit" disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50">
          {isSubmitting ? 'در حال ذخیره...' : 'ذخیره مقاله'}
        </button>
      </div>

    </form>
  )
}