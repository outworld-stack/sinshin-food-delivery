// src/components/site/cart/CartItemRow.tsx

import { Link } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { Trash2 } from 'reicon-react'
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
}

interface CartItemRowProps {
	item: CartItem
	onIncrement: (key: string, quantity: number) => void
	onDecrement: (key: string, quantity: number) => void
	onRemove: (key: string) => void
}

// رارد ۳۲ — قیمت/تعداد/aria دوزبانه (fmt.price با ارقام زبان فعال)
export const CartItemRow = memo(function CartItemRow({
	item,
	onIncrement,
	onDecrement,
	onRemove,
}: CartItemRowProps) {
	const { t, fmt } = useI18n()
	const key = cartItemKey(item.id, item.sizeId)

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
		<div className="flex items-center gap-4 bg-white dark:bg-[#2a1015] p-4 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			{/* عکس — profileImage یا پشتیبان گرادیانت */}
			<div
				className="w-20 h-20 rounded-xl shrink-0 bg-cover bg-center bg-linear-to-br from-primary/20 to-dark-primary/20"
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
					<span className="font-DanaDemiBold text-base text-primary dark:text-dark-primary">
						{fmt.price(item.finalPrice)} {t['common.toman']}
					</span>
				</div>

				<div className="flex items-center gap-2 mt-3">
					<button
						type="button"
						onClick={handleInc}
						disabled={item.quantity >= CART_MAX_QTY}
						className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaBold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
						className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaBold cursor-pointer"
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
	)
})