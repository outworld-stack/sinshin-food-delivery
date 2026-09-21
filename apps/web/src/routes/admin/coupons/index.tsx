// src/routes/admin/coupons/index.tsx
// phase-9: بازنویسی — سه تغییر ریشه‌ای:
//  ۱) مودال حذف شد؛ ساخت/ویرایش به صفحات اختصاصی new.tsx و $couponId.tsx رفت.
//  ۲) کارت از قرارداد واقعی سرور می‌خواند (coupon.endsAt / coupon.isPublic /
//     recipientsCount) — قبلاً فیلدهای تختِ ساختگی می‌خواند که «Invalid Date»،
//     «undefined نفر»، مخاطب/وضعیت غلط می‌ساخت.
//  ۳) کل کارت کلیک‌پذیر است و به صفحه‌ی کوپن می‌رود.
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteCoupon, setCouponActive } from '#/server/coupons'
import { AdminCouponsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ConfirmModal } from '#/components/ConfirmModal'
import { useToastStore } from '#/stores/toastStore'
import { adminCouponsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import {
  couponStatus,
  couponStatusLabel,
  couponStatusBadgeClass,
  formatCouponExpiry,
  couponAudienceLabel,
  formatCouponUsage,
} from '#/utils/couponDisplay'
import { Plus, Pen, Ban, Check } from 'reicon-react'
import type { CouponWithConditionsDto } from '@sinshin/shared'
import { memo, useState, useCallback } from 'react'

// --- کارت کوپن — سه چیدمان (موبایل/تبلت/دسکتاپ) ---
// stage-10: آیکون وضعیت toggle شد — Ban برای غیرفعال‌سازی (با تایید)،
// Check برای فعال‌سازی مجدد. کوپن منقضی فقط از صفحه‌ی خودش (ویرایش انقضا).
const CouponCard = memo(function CouponCard({
  coupon: row, onEdit, onToggle, onOpen,
}: {
  coupon: CouponWithConditionsDto
  onEdit: (id: string) => void
  onToggle: (row: CouponWithConditionsDto) => void
  onOpen: (id: string) => void
}) {
  const c = row.coupon
  const status = couponStatus(c)
  const statusBadge = (
    <span className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full ${couponStatusBadgeClass(status)}`}>
      {couponStatusLabel(status)}
    </span>
  )
  const audienceBadge = (
    <span className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full ${c.isPublic
      ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
      : 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'
      }`}
    >
      {couponAudienceLabel(c.isPublic)}
    </span>
  )

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(c.id as string)
  }, [onEdit, c.id])
  // stage-10: toggle — مسیر را صفحه تعیین می‌کند (فعال → تایید حذف؛ غیرفعال → فعال‌سازی)
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle(row)
  }, [onToggle, row])
  const handleOpen = useCallback(() => onOpen(c.id as string), [onOpen, c.id])
  // کیبورد — Enter/Space روی کارت هم باز می‌کند (دکمه‌ی ویرایش همیشه هست)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(c.id as string)
    }
  }, [onOpen, c.id])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: کارتِ حاوی دکمه‌های عملیات — دکمه‌ی واقعی یعنی button تو در تو (نامعتبر)؛ ناوبری کیبورد در handleKeyDown
    <div
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4 cursor-pointer hover:border-primary dark:hover:border-dark-primary/50 transition-colors"
    >
      {/* موبایل — ۳ ستونه وسط‌چین */}
      <div className="md:hidden grid grid-cols-3 gap-3 text-center w-full">
        <div className="flex flex-col gap-3 items-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">کد</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-xs" dir="ltr">{c.code}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">انقضا</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{formatCouponExpiry(c.endsAt)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 items-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">تخفیف</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-xs">{c.discountPercentage}٪</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مخاطب</p>
            {audienceBadge}
          </div>
        </div>
        <div className="flex flex-col gap-3 items-center justify-start">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">وضعیت</p>
            {statusBadge}
          </div>
          <div className="flex gap-1 justify-center">
            <button type="button" onClick={handleEdit} aria-label="ویرایش" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
              <Pen size={16} />
            </button>
            {c.isActive ? (
              <button type="button" onClick={handleToggle} aria-label="غیرفعال‌سازی" className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
                <Ban size={16} />
              </button>
            ) : status === 'DISABLED' ? (
              <button type="button" onClick={handleToggle} aria-label="فعال‌سازی" className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 cursor-pointer">
                <Check size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* تبلت — ۳ ستونه راست‌چین */}
      <div className="hidden md:grid md:grid-cols-3 lg:hidden gap-4 items-start text-right">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">کد و تخفیف</p>
            <div className="flex flex-col">
              <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm" dir="ltr">{c.code}</p>
              <p className="text-xs text-primary dark:text-dark-primary">{c.discountPercentage}٪</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">انقضا</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{formatCouponExpiry(c.endsAt)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">مخاطب</p>
            {audienceBadge}
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">استفاده</p>
            <p className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{formatCouponUsage(c.usedCount, c.maxUses)}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 justify-start">
          {statusBadge}
          <div className="flex gap-2">
            <button type="button" onClick={handleEdit} aria-label="ویرایش" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
              <Pen size={18} />
            </button>
            {c.isActive ? (
              <button type="button" onClick={handleToggle} aria-label="غیرفعال‌سازی" className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
                <Ban size={18} />
              </button>
            ) : status === 'DISABLED' ? (
              <button type="button" onClick={handleToggle} aria-label="فعال‌سازی" className="p-2 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 cursor-pointer">
                <Check size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* دسکتاپ — ۸ ستونه */}
      <div className="hidden lg:grid lg:grid-cols-8 gap-4 items-center text-right">
        <div className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm" dir="ltr">{c.code}</div>
        <div className="text-sm text-gray-700 dark:text-gray-300">{c.discountPercentage}٪</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{formatCouponExpiry(c.endsAt)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{formatCouponUsage(c.usedCount, c.maxUses)}</div>
        <div>{audienceBadge}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {c.isPublic ? '—' : `${row.recipientsCount} نفر`}
        </div>
        <div>{statusBadge}</div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={handleEdit} aria-label="ویرایش" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
            <Pen size={18} />
          </button>
          {c.isActive ? (
            <button type="button" onClick={handleToggle} aria-label="غیرفعال‌سازی" className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
              <Ban size={18} />
            </button>
          ) : status === 'DISABLED' ? (
            <button type="button" onClick={handleToggle} aria-label="فعال‌سازی" className="p-2 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 cursor-pointer">
              <Check size={18} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
})

// --- صفحه — assemble ---
const AdminCouponsPage = memo(function AdminCouponsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [couponToDelete, setCouponToDelete] = useState<string | null>(null)

  const { data: coupons, isLoading } = useQuery(adminCouponsOptions)

  // حذف اپتیمیستیک با rollback — همان الگوی قبل از phase-9
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCoupon(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.adminCoupons })
      const previous = queryClient.getQueryData<CouponWithConditionsDto[]>(qk.adminCoupons)
      queryClient.setQueryData<CouponWithConditionsDto[]>(qk.adminCoupons, (old) =>
        old ? old.filter((c) => c.coupon.id !== id) : old)
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(qk.adminCoupons, ctx.previous)
    },
    onSuccess: () => {
      showToast('کوپن غیرفعال شد')
      setIsDeleteModalOpen(false)
      setCouponToDelete(null)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
    },
  })

  // stage-10: فعال‌سازی مجدد — مستقیم (بدون مودال)؛ خطا (مثل انقضای گذشته) toast می‌شود
  const activateMut = useMutation({
    mutationFn: (id: string) => setCouponActive(id, true),
    onSuccess: (res) => {
      showToast(res.message || 'کوپن فعال شد')
    },
    onError: (err) => showToast(err.message || 'فعال‌سازی ناموفق بود', 'error'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
    },
  })

  const handleOpenNew = useCallback(() => {
    navigate({ to: '/admin/coupons/new' })
  }, [navigate])
  const handleEdit = useCallback((id: string) => {
    navigate({ to: '/admin/coupons/$couponId', params: { couponId: id } })
  }, [navigate])
  const handleOpen = useCallback((id: string) => {
    navigate({ to: '/admin/coupons/$couponId', params: { couponId: id } })
  }, [navigate])
  const handleRequestToggle = useCallback((row: CouponWithConditionsDto) => {
    if (row.coupon.isActive) {
      setCouponToDelete(row.coupon.id as string)
      setIsDeleteModalOpen(true)
    } else {
      activateMut.mutate(row.coupon.id as string)
    }
  }, [activateMut])
  const handleCloseDelete = useCallback(() => {
    setCouponToDelete(null)
    setIsDeleteModalOpen(false)
  }, [])
  const handleConfirmDelete = useCallback(() => {
    if (couponToDelete) deleteMut.mutate(couponToDelete)
  }, [couponToDelete, deleteMut])

  if (isLoading) {
    return <AdminCouponsPageSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">مدیریت کوپن‌ها</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">ایجاد کوپن‌های هدفمند و بازاریابی رفتاری</p>
        </div>
        <button
          type="button"
          onClick={handleOpenNew}
          className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center"
        >
          <Plus size={16} />
          ایجاد کوپن جدید
        </button>
      </div>

      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        {/* هدر دسکتاپ */}
        <div className="hidden lg:grid lg:grid-cols-8 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium border-b border-gray-100 dark:border-white/5 pb-2 text-right">
          <div>کد تخفیف</div>
          <div>درصد</div>
          <div>انقضا</div>
          <div>استفاده</div>
          <div>مخاطب</div>
          <div>دریافت‌کنندگان</div>
          <div>وضعیت</div>
          <div className="text-left">عملیات</div>
        </div>

        <div className="space-y-4">
          {(coupons ?? []).map((row) => (
            <CouponCard
              key={row.coupon.id}
              coupon={row}
              onEdit={handleEdit}
              onToggle={handleRequestToggle}
              onOpen={handleOpen}
            />
          ))}
          {(coupons ?? []).length === 0 && (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">کوپنی ثبت نشده است.</div>
          )}
        </div>
      </div>

      {/* کانفرم حذف/غیرفعال‌سازی */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="غیرفعال‌سازی کوپن تخفیف"
        message="این کوپن غیرفعال می‌شود و دیگر قابل استفاده نخواهد بود. سفارش‌های در جریان که قبلاً از آن استفاده کرده‌اند سالم می‌مانند. ادامه می‌دهید؟"
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDelete}
      />
    </div>
  )
})

export const Route = createFileRoute('/admin/coupons/')({
  ssr: false,
  // prefetch — هاور روی لینک «کوپن‌ها» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  loader: async ({ context }) => {
    await context.queryClient.query(adminCouponsOptions)
  },

  component: AdminCouponsPage,
  pendingComponent: AdminCouponsPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'مدیریت کوپن‌ها | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})
