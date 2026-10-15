// src/routes/admin/coupons/$couponId.tsx
// phase-9: صفحه‌ی اختصاصی هر کوپن — قبلاً مودال بود که با تاریخ invalid
// کرش می‌کرد (RangeError: Invalid time value). حالا: کارت وضعیت + ویرایش
// + حذف، همه از قرارداد واقعی سرور (coupon/conditions/recipientsCount).
// stage-10: دکمه‌ی وضعیت حالا تغییر وضعیت می‌دهد — فعال‌سازی مجدد بعد از غیرفعال‌سازی.
// stage-65: ① دکمه‌ی وضعیت = غیرفعال‌سازی/فعال‌سازی نرم (مسیر /status)
//          ② دکمه‌ی جداگانه‌ی «حذف کامل» = حذف واقعی + پاک شدن تاریخچه‌ی مصرف
//          ③ سکشن «مصرف‌کنندگان» — تاریخچه‌ی redemption با صفحه‌بندی سروری

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ArrowRotate, Ban, ChevronRight, Profile2user, Trash2 } from 'reicon-react'
import { CouponForm, type CouponFormPayload } from '#/components/admin/coupons/CouponForm'
import { ConfirmModal } from '#/components/ConfirmModal'
import { AdminCouponsPageSkeleton } from '#/components/LoadingSkeletons'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { useCouponActivate, useCouponDeactivate, useCouponDelete } from '#/hooks/admin/useCouponMutations'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { updateCoupon } from '#/server/coupons'
import { useToastStore } from '#/stores/toastStore'
import {
  couponAudienceLabel,
  couponStatus,
  couponStatusBadgeClass,
  couponStatusLabel,
  formatCouponExpiry,
  formatCouponUsage,
} from '#/utils/couponDisplay'
import { qk } from '#/utils/queryKeys'
import { adminCouponConsumersOptions, adminCouponDetailsOptions } from '#/utils/queryOptions'

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

const CONSUMERS_PAGE_SIZE = 20

const formatUsedAt = (iso: string): string => {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(t))
}

function CouponDetailPage() {
  const { couponId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  const { isMainAdmin } = usePermissions()
  // stage-65 — دو مودال جدا: غیرفعال‌سازی نرم / حذف کامل
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  // stage-65 — صفحه‌ی فعلی لیست مصرف‌کنندگان
  const [consumersPage, setConsumersPage] = useState(1)

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

  // stage-65 — حذف واقعی: DELETE (ردیف + تاریخچه‌ی مصرف با cascade)
  const deleteMut = useCouponDelete({
    couponId,
    onDeleted: () => navigate({ to: '/admin/coupons' }),
  })

  // stage-65 — غیرفعال‌سازی نرم (برگشت‌پذیر): PATCH /status
  const deactivateMut = useCouponDeactivate({ couponId })

  // stage-10: فعال‌سازی مجدد — در جای خود می‌ماند (بدون ناوبری)
  const activateMut = useCouponActivate({ couponId })

  // stage-65 — مصرف‌کنندگان واقعی (redemptions)؛ صفحه در کلید کش
  const { data: consumers, isLoading: consumersLoading } = useQuery(
    adminCouponConsumersOptions(couponId, consumersPage),
  )

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((consumers?.total ?? 0) / CONSUMERS_PAGE_SIZE)),
    [consumers?.total],
  )

  if (!isMainAdmin) {
    return <PermissionGate hasAccess={false} pageName="جزئیات کوپن" />
  }

  if (isLoading || !data) {
    return <AdminCouponsPageSkeleton />
  }

  const c = data.coupon
  const status = couponStatus(c)

  const handleOpenDeactivate = () => setIsDeactivateModalOpen(true)
  const handleCloseDeactivate = () => setIsDeactivateModalOpen(false)
  const handleConfirmDeactivate = () => deactivateMut.mutate()
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
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* stage-10/stage-65: وضعیت — فعال: غیرفعال‌سازی نرم (با تایید)؛
                غیرفعال: فعال‌سازی؛ منقضی: غیرقابل فعال‌سازی تا ویرایش انقضا */}
            {c.isActive ? (
              <button
                type="button"
                onClick={handleOpenDeactivate}
                disabled={deactivateMut.isPending}
                className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-white/10 transition cursor-pointer flex items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Ban size={16} />
                {deactivateMut.isPending ? 'در حال انجام...' : 'غیرفعال‌سازی'}
              </button>
            ) : status === 'EXPIRED' ? (
              <button
                type="button"
                disabled
                title="تاریخ انقضا گذشته — ابتدا انقضا را ویرایش کنید"
                className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-400 text-sm font-DanaMedium cursor-not-allowed flex items-center gap-2 justify-center shrink-0"
              >
                <ArrowRotate size={16} />
                منقضی — ابتدا انقضا را ویرایش کنید
              </button>
            ) : (
              <button
                type="button"
                onClick={() => activateMut.mutate()}
                disabled={activateMut.isPending}
                className="px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-DanaMedium hover:bg-green-100 dark:hover:bg-green-500/20 transition cursor-pointer flex items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowRotate size={16} />
                {activateMut.isPending ? 'در حال انجام...' : 'فعال‌سازی کوپن'}
              </button>
            )}

            {/* stage-65 — حذف کامل (غیرقابل برگشت): ردیف + تاریخچه‌ی مصرف پاک می‌شوند */}
            <button
              type="button"
              onClick={handleOpenDelete}
              disabled={deleteMut.isPending}
              className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-500 text-sm font-DanaMedium hover:bg-red-100 dark:hover:bg-red-500/20 transition cursor-pointer flex items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={16} />
              {deleteMut.isPending ? 'در حال حذف...' : 'حذف کامل'}
            </button>
          </div>
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
          {/* stage-66 — عمومی: سقف مصرف هر کاربر (به‌جای دریافت‌کنندگان که برای عمومی «—» است)؛ خصوصی: گرنت یکتا = ۱ */}
          {c.isPublic ? (
            <div>
              <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">سقف هر کاربر</p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {c.maxPerUser === 0 ? 'نامحدود' : `${c.maxPerUser} بار`}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">دریافت‌کنندگان</p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {`${data.recipientsCount} نفر`}
              </p>
            </div>
          )}
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
              شرط‌های هدف‌گیری ({data.conditions.length} مورد)
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

      {/* ── stage-65: مصرف‌کنندگان کوپن — تاریخچه‌ی redemption ── */}
      <section className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-DanaDemiBold text-gray-800 dark:text-white flex items-center gap-2">
            <Profile2user size={18} className="text-primary dark:text-dark-primary shrink-0" />
            مصرف‌کنندگان کوپن
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {consumers ? `${consumers.total} نفر` : '...'}
          </span>
        </div>

        {consumersLoading && !consumers ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 font-DanaMedium text-sm">
            در حال بارگذاری...
          </div>
        ) : (consumers?.rows.length ?? 0) === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 font-DanaMedium text-sm">
            هنوز کسی این کوپن را مصرف نکرده است.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {(consumers?.rows ?? []).map((r) => (
                <div
                  key={`${r.userId}-${r.orderDisplayId ?? 'no-order'}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e]"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 dark:text-white font-DanaMedium truncate">
                      {r.name ?? 'بدون نام'}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400" dir="ltr">
                      {r.phone}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] text-gray-400 font-DanaMedium">سفارش</p>
                      <p className="text-[11px] text-gray-600 dark:text-gray-300" dir="ltr">
                        {r.orderDisplayId ?? '—'}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] text-gray-400 font-DanaMedium">زمان مصرف</p>
                      <p className="text-[11px] text-gray-600 dark:text-gray-300">
                        {formatUsedAt(r.usedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setConsumersPage((p) => Math.max(1, p - 1))}
                  disabled={consumersPage <= 1}
                  className="px-4 py-2 min-h-11 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 text-xs font-DanaMedium hover:bg-gray-200 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  صفحه قبلی
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium" dir="ltr">
                  {consumersPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setConsumersPage((p) => Math.min(totalPages, p + 1))}
                  disabled={consumersPage >= totalPages}
                  className="px-4 py-2 min-h-11 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 text-xs font-DanaMedium hover:bg-gray-200 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  صفحه بعدی
                </button>
              </div>
            )}
          </>
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

      {/* stage-65 — مودال غیرفعال‌سازی نرم (برگشت‌پذیر) */}
      <ConfirmModal
        isOpen={isDeactivateModalOpen}
        title="غیرفعال‌سازی کوپن تخفیف"
        message="این کوپن موقتاً غیرفعال می‌شود و تا فعال‌سازی مجدد قابل استفاده نیست. مصرف‌کنندگان و تاریخچه‌ی کوپن حفظ می‌شوند و هر زمان می‌توانید دوباره فعالش کنید. ادامه می‌دهید؟"
        onConfirm={handleConfirmDeactivate}
        onCancel={handleCloseDeactivate}
      />

      {/* stage-65 — مودال حذف کامل (غیرقابل برگشت) */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="حذف کامل کوپن"
        message="این عملیات غیرقابل برگشت است: کوپن به‌همراه شرط‌ها، گرنت‌ها و کل تاریخچه‌ی مصرف‌کنندگانش از دیتابیس حذف می‌شود. سفارش‌ها و سوابق مالی سالم می‌مانند (فقط پیوندشان به این کوپن قطع می‌شود). اگر فقط می‌خواهید کوپن موقتاً خاموش شود، از «غیرفعال‌سازی» استفاده کنید. مطمئن هستید؟"
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDelete}
      />
    </div>
  )
}