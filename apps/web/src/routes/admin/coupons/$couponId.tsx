// src/routes/admin/coupons/$couponId.tsx
// phase-9: صفحه‌ی اختصاصی هر کوپن — قبلاً مودال بود که با تاریخ invalid
// کرش می‌کرد (RangeError: Invalid time value). حالا: کارت وضعیت + ویرایش
// + حذف، همه از قرارداد واقعی سرور (coupon/conditions/recipientsCount).
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteCoupon, updateCoupon } from '#/server/coupons'
import { adminCouponDetailsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { CouponForm, type CouponFormPayload } from '#/components/admin/coupons/CouponForm'
import { AdminCouponsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ConfirmModal } from '#/components/ConfirmModal'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'
import {
  couponStatus,
  couponStatusLabel,
  couponStatusBadgeClass,
  formatCouponExpiry,
  couponAudienceLabel,
  formatCouponUsage,
} from '#/utils/couponDisplay'
import { ChevronRight, Trash2 } from 'reicon-react'
import { useState } from 'react'

export const Route = createFileRoute('/admin/coupons/$couponId')({
  ssr: false,
  component: CouponDetailPage,
  pendingComponent: AdminCouponsPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'جزئیات کوپن | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})

function CouponDetailPage() {
  const { couponId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  const { isMainAdmin } = usePermissions()
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  const { data, isLoading } = useQuery(adminCouponDetailsOptions(couponId))

  const updateMut = useMutation({
    mutationFn: (data: CouponFormPayload) => updateCoupon({ id: couponId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
      queryClient.invalidateQueries({ queryKey: qk.adminCouponDetails(couponId) })
      showToast('کوپن ویرایش شد')
      navigate({ to: '/admin/coupons' })
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteCoupon(couponId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
      // حذف در این پروژه = غیرفعال‌سازی (سفارش‌های در جریان سالم می‌مانند)
      showToast('کوپن غیرفعال شد')
      navigate({ to: '/admin/coupons' })
    },
  })

  if (!isMainAdmin) {
    return <PermissionGate hasAccess={false} pageName="جزئیات کوپن" />
  }

  if (isLoading || !data) {
    return <AdminCouponsPageSkeleton />
  }

  const c = data.coupon
  const status = couponStatus(c)

  const handleOpenDelete = () => setIsDeleteModalOpen(true)
  const handleCloseDelete = () => setIsDeleteModalOpen(false)
  const handleConfirmDelete = () => deleteMut.mutate()

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          to="/admin/coupons"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary dark:hover:text-dark-primary transition-colors mb-3"
        >
          <ChevronRight size={14} />
          بازگشت به کوپن‌ها
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
              کوپن <span dir="ltr" className="font-mono">{c.code}</span>
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
              مشاهده و ویرایش جزئیات کوپن
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenDelete}
            disabled={deleteMut.isPending || !c.isActive}
            className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-500 text-sm font-DanaMedium hover:bg-red-100 dark:hover:bg-red-500/20 transition cursor-pointer flex items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Trash2 size={16} />
            {c.isActive ? 'غیرفعال‌سازی کوپن' : 'غیرفعال شده'}
          </button>
        </div>
      </div>

      {/* ── کارت وضعیت — گرید پاسخ‌گو ── */}
      <section className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">تخفیف</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary">{c.discountPercentage}٪</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">وضعیت</p>
            <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${couponStatusBadgeClass(status)}`}>
              {couponStatusLabel(status)}
            </span>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">انقضا</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">{formatCouponExpiry(c.endsAt)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">مخاطب</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">{couponAudienceLabel(c.isPublic)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">دریافت‌کنندگان</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {c.isPublic ? '—' : `${data.recipientsCount} نفر`}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">مصرف</p>
            <p className="text-xs text-gray-600 dark:text-gray-300" dir="ltr">
              {formatCouponUsage(c.usedCount, c.maxUses)}
            </p>
          </div>
        </div>

        {!c.isPublic && data.conditions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-2">
              شرط‌های هدف‌یابی ({data.conditions.length} مورد)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.conditions.map((cond) => (
                <span
                  key={cond.id}
                  dir="ltr"
                  className="text-[10px] font-mono text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 px-2 py-1 rounded-full"
                >
                  {cond.type}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── ویرایش ── */}
      <CouponForm
        initialData={data}
        onSubmit={(payload) => updateMut.mutate(payload)}
        onCancel={() => navigate({ to: '/admin/coupons' })}
        isSubmitting={updateMut.isPending}
        submitLabel="ذخیره تغییرات"
      />

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="غیرفعال‌سازی کوپن"
        message="این کوپن غیرفعال می‌شود و دیگر قابل استفاده نخواهد بود. سفارش‌های در جریان که قبلاً از آن استفاده کرده‌اند سالم می‌مانند. ادامه می‌دهید؟"
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDelete}
      />
    </div>
  )
}
