// src/routes/dashboard/addresses/index.tsx
// ⬅ NEW: loader پری‌فچ + pendingComponent (بقیه مثل قبل)
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { memo, useMemo } from 'react'
import { userProfileLightOptions } from '#/utils/queryOptions'
import { useAddressesPage } from '#/hooks/dashboard/useAddressesPage'
import { AddressCard } from '#/components/dashboard/addresses/AddressCard'
import { AddressFormModal } from '#/components/dashboard/addresses/AddressFormModal'
import { ConfirmModal } from '#/components/ConfirmModal'
import { DashboardAddressesSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { Plus } from 'reicon-react'


const AddressesPage = memo(function AddressesPage() {
  // کار-۶: این صفحه فقط آدرس‌ها را می‌خواهد — پروفایل سبک (آدرس‌ها داخلش هستند)
  const { data: user, isLoading } = useQuery(userProfileLightOptions)

  const page = useAddressesPage()

  const addresses = useMemo(() => user?.addresses ?? [], [user])

  // آدرسِ در حال ویرایش — از editingId پیدا می‌شه
  const editingAddress = useMemo(
    () => (page.state.editingId ? addresses.find(a => a.id === page.state.editingId) ?? null : null),
    [page.state.editingId, addresses],
  )

  if (isLoading || !user) {
    return <DashboardAddressesSkeleton />
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-2">آدرس‌های من</h1>
          <p className="text-gray-500 dark:text-gray-400 font-DanaMedium">آدرس‌های خود را برای تحویل سفارشات مدیریت کنید.</p>
        </div>
        <button
          type="button"
          onClick={page.handleOpenNew}
          className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2 shrink-0"
        >
          <Plus size={16} />
          آدرس جدید
        </button>
      </div>

      {addresses.length > 0 ? (
        <div className="space-y-4">
          {addresses.map((addr) => (
            <AddressCard
              key={addr.id}
              addr={addr}
              onEdit={page.handleOpenEdit}
              onDelete={page.handleOpenDelete}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-dashed border-gray-300 dark:border-white/5">
          <p className="text-gray-400 dark:text-gray-500 font-DanaMedium mb-4">شما هنوز آدرسی ثبت نکرده‌اید.</p>
          <button
            type="button"
            onClick={page.handleOpenNew}
            className="px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer"
          >
            ثبت اولین آدرس
          </button>
        </div>
      )}

      {/* مودال فرم — ساخت/ویرایش */}
      {page.state.isModalOpen && (
        <AddressFormModal
          editing={editingAddress}
          onClose={page.handleCloseModal}
        />
      )}

      {/* مودال حذف */}
      <ConfirmModal
        isOpen={page.state.isDeleteModalOpen}
        title="حذف آدرس"
        message="آیا از حذف این آدرس مطمئن هستید؟"
        onConfirm={page.handleConfirmDelete}
        onCancel={page.handleCloseDelete}
      />
    </div>
  )
});

export const Route = createFileRoute('/dashboard/addresses/')({
  ssr: false,
  component: AddressesPage,

  // ⬅ پری‌فچ — هاور روی «آدرس‌ها» در سایدبار => پروفایل سبک (شامل addresses) در کش؛
  // ناوبری بدون حتی یک اسکلتون. گارد والد قبل از این loader اجرا شده.
  loader: async ({ context }) => {
    await context.queryClient.query(userProfileLightOptions)
  },

  pendingComponent: DashboardAddressesSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'آدرس‌های من | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});