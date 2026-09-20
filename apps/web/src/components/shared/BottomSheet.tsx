// src/components/shared/BottomSheet.tsx
import { memo, useCallback, useEffect, type ReactNode } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** نقطه‌ی شکست مخفی‌سازی — فیلتر موبایل محصولات: 'md:hidden'، سفارشات: 'sm:hidden' */
  hideOnDesktop?: string
}

// شیت پایینِ موبایل — واحد (به‌جای ۵ کپی)
// + کلید Escape می‌بندد + اسکرول بدنه موقع باز بودن قفل می‌شود (رفع F-23)
export const BottomSheet = memo(function BottomSheet({
  isOpen, onClose, title, children, hideOnDesktop = 'md:hidden',
}: BottomSheetProps) {
  const handleBackdrop = useCallback(() => onClose(), [onClose])

  // Escape + قفل اسکرول
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-100 ${hideOnDesktop}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleBackdrop}></div>
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a0a0e] p-6 pt-2 rounded-t-3xl border-t border-gray-200 dark:border-[#3a151c] max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6"></div>
        <h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-6">{title}</h2>
        {children}
      </div>
    </div>
  )
})