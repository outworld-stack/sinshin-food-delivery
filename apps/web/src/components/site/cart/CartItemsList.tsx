// src/components/site/cart/CartItemsList.tsx
import { memo } from 'react'
import { X } from 'reicon-react'
import { cartItemKey } from '#/stores/cartStore'
import { CartItemRow } from './CartItemRow'

interface CartItemRowData {
	id: string
	sizeId: string | null
	sizeName: string | null
	name: string
	// ⬅ عوض شد: imageGradient → profileImage (قرارداد API)
	profileImage: string | null
	originalPrice: number
	finalPrice: number
	quantity: number
	lineTotal: number
}

// round-12 — ردیف استور که سرور آن را drop کرده (محصول حذف/غیرفعال شده).
// قبلاً این ردیف‌ها هیچ جایی رندر نمی‌شدند ولی تعدادشان در «تعداد کل اقلام»
// می‌ماند و راه حذف نداشتند جز خالی‌کردن کل سبد.
export interface UnavailableCartItem {
	key: string
	quantity: number
}

interface CartItemsListProps {
	items: CartItemRowData[]
	unavailableItems: UnavailableCartItem[]
	onIncrement: (key: string, quantity: number) => void
	onDecrement: (key: string, quantity: number) => void
	onRemove: (key: string) => void
}

export const CartItemsList = memo(function CartItemsList({
	items,
	unavailableItems,
	onIncrement,
	onDecrement,
	onRemove,
}: CartItemsListProps) {
	return (
		<div className="lg:col-span-2 space-y-4">
			{unavailableItems.map((item) => (
				<div
					key={item.key}
					className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-dashed border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/5"
				>
					<div className="flex flex-col gap-1">
						<p className="font-DanaDemiBold text-sm text-orange-600 dark:text-orange-400">
							محصولی در سبد شما موجود نیست
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
							این محصول حذف شده یا موقتاً غیرفعال است و قابل سفارش نیست — از سبد
							خارجش کنید.
							{item.quantity > 1 && ` (${item.quantity} عدد)`}
						</p>
					</div>
					<button
						type="button"
						onClick={() => onRemove(item.key)}
						className="p-2.5 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition cursor-pointer shrink-0"
						aria-label="حذف محصول ناموجود از سبد"
					>
						<X size={18} />
					</button>
				</div>
			))}

			{items.map((item) => (
				<CartItemRow
					key={cartItemKey(item.id, item.sizeId)}
					item={item}
					onIncrement={onIncrement}
					onDecrement={onDecrement}
					onRemove={onRemove}
				/>
			))}
		</div>
	)
})
