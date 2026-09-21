// src/components/site/checkout/DeliveryTypeSelector.tsx
// stage-10: سه حالت تحویل در دو گروه —
//  ۱) ارسال با پیک (DELIVERY)
//  ۲) تحویل حضوری → دو زیربخش:
//     • سرو در محل سین‌شین (DINE_IN) — بدون هزینه بسته‌بندی
//     • تحویل گرفتن از سین‌شین (PICKUP / بیرون‌بر) — با هزینه بسته‌بندی
// هزینه بسته‌بندی per-product است و از breakdown سرور می‌آید.
import { memo } from 'react'
import type { DeliveryType } from '#/types/site/checkout'
import { formatPrice } from '#/utils/format'

interface DeliveryTypeSelectorProps {
	deliveryType: DeliveryType
	deliveryFee: number
	packagingFee: number
	onChange: (t: DeliveryType) => void
}

export const DeliveryTypeSelector = memo(function DeliveryTypeSelector({
	deliveryType,
	deliveryFee,
	packagingFee,
	onChange,
}: DeliveryTypeSelectorProps) {
	const isInPerson = deliveryType === 'PICKUP' || deliveryType === 'DINE_IN'

	return (
		<div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">
				نوع تحویل سفارش
			</h2>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{/* ── ۱. ارسال با پیک ── */}
				<label
					className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${
						deliveryType === 'DELIVERY'
							? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
							: 'border-gray-200 dark:border-[#3a151c]'
					}`}
				>
					<input
						type="radio"
						name="deliveryType"
						checked={deliveryType === 'DELIVERY'}
						onChange={() => onChange('DELIVERY')}
						className="w-4 h-4 accent-primary dark:accent-dark-primary"
					/>
					<div>
						<p className="font-DanaDemiBold text-gray-800 dark:text-white">
							ارسال با پیک
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							{formatPrice(deliveryFee)} تومان + هزینه بسته‌بندی
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
							تحویل حضوری
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							سرو در محل یا بیرون‌بر
						</p>
					</div>
				</label>
			</div>

			{/* ── زیربخش‌های تحویل حضوری ── */}
			{isInPerson && (
				<div className="mt-4 mr-3 sm:mr-5 border-r-2 border-primary/30 dark:border-dark-primary/30 pr-3 sm:pr-5 pt-1">
					<p className="text-xs text-gray-400 font-DanaMedium mb-3">
						حالت تحویل حضوری را انتخاب کنید:
					</p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{/* سرو در محل — بدون بسته‌بندی */}
						<label
							className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition ${
								deliveryType === 'DINE_IN'
									? 'border-green-500 bg-green-50 dark:bg-green-500/10'
									: 'border-gray-200 dark:border-[#3a151c]'
							}`}
						>
							<input
								type="radio"
								name="inPersonMode"
								checked={deliveryType === 'DINE_IN'}
								onChange={() => onChange('DINE_IN')}
								className="w-4 h-4 accent-green-500"
							/>
							<div>
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									سرو در محل سین‌شین
								</p>
								<p className="text-xs text-green-600 dark:text-green-400 mt-1">
									بدون هزینه بسته‌بندی
								</p>
							</div>
						</label>

						{/* بیرون‌بر — با بسته‌بندی */}
						<label
							className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition ${
								deliveryType === 'PICKUP'
									? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
									: 'border-gray-200 dark:border-[#3a151c]'
							}`}
						>
							<input
								type="radio"
								name="inPersonMode"
								checked={deliveryType === 'PICKUP'}
								onChange={() => onChange('PICKUP')}
								className="w-4 h-4 accent-primary dark:accent-dark-primary"
							/>
							<div>
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									تحویل گرفتن از سین‌شین (بیرون‌بر)
								</p>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
									{packagingFee > 0
										? `با ${formatPrice(packagingFee)} تومان هزینه بسته‌بندی`
										: 'با هزینه بسته‌بندی'}
								</p>
							</div>
						</label>
					</div>
				</div>
			)}
		</div>
	)
})
