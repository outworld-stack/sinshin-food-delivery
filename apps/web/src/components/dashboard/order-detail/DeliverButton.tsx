// src/components/dashboard/order-detail/DeliverButton.tsx
import { memo } from 'react'
import { Check } from 'reicon-react'

interface DeliverButtonProps {
  isSubmitting: boolean
  onConfirm: () => void
}

// آیتم ۱۶: کاربر با این دکمه سفارش رو از هر وضعیت پیش‌تحویل به DELIVERED نهایی می‌کنه
export const DeliverButton = memo(function DeliverButton({ isSubmitting, onConfirm }: DeliverButtonProps) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      disabled={isSubmitting}
      className="w-full py-4 rounded-2xl bg-green-500 text-white font-DanaDemiBold text-lg hover:bg-green-600 transition shadow-sm hover:shadow-lg hover:shadow-green-500/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
    >
      <Check size={24} />
      {isSubmitting ? 'در حال ثبت...' : 'تحویل گرفتم'}
    </button>
  )
})