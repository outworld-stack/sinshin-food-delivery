// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/admin/settings/FeaturedAnimationCard.tsx
// کارت «انیمیشن صفحه‌ی محصول ویژه» — فقط ادمین اصلی (بک: requireAdmin).
// انتخاب یکی از سه انیمیشن پس‌زمینه‌ی صفحه‌ی اختصاصیِ محصول ویژه:
//   • shader — شیدر موج‌دار WebGL (انیمیشن فعلی — پیش‌فرض)
//   • sonar  — شبکه‌ی نقطه‌ای با حلقه‌های پخش‌شونده (SonarGrid کارفرما)
//   • sparks — جرقه‌های پخش‌شونده از دو گوشه (DualSparks کارفرما)
// الگوی PaymentGatewaysCard: کوئری staleTime-0 + موتیشن + قفل تا رسیدن
// وضعیت ذخیره‌شده (کلیکِ زودهنگام پیش‌فرض را بازنویسی نکند) + توست.
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memo } from 'react'
import { Sparkles, Star, Wifi } from 'reicon-react'
import { setFeaturedAnimation } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import type { FeaturedAnimation } from '#/types/site/featured-animation'
import { qk } from '#/utils/queryKeys'
import { settingsFeaturedAnimationOptions } from '#/utils/queryOptions'

interface FeaturedAnimationCardProps {
	/** کارت فقط برای ادمین اصلی رندر می‌شود (روت ownerOnly) */
	visible: boolean
}

const OPTIONS: {
	key: FeaturedAnimation
	label: string
	hint: string
	icon: typeof Star
}[] = [
	{
		key: 'shader',
		label: 'شیدر موج‌دار (فعلی)',
		hint: 'موج‌های رنگی WebGL با تعامل اشاره‌گر — انیمیشن فعلی سایت',
		icon: Star,
	},
	{
		key: 'sonar',
		label: 'شبکه‌ی سونار',
		hint: 'میدان نقطه‌ای با حلقه‌های پخش‌شونده (پینگ‌های محیطی)',
		icon: Wifi,
	},
	{
		key: 'sparks',
		label: 'جرقه‌های دوطرفه',
		hint: 'اشعه‌های جرقه‌ای که از دو گوشه‌ی بالا موج می‌زنند',
		icon: Sparkles,
	},
]

export const FeaturedAnimationCard = memo(function FeaturedAnimationCard({
	visible,
}: FeaturedAnimationCardProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const { data: animation } = useQuery({
		...settingsFeaturedAnimationOptions,
		enabled: visible,
	})

	const mutation = useMutation({
		mutationFn: (next: FeaturedAnimation) =>
			setFeaturedAnimation({ data: { animation: next } }),
		onSuccess: async (_data, next) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: qk.settingsFeaturedAnimation,
				}),
				// خواندنِ عمومیِ صفحه‌ی محصول هم همان لحظه تازه شود (ادمین بعد از
				// ذخیره معمولاً خودش صفحه را باز می‌کند — نبض ETag منو هم هست)
				queryClient.invalidateQueries({ queryKey: qk.featuredAnimation }),
			])
			const chosen = OPTIONS.find((o) => o.key === next)
			showToast(
				chosen
					? `انیمیشن محصول ویژه «${chosen.label}» ذخیره شد`
					: 'انیمیشن محصول ویژه ذخیره شد',
			)
		},
		onError: (err: Error) =>
			showToast(err.message || 'ذخیره ناموفق بود', 'error'),
	})

	if (!visible) return null

	// تا رسیدنِ وضعیت ذخیره‌شده، ردیف‌ها قفل‌اند (درسِ اسکن استیج-۸۴ — کلیکِ
	// زودهنگام پیش‌فرضِ shader را روی مقدارِ ذخیره‌شده نمی‌نویسد)
	const loading = animation === undefined
	const current: FeaturedAnimation = animation ?? 'shader'

	const handleSelect = (next: FeaturedAnimation) => {
		if (loading || mutation.isPending || next === current) return
		mutation.mutate(next)
	}

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1 flex items-center gap-2">
				<Sparkles size={20} className="text-primary dark:text-dark-primary" />
				انیمیشن صفحه‌ی محصول ویژه
			</h2>
			<p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
				پس‌زمینه‌ی متحرکِ صفحه‌ی اختصاصیِ محصولِ ویژه. انتخاب شما برای همه‌ی
				بازدیدکنندگان اعمال می‌شود (حدود ۳۰ ثانیه بعد از ذخیره).
			</p>
			<div
				className="space-y-2.5"
				role="radiogroup"
				aria-label="انتخاب انیمیشن صفحه‌ی محصول ویژه"
			>
				{OPTIONS.map(({ key, label, hint, icon: Icon }) => {
					const active = key === current
					const pending = active && mutation.isPending
					const rowDisabled = loading || mutation.isPending
					return (
						<label
							key={key}
							className={`w-full flex items-center gap-3 p-3 rounded-xl text-right transition border focus-within:ring-2 focus-within:ring-primary/30 dark:focus-within:ring-dark-primary/30 ${
								active
									? 'bg-primary/5 dark:bg-dark-primary/5 border-primary dark:border-dark-primary shadow-sm'
									: 'bg-gray-50 dark:bg-[#1a0a0e] border-gray-100 dark:border-[#3a151c] hover:border-primary/40 dark:hover:border-dark-primary/40'
							} ${rowDisabled ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
						>
							{/* رادیوی ناتیو (نامرئی) — دسترس‌پذیری/کیبورد رامرغ
                                                            می‌کند؛ بیوم لازمش داشت (useSemanticElements) */}
							<input
								type="radio"
								name="featured-animation"
								checked={active}
								disabled={rowDisabled}
								onChange={() => handleSelect(key)}
								className="sr-only"
							/>
							<span
								className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-xl ${
									active
										? 'bg-primary dark:bg-dark-primary text-white'
										: 'bg-gray-100 dark:bg-[#2a1015] text-primary dark:text-dark-primary'
								}`}
							>
								<Icon size={18} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									{label}
									{active && (
										<span className="mr-2 text-[10px] font-DanaMedium text-primary dark:text-dark-primary">
											{pending ? 'در حال ذخیره…' : 'فعال'}
										</span>
									)}
								</span>
								<span className="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
									{hint}
								</span>
							</span>
							<span
								className={`shrink-0 w-4.5 h-4.5 rounded-full border-2 transition ${
									active
										? 'border-primary dark:border-dark-primary bg-primary dark:bg-dark-primary shadow-[inset_0_0_0_2.5px_#fff]'
										: 'border-gray-300 dark:border-gray-600'
								}`}
							/>
						</label>
					)
				})}
			</div>
			<p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
				توجه: انیمیشن فقط روی صفحه‌ی محصولاتی که «ویژه» علامت خورده‌اند نمایش داده
				می‌شود؛ بقیه‌ی صفحات تغییری نمی‌کنند.
			</p>
		</div>
	)
})
