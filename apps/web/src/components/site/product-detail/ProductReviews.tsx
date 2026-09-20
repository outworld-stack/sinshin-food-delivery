// src/components/site/product-detail/ProductReviews.tsx (بدون تغییر منطق — فقط تایپ)
import { memo } from 'react'
import { User } from 'reicon-react'
import { formatDate } from '#/utils/format'
import type { ProductReview } from '#/types/site/reviews'

interface ProductReviewsProps {
  reviews: ProductReview[]
}

// نام نمایشی — تابع خالص
function getDisplayName(review: ProductReview): string {
  const fullName = [review.firstName, review.lastName].filter(Boolean).join(' ').trim()
  if (fullName) return fullName
  const lastDigits = review.phone?.slice(-4) ?? '----'
  return `کاربر-${lastDigits}`
}

export const ProductReviews = memo(function ProductReviews({ reviews }: ProductReviewsProps) {
  if (reviews.length === 0) {
    return (
      <div className="mt-8 text-center py-8 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-dashed border-gray-300 dark:border-white/5">
        <p className="text-sm text-gray-400 dark:text-gray-500 font-DanaMedium">
          نظری برای این محصول تاکنون ثبت و تایید نشده است
        </p>
      </div>
    )
  }

  return (
    <div className="mt-8 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-300 dark:border-[#3a151c] shadow-sm">
      <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        نظرات مشتریان
      </h3>

      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
                  <User size={18} />
                </span>
                <p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
                  {getDisplayName(review)}
                </p>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
                {formatDate(review.date)}
              </span>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
              {review.comment}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
})