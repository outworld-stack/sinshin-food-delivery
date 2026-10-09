// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/product-detail/ProductPriceBox.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ناموجود → دکمه‌ی سبد قفل + هشدار نارنجی زیرش
//        (عکس صفحه‌ی محصول عمداً تار نمی‌شود — فقط فرم قفل).
// ═══════════════════════════════════════════════════════════════

// src/components/site/product-detail/ProductPriceBox.tsx
import { memo } from 'react'
import { Cart, BoxRemove } from 'reicon-react'
import { useI18n } from '#/i18n'
import { CountdownTimer } from '#/components/shared/CountdownTimer'

interface ProductPriceBoxProps {
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

export const ProductPriceBox = memo(function ProductPriceBox({
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
}: ProductPriceBoxProps) {
	const { t, fmt } = useI18n()

	return (
		<div className="hidden lg:flex mt-auto p-6 bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-300 dark:border-[#3a151c] shadow-sm flex-col gap-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-col">
					{hasDiscount && (
						<span className="text-sm text-gray-400 line-through font-DanaMedium">
							{fmt.price(originalTotal)} {t['common.toman']}
						</span>
					)}
					<div className="flex items-baseline gap-1">
						<span className="font-MorabbaBold text-3xl text-primary dark:text-dark-primary">
							{fmt.price(totalPrice)}
						</span>
						<span className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
							{t['common.toman']}
						</span>
					</div>
				</div>

				{/* کنترل تعداد */}
				<div className="flex items-center gap-3 bg-gray-100 dark:bg-[#1a0a0e] rounded-xl p-1">
					<button
						type="button"
						onClick={onIncrement}
						className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#3a151c] transition font-DanaBold text-lg cursor-pointer"
					>
						+
					</button>
					<span className="font-DanaDemiBold text-xl text-gray-800 dark:text-white w-8 text-center">
						{fmt.num(quantity)}
					</span>
					<button
						type="button"
						onClick={onDecrement}
						className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#3a151c] transition font-DanaBold text-lg cursor-pointer"
					>
						-
					</button>
				</div>
			</div>

			{/* stage-47 — شمارنده‌ی معکوس پایان تخفیف (فقط با پنجره‌ی پایان) */}
			{discountEndsAt && (
				<div className="flex justify-center">
					<CountdownTimer
						endsAt={discountEndsAt}
						onEnd={onCountdownEnd}
						variant="box"
					/>
				</div>
			)}

			<button
				type="button"
				onClick={onAddToCart}
				disabled={!isAvailable}
				className={`w-full py-4 rounded-xl font-DanaDemiBold text-lg transition flex items-center justify-center gap-2 ${
					isAvailable
						? 'bg-primary dark:bg-dark-primary text-white hover:opacity-90 shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30 cursor-pointer'
						: 'bg-gray-200 dark:bg-[#3a151c] text-gray-400 dark:text-gray-500 cursor-not-allowed'
				}`}
			>
				<Cart size={24} />
				{t['pdetail.addToCart']}
			</button>

			{/* stage-48 — هشدار نارنجی ناموجودی (زیر دکمه) */}
			{!isAvailable && (
				<div className="flex items-center gap-2 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
					<BoxRemove size={18} className="text-orange-500 shrink-0" />
					<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
						{t['pdetail.unavailableNotice']}
					</p>
				</div>
			)}
		</div>
	)
})