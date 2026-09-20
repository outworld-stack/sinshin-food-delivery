// src/components/site/cart/CartItemsList.tsx
import { memo } from 'react'
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

interface CartItemsListProps {
  items: CartItemRowData[]
  onIncrement: (key: string, quantity: number) => void
  onDecrement: (key: string, quantity: number) => void
  onRemove: (key: string) => void
}

export const CartItemsList = memo(function CartItemsList({ items, onIncrement, onDecrement, onRemove }: CartItemsListProps) {
  return (
    <div className="lg:col-span-2 space-y-4">
      {items.map((item) => (
        <CartItemRow
          key={`${item.id}|${item.sizeId ?? ''}`}
          item={item}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
})