// src/components/dashboard/addresses/AddressFormModal.tsx
import { memo, useState, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addUserAddress, updateUserAddress } from '#/server/user'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { MapPicker } from '#/components/shared/MapPicker'
import { X } from 'reicon-react'

interface AddressItem {
  id: string
  title: string
  address: string
  lat: number
  lng: number
}

interface AddressFormModalProps {
  editing: AddressItem | null   // تهی = ساخت جدید
  onClose: () => void
}

export const AddressFormModal = memo(function AddressFormModal({ editing, onClose }: AddressFormModalProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [title, setTitle] = useState('')
  const [addressText, setAddressText] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  // هیدراته در حالت ویرایش (پین ریست می‌شود — کاربر دوباره تعیین می‌کند)
  useEffect(() => {
    if (editing) {
      setTitle(editing.title)
      setAddressText(editing.address)
      setCoords({ lat: editing.lat, lng: editing.lng })
    } else {
      setTitle('')
      setAddressText('')
      setCoords(null)
    }
  }, [editing])

  const mutation = useMutation({
    mutationFn: (data: { id?: string; title: string; address: string; lat: number; lng: number }) => {
      if (data.id) {
        return updateUserAddress({ id: data.id, title: data.title, address: data.address, lat: data.lat, lng: data.lng })

      }
      return addUserAddress({ title: data.title, address: data.address, lat: data.lat, lng: data.lng })
    },
    onSuccess: () => {
      // ⬅ NEW: کلید از فکتوری مرکزی — هم‌hash با کوئری پروفایل در ۸ مصرف‌کننده
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      showToast(editing ? 'آدرس با موفقیت ویرایش شد' : 'آدرس جدید با موفقیت اضافه شد')
      onClose()
    },
  })

  const handleCoords = useCallback((c: { lat: number; lng: number }) => setCoords(c), [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!coords) { showToast('لطفاً موقعیت را روی نقشه انتخاب کنید', 'error'); return }
    mutation.mutate({ id: editing?.id, title, address: addressText, lat: coords.lat, lng: coords.lng })
  }, [coords, editing, title, addressText, mutation, showToast])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-6">
          <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
            {editing ? 'ویرایش آدرس' : 'افزودن آدرس جدید'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer p-1">
            <X size={24} />
          </button>
        </div>

        {/* نقشه — انتخابگر مشترک */}
        <div className="mb-4">
          <MapPicker value={coords} onChange={handleCoords} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">عنوان</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white"
              placeholder="مثلاً: خانه، محل کار"
            />
          </div>
          <div>
            <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">آدرس دقیق</label>
            <textarea
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              required
              className="w-full h-24 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white resize-none"
              placeholder="خیابان، کوچه، پلاک و..."
            ></textarea>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer">انصراف</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50">
              {mutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})