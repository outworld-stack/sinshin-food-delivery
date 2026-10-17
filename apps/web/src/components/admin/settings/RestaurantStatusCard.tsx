// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/settings/RestaurantStatusCard.tsx (فایل جدید)
// «باکس وضعیت رستوران» — سه بخش در یک کارتِ واحد (خواسته‌ی stage-84):
//   ① باز/بسته کردنِ دائم (ساعتی) — فقط ادمین اصلی
//   ② اعلام شلوغی رستوران — ادمین اصلی + ادمین۲ با canAnnounceBusy
//   ③ بسته/باز موقت — TemporaryCloseCard موجود (ادمین اصلی + مجوز)
//
// شلوغی فقط «اطلاع‌رسانی» است: سفارش‌دهی آزاد می‌ماند؛ در چک‌اوت، سرو در
// محل هنگام شلوغی یادداشتِ «اسم و شماره میز» را الزامی می‌کند.
// رسپانسیو: زیربخش‌ها گرید تک‌ستونه در موبایل و دو-ستونه از sm.
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/components/admin/settings/RestaurantStatusCard.tsx
import { memo } from 'react'
import { Clock, Store, Users } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import { setRestaurantBusy } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { settingsBusyOptions } from '#/utils/queryOptions'
import { TemporaryCloseCard } from './TemporaryCloseCard'

interface RestaurantStatusCardProps {
	/** ساعت کاری (باز/بسته دائم) — فقط ادمین اصلی */
	isMainAdmin: boolean
	/** ادمین۲ با مجوزِ اعلام شلوغی */
	canAnnounceBusy: boolean
	/** ادمین۲ با مجوزِ بسته/باز موقت */
	canToggleTemporaryClose: boolean
	/** زیربخش ۱ — وضعیت باز (ساعتی) از کوئری صفحه */
	hourlyOpen: boolean
	/** شلوغ است؟ (از کوئری همین کارت — نمایش بج وضعیت) */
	busy: boolean
	/** بسته‌ی موقت است؟ (برای بج وضعیت) */
	temporarilyClosed: boolean
	onToggleHourly: () => void
	nextOpenTime: string
	onNextOpenTimeChange: (value: string) => void
}

export const RestaurantStatusCard = memo(function RestaurantStatusCard({
	isMainAdmin,
	canAnnounceBusy,
	canToggleTemporaryClose,
	hourlyOpen,
	busy,
	temporarilyClosed,
	onToggleHourly,
	nextOpenTime,
	onNextOpenTimeChange,
}: RestaurantStatusCardProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)

	const { data: busyData } = useQuery({
		...settingsBusyOptions,
		enabled: isMainAdmin || canAnnounceBusy,
	})
	const isBusy = busyData ?? busy

	const busyMutation = useMutation({
		mutationFn: (next: boolean) => setRestaurantBusy({ data: { busy: next } }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: qk.settingsBusy })
			// چک‌اوت همیشه وضعیت تازه ببیند (هشدارِ سرو در محل)
			queryClient.invalidateQueries({ queryKey: qk.restaurantStatus })
			showToast('وضعیت شلوغی رستوران ثبت شد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'ثبت وضعیت ناموفق بود', 'error'),
	})

	const visible = isMainAdmin || canAnnounceBusy || canToggleTemporaryClose
	if (!visible) return null

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			{/* هدر — عنوان + بج‌های وضعیت زنده */}
			<div className="flex flex-wrap items-center justify-between gap-3 mb-4">
				<h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white flex items-center gap-2">
					<Store size={20} className="text-primary dark:text-dark-primary" />
					وضعیت رستوران
				</h2>
				<div className="flex flex-wrap items-center gap-2">
					{temporarilyClosed ? (
						<span className="px-3 py-1 rounded-full text-[11px] font-DanaDemiBold bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400">
							بسته موقت
						</span>
					) : (
						<span
							className={`px-3 py-1 rounded-full text-[11px] font-DanaDemiBold ${
								hourlyOpen
									? 'bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400'
									: 'bg-red-100 dark:bg-red-500/15 text-red-500 dark:text-red-400'
							}`}
						>
							{hourlyOpen ? 'باز' : 'بسته (ساعتی)'}
						</span>
					)}
					{isBusy && (
						<span className="px-3 py-1 rounded-full text-[11px] font-DanaDemiBold bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
							شلوغ
						</span>
					)}
				</div>
			</div>

			{/* ① باز/بسته دائم (ساعتی) — فقط ادمین اصلی */}
			{isMainAdmin && (
				<div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3 min-w-0">
							<Store
								size={20}
								className={`shrink-0 ${hourlyOpen ? 'text-green-500' : 'text-red-500'}`}
							/>
							<div className="min-w-0">
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									باز/بسته دائم (ساعتی)
								</p>
								<p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
									در حالت بسته، مشتری می‌تواند سفارش دهد اما ارسال بعد از باز شدن
									انجام می‌شود.
								</p>
							</div>
						</div>
						<Toggle
							isOn={hourlyOpen}
							onToggle={onToggleHourly}
							label="باز/بسته بودن رستوران"
						/>
					</div>
					{!hourlyOpen && (
						<div className="mt-3">
							<label className="flex items-center gap-1.5 text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
								<Clock size={14} />
								ساعت باز شدن بعدی (به مشتریان نمایش داده می‌شود)
							</label>
							<input
								type="text"
								value={nextOpenTime}
								onChange={(e) => onNextOpenTimeChange(e.target.value)}
								className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm"
								placeholder="مثلاً: ۱۱:۰۰ صبح"
							/>
						</div>
					)}
				</div>
			)}

			{/* ② اعلام شلوغی — ادمین اصلی + ادمین۲ با canAnnounceBusy */}
			{(isMainAdmin || canAnnounceBusy) && (
				<div
					className={`p-4 rounded-xl border ${
						isBusy
							? 'bg-amber-50/70 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
							: 'bg-gray-50 dark:bg-[#1a0a0e] border-gray-100 dark:border-[#3a151c]'
					} ${isMainAdmin ? 'mt-3' : ''}`}
				>
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3 min-w-0">
							<Users
								size={20}
								className={`shrink-0 ${isBusy ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500'}`}
							/>
							<div className="min-w-0">
								<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									اعلام شلوغی رستوران
								</p>
								<p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
									سفارش‌دهی آزاد می‌ماند؛ در چک‌اوتِ «سرو در محل»، اسم و شماره میز
									از مشتری خواسته می‌شود.
								</p>
							</div>
						</div>
						<Toggle
							isOn={isBusy}
							onToggle={() => busyMutation.mutate(!isBusy)}
							label="اعلام وضعیت شلوغی"
						/>
					</div>
				</div>
			)}

			{/* ③ بسته/باز موقت — همان کارتِ موجود، به‌عنوان بخش سومِ باکس */}
			<div className={isMainAdmin || canAnnounceBusy ? 'mt-3' : ''}>
				<TemporaryCloseCard
					visible={isMainAdmin || canToggleTemporaryClose === true}
				/>
			</div>
		</div>
	)
})
