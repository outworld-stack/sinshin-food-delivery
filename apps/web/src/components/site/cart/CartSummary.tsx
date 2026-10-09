// src/components/site/cart/CartSummary.tsx
// stage-48 — قفل دکمه‌ی «ادامه فرایند خرید» وقتی آیتم ناموجود در سبد است
// + بنر نارنجی توضیحی (کاربر می‌تواند صبر کند یا آیتم را حذف کند).
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { BoxRemove } from 'reicon-react'
import { useI18n } from '#/i18n'

interface CartSummaryProps {
	totalItems: number
	total: number
	totalSavings: number
	/** stage-48 — آیتم ناموجود در سبد هست؟ (سروری) */
	hasUnavailable?: boolean
}

export const CartSummary = memo(function CartSummary({
	totalItems,
	total,
	totalSavings,
	hasUnavailable = false,
}: CartSummaryProps) {
	const { t, fmt } = useI18n()

	return (
		<div className="lg:col-span-1 hidden lg:block">
			<div className="sticky top-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
					{t['cart.summary']}
				</h2>

				<div className="space-y-3 mb-6">
					<div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
						<span>{t['cart.itemCount']}</span>
						<span>
							{fmt.num(totalItems)} {t['common.pcs']}
						</span>
					</div>
					<div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
						<span>{t['cart.totalAmount']}</span>
						<span>
							{fmt.price(total)} {t['common.toman']}
						</span>
					</div>
					{totalSavings > 0 && (
						<div className="flex justify-between font-DanaRegular text-green-600 dark:text-green-400">
							<span>{t['cart.savings']}</span>
							<span>
								{fmt.price(totalSavings)} {t['common.toman']}
							</span>
						</div>
					)}
				</div>

				<div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-white/5 mb-4">
					<span className="font-DanaDemiBold text-gray-800 dark:text-white">
						{t['cart.finalAmount']}
					</span>
					<span className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">
						{fmt.price(total)}
					</span>
				</div>

				{/* stage-48 — هشدار ناموجودی: پرداخت قفل تا رفع */}
				{hasUnavailable && (
					<div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
						<BoxRemove size={18} className="text-orange-500 shrink-0 mt-0.5" />
						<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
							{t['cart.blockedNotice']}
						</p>
					</div>
				)}

				{hasUnavailable ? (
					<button
						type="button"
						disabled
						title={t['cart.blockedNotice']}
						className="block w-full py-3 rounded-xl bg-gray-200 dark:bg-[#3a151c] text-gray-400 dark:text-gray-500 font-DanaDemiBold text-center cursor-not-allowed"
					>
						{t['cart.continue']}
					</button>
				) : (
					<Link
						to="/checkout"
						className="block w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30 text-center cursor-pointer"
					>
						{t['cart.continue']}
					</Link>
				)}
			</div>
		</div>
	)
})