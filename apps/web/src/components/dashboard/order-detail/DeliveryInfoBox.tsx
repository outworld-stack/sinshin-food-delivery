// src/components/dashboard/order-detail/DeliveryInfoBox.tsx
import { memo } from 'react'
import { Home, Package, Phone, Pin, User } from 'reicon-react'
import type { UserOrder } from '#/server/user'

interface DeliveryInfoBoxProps {
	order: UserOrder
}

export const DeliveryInfoBox = memo(function DeliveryInfoBox({
	order,
}: DeliveryInfoBoxProps) {
	// round-12 — حالت حضوری (بیرون‌بر PICKUP و سرو در سالن DINE_IN):
	// قبلاً فقط DINE_IN این شاخه را می‌گرفت و PICKUP به مسیر پیک می‌افتاد —
	// «آدرس تحویل» null و «در حال جستجوی پیک» برای سفارشی که پیک ندارد.
	if (order.deliveryType !== 'DELIVERY') {
		return (
			<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
					اطلاعات تحویل
				</h2>
				<div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-500/10">
					<Home size={24} className="text-green-500 shrink-0" />
					<p className="font-DanaMedium text-green-600 dark:text-green-400">
						سفارش شما از نوع تحویل حضوری است. با مراجعه به محل سین شین سفارش خود
						را تحویل بگیرید.
					</p>
				</div>
			</div>
		)
	}

	// حالت پیک
	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
				اطلاعات تحویل
			</h2>

			<div className="space-y-4">
				{/* آدرس */}
				<div>
					<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-1">
						آدرس تحویل
					</p>
					<p className="font-DanaMedium text-gray-700 dark:text-gray-200 leading-relaxed flex items-start gap-2">
						<Pin
							size={16}
							className="text-primary dark:text-dark-primary shrink-0 mt-1"
						/>
						{order.address}
					</p>
				</div>

				{/* در حال جستجوی پیک */}
				{order.status === 'PAID' && (
					<div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20">
						<Package size={24} className="text-yellow-500 shrink-0" />
						<p className="font-DanaMedium text-yellow-600 dark:text-yellow-400 text-sm">
							در حال جستجوی پیک برای ارسال سفارش شما هستیم...
						</p>
					</div>
				)}

				{/* پیک تخصیص‌یافته */}
				{(order.status === 'CONFIRMED' || order.status === 'ON_THE_WAY') && (
					<div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-white/5">
						<div className="flex items-center gap-3">
							<span className="w-10 h-10 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
								<User size={20} />
							</span>
							<div>
								<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
									{order.courierName ?? 'پیک سفارش شما'}
								</p>
								{order.courierPhone && (
									<p
										className="text-xs text-gray-400 dark:text-gray-500"
										dir="ltr"
									>
										{order.courierPhone}
									</p>
								)}
							</div>
						</div>
						{order.courierPhone && (
							<a
								href={`tel:${order.courierPhone}`}
								className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white cursor-pointer shrink-0 hover:opacity-90 transition"
								aria-label="تماس با پیک"
							>
								<Phone size={20} />
							</a>
						)}
					</div>
				)}

				{/* تحویل‌داده‌شده */}
				{order.status === 'DELIVERED' && (
					<div className="flex items-center gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
						<span className="w-10 h-10 rounded-full bg-gray-200 dark:bg-[#2a1015] text-gray-500 flex items-center justify-center">
							<User size={20} />
						</span>
						<div>
							<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
								پیک تحویل‌دهنده:
							</p>
							<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
								{order.courierName}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
})
