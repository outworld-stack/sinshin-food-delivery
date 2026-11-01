// ═══════════════════════════════════════════════════════════════
// hundred-eleven (فاز ۱ — آمار واقعی) — sinshin-food-delivery
// مسیر مقصد: apps/web/scripts/test-product-stats-client.ts
//
// رفتار سمت کلاینتِ آمار: بیکن‌ها به مسیر درست می‌روند (POST +
// keepalive)، fail-silent اند (شکست شبکه چیزی نمی‌گیرد)، در SSR
// هیچ نمی‌فرستند و addItem سبد همان چوک‌پوینتِ رویدادِ افزودن است.
// ═══════════════════════════════════════════════════════════════
import assert from 'node:assert/strict'

// Keep both URL cases independent of the developer's .env configuration.
const originalApiUrl = process.env.VITE_API_URL
delete process.env.VITE_API_URL

// ── رهگیر fetch — URL/متد/keepalive هر بیکن ثبت می‌شود ──
const calls: Array<{
	url: string
	method: string
	keepalive: boolean
	credentials: RequestCredentials | undefined
}> = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	calls.push({
		url: String(input),
		method: init?.method ?? 'GET',
		keepalive: init?.keepalive === true,
		credentials: init?.credentials,
	})
	return new Response('{"counted":true}', { status: 200 })
}) as typeof fetch

// ── محیط مرورگر — apiBase() به window.location.origin وصل است؛
// persist سبد هم به window.localStorage نیاز دارد (الگوی test-auth-store) ──
const fakeStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}
const fakeWindow = () => {
	const w: { location: { origin: string }; localStorage: typeof fakeStorage } = {
		location: { origin: 'http://localhost:5173' },
		localStorage: fakeStorage,
	}
	return w
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow() })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })

const PID = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

// ── بیکن بازدید: مسیر + متد + keepalive ──
const { trackProductView } = await import('../src/lib/product-stats-beacon')
trackProductView(PID)
await Promise.resolve() // بیکن fire-and-forget است — میکروتسک فرصت اجرا
assert.equal(calls.length, 1, 'one view beacon per call')
assert.equal(
	calls[0].url,
	`http://localhost:5173/api/menu/products/${PID}/view`,
	'view beacon hits the product view endpoint under apiBase()',
)
assert.equal(calls[0].method, 'POST', 'view beacon is a POST')
assert.equal(calls[0].keepalive, true, 'view beacon survives early page exit (keepalive)')
console.log('  ✓ view beacon → POST /api/menu/products/:id/view (keepalive)')

// A separately hosted API must receive and set the anonymous visitor cookie.
process.env.VITE_API_URL = 'http://localhost:3000'
trackProductView(PID)
assert.equal(calls.at(-1)!.url, `http://localhost:3000/api/menu/products/${PID}/view`)
assert.equal(calls.at(-1)!.credentials, 'include', 'cross-origin views retain the visitor cookie for deduplication')
delete process.env.VITE_API_URL
console.log('  ✓ separate API origin retains the visitor cookie')

// ── بیکن در SSR هیچ نمی‌فرستد ──
Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
const before = calls.length
trackProductView(PID)
assert.equal(calls.length, before, 'SSR (no window) sends nothing')
console.log('  ✓ SSR sends no beacons')
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow() })

// ── سبد: addItem = تنها چوک‌پوینتِ رویدادِ افزودن ──
const { useCartStore } = await import('../src/stores/cartStore')
await useCartStore.persist.rehydrate()
useCartStore.getState().addItem(PID, 2)
const cartCall = calls.at(-1)!
assert.equal(
	cartCall.url.endsWith(`/menu/products/${PID}/cart-event`),
	true,
	'addItem fires the cart-event beacon for its own product',
)
assert.equal(cartCall.method, 'POST', 'cart beacon is a POST')
assert.equal(cartCall.credentials, 'include', 'cart beacon shares the visitor cookie')
assert.equal(useCartStore.getState().items.length, 1, 'item actually landed in the cart')
assert.equal(useCartStore.getState().items[0]!.quantity, 2, 'quantity preserved')
console.log('  ✓ cartStore.addItem fires the cart-event beacon (choke point)')

// ادغام ردیف موجود هم رویداد می‌فرستد (رویدادِ کلیک، نه تغییر مقدار)
useCartStore.getState().addItem(PID, 1)
assert.equal(calls.at(-1)!.url.endsWith(`/menu/products/${PID}/cart-event`), true)
assert.equal(useCartStore.getState().items.length, 1, 'same row merged, not duplicated')
assert.equal(useCartStore.getState().items[0]!.quantity, 3, 'merged quantity')
console.log('  ✓ merge-add still fires the beacon once')

// آیتم دوم — بیکن خودش
useCartStore.getState().addItem(OTHER, 1, null)
assert.equal(calls.at(-1)!.url.endsWith(`/menu/products/${OTHER}/cart-event`), true)
console.log('  ✓ each product gets its own cart beacon')

// ── fail-silent: شکستِ fetch هرگز به UI نمی‌ریزد ──
globalThis.fetch = (async () => {
	throw new Error('network down')
}) as unknown as typeof fetch
const ticksBefore = useCartStore.getState().addTick
assert.doesNotThrow(() => useCartStore.getState().addItem(PID, 1))
await new Promise((resolve) => setTimeout(resolve, 20)) // میکروتسک‌ها فرصت رد/گرفتن
assert.equal(useCartStore.getState().items[0]!.quantity, 4, 'cart works even with stats endpoint down')
assert.equal(useCartStore.getState().addTick, ticksBefore + 1, 'addTick moved regardless of beacon failure')
console.log('  ✓ beacon failure is swallowed — cart/UX never breaks')

if (originalApiUrl === undefined) delete process.env.VITE_API_URL
else process.env.VITE_API_URL = originalApiUrl

console.log('\n══ Product stats client: 7 checks passed ══')
