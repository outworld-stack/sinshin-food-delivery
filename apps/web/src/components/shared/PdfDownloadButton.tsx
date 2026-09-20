// src/components/shared/PdfDownloadButton.tsx
import { memo, useCallback } from 'react'
import { Download } from 'reicon-react'
import { useToastStore } from '#/stores/toastStore'

interface PdfDownloadButtonProps {
  documentId: string      // فاز بک‌اند: شناسه سند برای API واقعی
  documentType: string    // فاز بک‌اند: نوع سند
  targetSelector?: string // سلکتور محتوای قابل چاپ — نتایج فیلترشده
  label?: string
}

// موک فعلی: کلون محتوا → چاپ (Save as PDF)
// فاز بک‌اند: بدنه handleDownload با API جایگزین می‌شود — پراپ‌ها ثابت
export const PdfDownloadButton = memo(function PdfDownloadButton({
  documentId, documentType, targetSelector, label = 'دانلود PDF',
}: PdfDownloadButtonProps) {
  const showToast = useToastStore((s) => s.showToast)

  const handleDownload = useCallback(() => {
    const source = targetSelector ? document.querySelector(targetSelector) : null
    if (source) {
      const area = document.createElement('div')
      area.id = 'dynamic-print-area'
      area.innerHTML = source.innerHTML
      document.body.appendChild(area)
      window.print()
      const cleanup = () => area.remove()
      window.addEventListener('afterprint', cleanup, { once: true })
      setTimeout(cleanup, 10000) // fallback
    } else {
      window.print()
    }
    showToast('از گزینه «Save as PDF» در پنجره چاپ استفاده کنید')
  }, [targetSelector, showToast])

  return (
    <button
      type="button"
      onClick={handleDownload}
      data-document-id={documentId}
      data-document-type={documentType}
      className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-2 text-sm shrink-0"
    >
      <Download size={16} />
      {label}
    </button>
  )
})