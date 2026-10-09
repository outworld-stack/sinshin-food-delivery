// src/components/site/product-detail/ProductInfo.tsx
// stage-48 — حالت‌های سفارشِ مؤثر محصول (پیک/بیرون‌بر/سرو در محل)
// به‌شکل کامل و مفصل‌تر از کارت: کارتِ مجزا با آیکون + توضیح + وضعیت.
import { memo } from 'react'
import { Clock, Bicycle, Bag, Chair, Check, X } from 'reicon-react'
import type { Product } from '#/server/products'
import { useI18n, tpl } from '#/i18n'

interface ProductInfoProps {
	product: Product
}

// فقط با تغییر محصول رندر می‌شه
// رارد ۳۲ — «آماده‌سازی در {n} دقیقه» با ارقام زبان فعال
export const ProductInfo = memo(function ProductInfo({
	product,
}: ProductInfoProps) {
	const { t, fmt } = useI18n()

	// stage-48 — حالت‌های مؤثر (سروری = دسته AND محصول؛ نیامد = مجاز)
	const modes = [
		{
			ok: product.courierAllowed !== false,
			icon: Bicycle,
			title: t['common.courierBadge'],
			desc: t['pdetail.courierDesc'],
		},
		{
			ok: product.takeawayAllowed !== false,
			icon: Bag,
			title: t['common.takeawayBadge'],
			desc: t['pdetail.takeawayDesc'],
		},
		{
			ok: product.dineInAllowed !== false,
			icon: Chair,
			title: t['common.dineInBadge'],
			desc: t['pdetail.dineInDesc'],
		},
	]

	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-3 mb-4">
				<span className="px-3 py-1 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold">
					{product.categoryName || t['pdetail.category']}
				</span>
				<span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
					<Clock size={14} />
					{tpl(t['pdetail.prepTime'], { n: fmt.num(product.prepTime) })}
				</span>
			</div>

			<h1 className="font-MorabbaBold text-3xl md:text-4xl text-gray-900 dark:text-white mb-6">
				{product.name}
			</h1>

			<p className="text-base text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
				{product.description}
			</p>

			{/* ── stage-48 — حالت‌های سفارش (مفصل و زیبا) ── */}
			<div className="mb-8 p-4 rounded-2xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]">
				<p className="text-xs font-DanaDemiBold text-gray-600 dark:text-gray-300 mb-3">
					{t['pdetail.orderModesTitle']}
				</p>
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
					{modes.map(({ ok, icon: Icon, title, desc }) => (
						<div
							key={title}
							className={`flex flex-col gap-2 p-3 rounded-xl border transition ${
								ok
									? 'border-green-200 bg-green-50/60 dark:border-green-500/20 dark:bg-green-500/5'
									: 'border-red-200 bg-red-50/60 dark:border-red-500/20 dark:bg-red-500/5'
							}`}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-1.5 min-w-0">
									<span
										className={`shrink-0 ${
											ok
												? 'text-green-600 dark:text-green-400'
												: 'text-red-500 dark:text-red-400'
										}`}
									>
										<Icon size={18} />
									</span>
									<span className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200 truncate">
										{title}
									</span>
								</span>
								<span
									className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
										ok
											? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
											: 'bg-red-100 text-red-500 dark:bg-red-500/20 dark:text-red-400'
									}`}
								>
									{ok ? <Check size={12} /> : <X size={12} />}
								</span>
							</div>
							<p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
								{ok ? desc : t['pdetail.modeRestricted']}
							</p>
						</div>
					))}
				</div>
			</div>
		</div>
	)
})