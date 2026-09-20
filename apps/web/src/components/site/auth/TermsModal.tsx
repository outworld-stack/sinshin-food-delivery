// src/components/site/auth/TermsModal.tsx
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { termsContentOptions } from '#/utils/queryOptions'
import type { TermsSection } from '#/server/terms'
import { formatDate, faNum } from '#/utils/format'
import { X, Check } from 'reicon-react'

interface TermsModalProps {
  isOpen: boolean
  onClose: () => void
  onReadComplete: () => void   // وقتی کاربر تا انتهای متن اسکرول کرد
}

// مدال قوانین — متن از سرور (نسخه‌دار و قابل ویرایش)
// چک‌باکس قوانین تا اسکرول تا انتها فعال نمی‌شود
export const TermsModal = memo(function TermsModal({ isOpen, onClose, onReadComplete }: TermsModalProps) {
  const [hasRead, setHasRead] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // متن قوانین — از فکتوری مشترک؛ همون کش ادیتور ادمین (کلید terms-content)
  const { data: terms, isLoading } = useQuery(termsContentOptions)

  // هر بار باز می‌شود → وضعیت مطالعه ریست
  useEffect(() => {
    if (isOpen) setHasRead(false)
  }, [isOpen])

  const handleScroll = useCallback(() => {
    if (hasRead) return
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30
    if (atBottom) {
      setHasRead(true)
      onReadComplete()
    }
  }, [hasRead, onReadComplete])

  if (!isOpen) return null

  const sections: TermsSection[] = terms?.sections ?? []

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div className="relative bg-white dark:bg-[#2a1015] rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* هدر */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/5 shrink-0">
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">قوانین و شرایط سین‌شین</h3>
          <button type="button" onClick={onClose} className="text-gray-500 cursor-pointer p-1" aria-label="بستن">
            <X size={22} />
          </button>
        </div>

        {/* محتوای اسکرولی — از سرور */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-5 space-y-5"
        >
          {isLoading ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-32 rounded bg-gray-200 dark:bg-[#1a0a0e] animate-pulse" />
                  <div className="h-3 w-full rounded bg-gray-100 dark:bg-[#2a1015] animate-pulse" />
                  <div className="h-3 w-5/6 rounded bg-gray-100 dark:bg-[#2a1015] animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {sections.map((section, i) => (
                <div key={i}>
                  <h4 className="font-DanaDemiBold text-sm text-gray-800 dark:text-white mb-2">
                    {section.title}
                  </h4>
                  <ul className="space-y-2">
                    {section.items.map((item, j) => (
                      <li key={j} className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary dark:bg-dark-primary mt-1.5 shrink-0"></span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {terms && (
                <p className="text-[10px] text-gray-400 text-center pt-2">
                  نسخه {faNum(terms.version)} — به‌روزرسانی: {formatDate(terms.updatedAt)}
                </p>
              )}
            </>
          )}
        </div>

        {/* فوتر — وضعیت مطالعه */}
        <div className="p-5 border-t border-gray-100 dark:border-white/5 shrink-0">
          {hasRead ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Check size={18} />
              خواندم — بازگشت
            </button>
          ) : (
            <p className="text-xs text-orange-500 font-DanaMedium text-center leading-relaxed">
              برای فعال شدن چک‌باکس قوانین، متن را تا انتهای همین صفحه اسکرول کنید
            </p>
          )}
        </div>
      </div>
    </div>
  )
})