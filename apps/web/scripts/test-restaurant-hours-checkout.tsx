import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { CheckoutPreviewData, RestaurantStatusDto, RestaurantStatusDisplay } from '@sinshin/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { fa } from '../src/i18n/fa'
import { ar } from '../src/i18n/ar'
import { qk } from '../src/utils/queryKeys'

let status: RestaurantStatusDto = {
	isOpen: false,
	temporarilyClosed: false,
	paymentsDisabled: false,
	temporaryCloseReason: null,
	temporaryReopenTime: '',
	nextOpenTime: '11:00',
	anyClosed: true,
	isBusy: false,
}
const requests: string[] = []
let paymentRecovery: CheckoutPreviewData['paymentRecovery']
mock.module('#/lib/api-fetch', () => ({
	getJson: async (path: string) => {
		requests.push(path)
		return { ...status }
	},
	authJson: async () => { throw new Error('Unexpected authenticated request') },
	fetchWithTimeout: async () => { throw new Error('Unexpected payment request') },
}))
const { getRestaurantStatus } = await import('../src/server/checkout')
// Keep the original route-loader snapshot after refreshing query data. This
// catches checkout rendering stale loader data instead of the current cache.
const loaderStatus = await getRestaurantStatus()
mock.module('@tanstack/react-router', () => ({
	createFileRoute: () => (options: object) => ({ ...options, useLoaderData: () => loaderStatus }),
	useNavigate: () => () => {},
	Link: () => null,
}))
mock.module('#/utils/queryOptions', () => ({
	restaurantStatusOptions: { queryKey: qk.restaurantStatus, queryFn: getRestaurantStatus, staleTime: Infinity },
	userProfileLightClientOptions: { queryKey: ['checkout-test-profile'], queryFn: async () => ({}) },
}))
mock.module('#/components/LoadingSkeletons', () => ({ CheckoutPageSkeleton: () => null, Skeleton: () => null }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: () => null }))
mock.module('#/lib/seo', () => ({ noindexHead: () => ({}) }))
mock.module('#/hooks/useHydrated', () => ({ useHydrated: () => true }))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: any) => select({ isAuthenticated: true }) }))
mock.module('#/stores/cartStore', () => ({ useCartStore: (select: any) => select({ items: [{ productId: 'food-1', quantity: 1 }] }) }))
mock.module('#/hooks/site/useCheckoutPage', () => ({
	useCheckoutPage: () => ({
		state: { deliveryType: 'PICKUP', useWallet: false },
		calc: { payableFood: 100, discount: 0, walletDeduction: 0, deliveryFee: 0, packagingFee: 0, total: 100, amountPaidOnline: 100 },
		blocked: { courierBlockedNames: [], takeawayBlockedNames: [], dineInBlockedNames: [] },
		checkoutMutation: { isPending: false },
		paymentRecovery,
		isPaymentRecoveryBlocking: !!paymentRecovery && paymentRecovery.blocksPayment !== false,
		isDetailsLoading: false,
		isSubmitBlocked: !!paymentRecovery && paymentRecovery.blocksPayment !== false,
		mockPayPending: false,
		handleFinalSubmit() {},
	}),
}))
for (const name of ['AddAddressModal', 'AddressSelector', 'CouponBox', 'CustomerNoteBox', 'DeliveryTypeSelector', 'PaymentSection']) {
	mock.module(`#/components/site/checkout/${name}`, () => ({ [name]: () => null }))
}
let lang: 'fa' | 'ar' = 'fa'
mock.module('#/i18n', () => ({
	useI18n: () => ({
		t: lang === 'fa' ? fa : ar,
		fmt: {
			num: (value: number) => value.toLocaleString(lang === 'fa' ? 'fa-IR' : 'ar-EG'),
			price: String,
		},
	}),
	tpl: (template: string, values: Record<string, unknown>) => template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? '')),
}))
const { Route } = await import('../src/routes/checkout/index')
const CheckoutPage = (Route as unknown as { component: () => React.ReactNode }).component
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const render = () => renderToStaticMarkup(
	<QueryClientProvider client={client}><CheckoutPage /></QueryClientProvider>,
)
async function refresh(): Promise<RestaurantStatusDisplay> {
	const current = await getRestaurantStatus()
	client.setQueryData(qk.restaurantStatus, current)
	return current
}
function assertClosed(clock: string) {
	const html = render()
	const dictionary = lang === 'fa' ? fa : ar
	const notice = dictionary['checkout.openTime'].replace('{n}', clock)
	const summary = dictionary['checkout.closedSummary'].replace('{n}', clock)
	assert(html.includes(dictionary['checkout.closedTitle']), 'the top closed notice is visible')
	assert(html.includes(notice), `the top notice displays ${clock}`)
	assert(html.includes(summary), `the order summary displays ${clock}`)
	assert(html.indexOf(summary) > html.indexOf('</button>'), 'the summary warning stays below payment')
	assert(!/<button\b[^>]*\sdisabled(?:=|\s|>)/.test(html), 'being closed does not disable payment')
	return html
}
function assertTemporary(escapedReason: string, paymentsDisabled = false) {
	const html = render()
	const dictionary = lang === 'fa' ? fa : ar
	assert(html.includes(escapedReason), 'the admin temporary-closure message is visible')
	assert(html.indexOf(escapedReason) > html.indexOf('</button>'), 'the temporary message stays below payment')
	assert(!html.includes(dictionary['checkout.closedTitle']), 'temporary closure hides the permanent top banner')
	assert(!html.includes(dictionary['checkout.closedNote']), 'temporary closure hides the permanent delivery explanation')
	assert(!html.includes(dictionary['checkout.openTime'].split('{n}')[0]), 'temporary closure has no opening-time announcement')
	assert(!html.includes(dictionary['checkout.closedSummary'].split('{n}')[0]), 'temporary closure has no generic permanent summary')
	assert(!html.includes(dictionary['checkout.closeReason']), 'temporary summary contains the admin message without a reason label')
	assert.equal(/<button\b[^>]*\sdisabled(?:=|\s|>)/.test(html), paymentsDisabled, 'only the payment-pause option disables the payment button')
	assert(/bg-orange-50/.test(html), 'the temporary message retains its orange warning styling')
	return html
}

try {
	client.setQueryData(qk.restaurantStatus, loaderStatus)
	assertClosed('۱۱:۰۰')
	status.nextOpenTime = '09:05'
	assert.deepEqual(await refresh(), { isOpen: false, temporarilyClosed: false, paymentsDisabled: false, nextOpenTime: '09:05', closeReason: null, isBusy: false })
	assertClosed('۰۹:۰۵')
	assert.equal(loaderStatus.nextOpenTime, '11:00', 'query updates work while the route loader remains unchanged')
	assert(!render().includes('۱۱:۰۰'), 'neither warning retains the old opening hour')
	lang = 'ar'
	assertClosed('٠٩:٠٥')

	status.nextOpenTime = '18:30'
	await refresh()
	assertClosed('١٨:٣٠')
	lang = 'fa'
	assertClosed('۱۸:۳۰')
	status.nextOpenTime = '00:00'
	await refresh()
	assertClosed('۰۰:۰۰')

	status = { ...status, isOpen: true, temporarilyClosed: true, temporaryReopenTime: '16:45', temporaryCloseReason: 'تعمیرات', isBusy: true }
	assert.deepEqual(await refresh(), { isOpen: false, temporarilyClosed: true, paymentsDisabled: false, nextOpenTime: '00:00', closeReason: 'تعمیرات', isBusy: true })
	const temporary = assertTemporary('تعمیرات')
	assert(!temporary.includes('۱۶:۴۵') && !temporary.includes('16:45'), 'temporary reopening time is not part of the checkout message')
	assert(!temporary.includes('۰۰:۰۰'), 'regular hours are not part of the temporary message')
	status.paymentsDisabled = true
	assert.equal((await refresh()).paymentsDisabled, true)
	for (const locale of ['fa', 'ar'] as const) {
		lang = locale
		assert(assertTemporary('تعمیرات', true).includes((lang === 'fa' ? fa : ar)['checkout.paymentsPaused']))
	}
	status.paymentsDisabled = false
	lang = 'fa'
	await refresh()
	assertTemporary('تعمیرات')
	// Temporary closure wins even when the permanent flag is also closed.
	status.isOpen = false
	await refresh()
	assertTemporary('تعمیرات')
	status.temporaryReopenTime = 'پس از رفع مشکل'
	await refresh()
	assert(!assertTemporary('تعمیرات').includes('پس از رفع مشکل'), 'free-form temporary reopening text is omitted too')
	status.temporaryReopenTime = ''
	status.nextOpenTime = '09:05'
	await refresh()
	assert(!assertTemporary('تعمیرات').includes('۰۹:۰۵'), 'absent temporary reopening does not reveal regular hours')

	for (const locale of ['fa', 'ar'] as const) {
		lang = locale
		for (const missingReason of [null, '   \n\t ']) {
			status.temporaryCloseReason = missingReason
			await refresh()
			assertTemporary((lang === 'fa' ? fa : ar)['checkout.temporaryClosed'])
		}
	}
	lang = 'fa'
	status.temporaryCloseReason = '  تعمیرات  '
	await refresh()
	const shortLegacy = assertTemporary('تعمیرات')
	assert(!shortLegacy.includes(fa['checkout.temporaryClosed']), 'a short nonblank legacy reason remains the customer message')
	assert(!shortLegacy.includes('  تعمیرات  '), 'legacy reason padding is trimmed before display')

	lang = 'ar'
	status.temporaryCloseReason = 'المطعم مغلق مؤقتاً للصيانة'
	await refresh()
	assertTemporary('المطعم مغلق مؤقتاً للصيانة')
	lang = 'fa'
	status.temporaryCloseReason = 'تا بررسی <تجهیزات> & برق\nدوباره اطلاع می‌دهیم'
	await refresh()
	const escaped = assertTemporary('تا بررسی &lt;تجهیزات&gt; &amp; برق\nدوباره اطلاع می‌دهیم')
	assert(!escaped.includes('<تجهیزات>'), 'admin text is rendered as text rather than HTML')
	assert(/whitespace-pre-(line|wrap)/.test(escaped), 'multiline admin messages retain their line breaks visually')

	status.temporarilyClosed = false
	await refresh()
	assertClosed('۰۹:۰۵')
	assert(!render().includes('دوباره اطلاع می‌دهیم'), 'returning to permanent closure hides the temporary message')

	status = { ...status, isOpen: true, temporarilyClosed: false, anyClosed: false, temporaryReopenTime: '16:45' }
	assert.deepEqual(await refresh(), { isOpen: true, temporarilyClosed: false, paymentsDisabled: false, nextOpenTime: '09:05', closeReason: null, isBusy: true })
	const open = render()
	assert(!open.includes(fa['checkout.closedTitle']), 'open restaurant hides the top notice')
	assert(!open.includes(fa['checkout.closedSummary'].split('{n}')[0]), 'open restaurant hides the summary warning')
	assert(!open.includes('دوباره اطلاع می‌دهیم'), 'inactive temporary closure details stay hidden')
	assert(requests.every((path) => path === '/orders/restaurant-status'), 'checkout reads the public status endpoint')
	for (const locale of ['fa', 'ar'] as const) {
		lang = locale
		const dictionary = lang === 'fa' ? fa : ar
		for (const blocksPayment of [undefined, true, false]) {
			paymentRecovery = { orderId: 'old-order-under-review', message: 'Review', retryAfterSeconds: 60, blocksPayment }
			const html = render()
			const paymentButton = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2]!.includes(dictionary['checkout.submitPay']))
			assert(paymentButton, 'checkout keeps its ordinary payment button during financial review')
			assert.equal(/\bdisabled(?:=|\s|$)/.test(paymentButton[1]!), blocksPayment !== false, 'only legacy blocking recovery disables payment')
			assert(html.includes('old-order-under-review'), 'the previous order remains visible')
			assert(html.includes(dictionary[blocksPayment === false ? 'checkout.paymentRecoveryAdvisoryHint' : 'checkout.paymentRecoveryHint']), 'the explanation matches independent checkout availability')
		}
	}
	console.log('PASS restaurant hours checkout: permanent saved-time notices, query refresh, Persian/Arabic clocks, midnight, reason-only temporary warnings, closure precedence, escaped multiline messages and unchanged payment availability')
	console.log('PASS Persian/Arabic financial-review advisory keeps the previous order visible and permits the ordinary payment button')
} finally {
	client.clear()
}
