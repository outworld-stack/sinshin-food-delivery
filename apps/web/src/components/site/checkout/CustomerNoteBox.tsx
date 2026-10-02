// src/components/site/checkout/CustomerNoteBox.tsx
import { memo, useCallback } from 'react'
import { MessageSquare } from 'reicon-react'
import { useI18n } from '#/i18n'

interface CustomerNoteBoxProps {
  value: string
  onChange: (v: string) => void
}

export const CustomerNoteBox = memo(function CustomerNoteBox({ value, onChange }: CustomerNoteBoxProps) {
  const { t, fmt } = useI18n()
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value) // برش ۳۰۰ کاراکتری داخل کاهنده
  }, [onChange])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white flex items-center gap-2">
          <MessageSquare size={20} className="text-primary dark:text-dark-primary" />
          {t['checkout.noteTitle']}
        </h2>
        <span className="text-xs text-gray-400 font-DanaMedium">{fmt.num(value.length)}/{fmt.num(300)}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-3">
        {t['checkout.noteHint']}
      </p>
      <textarea
        value={value}
        onChange={handleChange}
        maxLength={300}
        className="w-full h-24 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white resize-none font-DanaMedium"
        placeholder={t['checkout.notePlaceholder']}
      />
    </div>
  )
})