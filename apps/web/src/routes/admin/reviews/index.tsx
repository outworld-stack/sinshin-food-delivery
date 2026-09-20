// src/routes/admin/reviews/index.tsx
// ⬅ NEW: تب فیلتر شهروند URL شد (validateSearch + loader پری‌فچ)
import { createFileRoute, Link } from '@tanstack/react-router'
import { memo } from 'react'
import { useReviewsPage, adminReviewsSearchSchema, type ReviewFilter } from '#/hooks/admin/useReviewsPage'
import { adminReviewsOptions } from '#/utils/queryOptions'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { PdfDownloadButton } from '#/components/shared/PdfDownloadButton'
import { formatDate } from '#/utils/format'
import { Check, X, User, MessageSquare, Package } from 'reicon-react'
import { AdminReviewsPageSkeleton } from '#/components/LoadingSkeletons'

// ترتیب راست به چپ: همه - تاییدشده - ردشده - در انتظار تایید
const FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: 'all', label: 'همه' },
  { key: 'approved', label: 'تایید شده' },
  { key: 'rejected', label: 'رد شده' },
  { key: 'pending', label: 'در انتظار تایید' },
]

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  approved: { text: 'تاییدشده', cls: 'bg-green-100 dark:bg-green-500/10 text-green-500' },
  rejected: { text: 'ردشده', cls: 'bg-red-100 dark:bg-red-500/10 text-red-500' },
  pending: { text: 'در انتظار', cls: 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-500' },
}

const ReviewCard = memo(function ReviewCard({ review, onApprove, onReject }: {
  review: { id: string; orderId: string; productName: string; firstName?: string | null; lastName?: string | null; phone: string; comment: string; date: Date; status: string }
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const displayName = [review.firstName, review.lastName].filter(Boolean).join(' ').trim()
    || `کاربر-${review.phone.slice(-4)}`
  const badge = STATUS_BADGE[review.status] ?? STATUS_BADGE.pending

  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
            <User size={18} />
          </span>
          <div>
            <p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">{displayName}</p>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Package size={12} />
              {review.productName} • {formatDate(review.date)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* لینک به سفارش مرتبط */}
          <Link
            to="/admin/orders/$orderId"
            params={{ orderId: review.orderId }}
            className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer font-DanaDemiBold"
          >
            {review.orderId}
          </Link>
          <span className={`text-xs font-DanaDemiBold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed flex items-start gap-2">
        <MessageSquare size={14} className="text-gray-400 shrink-0 mt-1" />
        {review.comment}
      </p>

      {review.status === 'pending' && (
        <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-white/5">
          <button type="button" onClick={() => onApprove(review.id)} className="flex-1 py-2 rounded-lg bg-green-500 text-white text-sm font-DanaDemiBold hover:bg-green-600 transition cursor-pointer flex items-center justify-center gap-1.5">
            <Check size={14} /> تایید
          </button>
          <button type="button" onClick={() => onReject(review.id)} className="flex-1 py-2 rounded-lg bg-red-500/10 text-red-500 text-sm font-DanaDemiBold hover:bg-red-500/20 transition cursor-pointer flex items-center justify-center gap-1.5">
            <X size={14} /> رد
          </button>
        </div>
      )}
    </div>
  )
})

const ReviewsPage = memo(function ReviewsPage() {
  const page = useReviewsPage()

  if (page.isLoading) return <AdminReviewsPageSkeleton />


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">نظرات مشتریان</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
            تایید یا رد نظرات — نظرات تاییدشده در صفحه محصول نمایش داده می‌شوند
          </p>
        </div>
        <PdfDownloadButton documentId="reviews" documentType="reviews-list" targetSelector="#reviews-list" label="خروجی PDF" />
      </div>

      <div className="flex bg-gray-100 dark:bg-[#1a0a0e] rounded-xl p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => page.handleFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-DanaMedium transition cursor-pointer flex items-center gap-1.5 ${page.filter === f.key
              ? 'bg-white dark:bg-[#2a1015] text-primary dark:text-dark-primary shadow-sm'
              : 'text-gray-500 dark:text-gray-400'
              }`}
          >
            {f.label}
            <span className="text-[10px] bg-gray-200 dark:bg-[#2a1015] px-1.5 rounded-full font-DanaDemiBold">
              {page.counts[f.key].toLocaleString('fa-IR')}
            </span>
          </button>
        ))}
      </div>

      <div id="reviews-list" className="space-y-4">
        {page.filtered.length > 0 ? (
          page.filtered.map((review) => (
            <ReviewCard key={review.id} review={{ ...review, date: new Date(review.date) }} onApprove={page.handleApprove} onReject={page.handleReject} />
          ))
        ) : (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 font-DanaMedium bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-[#3a151c]">
            نظری در این دسته وجود ندارد.
          </div>
        )}
      </div>
    </div>
  )
})

export const Route = createFileRoute('/admin/reviews/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — تب فعال در search param؛ رفرش/back/اشتراک‌گذاری حفظش می‌کنند
  validateSearch: adminReviewsSearchSchema,

  // ⬅ NEW: prefetch — هاور روی لینک «نظرات» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context }) => {
    await context.queryClient.query(adminReviewsOptions)
  },

  component: ReviewsPage,
  pendingComponent: AdminReviewsPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'نظرات مشتریان | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})