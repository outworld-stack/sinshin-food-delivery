import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckoutInput, DeliveryQuote } from '@sinshin/shared'

const { QueryClient, QueryObserver, keepPreviousData, onlineManager } = await import('@tanstack/react-query')

const navigations: Array<{ to: string; params?: { orderId: string } }> = []
const activeOrders: string[] = []
const toasts: string[] = []
const checkoutRequests: Array<{ input: CheckoutInput; key: string }> = []
const previewCodes: Array<string | null> = []
let checkoutResponse: { orderCompleted: boolean; orderId?: string; paymentUrl?: string } = { orderCompleted: false }
let checkoutError: Error | null = null
let mockPayment: () => Promise<{ paymentStatus: string; orderDisplayId: string }> = async () => ({ paymentStatus: 'SUCCESS', orderDisplayId: 'mock-paid' })
let onlineAmount = 100
let pendingMutation: Promise<void> | null = null
let navigationResult: Promise<void> = Promise.resolve()
let deliveryQuote: DeliveryQuote | null = null
let previewFetching = false
let previewPlaceholder = false
let previewPaused = false
let previewFailed = false
let refetches = 0
const previewAddresses: Array<string | null> = []

mock.module('@tanstack/react-router', () => ({ useNavigate: () => (next: any) => { navigations.push(next); return navigationResult } }))
mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: (options: any) => {
    const code = options.previewArgs[4] as string | null
    previewCodes.push(code)
    previewAddresses.push(options.previewArgs[2])
    return {
      data: {
        items: [{ name: 'Test food', available: true }],
        breakdown: { foodTotal: 100, discount: 0, totalAmount: 100, amountPaidOnline: onlineAmount, deliveryFee: deliveryQuote?.status === 'ready' || deliveryQuote?.status === 'fallback' ? deliveryQuote.fee : 0 },
        coupon: { valid: Boolean(code), discount: 5 },
        deliveryQuote,
      },
      isLoading: false, isFetching: previewFetching, isPlaceholderData: previewPlaceholder,
      isPaused: previewPaused, isError: previewFailed, refetch: async () => { refetches++ },
    }
  },
  useMutation: (options: any) => ({
    isPending: false,
    mutate: (input: CheckoutInput) => {
      pendingMutation = (async () => {
        try { await options.onSuccess(await options.mutationFn(input)) }
        catch (error) { await options.onError(error) }
      })()
    },
  }),
}))
mock.module('#/hooks/shared/useMenuLive', () => ({ useMenuLive: () => {} }))
mock.module('#/i18n', () => ({
  useI18n: () => ({ t: new Proxy({}, { get: (_target, key) => key === 'checkout.deliveryDistance' ? 'distance {n} km' : String(key) }), fmt: { num: String, price: String }, apiError: (message: string) => message }),
  tpl: (text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? '')),
}))
mock.module('#/server/checkout', () => ({
  processCheckout: async (input: CheckoutInput, key: string) => {
    checkoutRequests.push({ input, key })
    if (checkoutError) throw checkoutError
    return checkoutResponse
  },
  mockPay: async () => mockPayment(),
}))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: any) => select({ setActiveOrderId: (id: string) => activeOrders.push(id) }) }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast: (message: string) => toasts.push(message) }) }))
mock.module('#/utils/queryOptions', () => ({ checkoutPreviewOptions: (...previewArgs: unknown[]) => ({ previewArgs }) }))

const location = { href: '' }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError') } })

const { useCheckoutPage } = await import('../src/hooks/site/useCheckoutPage')
const { consumePendingCheckout, rememberPendingCheckout } = await import('../src/lib/pending-checkout')
const { PENDING_CHECKOUT_KEY } = await import('../src/types/site/checkout')
const { clearCheckoutIntent } = await import('../src/lib/checkout-intent')
type Page = ReturnType<typeof useCheckoutPage>

// Render-phase updates exercise React's real reducer and preserve its refs;
// no hook source extraction, reducer copies, browser APIs or live API calls.
function renderCheckout(coupon?: string, delivery?: { addressId?: string }): Page {
  let page!: Page
  let step = 0
  function Probe() {
    page = useCheckoutPage({ items: [{ productId: 'product-1', sizeId: 'size-1', quantity: 1 }], isAuthenticated: true })
    if (step === 0) {
      step++
      page.handleDeliveryTypeChange(delivery ? 'DELIVERY' : 'PICKUP')
      if (delivery?.addressId) page.handleSelectAddress(delivery.addressId)
      page.handleGatewayChange('MOCK')
    } else if (step === 1 && coupon !== undefined) {
      step++
      page.handleCouponStatusChange('HAVE')
      page.handleCouponCodeChange(coupon)
    } else if (step === 2) {
      step++
      page.handleApplyCoupon()
    }
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return page
}

async function submit(page: Page) {
  pendingMutation = null
  const count = checkoutRequests.length
  page.handleFinalSubmit()
  assert(pendingMutation, 'real submit handler must reach checkout mutation')
  await pendingMutation
  assert.equal(checkoutRequests.length, count + 1)
}

// Blocked storage cannot interrupt wallet success, order activation or routing.
onlineAmount = 0
checkoutResponse = { orderCompleted: true, orderId: 'wallet-paid' }
let finishNavigation!: () => void
let navigationFinished = false
navigationResult = new Promise<void>((resolve) => { finishNavigation = resolve })
void navigationResult.then(() => { navigationFinished = true })
const walletPage = renderCheckout()
await submit(walletPage)
assert.equal(navigations.at(-1)?.params?.orderId, 'wallet-paid')
assert.equal(activeOrders.at(-1), 'wallet-paid')
const completedWalletKey = checkoutRequests.at(-1)!.key
await submit(walletPage)
assert.equal(navigationFinished, false, 'old checkout remains visible while navigation is pending')
assert.equal(checkoutRequests.at(-1)!.key, completedWalletKey, 'a second click before confirmation replays the paid order')
finishNavigation()
await navigationResult
assert(consumePendingCheckout('wallet-paid'))
assert(!consumePendingCheckout('wallet-paid'), 'clear the cart at most once')
clearCheckoutIntent() // matching terminal order-page confirmation
await submit(renderCheckout())
assert.notEqual(checkoutRequests.at(-1)!.key, completedWalletKey, 'a new basket after matching confirmation gets a new key')

// External gateway routing survives the same denied sessionStorage getter.
onlineAmount = 100
checkoutResponse = { orderCompleted: false, orderId: 'gateway-order', paymentUrl: 'https://payment.zarinpal.com/pg/StartPay/authority' }
await submit(renderCheckout())
assert.equal(location.href, 'https://payment.zarinpal.com/pg/StartPay/authority')
assert(consumePendingCheckout('gateway-order'))

location.href = ''
checkoutResponse = { orderCompleted: false, orderId: 'unsafe-url-order', paymentUrl: 'https://attacker.example/pay' }
await submit(renderCheckout())
assert.equal(location.href, '')
assert.equal(navigations.at(-1)?.params?.orderId, 'unsafe-url-order')
assert(consumePendingCheckout('unsafe-url-order'), 'retain recovery for a created order with an invalid redirect')

let submitted = false
const bankForm = {
  method: '', action: '', style: { display: '' }, fields: [] as any[],
  appendChild(input: any) { this.fields.push(input) },
  submit() { submitted = true }, remove() {},
}
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: (tag: string) => tag === 'form' ? bankForm : {},
  body: { appendChild: (element: unknown) => assert.equal(element, bankForm) },
} })
checkoutResponse = { orderCompleted: false, orderId: 'mellat-order', paymentUrl: 'https://bpm.shaparak.ir/StartPay/REF123' }
await submit(renderCheckout())
assert(submitted)
assert.equal(bankForm.method, 'POST')
assert.equal(bankForm.action, 'https://bpm.shaparak.ir/pgwchannel/startpay.mellat')
assert.deepEqual(bankForm.fields, [{ type: 'hidden', name: 'RefId', value: 'REF123' }])
assert.equal(location.href, '')
assert(consumePendingCheckout('mellat-order'))

// A replay may contain only the existing order; it is still a valid recovery.
checkoutResponse = { orderCompleted: false, orderId: 'existing-order' }
await submit(renderCheckout())
assert.equal(navigations.at(-1)?.params?.orderId, 'existing-order')
assert.equal(activeOrders.at(-1), 'existing-order')
assert(consumePendingCheckout('existing-order'))

// Uncertain mock-payment network failure retains the original purchase key.
checkoutResponse = { orderCompleted: false, orderId: 'uncertain-order', paymentUrl: '/api/payments/mock/00000000-0000-4000-8000-000000000001.0123456789abcdef0123456789abcdef' }
mockPayment = async () => { throw new Error('Network connection lost') }
const retryPage = renderCheckout()
await submit(retryPage)
const originalKey = checkoutRequests.at(-1)!.key
assert.equal(navigations.at(-1)?.params?.orderId, 'uncertain-order')
assert(toasts.includes('Network connection lost'))
checkoutResponse = { orderCompleted: false, orderId: 'uncertain-order' }
await submit(retryPage)
assert.equal(checkoutRequests.at(-1)!.key, originalKey)

// The same guarantee also applies before the checkout response arrives.
checkoutError = new Error('Checkout response lost')
const requestRetryPage = renderCheckout()
await submit(requestRetryPage)
const failedKey = checkoutRequests.at(-1)!.key
checkoutError = null
await submit(renderCheckout())
assert.equal(checkoutRequests.at(-1)!.key, failedKey)

// Successful mock payment also retains its key until the matching order
// confirms it; only a definite failed payment permits an immediate new try.
for (const paymentStatus of ['SUCCESS', 'FAILED']) {
  clearCheckoutIntent()
  checkoutResponse = { orderCompleted: false, orderId: `mock-${paymentStatus}`, paymentUrl: '/api/payments/mock/00000000-0000-4000-8000-000000000002.0123456789abcdef0123456789abcdef' }
  mockPayment = async () => ({ paymentStatus, orderDisplayId: `mock-${paymentStatus}` })
  navigationFinished = false
  navigationResult = new Promise<void>((resolve) => { finishNavigation = resolve })
  void navigationResult.then(() => { navigationFinished = true })
  const mockPage = renderCheckout()
  await submit(mockPage)
  const terminalKey = checkoutRequests.at(-1)!.key
  await submit(mockPage)
  if (paymentStatus === 'SUCCESS') {
    assert.equal(navigationFinished, false)
    assert.equal(checkoutRequests.at(-1)!.key, terminalKey)
    assert(consumePendingCheckout('mock-SUCCESS'))
    clearCheckoutIntent()
  } else {
    assert.notEqual(checkoutRequests.at(-1)!.key, terminalKey)
  }
  finishNavigation()
  await navigationResult
}
checkoutResponse = { orderCompleted: false, orderId: 'coupon-order' }

for (const [raw, expected] of [
  [' sinshin۲۰ ', 'SINSHIN20'],
  ['save١٢٣', 'SAVE123'],
  ['تخفیف-۴٢', 'تخفیف-42'],
] as const) {
  const page = renderCheckout(raw)
  assert.equal(page.state.couponDraft, expected)
  assert.equal(page.state.couponCode, expected)
  assert.equal(previewCodes.at(-1), expected)
  await submit(page)
  assert.equal(checkoutRequests.at(-1)!.input.couponCode, expected)
}

// Writes can fail while reads still work (full storage). A stale persisted
// marker must not override the newly completed order held in memory.
const values = new Map([[PENDING_CHECKOUT_KEY, 'old-order']])
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
  removeItem: () => { throw new DOMException('Storage denied', 'SecurityError') },
} })
rememberPendingCheckout('new-order')
assert(consumePendingCheckout('new-order'), 'memory must win over stale storage after a write failure')
assert(!consumePendingCheckout('new-order'))

deliveryQuote = { status: 'address_required', message: 'Select a delivery address' }
const missingAddress = renderCheckout(undefined, {})
assert(missingAddress.isSubmitBlocked)
assert.equal(missingAddress.deliveryDistanceKm, null)
assert.equal(missingAddress.canRetryDelivery, false)
deliveryQuote = { status: 'ready', distanceKm: 5.001, radiusKm: 6, fee: 60_000 }
const quoted = renderCheckout(undefined, { addressId: 'home' })
assert.equal(quoted.isDeliveryQuoteReady, true)
assert.equal(quoted.deliveryDistanceKm, 5.001)
assert.equal(quoted.calc.deliveryFee, 60_000)
assert.equal(quoted.deliveryFeeMessage, null)
assert.equal(previewAddresses.at(-1), 'home')
previewFetching = true
const changingAddress = renderCheckout(undefined, { addressId: 'work' })
assert.equal(previewAddresses.at(-1), 'work')
assert(changingAddress.isSubmitBlocked, 'address changes wait for the new server quote')
assert.equal(changingAddress.deliveryDistanceKm, null, 'stale distance is hidden while recalculating')
assert.equal(changingAddress.deliveryFeeMessage, 'checkout.deliveryCalculating')
previewFetching = false

// Exercise React Query's real offline transition: the old address remains as
// successful placeholder data even though no fetch is running for the new one.
const quoteClient = new QueryClient()
quoteClient.mount()
const wasOnline = onlineManager.isOnline()
const nextQuote: DeliveryQuote = { status: 'ready', distanceKm: 9, radiusKm: 10, fee: 90_000 }
const quoteOptions = {
  queryKey: ['shipping-quote', 'home'],
  queryFn: async () => nextQuote,
  staleTime: Infinity,
  placeholderData: keepPreviousData,
}
quoteClient.setQueryData(quoteOptions.queryKey, deliveryQuote)
const quoteObserver = new QueryObserver(quoteClient, quoteOptions)
const stopQuotes = quoteObserver.subscribe(() => {})
try {
  onlineManager.setOnline(false)
  quoteObserver.setOptions({ ...quoteOptions, queryKey: ['shipping-quote', 'work'] })
  const paused = quoteObserver.getCurrentResult()
  assert.equal(paused.status, 'success')
  assert.equal(paused.fetchStatus, 'paused')
  assert.equal(paused.isFetching, false)
  assert.equal(paused.isError, false)
  assert.equal(paused.isPlaceholderData, true)
  assert.equal(paused.data?.fee, 60_000)
  previewPlaceholder = paused.isPlaceholderData
  previewPaused = paused.isPaused
  const pausedDelivery = renderCheckout(undefined, { addressId: 'work' })
  assert(pausedDelivery.isSubmitBlocked, 'an offline address change cannot authorize the previous shipping fee')
  assert.equal(pausedDelivery.isDeliveryQuoteReady, false)
  assert.equal(pausedDelivery.deliveryDistanceKm, null)
  assert.equal(pausedDelivery.deliveryFeeMessage, 'checkout.priceError')
  assert(pausedDelivery.canRetryDelivery)
  const beforePausedSubmit = checkoutRequests.length
  pausedDelivery.handleFinalSubmit()
  assert.equal(checkoutRequests.length, beforePausedSubmit, 'the handler cannot queue checkout with a placeholder quote')

  // Cached current-key data can also have a paused refresh without being
  // placeholder data; pickup and wallet/coupon changes must remain blocked too.
  previewPlaceholder = false
  const pausedPickup = renderCheckout()
  assert(pausedPickup.isSubmitBlocked)
  pausedPickup.handleFinalSubmit()
  assert.equal(checkoutRequests.length, beforePausedSubmit)

  onlineManager.setOnline(true)
  const refreshed = await quoteObserver.refetch()
  assert.equal(refreshed.isPlaceholderData, false)
  assert.equal(refreshed.isPaused, false)
  deliveryQuote = refreshed.data!
  previewPlaceholder = refreshed.isPlaceholderData
  previewPaused = refreshed.isPaused
  const refreshedDelivery = renderCheckout(undefined, { addressId: 'work' })
  assert.equal(refreshedDelivery.isSubmitBlocked, false)
  assert.equal(refreshedDelivery.deliveryDistanceKm, 9)
  assert.equal(refreshedDelivery.calc.deliveryFee, 90_000, 'reconnection uses the selected address quote')
} finally {
  stopQuotes()
  quoteClient.unmount()
  quoteClient.clear()
  onlineManager.setOnline(wasOnline)
  previewPlaceholder = false
  previewPaused = false
}

previewFailed = true
const failedRefresh = renderCheckout(undefined, { addressId: 'work' })
assert(failedRefresh.isSubmitBlocked)
assert.equal(failedRefresh.deliveryDistanceKm, null)
assert(failedRefresh.canRetryDelivery)
previewFailed = false
for (const status of ['unavailable', 'no_route'] as const) {
  deliveryQuote = { status, message: `Shipping ${status}` }
  const failed = renderCheckout(undefined, { addressId: 'work' })
  assert(failed.isSubmitBlocked)
  assert.equal(failed.deliveryFeeMessage, `Shipping ${status}`)
  const before = checkoutRequests.length
  failed.handleFinalSubmit()
  assert.equal(checkoutRequests.length, before, 'an unquoted delivery cannot submit even through the handler')
  await failed.refetchPreview()
}
assert.equal(refetches, 2)
assert.equal(renderCheckout().isDeliveryQuoteReady, true, 'pickup remains available during a shipping outage')

deliveryQuote = { status: 'fallback', fee: 35_000 }
const fallbackPage = renderCheckout(undefined, { addressId: 'home' })
assert.equal(fallbackPage.isSubmitBlocked, false, 'a server fallback quote allows payment')
assert.equal(fallbackPage.isDeliveryQuoteReady, true)
assert.equal(fallbackPage.calc.deliveryFee, 35_000)
assert.equal(fallbackPage.deliveryDistanceKm, null, 'fallback has no invented distance')
assert.equal(fallbackPage.deliveryFeeMessage, null)
assert.equal(fallbackPage.canRetryDelivery, false)
await submit(fallbackPage)
assert.equal(checkoutRequests.at(-1)!.input.addressId, 'home')
assert.equal('deliveryFee' in checkoutRequests.at(-1)!.input, false, 'client cannot supply the charge')

const { OrderSummary } = await import('../src/components/site/checkout/OrderSummary')
const summaryProps = {
  subtotal: 100_000, discount: 0, walletDeduction: 0, deliveryFee: 60_000, packagingFee: 0,
  total: 160_000, amountPaidOnline: 160_000, deliveryType: 'DELIVERY' as const,
  isLoading: false, isSubmitBlocked: false, isSubmitting: false, onSubmit: () => {},
  restaurantStatus: { isOpen: true, nextOpenTime: '', closeReason: null, isBusy: false },
}
const readySummary = renderToStaticMarkup(createElement(OrderSummary, { ...summaryProps, deliveryDistanceKm: 5.001 }))
assert(readySummary.includes('60000'))
assert(readySummary.includes('distance 5.001 km'))
assert(readySummary.includes('160000'))
const fallbackSummary = renderToStaticMarkup(createElement(OrderSummary, { ...summaryProps, deliveryFee: fallbackPage.calc.deliveryFee, total: 135_000, amountPaidOnline: 135_000, deliveryFeeMessage: fallbackPage.deliveryFeeMessage, deliveryDistanceKm: fallbackPage.deliveryDistanceKm, isSubmitBlocked: fallbackPage.isSubmitBlocked }))
assert(fallbackSummary.includes('35000'))
assert(fallbackSummary.includes('135000'))
assert(!fallbackSummary.includes('disabled=""'))
assert(!fallbackSummary.includes('distance '))
const unavailableSummary = renderToStaticMarkup(createElement(OrderSummary, { ...summaryProps, deliveryFeeMessage: 'Shipping unavailable', onRetryDelivery: () => {} }))
assert(unavailableSummary.includes('Shipping unavailable'))
assert(unavailableSummary.includes('checkout.deliveryRetry'))
assert(unavailableSummary.includes('disabled=""'))
assert(!unavailableSummary.includes('60000'), 'previous shipping price is hidden')
assert(!unavailableSummary.includes('160000'), 'incomplete total is not presented as a payable amount')
console.log('PASS shipping selection/recalculation, offline address changes, paused-preview submit guard, retry, pickup and visible road-distance pricing')
console.log('Checkout client regressions passed: denied/quota-limited storage, wallet/redirect/replay routing, retry idempotency and Persian/Arabic coupon digits.')
