// src/components/admin/user-detail/AddressesBox.tsx
import { memo, useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteUserAddress, type AdminUserDetails } from '#/server/admin'
import { Pagination } from '#/components/Pagination'
import { ConfirmModal } from '#/components/ConfirmModal'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { Trash2 } from 'reicon-react'

type AddressRow = AdminUserDetails['addresses'][number]

interface AddressesBoxProps {
  addresses: AddressRow[]
  userId: string
}

export const AddressesBox = memo(function AddressesBox({ addresses, userId }: AddressesBoxProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(5)
  const [addressToDelete, setAddressToDelete] = useState<string | null>(null)

  const deleteMut = useMutation({
    mutationFn: (addressId: string) => deleteUserAddress({ data: { userId, addressId } }),
    onSuccess: () => {
      // ⬅ NEW: کلید از فکتوری مرکزی — هم‌hash با کوئری مشترک صفحه‌ی $userId
      queryClient.invalidateQueries({ queryKey: qk.adminUserDetails(userId) })
      showToast('آدرس با موفقیت حذف شد')
      setAddressToDelete(null)
    },
  })

  const openDeleteModal = useCallback((id: string) => setAddressToDelete(id), [])
  const closeDeleteModal = useCallback(() => setAddressToDelete(null), [])
  const confirmDelete = useCallback(() => {
    if (addressToDelete) deleteMut.mutate(addressToDelete)
  }, [addressToDelete, deleteMut])

  const totalPages = Math.ceil(addresses.length / limit)
  const safePage = Math.min(page, totalPages || 1)
  const current = addresses.slice((safePage - 1) * limit, safePage * limit)

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-4">آدرس‌های کاربر</h3>
      <div className="space-y-4">
        {current.map(addr => (
          <div key={addr.id} className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">

            <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 items-start text-center xl:text-right">
                <div className="flex flex-col gap-1 items-center xl:items-start">
                  <p className="text-[10px] text-gray-400 font-DanaMedium">آدرس کامل</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 wrap-break-word">{addr.address}</p>
                </div>
                <div className="flex flex-col gap-1 items-center xl:items-start">
                  <p className="text-[10px] text-gray-400 font-DanaMedium">مختصات جغرافیایی</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400" dir="ltr">{addr.lat.toFixed(4)}, {addr.lng.toFixed(4)}</p>
                </div>
                <div className="flex flex-col gap-1 items-center xl:items-start">
                  <p className="text-[10px] text-gray-400 font-DanaMedium">سفارشات ارسالی</p>
                  <p className="text-sm font-DanaDemiBold text-primary dark:text-dark-primary">{addr.orderCount} سفارش</p>
                </div>
              </div>

              <div className="flex justify-center sm:justify-end sm:shrink-0 sm:self-start">
                <button
                  onClick={() => openDeleteModal(addr.id)}
                  className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
                  aria-label="حذف آدرس"
                >
                  <Trash2 size={18} />
                </button>
              </div>

            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-6">
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            itemsPerPage={limit}
            totalItems={addresses.length}
            onPageChange={setPage}
            onItemsPerPageChange={(v) => { setLimit(v); setPage(1) }}
            pageSizeOptions={[5, 10]}
          />
        </div>
      )}

      <ConfirmModal
        isOpen={addressToDelete !== null}
        title="حذف آدرس"
        message="آیا از حذف این آدرس مطمئن هستید؟ این عملیات قابل بازگشت نیست."
        onConfirm={confirmDelete}
        onCancel={closeDeleteModal}
      />
    </div>
  )
})