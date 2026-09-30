// src/components/site/checkout/AddAddressModal.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addUserAddress } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { MapPicker } from '#/components/shared/MapPicker'
import { X } from 'reicon-react'
import { useI18n } from '#/i18n'

interface AddAddressModalProps {
  onClose: () => void
}

export const AddAddressModal = memo(function AddAddressModal({ onClose }: AddAddressModalProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [title, setTitle] = useState('')
  const [addressText, setAddressText] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  const mutation = useMutation({
    mutationFn: (data: { title: string; address: string; lat: number; lng: number }) => addUserAddress(data),
    onSuccess: () => {
      // ⬅ NEW: کلید از فکتوری مرکزی — هم‌hash با کوئری پروفایل در ۸ مصرف‌کننده
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      showToast(t['checkout.addressAdded'])
      onClose()
    },
  })

  const handleCoords = useCallback((c: { lat: number; lng: number }) => setCoords(c), [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!coords) { showToast(t['checkout.pickLocation'], 'error'); return }
    mutation.mutate({ title, address: addressText, lat: coords.lat, lng: coords.lng })
  }, [coords, title, addressText, mutation, showToast, t])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">{t['checkout.addAddressTitle']}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 cursor-pointer p-1">
            <X size={24} />
          </button>
        </div>

        {/* نقشه — انتخابگر مشترک */}
        <div className="mb-4">
          <MapPicker value={coords} onChange={handleCoords} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
            placeholder={t['checkout.titlePlaceholder']}
          />
          <textarea
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            required
            className="w-full h-24 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white resize-none"
            placeholder={t['checkout.addressPlaceholder']}
          />
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer">{t['common.cancel']}</button>
            <button type="submit" disabled={mutation.isPending || !coords} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer disabled:opacity-50">
              {mutation.isPending ? t['checkout.saving'] : t['checkout.save']}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})
