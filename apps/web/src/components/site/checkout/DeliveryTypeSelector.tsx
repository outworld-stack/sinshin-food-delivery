// src/components/site/checkout/DeliveryTypeSelector.tsx
import { memo } from 'react'
import { formatPrice } from '#/utils/format'
import type { DeliveryType } from '#/types/site/checkout'

interface DeliveryTypeSelectorProps {
  deliveryType: DeliveryType
  deliveryFee: number
  onChange: (t: DeliveryType) => void
}

const OPTIONS: { key: DeliveryType; title: string; sub: string }[] = [
  { key: 'DELIVERY', title: 'ارسال با پیک', sub: 'هزینه پیک' },
  { key: 'DINE_IN', title: 'تحویل حضوری', sub: 'بدون هزینه ارسال' },
]

export const DeliveryTypeSelector = memo(function DeliveryTypeSelector({ deliveryType, deliveryFee, onChange }: DeliveryTypeSelectorProps) {
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">نوع تحویل سفارش</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {OPTIONS.map((opt) => (
          <label
            key={opt.key}
            className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${
              deliveryType === opt.key
                ? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
                : 'border-gray-200 dark:border-[#3a151c]'
            }`}
          >
            <input
              type="radio"
              name="deliveryType"
              checked={deliveryType === opt.key}
              onChange={() => onChange(opt.key)}
              className="w-4 h-4 accent-primary dark:accent-dark-primary"
            />
            <div>
              <p className="font-DanaDemiBold text-gray-800 dark:text-white">{opt.title}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {opt.key === 'DELIVERY' ? `${formatPrice(deliveryFee)} تومان` : opt.sub}
              </p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
})