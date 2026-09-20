// src/components/site/checkout/AddressSelector.tsx
import { memo, useCallback } from 'react'
import { Plus, Pin } from 'reicon-react'

interface AddressItem {
  id: string
  title: string
  address: string
}

interface AddressSelectorProps {
  addresses: AddressItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenModal: () => void
}

export const AddressSelector = memo(function AddressSelector({ addresses, selectedId, onSelect, onOpenModal }: AddressSelectorProps) {
  const handleSelect = useCallback((id: string) => onSelect(id), [onSelect])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">آدرس تحویل</h2>
        <button
          type="button"
          onClick={onOpenModal}
          className="text-sm text-primary dark:text-dark-primary font-DanaDemiBold cursor-pointer flex items-center gap-1"
        >
          <Plus size={16} />
          آدرس جدید
        </button>
      </div>

      {addresses.length === 0 ? (
        <div className="text-center py-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-4 flex items-center justify-center gap-2">
            <Pin size={18} />
            شما هنوز آدرسی ثبت نکرده‌اید
          </p>
          <button
            type="button"
            onClick={onOpenModal}
            className="px-4 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium cursor-pointer"
          >
            ثبت اولین آدرس
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr) => (
            <label
              key={addr.id}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                selectedId === addr.id
                  ? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
                  : 'border-gray-200 dark:border-[#3a151c]'
              }`}
            >
              <input
                type="radio"
                name="address"
                checked={selectedId === addr.id}
                onChange={() => handleSelect(addr.id)}
                className="w-4 h-4 accent-primary dark:accent-dark-primary mt-1"
              />
              <div>
                <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm mb-1">{addr.title}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">{addr.address}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
})