// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/cart/CartMobileBar.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: pb-safe روی نوار فیکس (home indicator آیفون)
// ═══════════════════════════════════════════════════════════════

// src/components/site/cart/CartMobileBar.tsx
// stage-48 — قفل «ادامه» وقتی آیتم ناموجود در سبد است (همون قفل خلاصه).
import { memo } from 'react'
import { useI18n } from '#/i18n'

interface CartMobileBarProps {
	total: number
	/** stage-48 — آیتم ناموجود در سبد هست؟ (سروری) */
	hasUnavailable?: boolean
}

export const CartMobileBar = memo(function CartMobileBar({
	total,
	hasUnavailable = false,
}: CartMobileBarProps) {
	const { t, fmt } = useI18n()

	// stage-55 — ارتفاع ناحیه‌ی امن آیفون (home indicator)
return (
		<div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pt-4 px-4 pb-safe bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-[#3a151c] shadow-[0_-4px_15px_rgba(0,0,0,0.05)]">
			{hasUnavailable && (
				<p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium text-center mb-2 leading-relaxed">
					{t['cart.blockedNotice']}
				</p>
			)}
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col">
					<span className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
						{t['cart.finalAmount']}
					</span>
					<div className="flex items-baseline gap-1">
						<span
							className={`font-MorabbaBold text-xl ${hasUnavailable ? 'text-gray-400 dark:text-gray-500' : 'text-primary dark:text-dark-primary'}`}
						>
							{fmt.price(total)}
						</span>
						<span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaMedium">
							{t['common.toman']}
						</span>
					</div>
				</div>
				{hasUnavailable ? (
					<button
						type="button"
						disabled
						title={t['cart.blockedNotice']}
						className="flex-1 max-w-[60%] py-3 rounded-xl bg-gray-200 dark:bg-[#3a151c] text-gray-400 dark:text-gray-500 font-DanaDemiBold text-center cursor-not-allowed"
					>
						{t['cart.continue']}
					</button>
				) : (
					<a
						href="/checkout"
						className="flex-1 max-w-[60%] py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold transition shadow-sm text-center cursor-pointer"
					>
						{t['cart.continue']}
					</a>
				)}
			</div>
		</div>
	)
})