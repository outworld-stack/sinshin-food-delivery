// src/components/admin/admin2/NoteModal.tsx
import { memo, useCallback } from 'react'
import { Stickynote, Check } from 'reicon-react'

interface NoteModalProps {
  orderId: string
  note: string
  onClose: () => void
  onConfirm: () => void
}

// آیتم: دیدن نکته اجباری → تیک → سفارش قابل پردازش
export const NoteModal = memo(function NoteModal({ orderId, note, onClose, onConfirm }: NoteModalProps) {
  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      {/* بدون بستن با کلیک بک‌دراپ — مجبور به دیدن باشه */}
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white flex items-center gap-2">
            <Stickynote size={20} className="text-orange-500" />
            نکته مشتری — سفارش {orderId}
          </h3>
        </div>

        <div className="p-4 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 mb-6">
          <p className="text-sm text-orange-700 dark:text-orange-300 font-DanaMedium leading-relaxed">
            {note}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-3 rounded-xl bg-green-500 text-white font-DanaDemiBold hover:bg-green-600 transition cursor-pointer flex items-center justify-center gap-2"
          >
            <Check size={18} />
            دیدم و متوجه شدم
          </button>
        </div>
      </div>
    </div>
  )
})