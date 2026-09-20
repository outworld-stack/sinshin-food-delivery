// src/hooks/admin/useReviewsPage.ts
// ⬅ NEW GENERATION: «URL as State» — تب فیلتر نظرات شهروند URL شد
//
// چرا؟ نسخه قبلی فیلتر را در reducer نگه می‌داشت:
//   ✗ رفرش = برگشت به «در انتظار تایید» حتی اگر تب دیگری فعال بود
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ لینک عمیق قابل اشتراک نبود (مثلاً «نظرات ردشده» برای همکار)
//
// حالا: تب فعال = search param روت (validateSearch با zod)؛
// reducer کلاً حذف شد — کل state صفحه یک فیلد URL است.
// + مودریشن اپتیمیستیک با rollback (کلیک = فوری خروج کارت از صف انتظار)
import { useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { moderateReview, type AdminReview } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { adminReviewsOptions } from '#/utils/queryOptions'

// --- اسکیمای search — تب فعال شهروند URL است ---
// پیش‌فرض 'pending' (مثل رفتار قبلی): ادمین کار را از صف انتظار شروع می‌کند.
// catch: مقدار خرابِ دست‌کاری‌شده → پیش‌فرض، نه خطای روت
export const adminReviewsSearchSchema = z.object({
  status: z.enum(['all', 'approved', 'rejected', 'pending']).catch('pending').default('pending'),
})
export type AdminReviewsSearch = z.infer<typeof adminReviewsSearchSchema>
export type ReviewFilter = AdminReviewsSearch['status']

export function useReviewsPage() {
  const navigate = useNavigate({ from: '/admin/reviews/' })
  const search = useSearch({ from: '/admin/reviews/' })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  // کوئری — فکتوری مرکزی؛ همان کلیدی که loader روت با query پر کرده
  const { data: allReviews, isLoading } = useQuery(adminReviewsOptions)

  // مودریشن — ⬅ NEW: آپدیت اپتیمیستیک با rollback
  // قبلاً: کلیک → انتظار سرور → invalidate → رفرش.
  // حالا: کلیک → همان لحظه بج کارت عوض می‌شود و دکمه‌های تایید/رد جمع می‌شوند؛
  // اگر خطا شد، snapshot برمی‌گردد (و MutationCache سراسری toast می‌دهد)
  const moderateMutation = useMutation({
    mutationFn: (data: { reviewId: string; action: 'approve' | 'reject' }) => moderateReview(data),
    onMutate: async ({ reviewId, action }) => {
      // ریفچ در جریان را متوقف کن تا snapshot تمیز باشد
      await queryClient.cancelQueries({ queryKey: qk.adminReviews })
      const previous = queryClient.getQueryData<AdminReview[]>(qk.adminReviews)

      // فلیپ اپتیمیستیک وضعیت نظر
      queryClient.setQueryData<AdminReview[]>(qk.adminReviews, (old) =>
        old
          ? old.map(r => (r.id === reviewId
            ? { ...r, status: action === 'approve' ? ('approved' as const) : ('rejected' as const) }
            : r))
          : old)

      return { previous }
    },
    onError: (_err, _data, ctx) => {
      // rollback — کش به snapshot قبل از کلیک برمی‌گردد
      if (ctx?.previous) queryClient.setQueryData(qk.adminReviews, ctx.previous)
    },
    onSuccess: () => showToast('نظر بررسی شد'),
    onSettled: () => {
      // در هر صورت (موفق/ناموفق) با سرور هم‌تراز شو — منبع حقیقت
      queryClient.invalidateQueries({ queryKey: qk.adminReviews })
    },
  })

  // شمارش هر وضعیت — برای بج تب‌ها
  const counts = useMemo(() => {
    const reviews = allReviews ?? []
    return {
      all: reviews.length,
      approved: reviews.filter(r => r.status === 'approved').length,
      rejected: reviews.filter(r => r.status === 'rejected').length,
      pending: reviews.filter(r => r.status === 'pending').length,
    }
  }, [allReviews])

  // فیلتر — ⬅ NEW: از URL می‌آید (تایپ‌دار)؛ back/refresh/share حفظش می‌کنند
  const filtered = useMemo(() => {
    const reviews = allReviews ?? []
    if (search.status === 'all') return reviews
    return reviews.filter(r => r.status === search.status)
  }, [allReviews, search.status])

  // تب → URL (back مرورگر = تب قبلی، رفرش = همان تب)
  const handleFilter = useCallback((f: ReviewFilter) => {
    navigate({ search: { ...search, status: f } })
  }, [navigate, search])

  const handleApprove = useCallback((id: string) => moderateMutation.mutate({ reviewId: id, action: 'approve' }), [moderateMutation])
  const handleReject = useCallback((id: string) => moderateMutation.mutate({ reviewId: id, action: 'reject' }), [moderateMutation])

  return { filter: search.status, filtered, counts, isLoading, handleFilter, handleApprove, handleReject }
}