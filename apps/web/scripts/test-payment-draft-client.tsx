import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckoutInput, CheckoutItemInput, UserOrder } from '@sinshin/shared'

const effects: Array<() => void> = []
const react = { ...await import('react') }
mock.module('react', () => ({ ...react, useEffect: (effect: () => void) => { effects.push(effect) } }))
let routeOrderId = 'legacy-order'
let paymentStatus: UserOrder['paymentStatus'] = 'SUCCESS'
let orderStatus: UserOrder['status'] = 'PAID'
mock.module('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ orderId: routeOrderId }) }),
  Link: () => null,
  notFound: () => new Error('Not found'),
}))
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: { kind: string }) => ({ data: options.kind === 'order'
    ? { id: routeOrderId, status: orderStatus, paymentStatus, deliveryType: 'PICKUP', items: [] } : {} }),
}))
mock.module('#/utils/queryOptions', () => ({
  orderDetailsOptions: () => ({ kind: 'order' }),
  orderReviewedOptions: () => ({ kind: 'reviews' }),
  liveTrackingOptions: () => ({ kind: 'tracking' }),
  userProfileOptions: { kind: 'profile' },
}))
mock.module('#/hooks/dashboard/useOrderDetailPage', () => ({ useOrderDetailPage: () => ({}) }))
mock.module('#/hooks/dashboard/useOrderFinancialSync', () => ({ useOrderFinancialSync: () => undefined }))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ setActiveOrderId: () => undefined }) }))
mock.module('#/i18n', () => ({ useI18n: () => ({ t: new Proxy({}, { get: (_target, key) => String(key) }) }) }))
mock.module('#/lib/seo', () => ({ noindexHead: () => () => ({ meta: [] }), headLang: () => 'fa' }))
mock.module('#/i18n/seo', () => ({ SEO: { fa: { orderDetail: { title: 'Order {id}' } } } }))
mock.module('#/components/LoadingSkeletons', () => ({ OrderDetailSkeleton: () => null }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: () => null, RouteNotFound: () => null }))
for (const name of ['CourierTrackingMap', 'DeliverButton', 'DeliveryInfoBox', 'FeedbackBox', 'OrderDetails', 'OrderStatusHeader', 'PendingPaymentBox', 'ReferralProfitBox']) {
  mock.module(`#/components/dashboard/order-detail/${name}`, () => ({ [name]: () => null }))
}

const cartStorage = new Map<string, string>()
const sessionValues = new Map<string, string>([['sinshin:pending-checkout', 'legacy-order']])
const storage = {
  getItem: (key: string) => cartStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { cartStorage.set(key, value) },
  removeItem: (key: string) => { cartStorage.delete(key) },
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => sessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionValues.set(key, value) },
  removeItem: (key: string) => { sessionValues.delete(key) },
} })
const { useCartStore } = await import('../src/stores/cartStore')
const { forgetPendingCheckout, rememberPendingCheckout, pendingCheckoutMatchesCart } = await import('../src/lib/pending-checkout')
const { checkoutIntentKey, completeCheckoutIntent } = await import('../src/lib/checkout-intent')
const { Route } = await import('../src/routes/dashboard/orders/$orderId')
const component = Route.options.component!
const submitted: CheckoutItemInput[] = [
  { productId: '00000000-0000-4000-8000-000000000001', sizeId: null, quantity: 1 },
  { productId: '00000000-0000-4000-8000-000000000002', sizeId: null, quantity: 2 },
]
const draft = [{ ...submitted[0]!, quantity: 3 }]
const setCart = (items: CheckoutItemInput[]) => useCartStore.setState({ items: items.map(item => ({ ...item, sizeId: item.sizeId ?? null })) })
function renderOrder() {
  renderToStaticMarkup(createElement(component))
  for (const effect of effects.splice(0)) effect()
}

setCart(draft)
renderOrder()
assert.deepEqual(useCartStore.getState().items, draft, 'unbound legacy markers must preserve a possibly edited draft')
assert.equal(sessionValues.has('sinshin:pending-checkout'), false)

routeOrderId = 'normal-order'
setCart(submitted)
rememberPendingCheckout(routeOrderId, submitted)
assert(pendingCheckoutMatchesCart(routeOrderId, [...submitted].reverse()), 'item ordering does not change basket identity')
paymentStatus = 'PENDING'; orderStatus = 'PENDING_PAYMENT'
renderOrder()
assert.deepEqual(useCartStore.getState().items, submitted, 'pending financial result cannot clear the submitted basket')
paymentStatus = 'SUCCESS'; orderStatus = 'PAID'
renderOrder()
assert.equal(useCartStore.getState().items.length, 0, 'verified success clears the original submitted basket')
setCart(draft)
renderOrder()
assert.deepEqual(useCartStore.getState().items, draft, 'duplicate callback/refresh cannot clear the next draft')

routeOrderId = 'late-success-order'
rememberPendingCheckout(routeOrderId, submitted)
setCart(draft)
renderOrder()
assert.deepEqual(useCartStore.getState().items, draft, 'late success preserves a basket edited while verification was unresolved')
assert.equal(JSON.parse(cartStorage.get('sinshin-cart-storage')!).state.items[0].quantity, 3)
setCart(submitted)
renderOrder()
assert.deepEqual(useCartStore.getState().items, submitted, 'a consumed marker cannot later clear matching contents')

rememberPendingCheckout('newer-order', draft)
setCart(draft)
renderOrder()
assert.deepEqual(useCartStore.getState().items, draft, 'an older order cannot consume a newer checkout marker')
assert(pendingCheckoutMatchesCart('newer-order', draft))

// Even identical baskets belong to the new checkout once it has begun.
const checkoutInput: CheckoutInput = { items: submitted, deliveryType: 'PICKUP', useWallet: false, gatewayId: 'ZARINPAL' }
const newerKey = checkoutIntentKey(checkoutInput)
completeCheckoutIntent(newerKey, 'newer-identical-order')
rememberPendingCheckout('newer-identical-order', submitted)
setCart(submitted)
const newerIntent = sessionValues.get('sinshin:checkout-intent')
renderOrder()
assert.deepEqual(useCartStore.getState().items, submitted, 'an old success cannot clear a newer identical basket')
assert(pendingCheckoutMatchesCart('newer-identical-order', submitted), 'the new payment marker survives the old callback')
assert.equal(sessionValues.get('sinshin:checkout-intent'), newerIntent, 'the newer durable checkout intent also survives')

// The new checkout request may still be in flight when the old success arrives.
rememberPendingCheckout(routeOrderId, submitted)
const inFlightKey = checkoutIntentKey(checkoutInput)
forgetPendingCheckout()
renderOrder()
assert.deepEqual(useCartStore.getState().items, submitted, 'an old success cannot clear an identical basket during a new checkout request')
assert.equal(checkoutIntentKey(checkoutInput), inFlightKey, 'old success cannot destroy the lost-response retry key')

// Order-bound clearing protects a new intent even with a leftover legacy marker.
rememberPendingCheckout(routeOrderId, submitted)
setCart(draft)
renderOrder()
assert.equal(checkoutIntentKey(checkoutInput), inFlightKey, 'consuming an old marker cannot clear an unrelated new request')

for (const outcome of ['FAILED', 'REFUNDED'] as const) {
  routeOrderId = `terminal-${outcome}`
  paymentStatus = outcome; orderStatus = 'CANCELED'
  rememberPendingCheckout(routeOrderId, submitted)
  setCart(submitted)
  renderOrder()
  assert.deepEqual(useCartStore.getState().items, submitted, `${outcome} preserves the cart`)
}

Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError') } })
routeOrderId = 'storage-denied-order'
paymentStatus = 'SUCCESS'; orderStatus = 'PAID'
rememberPendingCheckout(routeOrderId, submitted)
setCart(submitted)
renderOrder()
assert.equal(useCartStore.getState().items.length, 0, 'memory fallback still clears a proven original basket')
setCart(draft)
renderOrder()
assert.deepEqual(useCartStore.getState().items, draft, 'storage denial cannot revive a consumed marker')
console.log('PASS actual order-page effects protect identical new baskets, in-flight retry keys, newer payment markers, late/duplicate success, edited drafts and unavailable storage')
