// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/ProductCard.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر:
//   • سه بج حالت سفارش (پیک/بیرون‌بر/سرو در محل) — سبز = مجاز،
//     قرمز = غیرمجاز (مؤثر = دسته AND محصول؛ از سرور)
//   • ناموجود: عکس تار + نوشته‌ی نارنجی روی عکس + قفل دکمه‌ی سبد
// ═══════════════════════════════════════════════════════════════

// src/components/ProductCard.tsx

import { Link } from '@tanstack/react-router'
import { memo, useCallback, useReducer, useState } from 'react'
import { Bag, Bicycle, Cart, Chair } from 'reicon-react'
import { CountdownTimer } from '#/components/shared/CountdownTimer'
import { tpl, useI18nSafe } from '#/i18n'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'
import type { ProductCardProps } from '#/types/shared/ui'

/**
 * stage-47 — پنجره‌ی تخفیف همین لحظه فعال است؟ (سمت کلاینت)
 * قرارداد سرور: [startsAt, endsAt]؛ هر طرف null = باز؛ رشته‌ی خراب = نادیده
 * (عمداً fail-open مثل بک‌اند — نمایش، قیمت واقعی همیشه سروری است).
 */
function windowActiveNow(
	startsAt: string | null | undefined,
	endsAt: string | null | undefined,
): boolean {
	const now = Date.now()
	if (startsAt) {
		const t = new Date(startsAt).getTime()
		if (Number.isFinite(t) && now < t) return false
	}
	if (endsAt) {
		const t = new Date(endsAt).getTime()
		if (Number.isFinite(t) && now > t) return false
	}
	return true
}

/** stage-47 — قیمت مؤثر سایز: اول فلگ/قیمت سرور، بعد محاسبه‌ی محلی (پیش‌نمایش) */
function sizeEffective(
	size: NonNullable<ProductCardProps['product']['sizes'][number]>,
): { active: boolean; pct: number; price: number; endsAt: string | null } {
	const pct = size.discountPercentage ?? 0
	const active =
		pct > 0 &&
		(size.discountActive !== undefined
			? size.discountActive
			: windowActiveNow(size.discountStartsAt, size.discountEndsAt))
	return {
		active,
		pct,
		price: active
			? (size.finalPrice ?? Math.round(size.price * (1 - pct / 100)))
			: size.price,
		endsAt: active ? (size.discountEndsAt ?? null) : null,
	}
}

// رارد ۳۲ — دوزبانه با useI18nSafe: این کارت در گرید سایت (داخل Provider =
// دوزبانه) و در فرم محصول ادمین به‌عنوان پیش‌نمایش (خارج Provider = فارسی
// خالص، همان رفتار قبل) استفاده می‌شود.
export const ProductCard = memo(function ProductCard({
	product,
	interactive = true,
}: ProductCardProps) {
	const addItem = useCartStore((state) => state.addItem)
	const showToast = useToastStore((state) => state.showToast)
	const { t, fmt } = useI18nSafe()

	// stage-47 — انقضای شمارنده → بازمحاسبه‌ی بج/قیمت همان لحظه (بدون رفرش)
	const [, bump] = useReducer((x: number) => x + 1, 0)
	const onCountdownEnd = useCallback(() => bump(), [])

	const hasSizes =
		product.sizesEnabled && product.sizes && product.sizes.length > 0
	const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null)
	const effectiveSizeId = hasSizes
		? (selectedSizeId ?? product.sizes[0].id)
		: null
	const selectedSize = hasSizes
		? product.sizes.find((s) => s.id === effectiveSizeId)
		: null

	// stage-47 — سطح فعال تخفیف: سایزِ انتخاب‌شده یا خود محصول
	const sizeEff = selectedSize ? sizeEffective(selectedSize) : null
	const productPct = product.discountPercentage
	const productActive =
		productPct > 0 &&
		(product.discountActive !== undefined
			? product.discountActive
			: windowActiveNow(product.discountStartsAt, product.discountEndsAt))

	const showDiscount = sizeEff ? sizeEff.active : productActive
	const activePct = sizeEff ? (sizeEff.active ? sizeEff.pct : 0) : productPct
	const activeEndsAt = sizeEff
		? sizeEff.endsAt
		: productActive
			? (product.discountEndsAt ?? null)
			: null

	const displayPrice = sizeEff ? sizeEff.price : product.finalPrice
	// stage-47 — قیمت خامِ سطح فعال (سایز یا محصول) برای خط‌خوردگی
	const crossedPrice = selectedSize ? selectedSize.price : product.originalPrice

	// ── stage-48 — موجودی + حالت‌های مؤثر سفارش ──
	const unavailable = product.isAvailable === false
	const courierOk = product.courierAllowed !== false
	const takeawayOk = product.takeawayAllowed !== false
	const dineInOk = product.dineInAllowed !== false
	const anyModeRestricted = !courierOk || !takeawayOk || !dineInOk

	const handleAddToCart = useCallback(() => {
		if (unavailable) return
		addItem(product.id, 1, effectiveSizeId)
		showToast(
			tpl(t['pdetail.addedToast'], {
				n: `${product.name}${selectedSize ? ` (${selectedSize.name})` : ''}`,
			}),
		)
	}, [
		addItem,
		showToast,
		product.id,
		product.name,
		effectiveSizeId,
		selectedSize,
		unavailable,
		t,
	])

	// stage-47 — بج + شمارنده (روی تصویر؛ پنل زنده‌ی پیش‌نمایش هم همین را می‌بیند)
	const badge =
		showDiscount && activePct > 0 ? (
			<div className="absolute top-3 left-3 bg-white/90 dark:bg-[#1a0a0e]/90 backdrop-blur-sm text-primary dark:text-dark-primary text-xs font-DanaDemiBold px-3 py-1 rounded-full shadow-md">
				{tpl(t['common.discountBadge'], { n: fmt.num(activePct) })}
			</div>
		) : null

	const countdown = showDiscount ? (
		<div className="absolute bottom-3 right-3 left-3 flex justify-center">
			<CountdownTimer
				endsAt={activeEndsAt}
				onEnd={onCountdownEnd}
				variant="card"
			/>
		</div>
	) : null

	// stage-48 — لایه‌ی ناموجودی روی عکس: تاری + نوشته‌ی نارنجی
	const unavailableOverlay = unavailable ? (
		<div
			className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[3px]"
			aria-hidden="true"
		>
			<span className="px-3 py-1.5 rounded-xl bg-orange-500/90 text-white text-xs font-DanaDemiBold shadow-lg text-center leading-relaxed">
				{t['common.temporarilyUnavailable']}
			</span>
		</div>
	) : null

	// stage-48 — سه بج حالت سفارش (کوتاه و مجمل) زیر عنوان
	const modeBadges = (
		<div className="flex flex-wrap items-center gap-1.5">
			{(
				[
					{
						ok: courierOk,
						icon: Bicycle,
						label: t['common.courierBadge'],
						full: t['checkout.courier'],
					},
					{
						ok: takeawayOk,
						icon: Bag,
						label: t['common.takeawayBadge'],
						full: t['checkout.pickup'],
					},
					{
						ok: dineInOk,
						icon: Chair,
						label: t['common.dineInBadge'],
						full: t['checkout.dineIn'],
					},
				] as const
			).map(({ ok, icon: Icon, label, full }) => (
				<span
					key={label}
					title={`${full} — ${ok ? t['common.modeAvailable'] : t['common.modeUnavailable']}`}
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-DanaDemiBold ${
						ok
							? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
							: 'bg-red-100 text-red-500 dark:bg-red-500/10 dark:text-red-400'
					}`}
				>
					<Icon size={11} />
					{label}
				</span>
			))}
		</div>
	)

	return (
		<div className="group flex flex-col bg-white dark:bg-[#2a1015] rounded-2xl overflow-hidden border border-gray-300 dark:border-[#3a151c] shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
			{/* سئو-۸: <img> واقعی به‌جای تصویر پس‌زمینه — alt + lazy + دیده‌شدن در Google Images
      round-12 — interactive=false (پیش‌نمایش فرم محصول): بدون Link — لینک با
      id سنتینل «preview»، preload روی هاور/فوکوس می‌ساخت و 422 پترن UUID
      می‌گرفت (نویز کنسول + RouteError روی کلیک) */}
			{interactive ? (
				<Link
					to="/products/$productId"
					params={{ productId: product.id }}
					className="relative block w-full aspect-4/3 bg-gray-100 dark:bg-[#1a0a0e]"
				>
					{product.profileImage ? (
						<img
							src={product.profileImage}
							alt={product.name}
							loading="lazy"
							decoding="async"
							className={`h-full w-full object-cover ${unavailable ? 'blur-[2px] saturate-75' : ''}`}
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]"></div>
					)}
					{badge}
					{countdown}
					{unavailableOverlay}
				</Link>
			) : (
				<div className="relative block w-full aspect-4/3 bg-gray-100 dark:bg-[#1a0a0e]">
					{product.profileImage ? (
						<img
							src={product.profileImage}
							alt={product.name}
							decoding="async"
							className={`h-full w-full object-cover ${unavailable ? 'blur-[2px] saturate-75' : ''}`}
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]"></div>
					)}
					{badge}
					{countdown}
					{unavailableOverlay}
				</div>
			)}

			{/* round-14 — موبایل: پدینگ جمع‌تر، قیمت/«تومان» و آیکون سبد کوچک‌تر تا کارت در عرض کم نشکند */}
			<div className="p-3 sm:p-4 flex flex-col flex-1">
				{interactive ? (
					<Link to="/products/$productId" params={{ productId: product.id }}>
						<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1 hover:text-primary dark:hover:text-dark-primary transition-colors">
							{product.name}
						</h3>
					</Link>
				) : (
					<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1">
						{product.name}
					</h3>
				)}

				<p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 font-DanaRegular mb-2 h-10 overflow-hidden">
					{product.description ?? ''}
				</p>

				{/* stage-48 — بج‌های حالت سفارش (فقط وقتی محدودیتی هست که فضا نگیرد؛ همه‌مجاز = بدون بج) */}
				{(anyModeRestricted || unavailable) && (
					<div className="mb-2">{modeBadges}</div>
				)}

				{hasSizes && (
					<div className="flex flex-wrap gap-1.5 mb-2">
						{product.sizes.map((size) => {
							const eff = sizeEffective(size)
							return (
								<button
									key={size.id}
									type="button"
									onClick={() => setSelectedSizeId(size.id)}
									className={`px-2.5 py-1 rounded-lg text-[11px] font-DanaMedium transition cursor-pointer ${
										size.id === effectiveSizeId
											? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
											: 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
									}`}
								>
									{size.name}
									{eff.active && eff.pct > 0 && (
										<span className="mr-1 opacity-80">٪{fmt.num(eff.pct)}</span>
									)}
								</button>
							)
						})}
					</div>
				)}

				<div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
					<div className="flex flex-col">
						{showDiscount && crossedPrice > displayPrice && (
							<span className="text-[11px] sm:text-xs text-gray-400 line-through font-DanaRegular">
								{fmt.price(crossedPrice)}
							</span>
						)}
						<div className="flex items-center gap-1">
							<span className="font-DanaDemiBold text-[15px] sm:text-lg text-gray-900 dark:text-white">
								{fmt.price(displayPrice)}
							</span>
							<span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mr-0.5 sm:mr-1">
								{t['common.toman']}
							</span>
						</div>
					</div>

					<button
						type="button"
						onClick={handleAddToCart}
						disabled={unavailable}
						aria-label={
							unavailable
								? t['common.temporarilyUnavailable']
								: t['pdetail.addToCart']
						}
						title={unavailable ? t['common.temporarilyUnavailable'] : undefined}
						className={`cursor-pointer flex items-center justify-center p-2 sm:p-3 rounded-xl transition-colors duration-300 shrink-0 ${
							unavailable
								? 'bg-gray-200 dark:bg-[#3a151c] text-gray-400 dark:text-gray-500 cursor-not-allowed'
								: 'bg-primary dark:bg-dark-primary text-white hover:opacity-90 shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30'
						}`}
					>
						<Cart size={24} className="h-4.5 w-4.5 sm:h-6 sm:w-6" />
					</button>
				</div>
			</div>
		</div>
	)
})