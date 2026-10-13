// src/components/dashboard/info/TermsBox.tsx
// stage-59 — باکس قوانین در صفحه‌ی «اطلاعات کاربری»:
//  • موبایل: انتهای صفحه، در باکسی با ارتفاع ثابت و اسکرول عمودی.
//  • xl و بالاتر: ستون چپِ خالی صفحه؛ باکس‌های اطلاعات/دستگاه‌ها کمی
//    باریک‌تر می‌شوند تا این باکس زیبا کنارشان بنشیند (گرید والد).
//  • محتوا همان سرچشمه‌ی مودال قوانین (termsContentOptions) + انتخاب
//    sectionsAr وقتی زبان فعال عربی است.
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { termsContentOptions } from '#/utils/queryOptions'
import type { TermsSection } from '#/server/terms'
import { useI18n } from '#/i18n'

export const TermsBox = memo(function TermsBox() {
  const { t, fmt, lang } = useI18n()
  const { data: terms, isLoading } = useQuery(termsContentOptions)

  // عربی فقط وقتی موجود باشد (وگرنه فارسی)
  const faSections: TermsSection[] = terms?.sections ?? []
  const arSections: TermsSection[] | null | undefined = terms?.sectionsAr
  const sections: TermsSection[] =
    lang === 'ar' && arSections && arSections.length > 0 ? arSections : faSections

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm xl:sticky xl:top-6">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4">{t['terms.title']}</h2>
      {/* ارتفاع ثابت + اسکرول عمودی (خواسته‌ی صریح) */}
      <div className="h-[420px] xl:h-[560px] overflow-y-auto pl-1 space-y-5">
        {isLoading ? (
          <div className="space-y-4 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
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
  )
})