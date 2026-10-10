// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/hooks/site/useCheckoutPage.ts
// تغییر: بعد از ثبت سفارشِ موفق، پریفکس my-orders هم نامعتبر شود
// ═══════════════════════════════════════════════════════════════

// src/hooks/site/useCheckoutPage.ts

import type { CheckoutItemInput } from '@sinshin/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useMenuLive } from '#/hooks/shared/useMenuLive'
import { tpl, useI18n } from '#/i18n'
import { mockPay, processCheckout } from '#/server/checkout'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import type {
	CheckoutCalculation,
	CheckoutSubmitPayload,
	CouponStatus,
	DeliveryType,
} from '#/types/site/checkout'
import { PENDING_CHECKOUT_KEY } from '#/types/site/checkout'
import { qk } from '#/utils/queryKeys'
import { checkoutPreviewOptions } from '#/utils/queryOptions'

// ── وضعیت ──
interface CheckoutState {
	deliveryType: DeliveryType
	selectedAddressId: string | null
	isAddressModalOpen: boolean
	couponStatus: CouponStatus
	couponDraft: string // ← مقدار ورودی — تا دکمه‌ی «اعمال» به سرور نمی‌رود
	couponCode: string | null // ← کدِ تثبیت‌شده — فقط این در کلید پیش‌نمایش می‌نشیند
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
	// رارد L15 — حدسِ ثابت حذف شد: در prod هیچ درگاهی پیش‌فرض انتخاب نیست تا
	// کاربر خودش انتخاب کند (MELLATِ پیکربندی‌نشده یعنی شکست اولین ثبت).
	selectedGateway: import.meta.env.DEV ? 'MOCK' : '',
	customerNote: '',
}

function checkoutReducer(
	state: CheckoutState,
	action: CheckoutAction,
): CheckoutState {
	switch (action.type) {
		case 'SET_DELIVERY_TYPE':
			return { ...state, deliveryType: action.payload }
		case 'SELECT_ADDRESS':
			return { ...state, selectedAddressId: action.payload }
		case 'OPEN_ADDRESS_MODAL':
			return { ...state, isAddressModalOpen: true }
		case 'CLOSE_ADDRESS_MODAL':
			return { ...state, isAddressModalOpen: false }
		case 'SET_COUPON_STATUS':
			return { ...state, couponStatus: action.payload }
		case 'SET_COUPON_DRAFT':
			return { ...state, couponDraft: action.payload }
		case 'COMMIT_COUPON':
			return { ...state, couponCode: state.couponDraft || null }
		// round-26 — couponStatus هم برمی‌گردد به 'NONE': قبلاً فقط درَفت/کد پاک
		// می‌شد → رادیو روی «دارم» می‌ماند و چون اعمال‌شده هم false بود،
		// isSubmitBlocked برای همیشه true می‌ماند (قفل ثبت سفارش تا رفرش)
		case 'RESET_COUPON':
			return {
				...state,
				couponStatus: 'NONE',
				couponDraft: '',
				couponCode: null,
			}
		case 'TOGGLE_WALLET':
			return { ...state, useWallet: !state.useWallet }
		case 'SET_GATEWAY':
			return { ...state, selectedGateway: action.payload }
		case 'SET_CUSTOMER_NOTE':
			return { ...state, customerNote: action.payload.slice(0, 300) }
		default:
			return state
	}
}

// --- هوک ---
export function useCheckoutPage(deps: {
	items: CheckoutItemInput[]
	isAuthenticated: boolean
}) {
	const navigate = useNavigate()
	const { items, isAuthenticated } = deps
	const [state, dispatch] = useReducer(checkoutReducer, initialState)
	const queryClient = useQueryClient()
	const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)
	const showToast = useToastStore((s) => s.showToast)
	// رارد ۳۲ — توست‌ها/خطاهای دوزبانه؛ پیام‌های سرور تا رارد ۳۳ فارسی می‌مانند
	const { t, fmt } = useI18n()

	// phase-fix: پشتیبان برای مرورگرهای قدیمی (iOS < 15.4 / WebView ناامن) —
	// نبود randomUUID یعنی TypeError در لحظه‌ی ثبت سفارش = چک‌اوت مرده
	const newIdempotencyKey = (): string =>
		crypto.randomUUID?.() ??
		`idm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

	// phase-3: تکرارناپذیری — یک کلید به‌ازای هر نیت خرید؛ تلاش مجدد شبکه همان کلید
	// را می‌فرستد → سفارش دوم ساخته نمی‌شود. فقط بعد از «شکست قطعی» تازه می‌شود.
	// رارد L13 — lazy-init: آرگومان useRef در هر رندر اجرا می‌شد (تولید UUID
	// بی‌اثر و دورریختن). حالا فقط در اولین نیاز ساخته می‌شود.
	const idempotencyKeyRef = useRef<string | null>(null)
	const getIdempotencyKey = (): string => {
		if (idempotencyKeyRef.current === null) {
			idempotencyKeyRef.current = newIdempotencyKey()
		}
		return idempotencyKeyRef.current
	}

	// ⬅ پیش‌نمایش — قیمت‌گذاری ۱۰۰٪ سروری: سایز/تخفیف/کوپن/ناحیه/بسته‌بندی/کیف پول
	const {
		data: previewData,
		isLoading: isDetailsLoading,
		isError: isPreviewError,
		error: previewError,
		refetch: refetchPreview,
	} = useQuery({
		...checkoutPreviewOptions(
			items,
			state.deliveryType,
			state.selectedAddressId,
			state.useWallet,
			state.couponCode,
		),
		enabled: isAuthenticated && items.length > 0,
		retry: false, // خطای اعتبارسنجی (سایز حذف‌شده و…) را با تلاش مجدد مخفی نکن
	})

	// ── stage-48 — SSE عمومی menu:live: ناموجودی/حالت ارسال عوض شد ⇒
	// پیش‌نمایش چک‌اوت درجا رفرش می‌شود (هشدار نارنجی + قفل پرداخت فوری).
	useMenuLive(
		useCallback(() => {
			void refetchPreview()
		}, [refetchPreview]),
	)

	// ── stage-48 — وضعیت سبد از دید سرور: ناموجودها + حالت‌های مسدود ──
	const blocked = useMemo(() => {
		const list = previewData?.items ?? []
		const unavailableNames = list
			.filter((i) => i.available === false)
			.map((i) => i.name)
		const courierBlockedNames = list
			.filter((i) => i.courierAllowed === false)
			.map((i) => i.name)
		const takeawayBlockedNames = list
			.filter((i) => i.takeawayAllowed === false)
			.map((i) => i.name)
		const dineInBlockedNames = list
			.filter((i) => i.dineInAllowed === false)
			.map((i) => i.name)
		return {
			unavailableNames,
			courierBlockedNames,
			takeawayBlockedNames,
			dineInBlockedNames,
		}
	}, [previewData])

	const hasUnavailableItems = blocked.unavailableNames.length > 0

	// اعلان نتیجه‌ی کوپن — فقط یک‌بار به‌ازای هر کدِ تثبیت‌شده
	const announcedCoupon = useRef<string | null>(null)
	useEffect(() => {
		const c = previewData?.coupon
		const code = state.couponCode
		if (!code || !c || announcedCoupon.current === code) return
		announcedCoupon.current = code
		if (c.valid) {
			showToast(
				tpl(t['checkout.couponApplied'], {
					n: `${fmt.num(c.discount)} ${t['common.toman']}`,
				}),
			)
		} else {
			showToast(c.message ?? t['checkout.couponInvalid'], 'error')
		}
	}, [previewData?.coupon, state.couponCode, showToast, t, fmt])

	// خطای پیش‌نمایش → کاربر بداند چرا ثبت قفل است
	useEffect(() => {
		if (isPreviewError) {
			showToast(
				previewError instanceof Error
					? previewError.message
					: t['checkout.priceError'],
				'error',
			)
		}
	}, [isPreviewError, previewError, showToast, t])

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
	// stage-48 — قفل‌های سروری: آیتم ناموجود یا حالت تحویلِ انتخابیِ مسدود
	const deliveryBlockedFor =
		state.deliveryType === 'DELIVERY'
			? blocked.courierBlockedNames
			: state.deliveryType === 'PICKUP'
				? blocked.takeawayBlockedNames
				: blocked.dineInBlockedNames
	const isDeliveryBlocked = deliveryBlockedFor.length > 0
	const isSubmitBlocked =
		(state.couponStatus === 'HAVE' && !couponApplied) ||
		isPreviewError ||
		hasUnavailableItems ||
		isDeliveryBlocked

	// --- هندلرها ---
	const handleDeliveryTypeChange = useCallback(
		(t: DeliveryType) => dispatch({ type: 'SET_DELIVERY_TYPE', payload: t }),
		[],
	)
	const handleSelectAddress = useCallback(
		(id: string) => dispatch({ type: 'SELECT_ADDRESS', payload: id }),
		[],
	)
	const handleOpenAddressModal = useCallback(
		() => dispatch({ type: 'OPEN_ADDRESS_MODAL' }),
		[],
	)
	const handleCloseAddressModal = useCallback(
		() => dispatch({ type: 'CLOSE_ADDRESS_MODAL' }),
		[],
	)
	const handleCouponStatusChange = useCallback((s: CouponStatus) => {
		if (s === 'NONE') {
			announcedCoupon.current = null
			dispatch({ type: 'RESET_COUPON' })
		} else {
			dispatch({ type: 'SET_COUPON_STATUS', payload: s })
		}
	}, [])
	const handleCouponCodeChange = useCallback((raw: string) => {
		// round-11 (اسکن H-1): راند ۹ کد فارسی را در کل پلتفرم مجاز کرد
		// (سرور: [A-Z0-9\u0600-\u06FF_-]{3,16}) ولی این sanitizer حروف فارسی و
		// خط تیره را می‌زداشت → کوپن فارسی عملاً در چک‌اوت قابل تایپ نبود.
		// هم‌الگوی سرور + سقف ۱۶ (نه ۲۰).
		const sanitized = raw
			.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '')
			.toUpperCase()
			.slice(0, 16)
		dispatch({ type: 'SET_COUPON_DRAFT', payload: sanitized })
	}, [])
	// phase-3: اعمال = تثبیت کد → پیش‌نمایش با کد رفرش می‌شود → نتیجه از سرور
	const handleApplyCoupon = useCallback(() => {
		if (!state.couponDraft) {
			showToast(t['checkout.enterCoupon'], 'error')
			return
		}
		dispatch({ type: 'COMMIT_COUPON' })
	}, [state.couponDraft, showToast, t])
	const handleToggleWallet = useCallback(
		() => dispatch({ type: 'TOGGLE_WALLET' }),
		[],
	)
	const handleGatewayChange = useCallback(
		(id: string) => dispatch({ type: 'SET_GATEWAY', payload: id }),
		[],
	)
	const handleCustomerNoteChange = useCallback(
		(v: string) => dispatch({ type: 'SET_CUSTOMER_NOTE', payload: v }),
		[],
	)

	// --- ثبت سفارش ---
	const checkoutMutation = useMutation({
		mutationFn: (payload: CheckoutSubmitPayload) =>
			processCheckout(payload, getIdempotencyKey()),
		onSuccess: async (res) => {
			queryClient.invalidateQueries({ queryKey: qk.userProfile })
			queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrdersPrefix })
			// stage-56 — سفارش تازه باید در «سفارشات من» (صفحه‌بندی سروری) ظاهر شود
			queryClient.invalidateQueries({ queryKey: qk.myOrdersPrefix })

			// ── تمام-کیف‌پول: همین، نتیجه است ──
			if (res.orderCompleted && res.orderId) {
				sessionStorage.setItem(PENDING_CHECKOUT_KEY, res.orderId)
				setActiveOrderId(res.orderId)
				showToast(t['checkout.orderPlaced'])
				navigate({
					to: '/dashboard/orders/$orderId',
					params: { orderId: res.orderId },
				})
				return
			}

			if (res.paymentUrl) {
				// ── MOCK (URL نسبی) — فلوی برنامه‌ای محیط توسعه ──
				if (!res.paymentUrl.startsWith('http')) {
					try {
						const payResult = await mockPay(res.paymentUrl, true)
						if (payResult.paymentStatus === 'SUCCESS') {
							sessionStorage.setItem(
								PENDING_CHECKOUT_KEY,
								payResult.orderDisplayId,
							)
							setActiveOrderId(payResult.orderDisplayId)
							showToast(t['checkout.paySuccess'])
							navigate({
								to: '/dashboard/orders/$orderId',
								params: { orderId: payResult.orderDisplayId },
							})
						} else {
							// شکست قطعی → کلید تازه؛ سبد «پاک نشده» — کاربر دوباره می‌زند
							idempotencyKeyRef.current = newIdempotencyKey()
							showToast(t['checkout.payFailed'], 'error')
						}
					} catch (err) {
						idempotencyKeyRef.current = newIdempotencyKey()
						showToast(
							err instanceof Error ? err.message : t['checkout.payError'],
							'error',
						)
					}
					return
				}

				// ── درگاه واقعی (URL مطلق) — ریدایرکت؛ سبد پاک «نمی‌شود» ──
				// برگشت از درگاه → /dashboard/orders/:orderId → پول →
				// اولین SUCCESS با پرچمِ همین سفارش → سبد پاک می‌شود
				if (res.orderId)
					sessionStorage.setItem(PENDING_CHECKOUT_KEY, res.orderId)
				window.location.href = res.paymentUrl
				return
			}

			showToast(t['checkout.orderProcessFail'], 'error')
		},
		// onError عمداً کلید را عوض «نمی‌کند»: خطای شبکه → تلاش مجدد با همان کلید
		// امن است (اگر سفارش ساخته شده باشد، پاسخ کش‌شده برمی‌گردد)
		onError: (err) =>
			showToast(err.message || t['checkout.orderProcessError'], 'error'),
	})

	const handleFinalSubmit = useCallback(() => {
		// stage-48 — گارد ناموجودی (سروری): پرداخت قفل تا رفع/حذف آیتم
		if (hasUnavailableItems) {
			showToast(
				tpl(t['checkout.unavailableBlocked'], {
					n: blocked.unavailableNames[0] ?? '',
				}),
				'error',
			)
			return
		}
		// stage-48 — گارد حالت تحویل: آیتم محدود ⇒ کل سفارش در آن حالت نمی‌رود
		if (isDeliveryBlocked) {
			showToast(
				tpl(t['checkout.deliveryBlocked'], { n: deliveryBlockedFor[0] ?? '' }),
				'error',
			)
			return
		}
		if (state.deliveryType === 'DELIVERY' && !state.selectedAddressId) {
			showToast(t['checkout.pickAddress'], 'error')
			return
		}
		// رارد L15 — درگاهِ انتخاب‌نشده = ثبت قفل شود (نه اینکه حدسِ MELLAT
		// اولین ثبتِ درگاهی را با خطا بشکند). کاربر خودش درگاه را انتخاب می‌کند.
		if (!isGatewayDisabled && state.selectedGateway === '') {
			showToast('درگاه پرداخت را انتخاب کنید.', 'error')
			return
		}
		if (isSubmitBlocked) {
			if (isPreviewError) showToast(t['checkout.fixPriceError'], 'error')
			else showToast(t['checkout.applyOrRemoveCoupon'], 'error')
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
	}, [
		state,
		items,
		isSubmitBlocked,
		isGatewayDisabled,
		couponApplied,
		isPreviewError,
		showToast,
		checkoutMutation,
		t,
		hasUnavailableItems,
		isDeliveryBlocked,
		blocked,
		deliveryBlockedFor,
	])

	return {
		state,
		calc,
		previewData,
		isDetailsLoading,
		isPreviewError,
		couponApplied,
		isGatewayDisabled,
		isSubmitBlocked,
		/** stage-48 — وضعیت‌های سروری سبد (هشدار نارنجی + قفل گزینه‌ی تحویل) */
		blocked,
		hasUnavailableItems,
		isDeliveryBlocked,
		deliveryBlockedFor,
		checkoutMutation,
		handleDeliveryTypeChange,
		handleSelectAddress,
		handleOpenAddressModal,
		handleCloseAddressModal,
		handleCouponStatusChange,
		handleCouponCodeChange,
		handleApplyCoupon,
		handleToggleWallet,
		handleGatewayChange,
		handleCustomerNoteChange,
		handleFinalSubmit,
	}
}