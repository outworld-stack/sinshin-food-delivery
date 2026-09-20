// src/hooks/site/useProductPage.ts
import { useReducer, useCallback } from 'react'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'
import type { Product, ProductSize } from '#/server/products'

interface ProductPageState {
  quantity: number
  selectedSizeId: string | null      // ⬅ سایز انتخابی
}

type ProductPageAction =
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'RESET' }
  | { type: 'SELECT_SIZE'; payload: string }

const initialState: ProductPageState = {
  quantity: 1,
  selectedSizeId: null,
}

function productPageReducer(state: ProductPageState, action: ProductPageAction): ProductPageState {
  switch (action.type) {
    case 'INCREMENT': return { ...state, quantity: state.quantity + 1 }
    case 'DECREMENT': return { ...state, quantity: Math.max(1, state.quantity - 1) };
    case 'RESET': return initialState
    case 'SELECT_SIZE': return { ...state, selectedSizeId: action.payload }
    default: return state
  }
}

export function useProductPage(product: Product) {
  const [state, dispatch] = useReducer(productPageReducer, initialState)
  const addItem = useCartStore((s) => s.addItem)
  const showToast = useToastStore((s) => s.showToast)

  // --- سایزبندی ---
  const hasSizes = product.sizesEnabled && product.sizes.length > 0
  // انتخاب مؤثر: انتخابِ کاربر، وگرنه سایز اول
  const selectedSize: ProductSize | null = hasSizes
    ? (product.sizes.find(s => s.id === state.selectedSizeId) ?? product.sizes[0])
    : null
  const selectedSizeId = hasSizes ? (state.selectedSizeId ?? product.sizes[0].id) : null

  // --- قیمت واحد ---
  const unitPrice = selectedSize ? selectedSize.price : product.finalPrice
  const unitOriginal = selectedSize ? selectedSize.price : product.originalPrice

  const totalPrice = unitPrice * state.quantity
  const originalTotal = unitOriginal * state.quantity
  // با سایز فعال، تخفیف مفهوم نداره — بج تخفیف مخفی می‌شه
  const hasDiscount = !hasSizes && product.discountPercentage > 0

  // --- هندلرها ---
  const handleIncrement = useCallback(() => dispatch({ type: 'INCREMENT' }), [])
  const handleDecrement = useCallback(() => dispatch({ type: 'DECREMENT' }), [])
  const handleSelectSize = useCallback((sizeId: string) => dispatch({ type: 'SELECT_SIZE', payload: sizeId }), [])

  const handleAddToCart = useCallback(() => {
    addItem(product.id, state.quantity, selectedSizeId)
    showToast(`${product.name}${selectedSize ? ` (${selectedSize.name})` : ''} به سبد اضافه شد!`)
  }, [addItem, showToast, product.id, product.name, state.quantity, selectedSizeId, selectedSize])

  return {
    quantity: state.quantity,
    selectedSizeId,
    selectedSize,
    hasSizes,
    totalPrice,
    originalTotal,
    hasDiscount,
    handleIncrement,
    handleDecrement,
    handleSelectSize,
    handleAddToCart,
  }
}