// src/components/dashboard/order-detail/FeedbackBox.tsx
import { memo, useCallback, useState } from 'react'
import { Check, MessageSquare } from 'reicon-react'
import type { UserOrderItem as OrderItem } from '@sinshin/shared'

interface FeedbackBoxProps {
  items: OrderItem[]
  reviewedProductIds: string[]
  isSubmitting: boolean
  onSubmit: (productId: string, feedback: string) => void
}

// آیتم ۹: نظر به‌ازای هر محصول — انتخاب با چیپ، محصولات نظرداده قفل با تیک
export const FeedbackBox = memo(function FeedbackBox({
  items, reviewedProductIds, isSubmitting, onSubmit,
}: FeedbackBoxProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState('')

  const reviewed = new Set(reviewedProductIds)
  const unreviewed = items.filter(i => i.productId !== null && !reviewed.has(i.productId))

  // انتخابِ مؤثر: اگه انتخاب فعلی نظرش ثبت شده، خودکار اولینِ نظر-نداده
  const effectiveSelected =
    selectedId && !reviewed.has(selectedId)
      ? selectedId
      : unreviewed[0]?.productId ?? null

  const handleText = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, 500))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!effectiveSelected || !text.trim()) return
    onSubmit(effectiveSelected, text.trim())
    setText('') // پاک برای محصول بعدی
  }, [effectiveSelected, text, onSubmit])

  // همه‌ی محصولات نظر داده شدند → حالت موفقیت
  if (items.length > 0 && unreviewed.length === 0) {
    return (
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
          بازخورد شما
        </h2>
        <div className="flex items-center gap-2 text-green-500">
          <Check size={20} />
          <p className="font-DanaMedium text-sm">
            برای تمام محصولات این سفارش نظر ثبت شد. پس از بررسی، در صفحه‌ی محصول نمایش داده می‌شود.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4 flex items-center gap-2">
        <MessageSquare size={20} className="text-primary dark:text-dark-primary" />
        نظر شما درباره این سفارش
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-4">
        برای هر محصول می‌توانید یک نظر ثبت کنید — نظرها پس از بررسی در صفحه‌ی همان محصول نمایش داده می‌شوند.
      </p>

      {/* انتخاب محصول */}
      <div className="flex flex-wrap gap-2 mb-4">
        {items.map(item => {
          const isReviewed = item.productId !== null && reviewed.has(item.productId)
          const isSelected = effectiveSelected === item.productId
          return (
            <button
              key={item.productId}
              type="button"
              disabled={isReviewed}
              onClick={() => setSelectedId(item.productId)}
              className={`px-3 py-2 rounded-xl text-xs font-DanaMedium transition flex items-center gap-1.5 ${isReviewed
                ? 'bg-green-50 dark:bg-green-500/10 text-green-500 cursor-not-allowed'
                : isSelected
                  ? 'bg-primary dark:bg-dark-primary text-white shadow-sm cursor-pointer'
                  : 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] cursor-pointer'
                }`}
            >
              {isReviewed && <Check size={12} />}
              {item.name}
            </button>
          )
        })}
      </div>

      {/* فرم — وقتی محصول قابل‌نظری انتخاب شده */}
      {effectiveSelected ? (
        <>
          <textarea
            value={text}
            onChange={handleText}
            maxLength={500}
            className="w-full h-32 px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white resize-none font-DanaMedium"
            placeholder="تجربه‌تان از این محصول را با ما و دیگر مشتریان به اشتراک بگذارید..."
          />
          <div className="flex items-center justify-between mt-2 mb-4">
            <span className="text-xs text-gray-400 font-DanaMedium">
              {text.length.toLocaleString('fa-IR')}/۵۰۰
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !text.trim()}
            className="px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'در حال ارسال...' : 'ارسال نظر'}
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-400 font-DanaMedium">محصول قابل نظردادن باقی نمانده است.</p>
      )}
    </div>
  )
})