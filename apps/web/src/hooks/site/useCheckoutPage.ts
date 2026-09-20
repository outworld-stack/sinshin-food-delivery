// src/hooks/site/useCheckoutPage.ts
import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { checkoutPreviewOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { processCheckout, mockPay } from '#/server/checkout'
import { PENDING_CHECKOUT_KEY } from '#/types/site/checkout'
import type {
  CheckoutCalculation,
  CheckoutSubmitPayload,
  CouponStatus,
  DeliveryType,
} from '#/types/site/checkout'

// --- State ---
interface CheckoutState {
  deliveryType: DeliveryType
  selectedAddressId: string | null
  isAddressModalOpen: boolean
  couponStatus: CouponStatus
  couponDraft: string // ← مقدار input — تا دکمه‌ی «اعمال» به سرور نمی‌رود
  couponCode: string | null // ← کدِ commit شده — فقط این در کلید preview می‌نشیند
  useWallet: boolean
  selectedGateway: string
  customerNote: string
}

type CheckoutAction =
  | { type: 'SET_DELIVERY_TYPE'; payload: DeliveryType }
  | { type: 'SELECT_ADDRESS'; payload: string }
  | { type: 'OPEN_ADDRESS_MODAL' }
  | { type: 'CLOSE_ADDRESS_MODAL' }
  | { type: 'SET_COUPON_STATUS'; payload: CouponStatus }
  | { type: 'SET_COUPON_DRAFT'; payload: string }
  | { type: 'COMMIT_COUPON' }
  | { type: 'RESET_COUPON' }
  | { type: 'TOGGLE_WALLET' }
  | { type: 'SET_GATEWAY'; payload: string }
  | { type: 'SET_CUSTOMER_NOTE'; payload: string }

const initialState: CheckoutState = {
  deliveryType: 'DELIVERY',
  selectedAddressId: null,
  isAddressModalOpen: false,
  couponStatus: 'NONE',
  couponDraft: '',
  couponCode: null,
  useWallet: false,
  selectedGateway: import.meta.env.DEV ? 'MOCK' : 'ZARINPAL',
  customerNote: '',
}

function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case 'SET_DELIVERY_TYPE': return { ...state, deliveryType: action.payload }
    case 'SELECT_ADDRESS': return { ...state, selectedAddressId: action.payload }
    case 'OPEN_ADDRESS_MODAL': return { ...state, isAddressModalOpen: true }
    case 'CLOSE_ADDRESS_MODAL': return { ...state, isAddressModalOpen: false }
    case 'SET_COUPON_STATUS': return { ...state, couponStatus: action.payload }
    case 'SET_COUPON_DRAFT': return { ...state, couponDraft: action.payload }
    case 'COMMIT_COUPON': return { ...state, couponCode: state.couponDraft || null }
    case 'RESET_COUPON': return { ...state, couponDraft: '', couponCode: null }
    case 'TOGGLE_WALLET': return { ...state, useWallet: !state.useWallet }
    case 'SET_GATEWAY': return { ...state, selectedGateway: action.payload }
    case 'SET_CUSTOMER_NOTE': return { ...state, customerNote: action.payload.slice(0, 300) }
    default: return state
  }
}

// --- هوک ---
export function useCheckoutPage(deps: {
  items: { productId: string; sizeId?: string | null; quantity: number }[]
  isAuthenticated: boolean
}) {
  const navigate = useNavigate()
  const { items, isAuthenticated } = deps
  const [state, dispatch] = useReducer(checkoutReducer, initialState)
  const queryClient = useQueryClient()
  const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)
  const showToast = useToastStore((s) => s.showToast)


  // phase-fix: fallback برای مرورگرهای قدیمی (iOS < 15.4 / WebView ناامن) —
  // نبود randomUUID یعنی TypeError در لحظه‌ی ثبت سفارش = چک‌اوت مرده
  const newIdempotencyKey = (): string =>
    crypto.randomUUID?.() ?? `idm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

  // phase-3: idempotency — یک کلید به‌ازای هر نیت خرید؛ retry شبکه همان کلید
  // را می‌فرستد → سفارش دوم ساخته نمی‌شود. فقط بعد از «شکست قطعی» تازه می‌شود.
  const idempotencyKey = useRef<string>(newIdempotencyKey())

  // ⬅ preview — قیمت‌گذاری ۱۰۰٪ سروری: سایز/تخفیف/کوپن/ناحیه/بسته‌بندی/کیف پول
  const {
    data: previewData,
    isLoading: isDetailsLoading,
    isError: isPreviewError,
    error: previewError,
  } = useQuery({
    ...checkoutPreviewOptions(
      items,
      state.deliveryType,
      state.selectedAddressId,
      state.useWallet,
      state.couponCode,
    ),
    enabled: isAuthenticated && items.length > 0,
    retry: false, // خطای اعتبارسنجی (سایز حذف‌شده و…) را با retry مخفی نکن
  })

  // اعلان نتیجه‌ی کوپن — فقط یک‌بار به‌ازای هر کدِ commit شده
  const announcedCoupon = useRef<string | null>(null)
  useEffect(() => {
    const c = previewData?.coupon
    const code = state.couponCode
    if (!code || !c || announcedCoupon.current === code) return
    announcedCoupon.current = code
    if (c.valid) {
      showToast(`کد تخفیف اعمال شد (${ c.discount.toLocaleString('fa-IR') } تومان)`)
    } else {
      showToast(c.message ?? 'کد تخفیف نامعتبر است', 'error')
    }
  }, [previewData?.coupon, state.couponCode, showToast])

  // خطای preview → کاربر بداند چرا ثبت قفل است
  useEffect(() => {
    if (isPreviewError) {
      showToast(
        previewError instanceof Error
          ? previewError.message
          : 'خطا در محاسبه‌ی قیمت — دوباره تلاش کنید',
        'error',
      )
    }
  }, [isPreviewError, previewError, showToast])

  // محاسبات — همه از breakdown سرور
  const calc = useMemo<CheckoutCalculation>(() => {
    const b = previewData?.breakdown
    const foodTotal = b?.foodTotal ?? 0
    const discount = b?.discount ?? 0
    return {
      foodTotal,
      discount,
      payableFood: foodTotal - discount,
      walletDeduction: b?.walletDeduction ?? 0,
      deliveryFee: b?.deliveryFee ?? 0,
      packagingFee: b?.packagingFee ?? 0,
      total: b?.totalAmount ?? 0,
      amountPaidOnline: b?.amountPaidOnline ?? 0,
    }
  }, [previewData])

  const couponApplied = previewData?.coupon?.valid === true
  const isGatewayDisabled = calc.amountPaidOnline === 0
  const isSubmitBlocked = (state.couponStatus === 'HAVE' && !couponApplied) || isPreviewError

  // --- هندلرها ---
  const handleDeliveryTypeChange = useCallback((t: DeliveryType) => dispatch({ type: 'SET_DELIVERY_TYPE', payload: t }), [])
  const handleSelectAddress = useCallback((id: string) => dispatch({ type: 'SELECT_ADDRESS', payload: id }), [])
  const handleOpenAddressModal = useCallback(() => dispatch({ type: 'OPEN_ADDRESS_MODAL' }), [])
  const handleCloseAddressModal = useCallback(() => dispatch({ type: 'CLOSE_ADDRESS_MODAL' }), [])
  const handleCouponStatusChange = useCallback((s: CouponStatus) => {
    if (s === 'NONE') {
      announcedCoupon.current = null
      dispatch({ type: 'RESET_COUPON' })
    } else {
      dispatch({ type: 'SET_COUPON_STATUS', payload: s })
    }
  }, [])
  const handleCouponCodeChange = useCallback((raw: string) => {
    const sanitized = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20)
    dispatch({ type: 'SET_COUPON_DRAFT', payload: sanitized })
  }, [])
  // phase-3: اعمال = commit کد → preview با کد رفرش می‌شود → نتیجه از سرور
  const handleApplyCoupon = useCallback(() => {
    if (!state.couponDraft) {
      showToast('لطفاً کد تخفیف را وارد کنید', 'error')
      return
    }
    dispatch({ type: 'COMMIT_COUPON' })
  }, [state.couponDraft, showToast])
  const handleToggleWallet = useCallback(() => dispatch({ type: 'TOGGLE_WALLET' }), [])
  const handleGatewayChange = useCallback((id: string) => dispatch({ type: 'SET_GATEWAY', payload: id }), [])
  const handleCustomerNoteChange = useCallback((v: string) => dispatch({ type: 'SET_CUSTOMER_NOTE', payload: v }), [])

  // --- ثبت سفارش ---
  const checkoutMutation = useMutation({
    mutationFn: (payload: CheckoutSubmitPayload) =>
      processCheckout(payload, idempotencyKey.current),
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: qk.userProfile })
      queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrdersPrefix })

      // ── تمام-کیف‌پول: همین، نتیجه است ──
      if (res.orderCompleted && res.orderId) {
        sessionStorage.setItem(PENDING_CHECKOUT_KEY, res.orderId)
        setActiveOrderId(res.orderId)
        showToast('سفارش شما ثبت شد!')
        navigate({ to: '/dashboard/orders/$orderId', params: { orderId: res.orderId } })
        return
      }

      if (res.paymentUrl) {
        // ── MOCK (URL نسبی) — فلوی برنامه‌ای dev ──
        if (!res.paymentUrl.startsWith('http')) {
          try {
            const payResult = await mockPay(res.paymentUrl, true)
            if (payResult.paymentStatus === 'SUCCESS') {
              sessionStorage.setItem(PENDING_CHECKOUT_KEY, payResult.orderDisplayId)
              setActiveOrderId(payResult.orderDisplayId)
              showToast('پرداخت موفق — سفارش ثبت شد')
              navigate({ to: '/dashboard/orders/$orderId', params: { orderId: payResult.orderDisplayId } })
            } else {
              // شکست قطعی → کلید تازه؛ سبد «پاک نشده» — کاربر دوباره می‌زند
              idempotencyKey.current = newIdempotencyKey()
              showToast('پرداخت ناموفق — سفارش لغو شد؛ سبد شما حفظ شده است', 'error')
            }
          } catch (err) {
            idempotencyKey.current = newIdempotencyKey()
            showToast(err instanceof Error ? err.message : 'خطا در پرداخت', 'error')
          }
          return
        }

        // ── درگاه واقعی (URL مطلق) — ریدایرکت؛ سبد پاک «نمی‌شود» ──
        // برگشت از درگاه → /dashboard/orders/:orderId → polling →
        // اولین SUCCESS با پرچمِ همین سفارش → سبد پاک می‌شود
        if (res.orderId) sessionStorage.setItem(PENDING_CHECKOUT_KEY, res.orderId)
        window.location.href = res.paymentUrl
        return
      }

      showToast('پردازش سفارش ناموفق بود', 'error')
    },
    // onError عمداً کلید را عوض «نمی‌کند»: خطای شبکه → retry با همان کلید
    // امن است (اگر سفارش ساخته شده باشد، پاسخ کش‌شده برمی‌گردد)
    onError: (err) => showToast(err.message || 'خطا در پردازش سفارش', 'error'),
  })

  const handleFinalSubmit = useCallback(() => {
    if (state.deliveryType === 'DELIVERY' && !state.selectedAddressId) {
      showToast('لطفاً آدرس تحویل را انتخاب کنید', 'error')
      return
    }
    if (isSubmitBlocked) {
      if (isPreviewError) showToast('ابتدا خطای قیمت‌گذاری را برطرف کنید', 'error')
      else showToast('ابتدا کد تخفیف را اعمال یا حذف کنید', 'error')
      return
    }
    const payload: CheckoutSubmitPayload = {
      items,
      deliveryType: state.deliveryType,
      useWallet: state.useWallet,
      addressId: state.selectedAddressId,
      customerNote: state.customerNote.trim(),
      couponCode: couponApplied ? state.couponCode : null,
      gatewayId: isGatewayDisabled ? null : state.selectedGateway,
    }
    checkoutMutation.mutate(payload)
  }, [state, items, isSubmitBlocked, isGatewayDisabled, couponApplied, isPreviewError, showToast, checkoutMutation])

  return {
    state, calc, previewData, isDetailsLoading, isPreviewError,
    couponApplied, isGatewayDisabled, isSubmitBlocked,
    checkoutMutation,
    handleDeliveryTypeChange, handleSelectAddress,
    handleOpenAddressModal, handleCloseAddressModal,
    handleCouponStatusChange, handleCouponCodeChange, handleApplyCoupon,
    handleToggleWallet, handleGatewayChange, handleCustomerNoteChange,
    handleFinalSubmit,
  }
}