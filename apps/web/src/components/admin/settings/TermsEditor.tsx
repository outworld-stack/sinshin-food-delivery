// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 38 از 49
// مسیر مقصد: apps/web/src/components/admin/settings/TermsEditor.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/components/admin/settings/TermsEditor.tsx
import { memo, useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { updateTerms } from '#/server/terms'
import { termsContentOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { Plus, Trash2, File } from 'reicon-react'
import { formatDate, faNum } from '#/utils/format'
import type { Role } from '@sinshin/shared'

// فرم — هر بخش: عنوان + متن چندخطی (هر خط = یک بند)
interface TermsFormSection {
    title: string
    itemsText: string
    /** round-34 — عنوان عربی + بندهای عربی (هر خط = یک بند؛ خالی = پشتیبان فارسی) */
    titleAr: string
    itemsTextAr: string
}

// ادیتور قوانین — فقط ادمین اصلی (تنظیمات) — هر ذخیره = نسخه جدید
export const TermsEditor = memo(function TermsEditor() {
    const queryClient = useQueryClient()
    const showToast = useToastStore((s) => s.showToast)
    const role = useAuthStore((s) => s.role)

    // قوانین از فکتوری مشترک — همون کش مودال ثبت‌نام (کلید terms-content)
    const { data: terms, isLoading } = useQuery(termsContentOptions)

    const [sections, setSections] = useState<TermsFormSection[]>([])
    const [isDirty, setIsDirty] = useState(false)

    // هیدرات — فقط تا وقتی ادمین دست نزده (الگوی isDirty — ویرایش‌ها پاک نمی‌شوند)
    useEffect(() => {
        if (terms && !isDirty) {
            // round-34 — sectionsAr خام از سرور؛ ساختار موازی با sections (جفت با ایندکس)
            const ar = terms.sectionsAr ?? []
            setSections(terms.sections.map((s, i) => ({
                title: s.title,
                itemsText: s.items.join('\n'),
                titleAr: ar[i]?.title ?? '',
                itemsTextAr: (ar[i]?.items ?? []).join('\n'),
            })))
        }
    }, [terms, isDirty])

    const handleTitleChange = useCallback((index: number, value: string) => {
        setIsDirty(true)
        setSections(prev => prev.map((s, i) => i === index ? { ...s, title: value } : s))
    }, [])

    const handleItemsChange = useCallback((index: number, value: string) => {
        setIsDirty(true)
        setSections(prev => prev.map((s, i) => i === index ? { ...s, itemsText: value } : s))
    }, [])

    // round-34 — ویرایش قسمت عربی بخش n
    const handleArChange = useCallback((index: number, patch: Partial<{ titleAr: string; itemsTextAr: string }>) => {
        setIsDirty(true)
        setSections(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
    }, [])

    const addSection = useCallback(() => {
        setIsDirty(true)
        setSections(prev => [...prev, { title: '', itemsText: '', titleAr: '', itemsTextAr: '' }])
    }, [])

    const removeSection = useCallback((index: number) => {
        setIsDirty(true)
        setSections(prev => prev.filter((_, i) => i !== index))
    }, [])

    const saveMut = useMutation({
        mutationFn: (data: {
            role: Role
            sections: { title: string; items: string[] }[]
            sectionsAr?: { title: string; items: string[] }[] | null
        }) => updateTerms(data),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: qk.termsContent })
            setIsDirty(false)   // اجازه‌ی سینک مجدد با داده‌ی تازه
            showToast(`قوانین ذخیره شد — نسخه ${faNum(res.version)} برای ثبت‌نام‌های بعدی`)
        },
        onError: (err) => showToast(err.message || 'خطا در ذخیره قوانین', 'error'),
    })

    const handleSave = useCallback(() => {
        if (sections.length === 0) { showToast('حداقل یک بخش لازم است', 'error'); return }
        if (sections.some(s => !s.title.trim())) { showToast('عنوان همه‌ی بخش‌ها را وارد کنید', 'error'); return }

        // متن چندخطی → آرایه‌ی بندها (خطوط خالی حذف)
        const parsed = sections.map(s => ({
            title: s.title.trim(),
            items: s.itemsText.split('\n').map(l => l.trim()).filter(Boolean),
        }))
        if (parsed.some(s => s.items.length === 0)) { showToast('هر بخش حداقل یک بند (یک خط) لازم دارد', 'error'); return }
        if (!role) { showToast('نشست شما منقضی شده است. دوباره وارد شوید.', 'error'); return }

        // round-34 — بندهای عربی موازی با ایندکس (بدون filter — هم‌ترازی با sections
        // حیاتی است؛ بخش بدون ترجمه سمت سرور per-section به فارسی برمی‌گردد)
        const parsedAr = sections.map(s => ({
            title: s.titleAr.trim(),
            items: s.itemsTextAr.split('\n').map(l => l.trim()).filter(Boolean),
        }))
        const hasAnyAr = parsedAr.some(s => s.title !== '' || s.items.length > 0)

        saveMut.mutate({ role, sections: parsed, sectionsAr: hasAnyAr ? parsedAr : null })
    }, [sections, role, saveMut, showToast])

    const inputCls = 'px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary'

    return (
        <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white flex items-center gap-2">
                    <File size={20} className="text-primary dark:text-dark-primary" />
                    قوانین سایت
                </h2>
                {terms && (
                    <span className="text-xs text-gray-400 font-DanaMedium">
                        نسخه {faNum(terms.version)} · به‌روزرسانی {formatDate(terms.updatedAt)}
                    </span>
                )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-6 leading-relaxed">
                متن قوانینی که کاربران جدید هنگام ثبت‌نام می‌پذیرند. هر ذخیره = نسخه‌ی جدید؛
                پذیرش‌های قبلی به نسخه‌ی زمان خودشان ثبت شده‌اند.
            </p>

            {isLoading ? (
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-32 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
                    ))}
                </div>
            ) : (
                <>
                    <div className="space-y-4">
                        {sections.map((section, index) => (
                            <div key={index} className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 space-y-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        value={section.title}
                                        onChange={(e) => handleTitleChange(index, e.target.value)}
                                        placeholder="عنوان بخش — مثلا: ۳. سفارش و پرداخت"
                                        className={`flex-1 ${inputCls}`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeSection(index)}
                                        className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer shrink-0"
                                        aria-label="حذف بخش"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <textarea
                                    value={section.itemsText}
                                    onChange={(e) => handleItemsChange(index, e.target.value)}
                                    rows={5}
                                    placeholder="هر خط = یک بند قوانین..."
                                    className={`w-full ${inputCls} resize-y font-DanaMedium`}
                                />
                                {/* round-34 — ترجمه‌ی عربی همین بخش (خالی = fallback فارسی) */}
                                <div className="pt-3 border-t border-dashed border-gray-200 dark:border-white/10 space-y-2">
                                    <p className="text-[11px] text-gray-400 font-DanaMedium">
                                        عربی این بخش <span className="text-gray-300">(خالی = همان فارسی)</span>
                                    </p>
                                    <input
                                        value={section.titleAr}
                                        onChange={(e) => handleArChange(index, { titleAr: e.target.value })}
                                        dir="rtl"
                                        maxLength={200}
                                        placeholder={`عنوان عربی (فارسی: ${section.title || '—'})`}
                                        className={`w-full ${inputCls}`}
                                    />
                                    <textarea
                                        value={section.itemsTextAr}
                                        onChange={(e) => handleArChange(index, { itemsTextAr: e.target.value })}
                                        dir="rtl"
                                        rows={5}
                                        placeholder="هر خط = معرب همان بند فارسی بالا..."
                                        className={`w-full ${inputCls} resize-y font-DanaMedium`}
                                    />
                                </div>
                            </div>
                        ))}
                        {sections.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-6 font-DanaMedium">بخشی تعریف نشده — حداقل یک بخش لازم است</p>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 mt-6">
                        <button
                            type="button"
                            onClick={addSection}
                            className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2"
                        >
                            <Plus size={16} />
                            افزودن بخش
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saveMut.isPending || !isDirty}
                            className="flex-1 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                        >
                            {saveMut.isPending ? 'در حال ذخیره...' : 'ذخیره قوانین (نسخه جدید)'}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
})