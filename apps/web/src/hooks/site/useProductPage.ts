// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery — فایل ۸
// مسیر مقصد: apps/web/src/hooks/site/useProductPage.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: تخفیف مستقِ هر سایز + تخفیف زمان‌دار — قیمت واحد از
//        قیمت مؤثر سایز می‌آید؛ شمارنده‌ی معکوس تا پایان پنجره؛
//        انقضا → بازمحاسبه‌ی قیمت/بج بدون رفرش.
// ═══════════════════════════════════════════════════════════════

// src/hooks/site/useProductPage.ts
import { useCallback, useReducer } from 'react'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'
import type { Product, ProductSize } from '#/server/products'
import { useI18n, tpl } from '#/i18n'

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

/** stage-47 — پنجره‌ی تخفیف همین لحظه فعال است؟ (نمایش؛ قیمت واقعی سروری) */
function windowActiveNow(startsAt?: string | null, endsAt?: string | null): boolean {
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

/** stage-47 — تخفیف فعال و قیمت مؤثر یک سایز (سرور فلگ داده؛ وگرنه محلی) */
function sizeDiscount(size: ProductSize): { active: boolean; pct: number; price: number; endsAt: string | null } {
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

export function useProductPage(product: Product) {
  const [state, dispatch] = useReducer(productPageReducer, initialState)
  // stage-47 — تیک انقضا: شمارنده صفر شد → قیمت/بج تازه شود
  const [, tick] = useReducer((x: number) => x + 1, 0)
  const addItem = useCartStore((s) => s.addItem)
  const showToast = useToastStore((s) => s.showToast)
  const { t } = useI18n()

  // --- سایزبندی ---
  const hasSizes = product.sizesEnabled && product.sizes.length > 0
  // انتخاب مؤثر: انتخابِ کاربر، وگرنه سایز اول
  const selectedSize: ProductSize | null = hasSizes
    ? (product.sizes.find(s => s.id === state.selectedSizeId) ?? product.sizes[0])
    : null
  const selectedSizeId = hasSizes ? (state.selectedSizeId ?? product.sizes[0].id) : null

  // --- قیمت واحد ---
  // stage-47 — سایز انتخاب‌شده: قیمت مؤثر با تخفیف مستقلِ همان سایز.
  // بدون سایز: finalPrice سرور (خودش با «درصدِ فعال» محاسبه شده).
  const sizeEff = selectedSize ? sizeDiscount(selectedSize) : null
  const productActive =
    product.discountPercentage > 0 &&
    (product.discountActive !== undefined
      ? product.discountActive
      : windowActiveNow(product.discountStartsAt, product.discountEndsAt))

  const unitPrice = sizeEff ? sizeEff.price : product.finalPrice
  // stage-47 — قیمت خامِ سطح فعال (سایز یا محصول) برای خط‌خوردگی
  const unitOriginal = selectedSize ? selectedSize.price : product.originalPrice

  const totalPrice = unitPrice * state.quantity
  const originalTotal = unitOriginal * state.quantity
  // stage-47 — تخفیف فعال در هر سطح (سایز یا محصول) → بج/خط‌خوردگی
  const hasDiscount = sizeEff ? sizeEff.active : productActive

  // stage-47 — پایان پنجره‌ی سطح فعال → شمارنده‌ی صفحه‌ی محصول
  const discountEndsAt = sizeEff
    ? sizeEff.endsAt
    : productActive
      ? (product.discountEndsAt ?? null)
      : null

  // --- هندلرها ---
  const handleIncrement = useCallback(() => dispatch({ type: 'INCREMENT' }), [])
  const handleDecrement = useCallback(() => dispatch({ type: 'DECREMENT' }), [])
  const handleSelectSize = useCallback((sizeId: string) => dispatch({ type: 'SELECT_SIZE', payload: sizeId }), [])
  const handleCountdownEnd = useCallback(() => tick(), [])

  const handleAddToCart = useCallback(() => {
    addItem(product.id, state.quantity, selectedSizeId)
    showToast(tpl(t['pdetail.addedToast'], {
      n: `${product.name}${selectedSize ? ` (${selectedSize.name})` : ''}`,
    }))
  }, [addItem, showToast, product.id, product.name, state.quantity, selectedSizeId, selectedSize, t])

  return {
    quantity: state.quantity,
    selectedSizeId,
    selectedSize,
    hasSizes,
    totalPrice,
    originalTotal,
    hasDiscount,
    /** stage-47 — ISO پایان پنجره‌ی تخفیف فعال (null = بدون شمارنده) */
    discountEndsAt,
    handleIncrement,
    handleDecrement,
    handleSelectSize,
    /** stage-47 — انقضای شمارنده → بازمحاسبه */
    handleCountdownEnd,
    handleAddToCart,
  }
}