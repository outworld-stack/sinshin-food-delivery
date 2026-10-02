// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 37 از 49
// مسیر مقصد: apps/web/src/components/admin/settings/AboutContentForm.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/components/admin/settings/AboutContentForm.tsx
import { memo, useEffect, useState, useCallback } from 'react'
import type { AboutContent, AboutContentInput } from '#/types/site/about'
import { FileUploader } from '#/components/FileUploader'
import { ArField } from '#/components/admin/ArField'

interface AboutContentFormProps {
  initialData: AboutContent
  isSaving: boolean
  onSave: (input: AboutContentInput) => void
}

const EMPTY_FORM: AboutContentInput = {
  heroTitle: '',
  heroText: '',
  heroGradient: '',
  teamTitle: '',
  teamGradient: '',
  teamAlt: '',
  // round-34 — محتوای عربی (خالی = پشتیبان فارسی)
  heroTitleAr: '',
  heroTextAr: '',
  teamTitleAr: '',
  teamAltAr: '',
}

const inputCls =
  'w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm'

// پیش‌نمایش تصویر — همان قرارداد موک محصول: src به‌عنوان کلاس رندر می‌شود
function ImagePreview({ src }: { src: string }) {
  return src ? (
    <div className={`h-40 rounded-2xl bg-linear-to-br ${src}`} aria-hidden />
  ) : (
    <div className="h-40 rounded-2xl bg-gray-100 dark:bg-[#1a0a0e] flex items-center justify-center text-xs text-gray-400">
      تصویری آپلود نشده است
    </div>
  )
}

export const AboutContentForm = memo(function AboutContentForm({
  initialData, isSaving, onSave,
}: AboutContentFormProps) {
  const [form, setForm] = useState<AboutContentInput>(EMPTY_FORM)
  const [isDirty, setIsDirty] = useState(false)

  // سینک با سرور فقط تا وقتی ادمین دست نزده
  useEffect(() => {
    if (isDirty) return
    const { updatedAt: _updatedAt, ...fields } = initialData
    setForm({
      ...fields,
      // round-34 — نرمال‌سازی مقادیر عربی (null/undefined → '' = پشتیبانِ فارسی)
      heroTitleAr: fields.heroTitleAr ?? '',
      heroTextAr: fields.heroTextAr ?? '',
      teamTitleAr: fields.teamTitleAr ?? '',
      teamAltAr: fields.teamAltAr ?? '',
    })
  }, [initialData, isDirty])

  const handleTextChange = useCallback(
    (field: keyof AboutContentInput) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setIsDirty(true)
        setForm((prev) => ({ ...prev, [field]: e.target.value }))
      },
    [],
  )

  // round-34 — ArField مقدار خام می‌دهد (نه event) — آداپتور فیلدهای عربی
  const handleArChange = useCallback(
    (field: 'heroTitleAr' | 'heroTextAr' | 'teamTitleAr' | 'teamAltAr') =>
      (value: string) => {
        setIsDirty(true)
        setForm((prev) => ({ ...prev, [field]: value }))
      },
    [],
  )

  // آپلود عکس — دقیقاً مثل ProductForm
  const handleHeroImage = useCallback((url: string) => {
    setIsDirty(true)
    setForm((prev) => ({ ...prev, heroGradient: url }))
  }, [])
  const handleTeamImage = useCallback((url: string) => {
    setIsDirty(true)
    setForm((prev) => ({ ...prev, teamGradient: url }))
  }, [])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      onSave(form)
      setIsDirty(false)
    },
    [form, onSave],
  )

  const isImagesMissing = !form.heroGradient || !form.teamGradient

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">صفحه درباره ما</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            آخرین ویرایش: {new Date(initialData.updatedAt).toLocaleString('fa-IR')}
          </p>
        </div>
        <button
          type="submit"
          disabled={isSaving || !isDirty || isImagesMissing}
          className="px-6 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-sm hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
        </button>
      </div>

      {/* HERO */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">عنوان اصلی</span>
            <input value={form.heroTitle} onChange={handleTextChange('heroTitle')} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">متن داستان برند</span>
            <textarea rows={5} value={form.heroText} onChange={handleTextChange('heroText')} className={`${inputCls} leading-7`} />
          </label>
          {/* round-34 — عنوان و متن عربی HERO */}
          <ArField
            label="عنوان اصلی"
            value={form.heroTitleAr}
            onChange={handleArChange('heroTitleAr')}
            arAuto={initialData.arAuto}
            faReference={form.heroTitle}
            maxLength={120}
          />
          <ArField
            label="متن داستان برند"
            value={form.heroTextAr}
            onChange={handleArChange('heroTextAr')}
            arAuto={initialData.arAuto}
            faReference={form.heroText}
            multiline
            rows={5}
            maxLength={2000}
          />
        </div>
        <div className="space-y-4">
          <ImagePreview src={form.heroGradient} />
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">تصویر اصلی</span>
            <FileUploader accept="image/webp" fileTypeText="WebP" onUploadComplete={handleHeroImage} />
          </label>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-white/10" />

      {/* TEAM */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">عنوان بخش تیم</span>
            <input value={form.teamTitle} onChange={handleTextChange('teamTitle')} className={inputCls} />
          </label>
          {/* round-34 — عنوان عربی تیم */}
          <ArField
            label="عنوان بخش تیم"
            value={form.teamTitleAr}
            onChange={handleArChange('teamTitleAr')}
            arAuto={initialData.arAuto}
            faReference={form.teamTitle}
            maxLength={120}
          />
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">متن جایگزین تصویر تیم (alt)</span>
            <input value={form.teamAlt} onChange={handleTextChange('teamAlt')} className={inputCls} />
          </label>
          {/* round-34 — alt عربی تیم */}
          <ArField
            label="متن جایگزین تصویر تیم"
            value={form.teamAltAr}
            onChange={handleArChange('teamAltAr')}
            arAuto={initialData.arAuto}
            faReference={form.teamAlt}
            maxLength={200}
          />
          <label className="block">
            <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">تصویر تیم</span>
            <FileUploader accept="image/webp" fileTypeText="WebP" onUploadComplete={handleTeamImage} />
          </label>
        </div>
        <ImagePreview src={form.teamGradient} />
      </div>
    </form>
  )
})