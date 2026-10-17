import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckoutInput } from '@sinshin/shared'

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

mock.module('@tanstack/react-router', () => ({ useNavigate: () => (next: any) => { navigations.push(next); return navigationResult } }))
mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: (options: any) => {
    const code = options.previewArgs[4] as string | null
    previewCodes.push(code)
    return {
      data: {
        items: [{ name: 'Test food', available: true }],
        breakdown: { foodTotal: 100, discount: 0, totalAmount: 100, amountPaidOnline: onlineAmount },
        coupon: { valid: Boolean(code), discount: 5 },
      },
      isLoading: false, isFetching: false, isError: false, refetch: async () => {},
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
  useI18n: () => ({ t: new Proxy({}, { get: (_target, key) => String(key) }), fmt: { num: String }, apiError: (message: string) => message }),
  tpl: (text: string) => text,
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
function renderCheckout(coupon?: string): Page {
  let page!: Page
  let step = 0
  function Probe() {
    page = useCheckoutPage({ items: [{ productId: 'product-1', sizeId: 'size-1', quantity: 1 }], isAuthenticated: true })
    if (step === 0) {
      step++
      page.handleDeliveryTypeChange('PICKUP')
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
checkoutResponse = { orderCompleted: false, orderId: 'gateway-order', paymentUrl: 'https://gateway.example/pay/1' }
await submit(renderCheckout())
assert.equal(location.href, 'https://gateway.example/pay/1')
assert(consumePendingCheckout('gateway-order'))

// A replay may contain only the existing order; it is still a valid recovery.
checkoutResponse = { orderCompleted: false, orderId: 'existing-order' }
await submit(renderCheckout())
assert.equal(navigations.at(-1)?.params?.orderId, 'existing-order')
assert.equal(activeOrders.at(-1), 'existing-order')
assert(consumePendingCheckout('existing-order'))

// Uncertain mock-payment network failure retains the original purchase key.
checkoutResponse = { orderCompleted: false, orderId: 'uncertain-order', paymentUrl: '/mock/pay/1' }
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
  checkoutResponse = { orderCompleted: false, orderId: `mock-${paymentStatus}`, paymentUrl: '/mock/pay/terminal' }
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
console.log('Checkout client regressions passed: denied/quota-limited storage, wallet/redirect/replay routing, retry idempotency and Persian/Arabic coupon digits.')
