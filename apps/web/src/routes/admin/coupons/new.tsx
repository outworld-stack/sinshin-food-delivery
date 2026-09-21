// src/routes/admin/coupons/new.tsx
// phase-9: ساخت کوپن از مودال به صفحه‌ی اختصاصی آمد — فرم بزرگ، متغیرهای
// زیاد و طراحی پاسخ‌گو در همه‌ی سایزها اینجا جای درستش است، نه در مودال.
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createCoupon } from '#/server/coupons'
import { CouponForm, type CouponFormPayload } from '#/components/admin/coupons/CouponForm'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'
import { ChevronRight } from 'reicon-react'

export const Route = createFileRoute('/admin/coupons/new')({
  ssr: false,
  component: NewCouponPage,

  head: () => ({
    meta: [
      { title: 'کوپن جدید | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})

function NewCouponPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  const { isMainAdmin } = usePermissions()

  const mutation = useMutation({
    mutationFn: (data: CouponFormPayload) => createCoupon(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
      showToast('کوپن ایجاد شد')
      navigate({ to: '/admin/coupons' })
    },
    // خطا (کد تکراری/نامعتبر و…) را MutationCache سراسری toast می‌کند
  })

  // کوپن‌ها فقط کار ادمین اصلی‌اند — گارد قبل از رندر فرم
  if (!isMainAdmin) {
    return <PermissionGate hasAccess={false} pageName="ایجاد کوپن" />
  }

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
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">کوپن جدید</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
          ایجاد کوپن عمومی یا هدفمند با قوانین بازاریابی رفتاری
        </p>
      </div>

      <CouponForm
        onSubmit={mutation.mutate}
        onCancel={() => navigate({ to: '/admin/coupons' })}
        isSubmitting={mutation.isPending}
        submitLabel="ایجاد کوپن"
      />
    </div>
  )
}
