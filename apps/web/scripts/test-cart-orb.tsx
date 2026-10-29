import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ReactElement } from 'react'

const react = { ...await import('react') }
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
	getItem: () => null, setItem() {}, removeItem() {},
} })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } })
type EffectCell = { deps: readonly unknown[]; cleanup?: () => void }
type Host = { cells: unknown[]; cursor: number; effects: Array<() => void>; dirty: boolean }
let host: Host = { cells: [], cursor: 0, effects: [], dirty: false }
const hooks = {
	memo: (component: unknown) => component,
	useCallback: (callback: unknown) => callback,
	useDebugValue() {},
	useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
	useState<T>(initial: T) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = initial
		return [active.cells[index], (value: T) => {
			if (!Object.is(active.cells[index], value)) {
				active.cells[index] = value
				active.dirty = true
			}
		}]
	},
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
		const active = host
		const index = active.cursor++
		const previous = active.cells[index] as EffectCell | undefined
		if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
			const cell: EffectCell = { deps }
			active.cells[index] = cell
			active.effects.push(() => {
				previous?.cleanup?.()
				cell.cleanup = effect() || undefined
			})
		}
	},
}
mock.module('react', () => ({ ...react, ...hooks, default: { ...react.default, ...hooks } }))
const { useCartStore: cart } = await import('../src/stores/cartStore')
let persisted: unknown = null
cart.persist.setOptions({ storage: {
	getItem: () => persisted as never,
	setItem: (_name, value) => { persisted = value },
	removeItem: () => { persisted = null },
} })
const destinations: unknown[] = []
mock.module('@tanstack/react-router', () => ({ useNavigate: () => (to: unknown) => destinations.push(to) }))
mock.module('#/i18n', () => ({
	useI18nSafe: () => ({ t: { 'cart.orbLabel': 'Cart: {n}', 'header.cart': 'Cart' }, fmt: { num: String } }),
	tpl: (value: string, args: { n: string }) => value.replace('{n}', args.n),
}))
const { CartPulseOrb } = await import('../src/components/site/products/CartPulseOrb')

const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
let now = 0
let nextTimer = 0
const timers = new Map<number, { due: number; callback: () => void }>()
globalThis.setTimeout = ((callback: () => void, delay: number) => {
	const id = ++nextTimer
	timers.set(id, { due: now + delay, callback })
	return id
}) as unknown as typeof setTimeout
globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout

function advance(ms: number) {
	const until = now + ms
	while (true) {
		const pending = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0]
		if (!pending) break
		now = pending[1].due
		timers.delete(pending[0])
		pending[1].callback()
	}
	now = until
}
function render() {
	let tree: ReactElement<{ 'aria-label': string; disabled: boolean; onClick: () => void }> | null
	do {
		host.cursor = 0
		host.dirty = false
		host.effects = []
		tree = CartPulseOrb({}) as typeof tree
		for (const effect of host.effects) effect()
	} while (host.dirty)
	return tree
}
function unmount() {
	for (const cell of host.cells) {
		if (cell && typeof cell === 'object' && 'cleanup' in cell) (cell as EffectCell).cleanup?.()
	}
}

const productId = '00000000-0000-0000-0000-000000000001'
try {
	cart.setState({ items: [{ productId, sizeId: null, quantity: 2 }], addTick: 7 })
	assert.equal(render(), null, 'opening a page with an existing cart never replays old adds')
	await cart.persist.rehydrate()
	assert.equal(render(), null, 'cart hydration does not create feedback')
	assert.equal(cart.getState().addTick, 7)
	assert.deepEqual(Object.keys((persisted as { state: object }).state), ['items'], 'add events are not persisted')

	cart.getState().addItem(productId)
	assert.equal(render()?.props['aria-label'], 'Cart: 3')
	advance(4_999)
	assert.equal(render()?.props.disabled, false, 'feedback stays active for the full five-second lap')
	advance(1)
	assert.equal(render()?.props.disabled, true, 'fading feedback is no longer interactive')
	advance(200)
	assert.equal(render(), null, 'feedback disappears after completing its lap and fade')

	cart.getState().addItem(productId)
	render()
	advance(3_000)
	cart.getState().addItem(productId)
	assert.equal(render()?.props['aria-label'], 'Cart: 5')
	advance(2_200)
	assert.equal(render()?.props.disabled, false, 'an old add cannot dismiss a newer lap')
	advance(2_800)
	assert.equal(render()?.props.disabled, true)
	cart.getState().addItem(productId)
	render()
	advance(200)
	assert.equal(render()?.props.disabled, false, 'adding during the fade cancels the pending dismissal')
	advance(5_000)
	assert.equal(render(), null)

	cart.getState().updateQuantity(`${productId}|`, 99)
	assert.equal(render(), null, 'quantity edits do not masquerade as product adds')
	cart.getState().addItem(productId)
	assert.equal(render()?.props['aria-label'], 'Cart: 99', 'merged adds still trigger at the quantity limit')
	cart.getState().clearCart()
	assert.equal(render(), null, 'an emptied cart has no floating feedback')
	cart.getState().addItem(productId)
	const button = render()
	assert(button)
	button.props.onClick()
	assert.equal(render(), null, 'clicking feedback dismisses it immediately')
	assert.deepEqual(destinations.at(-1), { to: '/cart' })
	assert.equal(timers.size, 0, 'navigation clears both timers')

	cart.getState().addItem(productId)
	render()
	assert.equal(timers.size, 1)
	unmount()
	assert.equal(timers.size, 0, 'unmounting cannot leave pending state updates')
	console.log('Cart orb regressions passed: hydration, five-second lifetime, repeated adds, fade restart, quantity limits, empty cart, navigation and cleanup.')
} finally {
	unmount()
	globalThis.setTimeout = originalSetTimeout
	globalThis.clearTimeout = originalClearTimeout
	cart.getState().clearCart()
	if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
	else Reflect.deleteProperty(globalThis, 'localStorage')
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
	else Reflect.deleteProperty(globalThis, 'window')
}
