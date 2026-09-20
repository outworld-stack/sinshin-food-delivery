// src/components/shared/ActionModal.tsx
import { memo } from 'react'

interface ActionModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText: string
  cancelText?: string
  confirmColor?: 'primary' | 'green' | 'red'
  onConfirm: () => void
  onCancel: () => void
}

const COLOR_MAP = {
  primary: 'bg-primary dark:bg-dark-primary hover:opacity-90',
  green: 'bg-green-500 hover:bg-green-600',
  red: 'bg-red-500 hover:bg-red-600',
}

// جانشین عمومی ConfirmModal برای اکشن‌های غیر حذف — بدون آیکون سطل
export const ActionModal = memo(function ActionModal({
  isOpen, title, message, confirmText, cancelText = 'انصراف',
  confirmColor = 'primary', onConfirm, onCancel,
}: ActionModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-sm text-center space-y-4">
        <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition">
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl text-white font-DanaDemiBold cursor-pointer transition ${COLOR_MAP[confirmColor]}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
})