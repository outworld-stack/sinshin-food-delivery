// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 38 از 49
// مسیر مقصد: apps/web/src/components/admin/settings/TermsEditor.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/components/admin/settings/TermsEditor.tsx
import { memo, useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createTerms, getAdminTerms, updateTerms } from '#/server/terms'
import { ArField } from '#/components/admin/ArField'
import { ContentTranslationTools } from '#/components/admin/ContentTranslationTools'
import { useContentTranslationDraft } from '#/hooks/admin/useContentTranslationDraft'
import { qk } from '#/utils/queryKeys'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { Plus, Trash2, File } from 'reicon-react'
import { formatDate, faNum } from '#/utils/format'
import { collectionTranslationIdentities, type Role, type TranslationEdit, type ContentCollectionIdentity, type TermsContentDto } from '@sinshin/shared'
import { collectionIds, moveCollectionItem } from '#/utils/contentTranslationDraft'

// فرم — هر بخش: عنوان + متن چندخطی (هر خط = یک بند)
interface TermsFormSection {
    id: string
    title: string
    items: { id: string; text: string; textAr: string }[]
    /** round-34 — عنوان عربی + بندهای عربی (هر خط = یک بند؛ خالی = پشتیبان فارسی) */
    titleAr: string
}

// ادیتور قوانین — فقط ادمین اصلی (تنظیمات) — هر ذخیره = نسخه جدید
export const TermsEditor = memo(function TermsEditor() {
    const queryClient = useQueryClient()
    const showToast = useToastStore((s) => s.showToast)
    const role = useAuthStore((s) => s.role)

    // قوانین از فکتوری مشترک — همون کش مودال ثبت‌نام (کلید terms-content)
    const { data: terms, isLoading } = useQuery({ queryKey: ['admin', 'terms-content'], queryFn: getAdminTerms })

    const [sections, setSections] = useState<TermsFormSection[]>([])
    const [snapshot, setSnapshot] = useState<TermsContentDto | null>(null)
    const [isDirty, setIsDirty] = useState(false)
    const sourceSections = useMemo(() => sections.map(s => ({ title: s.title.trim(), items: s.items.map(item => item.text.trim()) })), [sections])
    const translationIdentities = useMemo<ContentCollectionIdentity[]>(() => [{ collectionPath: ['sections'], itemIds: sections.map(section => section.id) },
        ...sections.map((section, index) => ({ collectionPath: ['sections', index, 'items'], itemIds: section.items.map(item => item.id) }))], [sections])
    const translation = useContentTranslationDraft({ entityType: 'terms', entityId: snapshot?.id,
        initialRow: snapshot ? { ...snapshot } : null, row: { sections: sourceSections, translationIdentities,
            sectionsAr: sections.map(s => ({ title: s.titleAr, items: s.items.map(item => item.textAr) })) } })

    // هیدرات — فقط تا وقتی ادمین دست نزده (الگوی isDirty — ویرایش‌ها پاک نمی‌شوند)
    useEffect(() => {
        if (terms && !isDirty) {
            setSnapshot(terms)
            const identities = collectionTranslationIdentities('terms', terms)
            // round-34 — sectionsAr خام از سرور؛ ساختار موازی با sections (جفت با ایندکس)
            const ar = terms.sectionsAr ?? []
            setSections(terms.sections.map((s, i) => ({
                id: collectionIds(identities, ['sections'])[i],
                title: s.title,
                items: s.items.map((text, index) => ({ id: collectionIds(identities, ['sections', i, 'items'])[index], text, textAr: ar[i]?.items[index] ?? '' })),
                titleAr: ar[i]?.title ?? '',
            })))
        }
    }, [terms, isDirty])

    const handleTitleChange = useCallback((sectionId: string, value: string) => {
        setIsDirty(true)
        setSections(prev => prev.map(s => s.id === sectionId ? { ...s, title: value } : s))
    }, [])

    const handleItemChange = useCallback((sectionId: string, itemId: string, value: string) => {
        setIsDirty(true)
        setSections(prev => prev.map(s => s.id === sectionId ? { ...s, items: s.items.map(item => item.id === itemId ? { ...item, text: value } : item) } : s))
    }, [])

    // round-34 — ویرایش قسمت عربی بخش n
    const handleArChange = useCallback((sectionId: string, patch: Partial<{ titleAr: string }>) => {
        setIsDirty(true)
        setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...patch } : s))
    }, [])

    const addSection = useCallback(() => {
        setIsDirty(true)
        setSections(prev => {
            const id = `sections:${crypto.randomUUID()}`
            return [...prev, { id, title: '', items: [{ id: `${id}:items:${crypto.randomUUID()}`, text: '', textAr: '' }], titleAr: '' }]
        })
    }, [])

    const removeSection = useCallback((sectionId: string) => {
        setIsDirty(true)
        setSections(prev => prev.filter(section => section.id !== sectionId))
    }, [])

    const saveMut = useMutation({
        mutationFn: (data: {
            operation: 'create' | 'update'
            role: Role
            sections: { title: string; items: string[] }[]
            sectionsAr?: { title: string; items: string[] }[] | null
            translationEdits?: TranslationEdit[]
            translationIdentities?: ContentCollectionIdentity[]
            sourceRevision?: string
        }) => data.operation === 'create' ? createTerms(data) : updateTerms(data),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: qk.termsContent })
            queryClient.invalidateQueries({ queryKey: ['admin', 'terms-content'] })
            setIsDirty(false)   // اجازه‌ی سینک مجدد با داده‌ی تازه
            showToast(`قوانین ذخیره شد — نسخه ${faNum(res.version)} برای ثبت‌نام‌های بعدی`)
        },
        onError: (err) => showToast(err.message || 'خطا در ذخیره قوانین', 'error'),
    })

    const handleSave = useCallback(() => {
        if (!snapshot) { showToast('قوانین ذخیره‌شده را دوباره بارگذاری کنید؛ پیش‌نویس شما حفظ شده است', 'error'); return }
        if (sections.length === 0) { showToast('حداقل یک بخش لازم است', 'error'); return }
        if (sections.some(s => !s.title.trim())) { showToast('عنوان همه‌ی بخش‌ها را وارد کنید', 'error'); return }

        // متن چندخطی → آرایه‌ی بندها (خطوط خالی حذف)
        const parsed = sourceSections
        if (parsed.some(s => s.items.length === 0)) { showToast('هر بخش حداقل یک بند (یک خط) لازم دارد', 'error'); return }
        if (parsed.some(s => s.items.some(item => !item))) { showToast('متن همه بندها را وارد کنید یا بند خالی را حذف کنید', 'error'); return }
        if (!role) { showToast('نشست شما منقضی شده است. دوباره وارد شوید.', 'error'); return }

        // round-34 — بندهای عربی موازی با ایندکس (بدون filter — هم‌ترازی با sections
        // حیاتی است؛ بخش بدون ترجمه سمت سرور per-section به فارسی برمی‌گردد)
        const parsedAr = sections.map((s, index) => ({
            title: s.titleAr.trim(),
            items: parsed[index].items.map((_, item) => s.items[item].textAr.trim()),
        }))
        const hasAnyAr = parsedAr.some(s => s.title !== '' || s.items.length > 0)

        const operation = !snapshot.id && snapshot.version === 0 && snapshot.sections.length === 0 ? 'create' : 'update'
        saveMut.mutate({ operation, role, sections: parsed, sectionsAr: hasAnyAr ? parsedAr : null, translationIdentities, translationEdits: translation.getEdits(), sourceRevision: translation.sourceRevision })
    }, [sections, role, saveMut, showToast, translation, sourceSections, translationIdentities, snapshot])

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
                    {['terms-loading-1', 'terms-loading-2', 'terms-loading-3'].map(key => (
                        <div key={key} className="h-32 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
                    ))}
                </div>
            ) : (
                <>
                    <ContentTranslationTools translation={translation} disabled={saveMut.isPending} />
                    <div className="space-y-4">
                        {sections.map((section, index) => (
                            <div key={section.id} className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 space-y-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        value={section.title}
                                        maxLength={200}
                                        onChange={(e) => handleTitleChange(section.id, e.target.value)}
                                        placeholder="عنوان بخش — مثلا: ۳. سفارش و پرداخت"
                                        className={`flex-1 ${inputCls}`}
                                    />
                                    {[-1, 1].map(direction => <button key={direction} type="button" aria-label={direction < 0 ? 'انتقال بخش به بالا' : 'انتقال بخش به پایین'}
                                        disabled={index + direction < 0 || index + direction >= sections.length} className="text-xs disabled:opacity-30"
                                        onClick={() => { setIsDirty(true); setSections(previous => { const currentIndex = previous.findIndex(entry => entry.id === section.id)
                                            return moveCollectionItem(previous, currentIndex, currentIndex + direction) }) }}>{direction < 0 ? '↑' : '↓'}</button>)}
                                    <button
                                        type="button"
                                        onClick={() => removeSection(section.id)}
                                        className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer shrink-0"
                                        aria-label="حذف بخش"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                {section.items.map((item, itemIndex) => <div key={item.id} className="flex gap-2 items-start">
                                    <textarea value={item.text} aria-label={`متن فارسی بند ${itemIndex + 1}`} maxLength={1000}
                                        onChange={event => handleItemChange(section.id, item.id, event.target.value)} rows={2}
                                        placeholder="متن بند قوانین" className={`flex-1 ${inputCls} resize-y font-DanaMedium`} />
                                    {[-1, 1].map(direction => <button key={direction} type="button" aria-label={direction < 0 ? 'انتقال بند به بالا' : 'انتقال بند به پایین'}
                                        disabled={itemIndex + direction < 0 || itemIndex + direction >= section.items.length} className="text-xs disabled:opacity-30"
                                        onClick={() => { setIsDirty(true); setSections(previous => previous.map(entry => { if (entry.id !== section.id) return entry
                                            const currentIndex = entry.items.findIndex(current => current.id === item.id)
                                            return { ...entry, items: moveCollectionItem(entry.items, currentIndex, currentIndex + direction) } })) }}>{direction < 0 ? '↑' : '↓'}</button>)}
                                    <button type="button" aria-label="حذف بند" className="text-red-400" onClick={() => { setIsDirty(true);
                                        setSections(previous => previous.map(entry => entry.id === section.id ? { ...entry, items: entry.items.filter(current => current.id !== item.id) } : entry)) }}>×</button>
                                </div>)}
                                <button type="button" className="text-xs text-primary" disabled={section.items.length >= 100}
                                    onClick={() => { setIsDirty(true); setSections(previous => previous.map(entry => entry.id === section.id
                                        ? { ...entry, items: [...entry.items, { id: `${entry.id}:items:${crypto.randomUUID()}`, text: '', textAr: '' }] } : entry)) }}>افزودن بند</button>
                                {/* round-34 — ترجمه‌ی عربی همین بخش (خالی = fallback فارسی) */}
                                <div className="pt-3 border-t border-dashed border-gray-200 dark:border-white/10 space-y-2">
                                    <p className="text-[11px] text-gray-400 font-DanaMedium">
                                        عربی این بخش <span className="text-gray-300">(خالی = همان فارسی)</span>
                                    </p>
                                    <ArField label="عنوان بخش" value={section.titleAr} faReference={sourceSections[index].title}
                                        translation={translation.field(['sections', index, 'title'])}
                                        onChange={titleAr => handleArChange(section.id, { titleAr })} maxLength={200} />
                                    {sourceSections[index].items.map((item, itemIndex) => <ArField
                                        key={section.items[itemIndex].id}
                                        label={`بند ${itemIndex + 1}`} faReference={item} value={section.items[itemIndex].textAr}
                                        translation={translation.field(['sections', index, 'items', itemIndex])}
                                        onChange={value => {
                                            setIsDirty(true)
                                            setSections(previous => previous.map(entry => {
                                                if (entry.id !== section.id) return entry
                                                return { ...entry, items: entry.items.map(item => item.id === section.items[itemIndex].id ? { ...item, textAr: value } : item) }
                                            }))
                                        }} multiline />)}
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
