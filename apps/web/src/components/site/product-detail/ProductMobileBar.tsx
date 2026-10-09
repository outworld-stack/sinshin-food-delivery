// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/product-detail/ProductMobileBar.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ناموجود → دکمه‌ی سبد قفل + هشدار نارنجی در نوار
// ═══════════════════════════════════════════════════════════════

// src/components/site/product-detail/ProductMobileBar.tsx
import { memo } from 'react'
import { Cart, BoxRemove } from 'reicon-react'
import { useI18n } from '#/i18n'
import { CountdownTimer } from '#/components/shared/CountdownTimer'

interface ProductMobileBarProps {
	totalPrice: number
	originalTotal: number
	hasDiscount: boolean
	quantity: number
	/** stage-47 — ISO پایان پنجره‌ی تخفیف فعال (null = بدون شمارنده) */
	discountEndsAt?: string | null
	/** stage-47 — انقضای شمارنده → والد قیمت را بازمحاسبه می‌کند */
	onCountdownEnd?: () => void
	/** stage-48 — موجودی فروش (false = قفل + هشدار) */
	isAvailable?: boolean
	onIncrement: () => void
	onDecrement: () => void
	onAddToCart: () => void
}

// نوار قیمت فیکس موبایل
export const ProductMobileBar = memo(function ProductMobileBar({
	totalPrice,
	originalTotal,
	hasDiscount,
	quantity,
	discountEndsAt,
	onCountdownEnd,
	isAvailable = true,
	onIncrement,
	onDecrement,
	onAddToCart,
}: ProductMobileBarProps) {
	const { t, fmt } = useI18n()

	return (
		<div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-[#3a151c] shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col min-w-0">
					{hasDiscount && (
						<span className="text-xs text-gray-400 line-through font-DanaRegular leading-none mb-1">
							{fmt.price(originalTotal)}
						</span>
					)}
					<div className="flex items-baseline gap-1">
						<span className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">
							{fmt.price(totalPrice)}
						</span>
						<span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaMedium">
							{t['common.toman']}
						</span>
					</div>
					{/* stage-47 — شمارنده‌ی معکوس (فشرده) در نوار موبایل */}
					{discountEndsAt && (
						<div className="mt-1.5">
							<CountdownTimer
								endsAt={discountEndsAt}
								onEnd={onCountdownEnd}
								variant="card"
							/>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<div className="flex items-center gap-1 bg-gray-100 dark:bg-[#2a1015] rounded-xl p-1">
						<button
							type="button"
							onClick={onIncrement}
							className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer"
						>
							+
						</button>
						<span className="font-DanaDemiBold text-base text-gray-800 dark:text-white w-6 text-center">
							{fmt.num(quantity)}
						</span>
						<button
							type="button"
							onClick={onDecrement}
							className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaBold cursor-pointer"
						>
							-
						</button>
					</div>
					<button
						type="button"
						onClick={onAddToCart}
						disabled={!isAvailable}
						aria-label={
							isAvailable
								? t['pdetail.addToCart']
								: t['common.temporarilyUnavailable']
						}
						className={`flex items-center justify-center p-3 rounded-xl transition ${
							isAvailable
								? 'bg-primary dark:bg-dark-primary text-white shadow-sm cursor-pointer'
								: 'bg-gray-200 dark:bg-[#3a151c] text-gray-400 dark:text-gray-500 cursor-not-allowed'
						}`}
					>
						<Cart size={24} />
					</button>
				</div>
			</div>

			{/* stage-48 — هشدار نارنجی ناموجودی در نوار موبایل */}
			{!isAvailable && (
				<div className="flex items-center gap-2 mt-2 p-2 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
					<BoxRemove size={16} className="text-orange-500 shrink-0" />
					<p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
						{t['pdetail.unavailableNotice']}
					</p>
				</div>
			)}
		</div>
	)
})