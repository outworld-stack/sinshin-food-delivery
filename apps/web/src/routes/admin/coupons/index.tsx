// src/routes/admin/coupons/index.tsx
// phase-9: بازنویسی — سه تغییر ریشه‌ای:
//  ۱) مودال حذف شد؛ ساخت/ویرایش به صفحات اختصاصی new.tsx و $couponId.tsx رفت.
//  ۲) کارت از قرارداد واقعی سرور می‌خواند (coupon.endsAt / coupon.isPublic /
//     recipientsCount) — قبلاً فیلدهای تختِ ساختگی می‌خواند که «Invalid Date»،
//     «undefined نفر»، مخاطب/وضعیت غلط می‌ساخت.
//  ۳) کل کارت کلیک‌پذیر است و به صفحه‌ی کوپن می‌رود.
//  stage-65 — دو مسیر جدا شد: Ban = غیرفعال‌سازی نمم (مسیر /status)؛
//  Trash2 = حذف کامل غیرقابل‌برگشت (تاریخچهی مصرف پاک می‌شود).

import type { CouponWithConditionsDto } from '@sinshin/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { memo, useCallback, useState } from 'react'
import { AlertTriangle, ArrowsRotate, Ban, Check, Pen, Plus, Trash2 } from 'reicon-react'
import { ConfirmModal } from '#/components/ConfirmModal'
import { AdminCouponsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { useCouponActivate, useCouponDeactivate, useCouponDelete } from '#/hooks/admin/useCouponMutations'
import {
  couponAudienceLabel,
  couponStatus,
  couponStatusBadgeClass,
  couponStatusLabel,
  formatCouponExpiry,
  formatCouponUsage,
} from '#/utils/couponDisplay'
import { adminCouponsOptions } from '#/utils/queryOptions'

// --- کارت کوپن — سه چیدمان (موبایل/تبلت/دسکتاپ) ---
// stage-10: آیکون وضعیت تغییر کرد — Ban برای غیرفعال‌سازی (با تایید)،
// Check برای فعال‌سازی مجدد. کوپن منقضی فقط از صفحه‌ی خودش (ویرایش انقضا).
const CouponCard = memo(function CouponCard({
  coupon: row, onEdit, onToggle, onOpen, onDelete,
}: {
  coupon: CouponWithConditionsDto
  onEdit: (id: string) => void
  onToggle: (row: CouponWithConditionsDto) => void
  onOpen: (id: string) => void
  onDelete: (row: CouponWithConditionsDto) => void
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
  // stage-10/stage-65: تغییر وضعیت — فعال → مودال غیرفعال‌سازی نرم؛ غیرفعال → فعال‌سازی
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle(row)
  }, [onToggle, row])
  // stage-65: حذف کامل — مودال تایید قوی (غیرقابل برگشت)
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(row)
  }, [onDelete, row])
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
            <button type="button" onClick={handleDelete} aria-label="حذف کامل" title="حذف کامل (غیرقابل برگشت)" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
              <Trash2 size={16} />
            </button>
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
            <button type="button" onClick={handleDelete} aria-label="حذف کامل" title="حذف کامل (غیرقابل برگشت)" className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
              <Trash2 size={18} />
            </button>
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
          <button type="button" onClick={handleDelete} aria-label="حذف کامل" title="حذف کامل (غیرقابل برگشت)" className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  )
})

// --- صفحه — assemble ---
const AdminCouponsPage = memo(function AdminCouponsPage() {
  const navigate = useNavigate()

  // stage-65 — دو مودال جدا: غیرفعال‌سازی نرم / حذف کامل
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false)
  const [couponToDeactivate, setCouponToDeactivate] = useState<string | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [couponToDelete, setCouponToDelete] = useState<string | null>(null)

  const { data: coupons, isLoading, isError, refetch } = useQuery(adminCouponsOptions)

  // رارد ۴۸ — جهش‌ها از هوک مشترک؛ حذف اپتیمیستیک همان الگوی قبل از phase-9
  const deleteMut = useCouponDelete({
    optimisticDelete: true,
    onDeleted: () => {
      setIsDeleteModalOpen(false)
      setCouponToDelete(null)
    },
  })

  // stage-65 — غیرفعال‌سازی نرم (برگشت‌پذیر)؛ خطا (مثل انقضای گذشته) پیام شناور می‌شود
  const deactivateMut = useCouponDeactivate()

  // stage-10: فعال‌سازی مجدد — مستقیم (بدون مودال)؛ خطا (مثل انقضای گذشته) پیام شناور می‌شود
  const activateMut = useCouponActivate()

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
      // stage-65 — نرم: مودال غیرفعال‌سازی (برگشت‌پذیر)
      setCouponToDeactivate(row.coupon.id as string)
      setIsDeactivateModalOpen(true)
    } else {
      activateMut.mutate(row.coupon.id as string)
    }
  }, [activateMut])

  const handleRequestDelete = useCallback((row: CouponWithConditionsDto) => {
    setCouponToDelete(row.coupon.id as string)
    setIsDeleteModalOpen(true)
  }, [])
  const handleCloseDeactivate = useCallback(() => {
    setCouponToDeactivate(null)
    setIsDeactivateModalOpen(false)
  }, [])
  const handleConfirmDeactivate = useCallback(() => {
    if (couponToDeactivate) deactivateMut.mutate(couponToDeactivate)
  }, [couponToDeactivate, deactivateMut])
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

  // stage-75 (P3-25) — خطای بارگذاری ≠ «کوپنی ثبت نشده»: قبلاً شکستِ fetch
  // اول (data=undefined، isLoading=false) مستقیم به حالتِ خالی می‌رفت و
  // ادمین فکر می‌کرد کوپن‌ها پاک شده‌اند. حالتِ خطا + تلاش مجدد (همان
  // الگوی InboxList)؛ refetch پس‌زمینه با داده‌ی کهنه ادامه‌ی نمایش می‌دهد.
  if (isError && !coupons) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <AlertTriangle size={44} className="text-red-400 mb-4" />
        <p className="font-DanaMedium text-sm text-gray-500 dark:text-gray-400 mb-5">
          بارگذاری کوپن‌ها ناموفق بود؛ دوباره تلاش کنید.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1.5 px-4 min-h-11 rounded-xl text-[12px] font-DanaDemiBold bg-primary dark:bg-dark-primary text-white hover:opacity-90 transition cursor-pointer"
        >
          <ArrowsRotate size={14} />
          تلاش مجدد
        </button>
      </div>
    )
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
              onDelete={handleRequestDelete}
            />
          ))}
          {(coupons ?? []).length === 0 && (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">کوپنی ثبت نشده است.</div>
          )}
        </div>
      </div>

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
        message="این عملیات غیرقابل برگشت است: کوپن به‌همراه شرط‌ها، گرنت‌ها و کل تاریخچه‌ی مصرف‌کنندگانش از دیتابیس حذف می‌شود. سفارش‌ها و سوابق مالی سالم می‌مانند (فقط پیوندشان به این کوپن قطع می‌شود). اگر فقط می‌خواهید کوپن موقتاً خاموش شود، از «غیرفعال‌سازی» (آیکون ممنوع) استفاده کنید. مطمئن هستید؟"
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDelete}
      />
    </div>
  )
})

export const Route = createFileRoute('/admin/coupons/')({
  ssr: false,
  // پیش‌واکشی — هاور روی لینک «کوپن‌ها» در سایدبار => این loader در کلاینت
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