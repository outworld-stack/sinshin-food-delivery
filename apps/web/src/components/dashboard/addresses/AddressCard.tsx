// src/components/dashboard/addresses/AddressCard.tsx
import { memo, useCallback } from 'react'
import { Pin, Pen, Trash2 } from 'reicon-react'

interface AddressItem {
  id: string
  title: string
  address: string
  lat: number
  lng: number
}

interface AddressCardProps {
  addr: AddressItem
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

// کارت آدرس — آیتم‌های لیست (state ID پاس می‌شه، نه شیء — پراپ پایدار برای memo)
export const AddressCard = memo(function AddressCard({ addr, onEdit, onDelete }: AddressCardProps) {
  // هندلرها با id پایدار — memo واقعاً کار می‌کنه چون onEdit/onDelete از هوک useCallback شدن
  const handleEdit = useCallback(() => onEdit(addr.id), [onEdit, addr.id])
  const handleDelete = useCallback(() => onDelete(addr.id), [onDelete, addr.id])

  return (
    <div className="flex flex-row items-start justify-between p-5 rounded-2xl bg-white dark:bg-[#2a1015] border border-gray-300 dark:border-[#3a151c] shadow-sm gap-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center text-primary dark:text-dark-primary shrink-0 mt-1">
          <Pin size={20} />
        </div>
        <div>
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-lg mb-1">{addr.title}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">{addr.address}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 font-DanaMedium">مختصات: {addr.lat.toFixed(4)}, {addr.lng.toFixed(4)}</p>
        </div>
      </div>

      {/* اکشن‌ها */}
      <div className="flex flex-col sm:flex-row items-center justify-end gap-2 shrink-0 mt-1">
        <button
          type="button"
          onClick={handleEdit}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] transition cursor-pointer"
          aria-label="ویرایش"
        >
          <Pen size={18} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
          aria-label="حذف"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  )
})