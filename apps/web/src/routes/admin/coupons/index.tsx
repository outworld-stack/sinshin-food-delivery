// src/routes/admin/coupons/index.tsx
// ⬅ NEW: کوئری از فکتوری مرکزی (adminCouponsOptions) + loader پری‌فچ روی هاور
// + حذف اپتیمیستیک با rollback + pendingComponent/errorComponent + head noindex
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useState, useCallback } from 'react'
import { deleteCoupon } from '#/server/coupons'
import { AdminCouponsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ConfirmModal } from '#/components/ConfirmModal'
import { CouponModal } from '#/components/admin/CouponModal'
import { useToastStore } from '#/stores/toastStore'
import { adminCouponsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { Plus, Pen, Trash2 } from 'reicon-react'
import type { AdminCoupon } from '#/types/admin/coupons'



// --- کارت کوپن — سه چیدمان (موبایل/تبلت/دسکتاپ) ---
const CouponCard = memo(function CouponCard({
  coupon, onEdit, onDelete,
}: {
  coupon: AdminCoupon
  onEdit: (coupon: AdminCoupon) => void
  onDelete: (id: string) => void
}) {
  const handleEdit = useCallback(() => onEdit(coupon), [onEdit, coupon])
  const handleDelete = useCallback(() => onDelete(coupon.id), [onDelete, coupon.id])

  const expiry = new Date(coupon.expiryDate).toLocaleDateString('fa-IR')

  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">

      {/* موبایل — ۳ ستونه وسط‌چین */}
      <div className="md:hidden grid grid-cols-3 gap-3 text-center w-full">
        <div className="flex flex-col gap-3 items-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">کد</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-xs">{coupon.code}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">انقضا</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{expiry}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 items-center">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">تخفیف</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-xs">{coupon.discountPercentage}٪</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مخاطب</p>
            <span className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full ${coupon.isPublic ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'}`}>
              {coupon.isPublic ? 'همه' : 'گروه خاص'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 items-center justify-start">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">وضعیت</p>
            <span className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full ${coupon.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}>
              {coupon.status === 'ACTIVE' ? 'فعال' : 'منقضی'}
            </span>
          </div>
          <div className="flex gap-1 justify-center">
            <button onClick={handleEdit} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
              <Pen size={16} />
            </button>
            <button onClick={handleDelete} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
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
              <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{coupon.code}</p>
              <p className="text-xs text-primary dark:text-dark-primary">{coupon.discountPercentage}٪</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">انقضا</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{expiry}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">مخاطب</p>
            <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${coupon.isPublic ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'}`}>
              {coupon.isPublic ? 'همه کاربران' : 'گروه خاص'}
            </span>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-1">استفاده</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{coupon.maxUses === 0 ? 'نامحدود' : coupon.maxUses + ' بار'}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 justify-start">
          <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${coupon.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}>
            {coupon.status === 'ACTIVE' ? 'فعال' : 'منقضی'}
          </span>
          <div className="flex gap-2">
            <button onClick={handleEdit} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
              <Pen size={18} />
            </button>
            <button onClick={handleDelete} className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* دسکتاپ — ۸ ستونه */}
      <div className="hidden lg:grid lg:grid-cols-8 gap-4 items-center text-right">
        <div className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{coupon.code}</div>
        <div className="text-sm text-gray-700 dark:text-gray-300">{coupon.discountPercentage}٪</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{expiry}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{coupon.maxUses === 0 ? 'نامحدود' : coupon.maxUses + ' بار'}</div>
        <div>
          <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${coupon.isPublic ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'}`}>
            {coupon.isPublic ? 'همه' : 'گروه خاص'}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{coupon.isPublic ? '-' : coupon.recipientsCount + ' نفر'}</div>
        <div>
          <span className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${coupon.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}>
            {coupon.status === 'ACTIVE' ? 'فعال' : 'منقضی'}
          </span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={handleEdit} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
            <Pen size={18} />
          </button>
          <button onClick={handleDelete} className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer">
            <Trash2 size={18} />
          </button>
        </div>
      </div>

    </div>
  )
});

// --- صفحه — assemble ---
const AdminCouponsPage = memo(function AdminCouponsPage() {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  // ۴ state مستقل — با هم تعامل ندارن، reducer لازم نیست
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<AdminCoupon | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [couponToDelete, setCouponToDelete] = useState<string | null>(null)

  // ⬅ NEW: کوئری — فکتوری مرکزی؛ همان کلیدی که loader روت با query
  // پر کرده => هاور روی «کوپن‌ها» در سایدبار، ناوبری را آنی می‌کند
  const { data: coupons, isLoading } = useQuery(adminCouponsOptions)

  // ⬅ NEW: حذف اپتیمیستیک با rollback
  // قبلاً: تایید → انتظار سرور → invalidate → رفرش.
  // حالا: تایید → همان لحظه کارت حذف می‌شود → سرور تأیید می‌کند؛
  // اگر خطا شد، snapshot برمی‌گردد (و MutationCache سراسری toast می‌دهد)
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCoupon(id),
    onMutate: async (id) => {
      // ریفچ در جریان را متوقف کن تا snapshot تمیز باشد
      await queryClient.cancelQueries({ queryKey: qk.adminCoupons })
      const previous = queryClient.getQueryData<AdminCoupon[]>(qk.adminCoupons)

      // حذف اپتیمیستیک
      queryClient.setQueryData<AdminCoupon[]>(qk.adminCoupons, (old) =>
        old ? old.filter(c => c.id !== id) : old)

      return { previous }
    },
    onError: (_err, _id, ctx) => {
      // rollback — کش به snapshot قبل از کلیک برمی‌گردد
      if (ctx?.previous) queryClient.setQueryData(qk.adminCoupons, ctx.previous)
    },
    onSuccess: () => {
      showToast('کوپن حذف شد')
      setIsDeleteModalOpen(false)
      setCouponToDelete(null)
    },
    onSettled: () => {
      // در هر صورت (موفق/ناموفق) با سرور هم‌تراز شو — منبع حقیقت
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
    },
  })

  // هندلرها — stable
  const handleOpenNew = useCallback(() => {
    setEditingCoupon(null)
    setIsModalOpen(true)
  }, [])
  const handleCloseModal = useCallback(() => {
    setEditingCoupon(null)
    setIsModalOpen(false)
  }, [])
  const handleEdit = useCallback((coupon: AdminCoupon) => {
    setEditingCoupon(coupon)
    setIsModalOpen(true)
  }, [])
  const handleRequestDelete = useCallback((id: string) => {
    setCouponToDelete(id)
    setIsDeleteModalOpen(true)
  }, [])
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
        <button onClick={handleOpenNew} className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center">
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
          {(coupons ?? []).map(c => (
            <CouponCard key={c.coupon.id} coupon={c.coupon as any} onEdit={handleEdit} onDelete={handleRequestDelete} />
          ))}
          {(coupons ?? []).length === 0 && (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium">کوپنی ثبت نشده است.</div>
          )}
        </div>
      </div>

      {/* مودال ساخت/ویرایش */}
      {isModalOpen && <CouponModal onClose={handleCloseModal} editingCoupon={editingCoupon} />}

      {/* کانفرم حذف */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="حذف کوپن تخفیف"
        message="آیا از حذف این کوپن تخفیف مطمئن هستید؟ این عملیات قابل بازگشت نیست."
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDelete}
      />
    </div>
  )
});

export const Route = createFileRoute('/admin/coupons/')({
  ssr: false,
  // ⬅ NEW: prefetch — هاور روی لینک «کوپن‌ها» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
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
});