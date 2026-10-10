// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/cart/CartItemRow.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: فونت‌های خراب font-DanaBold → font-DanaDemiBold (دو دکمه)
// ═══════════════════════════════════════════════════════════════

// src/components/site/cart/CartItemRow.tsx
// stage-48 — هشدار نارنجی در باکس هر محصول: ناموجودی + محدودیت حالت سفارش
// (مؤثر = دسته AND محصول؛ از سرور با جزئیات سبد می‌آید).

import { Link } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { Trash2, BoxRemove, Bicycle, Bag, Chair } from 'reicon-react'
import { CART_MAX_QTY, cartItemKey } from '#/stores/cartStore'
import { useI18n } from '#/i18n'

interface CartItem {
	id: string
	sizeId: string | null
	sizeName: string | null
	name: string
	// ⬅ عوض شد: imageGradient → profileImage
	profileImage: string | null
	originalPrice: number
	finalPrice: number
	quantity: number
	lineTotal: number
	/** stage-48 — ناموجود (هشدار نارنجی + خارج از جمع) */
	available?: boolean
	/** stage-48 — حالت‌های مؤثر سفارش */
	courierAllowed?: boolean
	takeawayAllowed?: boolean
	dineInAllowed?: boolean
}

interface CartItemRowProps {
	item: CartItem
	onIncrement: (key: string, quantity: number) => void
	onDecrement: (key: string, quantity: number) => void
	onRemove: (key: string) => void
}

// رارد ۳۲ — قیمت/تعداد/aria دوزبانه (fmt.price با ارقام زبان فعال)
// stage-48 — ردیف ناموجود: ظاهر کم‌رنگ + هشدار نارنجی داخل باکس
export const CartItemRow = memo(function CartItemRow({
	item,
	onIncrement,
	onDecrement,
	onRemove,
}: CartItemRowProps) {
	const { t, fmt } = useI18n()
	const key = cartItemKey(item.id, item.sizeId)

	const unavailable = item.available === false
	const courierOk = item.courierAllowed !== false
	const takeawayOk = item.takeawayAllowed !== false
	const dineInOk = item.dineInAllowed !== false
	const restrictions: string[] = []
	if (!courierOk) restrictions.push(t['cart.noCourier'])
	if (!takeawayOk) restrictions.push(t['cart.noTakeaway'])
	if (!dineInOk) restrictions.push(t['cart.noDineIn'])

	const handleInc = useCallback(
		() => onIncrement(key, item.quantity),
		[onIncrement, key, item.quantity],
	)
	const handleDec = useCallback(
		() => onDecrement(key, item.quantity),
		[onDecrement, key, item.quantity],
	)
	const handleRem = useCallback(() => onRemove(key), [onRemove, key])

	return (
		<div
			className={`flex flex-col gap-3 bg-white dark:bg-[#2a1015] p-4 rounded-2xl border shadow-sm transition ${
				unavailable
					? 'border-orange-200 dark:border-orange-500/30 opacity-80'
					: 'border-gray-200 dark:border-[#3a151c]'
			}`}
		>
			<div className="flex items-center gap-4">
				{/* عکس — profileImage یا پشتیبان گرادیانت */}
				<div
					className={`w-20 h-20 rounded-xl shrink-0 bg-cover bg-center bg-linear-to-br from-primary/20 to-dark-primary/20 ${unavailable ? 'blur-[2px] saturate-75' : ''}`}
					style={
						item.profileImage
							? { backgroundImage: `url(${item.profileImage})` }
							: undefined
					}
				/>

				<div className="flex-1 min-w-0">
					<Link
						to="/products/$productId"
						params={{ productId: item.id }}
						className="font-DanaDemiBold text-lg text-gray-800 dark:text-white truncate block hover:text-primary dark:hover:text-dark-primary transition cursor-pointer"
					>
						{item.name}
					</Link>

					{item.sizeName && (
						<span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-md bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-[10px] font-DanaDemiBold">
							{item.sizeName}
						</span>
					)}

					<div className="flex items-center gap-2 mt-1">
						{item.originalPrice > item.finalPrice && (
							<span className="text-xs text-gray-400 line-through">
								{fmt.price(item.originalPrice)}
							</span>
						)}
						<span
							className={`font-DanaDemiBold text-base ${unavailable ? 'text-gray-400 dark:text-gray-500' : 'text-primary dark:text-dark-primary'}`}
						>
							{fmt.price(item.finalPrice)} {t['common.toman']}
						</span>
					</div>

					<div className="flex items-center gap-2 mt-3">
						<button
							type="button"
							onClick={handleInc}
							disabled={unavailable || item.quantity >= CART_MAX_QTY}
							className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaDemiBold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
							aria-label={t['cart.incQty']}
						>
							+
						</button>
						<span className="font-DanaDemiBold text-gray-800 dark:text-white w-8 text-center">
							{fmt.num(item.quantity)}
						</span>
						<button
							type="button"
							onClick={handleDec}
							disabled={unavailable}
							className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaDemiBold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
							aria-label={t['cart.decQty']}
						>
							-
						</button>
					</div>
				</div>

				<div className="flex flex-col items-end justify-between h-full pl-2 self-stretch">
					<button
						type="button"
						onClick={handleRem}
						className="text-red-400 hover:text-red-500 transition cursor-pointer p-1"
						aria-label={t['cart.removeItem']}
					>
						<Trash2 size={20} />
					</button>
					<div className="text-left">
						<span className="text-xs text-gray-500 dark:text-gray-400 block">
							{t['cart.lineTotal']}
						</span>
						<span className="font-DanaDemiBold text-gray-900 dark:text-white">
							{fmt.price(item.lineTotal)} {t['common.toman']}
						</span>
					</div>
				</div>
			</div>

			{/* ── stage-48 — هشدارهای نارنجی (ناموجودی / محدودیت ارسال) ── */}
			{unavailable && (
				<div className="flex items-center gap-2 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
					<BoxRemove size={16} className="text-orange-500 shrink-0" />
					<p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
						{t['cart.unavailableItem']}
					</p>
				</div>
			)}
			{restrictions.length > 0 && (
				<div className="flex items-start gap-2 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
					<span className="flex items-center gap-1 text-orange-500 shrink-0 mt-0.5">
						<Bicycle size={14} className={courierOk ? 'hidden' : ''} />
						<Bag size={14} className={takeawayOk ? 'hidden' : ''} />
						<Chair size={14} className={dineInOk ? 'hidden' : ''} />
					</span>
					<p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
						{t['cart.modeRestrictionPrefix']} {restrictions.join('، ')}
						{t['cart.modeRestrictionSuffix']}
					</p>
				</div>
			)}
		</div>
	)
})