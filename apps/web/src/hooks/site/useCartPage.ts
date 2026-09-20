// src/hooks/site/useCartPage.ts
import { useReducer, useCallback } from 'react'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'

interface CartPageState {
  isClearModalOpen: boolean
}

type CartPageAction =
  | { type: 'OPEN_CLEAR_MODAL' }
  | { type: 'CLOSE_CLEAR_MODAL' }
  | { type: 'CONFIRM_CLEAR' }

const initialState: CartPageState = { isClearModalOpen: false }

function cartPageReducer(state: CartPageState, action: CartPageAction): CartPageState {
  switch (action.type) {
    case 'OPEN_CLEAR_MODAL': return { ...state, isClearModalOpen: true }
    case 'CLOSE_CLEAR_MODAL': return { ...state, isClearModalOpen: false }
    case 'CONFIRM_CLEAR': return { isClearModalOpen: false }
    default: return state
  }
}

export function useCartPage() {
  const [state, dispatch] = useReducer(cartPageReducer, initialState)

  const items = useCartStore((s) => s.items)
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const removeItem = useCartStore((s) => s.removeItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const showToast = useToastStore((s) => s.showToast)

  const handleOpenClearModal = useCallback(() => dispatch({ type: 'OPEN_CLEAR_MODAL' }), [])
  const handleCloseClearModal = useCallback(() => dispatch({ type: 'CLOSE_CLEAR_MODAL' }), [])

  const handleConfirmClear = useCallback(() => {
    clearCart()
    dispatch({ type: 'CONFIRM_CLEAR' })
    showToast('سبد خرید خالی شد')
  }, [clearCart, showToast])

  // هندلرها با کلید ردیف (محصول + سایز)
  const handleIncrement = useCallback((key: string, quantity: number) => {
    updateQuantity(key, quantity + 1)
  }, [updateQuantity])

  const handleDecrement = useCallback((key: string, quantity: number) => {
    if (quantity <= 1) removeItem(key)
    else updateQuantity(key, quantity - 1)
  }, [updateQuantity, removeItem])

  const handleRemove = useCallback((key: string) => {
    removeItem(key)
    showToast('محصول از سبد حذف شد')
  }, [removeItem, showToast])

  return {
    state, items,
    handleOpenClearModal, handleCloseClearModal, handleConfirmClear,
    handleIncrement, handleDecrement, handleRemove,
  }
}