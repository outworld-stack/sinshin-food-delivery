// src/components/site/checkout/OrderSummary.tsx
import { memo } from 'react'
import { InfoCircle } from 'reicon-react'
import { Skeleton } from '#/components/LoadingSkeletons'
import type { DeliveryType } from '#/types/site/checkout'
import { useI18n, tpl } from '#/i18n'
import type { RestaurantStatusDisplay } from '@sinshin/shared'

interface OrderSummaryProps {
	subtotal: number
	discount: number
	walletDeduction: number
	deliveryFee: number
	packagingFee: number
	total: number
	amountPaidOnline: number
	deliveryType: DeliveryType
	isLoading: boolean
	isSubmitBlocked: boolean
	isSubmitting: boolean
	onSubmit: () => void
	// رارد ۴۷ — تایپ درون‌خطی وضعیت رستوران با قرارداد RestaurantStatusDisplay یکی شد
	restaurantStatus: RestaurantStatusDisplay
}

export const OrderSummary = memo(function OrderSummary({
	subtotal,
	discount,
	walletDeduction,
	deliveryFee,
	packagingFee,
	total,
	amountPaidOnline,
	deliveryType,
	isLoading,
	isSubmitting,
	isSubmitBlocked,
	onSubmit,
	restaurantStatus,
}: OrderSummaryProps) {
	const { t, fmt } = useI18n()
	// مبلغ نهایی = کل سفارش منهای سهم کیف پول (پرداختِ واقعیِ الان)
	const finalAmount = total - walletDeduction
	const buttonText =
		finalAmount === 0 ? t['checkout.submitFree'] : t['checkout.submitPay']

	return (
		<div className="lg:col-span-1">
			<div className="lg:sticky lg:top-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
					{t['cart.summary']}
				</h2>

				{isLoading ? (
					<div className="space-y-4">
						<Skeleton className="h-6 w-full" />
						<Skeleton className="h-6 w-3/4" />
						<Skeleton className="h-10 w-full mt-4" />
					</div>
				) : (
					<>
						<div className="space-y-3 mb-6">
							<div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
								<span>{t['checkout.foodAmount']}</span>
								<span>{fmt.price(subtotal)} {t['common.toman']}</span>
							</div>
							{discount > 0 && (
								<div className="flex justify-between font-DanaRegular text-green-500">
									<span>{t['checkout.couponDiscount']}</span>
									<span>- {fmt.price(discount)} {t['common.toman']}</span>
								</div>
							)}
							{walletDeduction > 0 && (
								<div className="flex justify-between font-DanaRegular text-blue-500 bg-blue-50 dark:bg-blue-500/10 p-2 rounded-lg">
									<span>{t['checkout.walletLine']}</span>
									<span>- {fmt.price(walletDeduction)} {t['common.toman']}</span>
								</div>
							)}
							{/* stage-10: سه حالت تحویل — ارسال فقط برای پیک؛ بسته‌بندی برای پیک و بیرون‌بر */}
							{deliveryType === 'DELIVERY' && (
								<div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
									<span>{t['checkout.deliveryFee']}</span>
									<span>{fmt.price(deliveryFee)} {t['common.toman']}</span>
								</div>
							)}
							{deliveryType !== 'DINE_IN' && packagingFee > 0 && (
								<div className="flex justify-between font-DanaRegular text-gray-600 dark:text-gray-300">
									<span>{t['checkout.packagingFee']}</span>
									<span>{fmt.price(packagingFee)} {t['common.toman']}</span>
								</div>
							)}
							{deliveryType === 'DINE_IN' && (
								<div className="flex justify-between font-DanaRegular text-green-500">
									<span>{t['checkout.dineInLine']}</span>
									<span>{t['checkout.dineInFreeLine']}</span>
								</div>
							)}
						</div>

						<div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-white/5 mb-6">
							<span className="font-DanaDemiBold text-gray-800 dark:text-white">
								{t['checkout.finalTitle']}
							</span>
							<span className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">
								{fmt.price(finalAmount)}
							</span>
						</div>

						{walletDeduction > 0 ? (
							<div className="mb-4 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium text-center bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-xl">
								{fmt.price(walletDeduction)} {t['common.toman']} {t['checkout.fromWallet']}{' '}
								<span className="font-DanaDemiBold text-gray-800 dark:text-white">
									{fmt.price(amountPaidOnline)} {t['common.toman']}
								</span>{' '}
								{t['checkout.fromGateway']}
							</div>
						) : (
							<div className="mb-4 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium text-center bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-xl">
								{t['checkout.payableOnline']}{' '}
								<span className="font-DanaDemiBold text-gray-800 dark:text-white">
									{fmt.price(amountPaidOnline)} {t['common.toman']}
								</span>
							</div>
						)}

						<button
							type="button"
							onClick={onSubmit}
							disabled={isSubmitting || isSubmitBlocked}
							className="block w-full py-4 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-lg hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{isSubmitting ? t['checkout.processing'] : buttonText}
						</button>

						{/* آیتم ۸: هزینه پیک/بسته‌بندی فقط از درگاه — لحظه‌ای که کیف پول برای ارسال فعال است */}
						{deliveryType !== 'DINE_IN' && walletDeduction > 0 && (
							<div className="mt-4 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 flex items-start gap-2">
								<InfoCircle
									size={16}
									className="text-orange-500 shrink-0 mt-0.5"
								/>
								<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
									{t['checkout.gatewayNoteDelivery']}
								</p>
							</div>
						)}

						{/* رستوران بسته — تو باکس خلاصه، زیر دکمه */}
						{!restaurantStatus.isOpen && (
							<div className="mt-4 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
								<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed text-center">
									{tpl(t['checkout.closedSummary'], { n: restaurantStatus.nextOpenTime })}
								</p>
								{/* round-13 — علت بسته‌شدن موقت (اعلام‌شده توسط ادمین) */}
								{restaurantStatus.closeReason && (
									<p className="text-[11px] text-orange-500 dark:text-orange-300 font-DanaMedium leading-relaxed text-center mt-2 pt-2 border-t border-orange-200 dark:border-orange-500/20">
										<span className="font-DanaDemiBold">{t['checkout.closeReason']} </span>
										{restaurantStatus.closeReason}
									</p>
								)}
							</div>
						)}
						{/* قانون: بدون لغو — فقط پرداخت ناموفق (پرسش ۴) */}
						<p className="mt-4 text-center text-[11px] text-gray-400 dark:text-gray-500 font-DanaMedium leading-relaxed">
							{t['checkout.noCancel']}
						</p>
					</>
				)}
			</div>
		</div>
	)
})