// src/components/site/checkout/DeliveryTypeSelector.tsx
// stage-10: سه حالت تحویل در دو گروه —
//  ۱) ارسال با پیک (DELIVERY)
//  ۲) تحویل حضوری → دو زیربخش:
//     • سرو در محل سین‌شین (DINE_IN) — بدون هزینه بسته‌بندی
//     • تحویل گرفتن از سین‌شین (PICKUP / بیرون‌بر) — با هزینه بسته‌بندی
// هزینه بسته‌بندی per-product است و از breakdown سرور می‌آید.
// رارد ۳۲ — متن‌ها از دیکشنری؛ قیمت‌ها با فرمتر زبان‌آگاه.
// stage-48 — گزینه‌ی تحویلی که آیتمی از سبد اجازه‌ی آن را ندارد قفل می‌شود
// (کم‌رنگ + hint) — قرارداد سرور: یک آیتم محدود ⇒ کل سفارش.
import { memo } from 'react'
import type { DeliveryType } from '#/types/site/checkout'
import { useI18n, tpl } from '#/i18n'

interface DeliveryTypeSelectorProps {
	deliveryType: DeliveryType
	deliveryFee: number
	packagingFee: number
	onChange: (t: DeliveryType) => void
	/** stage-48 — حالت‌های مسدود (اسم محصول محدودکننده) */
	blockedCourier?: string | null
	blockedTakeaway?: string | null
	blockedDineIn?: string | null
}

export const DeliveryTypeSelector = memo(function DeliveryTypeSelector({
	deliveryType,
	deliveryFee,
	packagingFee,
	onChange,
	blockedCourier = null,
	blockedTakeaway = null,
	blockedDineIn = null,
}: DeliveryTypeSelectorProps) {
	const { t, fmt } = useI18n()
	const isInPerson = deliveryType === 'PICKUP' || deliveryType === 'DINE_IN'

	return (
		<div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">
				{t['checkout.deliveryTitle']}
			</h2>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{/* ── ۱. ارسال با پیک ── */}
				<label
					className={`flex items-center gap-4 p-4 rounded-xl border-2 transition ${
						!blockedCourier && deliveryType === 'DELIVERY'
							? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
							: blockedCourier
								? 'border-gray-200 dark:border-[#3a151c] opacity-70 cursor-not-allowed bg-gray-50 dark:bg-[#1a0a0e]'
								: 'border-gray-200 dark:border-[#3a151c] cursor-pointer'
					}`}
				>
					<input
						type="radio"
						name="deliveryType"
						checked={!blockedCourier && deliveryType === 'DELIVERY'}
						disabled={!!blockedCourier}
						onChange={() => onChange('DELIVERY')}
						className="w-4 h-4 accent-primary dark:accent-dark-primary"
					/>
					<div>
						<p className="font-DanaDemiBold text-gray-800 dark:text-white">
							{t['checkout.courier']}
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							{blockedCourier
								? tpl(t['checkout.modeBlockedHint'], { n: blockedCourier })
								: tpl(t['checkout.courierFee'], {
										n: `${fmt.price(deliveryFee)} ${t['common.toman']}`,
									})}
						</p>
					</div>
				</label>

				{/* ── ۲. تحویل حضوری — انتخاب این، دو زیربخش باز می‌کند ── */}
				<label
					className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${
						isInPerson
							? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
							: 'border-gray-200 dark:border-[#3a151c]'
					}`}
				>
					<input
						type="radio"
						name="deliveryType"
						checked={isInPerson}
						onChange={() => onChange('DINE_IN')}
						className="w-4 h-4 accent-primary dark:accent-dark-primary"
					/>
					<div>
						<p className="font-DanaDemiBold text-gray-800 dark:text-white">
							{t['checkout.inPerson']}
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							{t['checkout.inPersonSub']}
						</p>
					</div>
				</label>
			</div>

			{/* ── زیربخش‌های تحویل حضوری ── */}
			{isInPerson && (
				<div className="mt-4 mr-3 sm:mr-5 border-r-2 border-primary/30 dark:border-dark-primary/30 pr-3 sm:pr-5 pt-1">
					<p className="text-xs text-gray-400 font-DanaMedium mb-3">
						{t['checkout.chooseInPerson']}
					</p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{/* سرو در محل — بدون بسته‌بندی */}
						<label
							className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition ${
								!blockedDineIn && deliveryType === 'DINE_IN'
									? 'border-green-500 bg-green-50 dark:bg-green-500/10'
									: blockedDineIn
										? 'border-gray-200 dark:border-[#3a151c] opacity-70 cursor-not-allowed bg-gray-50 dark:bg-[#1a0a0e]'
										: 'border-gray-200 dark:border-[#3a151c] cursor-pointer'
							}`}
						>
							<input
								type="radio"
								name="inPersonMode"
								checked={!blockedDineIn && deliveryType === 'DINE_IN'}
								disabled={!!blockedDineIn}
								onChange={() => onChange('DINE_IN')}
								className="w-4 h-4 accent-green-500"
							/>
							<div>
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									{t['checkout.dineIn']}
								</p>
								<p
									className={`text-xs mt-1 ${blockedDineIn ? 'text-gray-400 dark:text-gray-500' : 'text-green-600 dark:text-green-400'}`}
								>
									{blockedDineIn
										? tpl(t['checkout.modeBlockedHint'], { n: blockedDineIn })
										: t['checkout.dineInFree']}
								</p>
							</div>
						</label>

						{/* بیرون‌بر — با بسته‌بندی */}
						<label
							className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition ${
								!blockedTakeaway && deliveryType === 'PICKUP'
									? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
									: blockedTakeaway
										? 'border-gray-200 dark:border-[#3a151c] opacity-70 cursor-not-allowed bg-gray-50 dark:bg-[#1a0a0e]'
										: 'border-gray-200 dark:border-[#3a151c] cursor-pointer'
							}`}
						>
							<input
								type="radio"
								name="inPersonMode"
								checked={!blockedTakeaway && deliveryType === 'PICKUP'}
								disabled={!!blockedTakeaway}
								onChange={() => onChange('PICKUP')}
								className="w-4 h-4 accent-primary dark:accent-dark-primary"
							/>
							<div>
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									{t['checkout.pickup']}
								</p>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
									{blockedTakeaway
										? tpl(t['checkout.modeBlockedHint'], { n: blockedTakeaway })
										: packagingFee > 0
											? tpl(t['checkout.pickupFee'], {
													n: `${fmt.price(packagingFee)} ${t['common.toman']}`,
												})
											: t['checkout.pickupFeeGeneric']}
								</p>
							</div>
						</label>
					</div>
				</div>
			)}
		</div>
	)
})