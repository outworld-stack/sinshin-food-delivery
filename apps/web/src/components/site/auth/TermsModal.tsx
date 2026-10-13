// src/components/site/auth/TermsModal.tsx
// stage-59 — بازطراحی جریان قوانین ثبت‌نام:
//  • اسکرول تا انتها دیگر اجباری نیست — تیکِ چک‌باکس به‌تنهایی کافی است.
//  • مودال فقط برای «مشاهده» است: هدر + X + محتوای اسکرولی + نسخه.
//  • محتوای عربی: وقتی زبان فعال ar است و sectionsAr موجود، همان رندر می‌شود.
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { termsContentOptions } from '#/utils/queryOptions'
import type { TermsSection } from '#/server/terms'
import { useI18n } from '#/i18n'
import { X } from 'reicon-react'

interface TermsModalProps {
  isOpen: boolean
  onClose: () => void
}

// مدال قوانین — متن از سرور (نسخه‌دار و قابل ویرایش)
// رارد ۳۲ — متن‌های مدال از دیکشنری؛ محتوای قوانین از سرور (داده = رارد ۳۴)
export const TermsModal = memo(function TermsModal({ isOpen, onClose }: TermsModalProps) {
  const { t, fmt, lang } = useI18n()

  // متن قوانین — از فکتوری مشترک؛ همون کش ادیتور ادمین (کلید terms-content)
  const { data: terms, isLoading } = useQuery(termsContentOptions)

  if (!isOpen) return null

  // stage-59 — انتخاب زبان محتوا: عربی فقط وقتی موجود باشد (وگرنه فارسی)
  const faSections: TermsSection[] = terms?.sections ?? []
  const arSections: TermsSection[] | null | undefined = terms?.sectionsAr
  const sections: TermsSection[] =
    lang === 'ar' && arSections && arSections.length > 0 ? arSections : faSections

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div className="relative bg-white dark:bg-[#2a1015] rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* هدر */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/5 shrink-0">
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">{t['terms.title']}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 cursor-pointer p-1" aria-label={t['common.close']}>
            <X size={22} />
          </button>
        </div>

        {/* محتوای اسکرولی — از سرور (بدون اجبارِ اسکرول تا انتها) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: اسکلتون — ایندکس همان شناسه است
                <div key={`sk-${i}`} className="space-y-2">
                  <div className="h-4 w-32 rounded bg-gray-200 dark:bg-[#1a0a0e] animate-pulse" />
                  <div className="h-3 w-full rounded bg-gray-100 dark:bg-[#2a1015] animate-pulse" />
                  <div className="h-3 w-5/6 rounded bg-gray-100 dark:bg-[#2a1015] animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {sections.map((section, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: عنوان بخش ممکن است تکراری باشد؛ عنوان+ایندکس = یکتا
                <div key={`${section.title}-${i}`}>
                  <h4 className="font-DanaDemiBold text-sm text-gray-800 dark:text-white mb-2">
                    {section.title}
                  </h4>
                  <ul className="space-y-2">
                    {section.items.map((item, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: متن بند ممکن است تکراری باشد؛ متن+ایندکس = یکتا
                      <li key={`${item}-${j}`} className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary dark:bg-dark-primary mt-1.5 shrink-0"></span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {terms && (
                <p className="text-[10px] text-gray-400 text-center pt-2">
                  {t['terms.version']} {fmt.num(terms.version)} — {t['terms.updated']}: {fmt.date(terms.updatedAt)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})