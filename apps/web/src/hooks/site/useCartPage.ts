// src/hooks/site/useCartPage.ts
import { useReducer, useCallback } from 'react'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'
import { useI18n } from '#/i18n'

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
  const { t } = useI18n()

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
    showToast(t['cart.clearedToast'])
  }, [clearCart, showToast, t])

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
    showToast(t['cart.removedToast'])
  }, [removeItem, showToast, t])

  return {
    state, items,
    handleOpenClearModal, handleCloseClearModal, handleConfirmClear,
    handleIncrement, handleDecrement, handleRemove,
  }
}