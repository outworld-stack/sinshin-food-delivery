/** Deterministic React/GPS host for shared About/article navigation behavior. */
import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree?: any; render(): void }
let host: Host
mock.module('react', () => ({
	...react, memo: (component: any) => component,
	useId: () => `id-${host.cursor++}`,
	useState(initial: any) {
		const owner = host, i = owner.cursor++
		const cell = owner.cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }
		return [cell.value, (next: any) => {
			const value = typeof next === 'function' ? next(cell.value) : next
			if (!Object.is(value, cell.value)) { cell.value = value; owner.dirty = true }
		}]
	},
	useRef(initial: any) { const i = host.cursor++; return (host.cells[i] ??= { value: { current: initial } }).value },
	useEffect(effect: () => (() => void) | void, deps: unknown[]) {
		const cell = host.cells[host.cursor++] ??= {}
		if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
			host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
		}
	},
}))
mock.module('#/i18n', () => ({ useI18n: () => ({ t: new Proxy({}, { get: (_, key) => key }) }) }))

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
let clock = 0, nextTimer = 0, openedDialogs = 0, closedDialogs = 0, restoredFocus = 0
const timers = new Map<number, { due: number; callback(): void }>()
globalThis.setTimeout = ((callback: () => void, delay = 0) => {
	const id = ++nextTimer; timers.set(id, { due: clock + delay, callback }); return id
}) as unknown as typeof setTimeout
globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout

const opened: string[] = []
const storage = new Map<string, string>()
let inClick = false, blockStorage = false
Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: { style: { overflow: 'auto' } } } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
	location: { assign: (url: string) => { assert(inClick, 'all navigation requires a fresh chooser click, never a GPS callback'); opened.push(url) } },
	localStorage: {
		getItem(key: string) { if (blockStorage) throw new Error('blocked'); return storage.get(key) ?? null },
		setItem(key: string, value: string) { if (blockStorage) throw new Error('blocked'); storage.set(key, value) },
		removeItem(key: string) { if (blockStorage) throw new Error('blocked'); storage.delete(key) },
	},
} })
type GeoRequest = { success(pos: { coords: { latitude: number; longitude: number } }): void; error(error: { code: number }): void; options: PositionOptions }
const requests: GeoRequest[] = []
const geolocation = { getCurrentPosition: (success: GeoRequest['success'], error: GeoRequest['error'], options: PositionOptions) => requests.push({ success, error, options }) }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
	userAgent: 'Mozilla Android Chrome', platform: 'Linux', maxTouchPoints: 5, geolocation,
} })
const device = navigator as unknown as { userAgent: string; platform: string; maxTouchPoints: number; geolocation: unknown }
const { ArticleRouteButton } = await import('../src/components/site/articles/ArticleRouteButton')
const { NeshanDirectionsButton } = await import('../src/components/shared/NeshanDirectionsButton')
const { neshanAppDirectionsUrl, neshanPlatform } = await import('../src/utils/neshanLinks')
assert.equal(ArticleRouteButton, NeshanDirectionsButton, 'article and About use one shared chooser')

type Node = { props: Record<string, any>; type: any }
function nodes(value: any): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value?.props) return []
	return [value, ...nodes(value.props.children)]
}
function createHost(getProps = () => ({ lat: 37, lng: 49 })): Host {
	const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, render() {
		host = owner; owner.cursor = 0; owner.dirty = false
		owner.tree = ArticleRouteButton(getProps())
		const trigger = nodes(owner.tree).find(node => node.type === 'button' && node.props.ref)
		if (trigger && !trigger.props.ref.current) trigger.props.ref.current = { focus(options: FocusOptions) { assert.equal(options.preventScroll, true); restoredFocus++ } }
		const dialog = nodes(owner.tree).find(node => node.type === 'dialog')
		if (dialog && !dialog.props.ref.current) dialog.props.ref.current = { showModal() { openedDialogs++ }, close() { closedDialogs++ } }
		for (const effect of owner.effects.splice(0)) effect()
	} }
	owner.render(); return owner
}
async function flush(owner: Host) {
	for (let i = 0; i < 12; i++) { await Promise.resolve(); if (owner.dirty) owner.render() }
}
async function advance(ms: number, owner: Host) {
	const end = clock + ms
	while (true) {
		const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
		if (!next) break
		clock = next[1].due; timers.delete(next[0]); next[1].callback(); await flush(owner)
	}
	clock = end; await flush(owner)
}
function unmount(owner: Host) {
	for (const cell of owner.cells) cell?.cleanup?.()
	assert.equal(timers.size, 0, 'unmount releases GPS timers')
	assert.equal(document.body.style.overflow, 'auto', 'closing restores scrolling')
}
const button = (owner: Host, key: string) => nodes(owner.tree).find(node => node.type === 'button' && node.props.children === key)!
function click(owner: Host, key = 'article.routeMap') {
	inClick = true
	try { button(owner, key).props.onClick() } finally { inClick = false }
}
async function choose(owner: Host, target: 'web' | 'app') {
	nodes(owner.tree).find(node => node.type === 'input' && node.props.value === target)!.props.onChange()
	await flush(owner)
}
const selected = (owner: Host) => nodes(owner.tree).find(node => node.type === 'input' && node.props.checked)?.props.value
const gpsSuccess = (request = requests.at(-1)!) => request.success({ coords: { latitude: 35.7, longitude: 51.4 } })
const webRoute = 'https://neshan.org/maps/routing/car/origin/35.700000,51.400000/destination/37.000000,49.000000'
const webPoint = 'https://neshan.org/maps/routing/car/destination/37.000000,49.000000'
const storageKey = 'sinshin.neshan-directions-target.v1'

try {
	const owner = createHost()
	click(owner); click(owner); await flush(owner)
	assert.equal(requests.length, 1, 'rapid clicks cannot start duplicate GPS requests')
	assert.equal(openedDialogs, 1, 'the chooser uses the native modal top layer')
	assert.equal(document.body.style.overflow, 'hidden')
	assert(nodes(owner.tree).some(node => node.type === 'dialog' && node.props['aria-labelledby'] && node.props['aria-describedby']))
	assert.equal(selected(owner), 'web')
	assert.equal(button(owner, 'article.routeOnce').props.disabled, true)
	click(owner, 'article.routeOnce'); assert.equal(opened.length, 0)
	assert.deepEqual(requests[0].options, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
	gpsSuccess(); await flush(owner)
	assert.equal(opened.length, 0, 'GPS only prepares coordinates; it never redirects')
	assert.equal(timers.size, 0)
	click(owner, 'article.routeOnce'); await flush(owner)
	assert.deepEqual(opened.splice(0), [webRoute], 'website choice explicitly opens the Neshan website with both endpoints')
	assert.equal(storage.size, 0, 'one-off choices are not persisted')
	assert.equal(closedDialogs, 1)
	assert.equal(restoredFocus, 1, 'closing returns keyboard focus to the directions button without scrolling')
	unmount(owner)

	const app = createHost()
	click(app); await flush(app); gpsSuccess(); await flush(app); await choose(app, 'app')
	const staleAlways = button(app, 'article.routeAlways').props.onClick
	click(app, 'article.routeAlways'); await flush(app)
	const intent = opened[0]
	assert(intent.startsWith('intent://nshn.ir?origin=35.700000,51.400000&destination=37.000000,49.000000&vehicle=d#Intent;'))
	assert(intent.includes('package=org.rajman.neshan.traffic.tehran.navigator;'))
	assert.equal(decodeURIComponent(intent.split('S.browser_fallback_url=')[1].split(';end')[0]), webRoute)
	assert.equal(nodes(app.tree).find(node => node.type === 'a')?.props.href, webRoute, 'an explicit website fallback remains if the browser cannot launch the app')
	assert.equal(storage.get(storageKey), 'app')
	inClick = true; staleAlways(); inClick = false
	assert.equal(opened.length, 1, 'duplicate launch events cannot launch the app twice')
	opened.length = 0
	click(app, 'common.cancel'); await flush(app)
	click(app); await flush(app)
	assert.equal(selected(app), 'app', 'Always preselects the saved choice before the next handoff')
	assert.equal(opened.length, 0, 'saved preference still presents a prompt and preserves user activation')
	gpsSuccess(); await flush(app); await choose(app, 'web'); click(app, 'article.routeOnce'); await flush(app)
	assert.equal(opened.pop(), webRoute)
	assert.equal(storage.get(storageKey), 'app', 'one-off override does not replace the remembered choice')
	click(app); await flush(app); click(app, 'article.routeForget'); await flush(app)
	assert.equal(storage.size, 0)
	click(app, 'common.cancel'); await flush(app); unmount(app)

	storage.set(storageKey, 'javascript:garbage')
	const corrupt = createHost(); click(corrupt); await flush(corrupt)
	assert.equal(selected(corrupt), 'web', 'invalid stored choices are ignored')
	click(corrupt, 'common.cancel'); await flush(corrupt); unmount(corrupt); storage.clear()
	blockStorage = true
	const blocked = createHost(); click(blocked); await flush(blocked); gpsSuccess(); await flush(blocked)
	click(blocked, 'article.routeAlways'); await flush(blocked)
	assert.equal(opened.pop(), webRoute, 'restricted storage cannot prevent a one-time handoff')
	unmount(blocked); blockStorage = false

	for (const problem of ['denied', 'unavailable', 'timeout', 'invalid', 'missing', 'throwing'] as const) {
		device.geolocation = problem === 'missing' ? undefined : problem === 'throwing'
			? { getCurrentPosition() { throw new DOMException('Denied', 'SecurityError') } } : geolocation
		const fallback = createHost(); click(fallback); await flush(fallback)
		if (problem === 'invalid') requests.at(-1)!.success({ coords: { latitude: NaN, longitude: 49 } })
		else if (problem === 'denied' || problem === 'unavailable' || problem === 'timeout') requests.at(-1)!.error({ code: ['denied', 'unavailable', 'timeout'].indexOf(problem) + 1 })
		await flush(fallback)
		assert.equal(timers.size, 0)
		assert(nodes(fallback.tree).some(node => node.props.children === 'article.routeGpsUnavailable'))
		assert.equal(opened.length, 0, `${problem}: location failure does not skip the chooser`)
		await choose(fallback, 'app'); click(fallback, 'article.routeOnce'); await flush(fallback)
		assert(opened[0].startsWith('intent://nshn.ir/?lat=37.000000&lng=49.000000#Intent;'))
		assert.equal(decodeURIComponent(opened[0].split('S.browser_fallback_url=')[1].split(';end')[0]), webPoint)
		opened.length = 0; unmount(fallback)
	}
	device.geolocation = geolocation

	const stalled = createHost(); click(stalled); await flush(stalled)
	const late = requests.at(-1)!
	await advance(11_999, stalled); assert.equal(button(stalled, 'article.routeOnce').props.disabled, true)
	await advance(1, stalled); assert.equal(button(stalled, 'article.routeOnce').props.disabled, false)
	gpsSuccess(late); late.error({ code: 1 }); await flush(stalled)
	assert.equal(opened.length, 0)
	click(stalled, 'article.routeOnce'); await flush(stalled); assert.equal(opened.pop(), webPoint, 'late GPS cannot override the timeout fallback')
	click(stalled); await flush(stalled); gpsSuccess(late); assert.equal(timers.size, 1, 'stale GPS cannot clear the retry watchdog')
	gpsSuccess(); await flush(stalled); click(stalled, 'article.routeOnce'); await flush(stalled); assert.equal(opened.pop(), webRoute)
	unmount(stalled)

	const cancelled = createHost(); click(cancelled); await flush(cancelled)
	const cancelledGps = requests.at(-1)!
	const dialog = nodes(cancelled.tree).find(node => node.type === 'dialog')!
	let prevented = false
	dialog.props.onCancel({ preventDefault() { prevented = true } }); await flush(cancelled)
	assert(prevented); assert.equal(timers.size, 0)
	assert.equal(restoredFocus, closedDialogs, 'Escape also restores keyboard focus')
	gpsSuccess(cancelledGps); cancelledGps.error({ code: 1 }); await flush(cancelled)
	assert.equal(opened.length, 0, 'Escape cancellation ignores late GPS')
	unmount(cancelled)

	let destination = { lat: 37, lng: 49 }
	const changed = createHost(() => destination); click(changed); await flush(changed)
	const oldGps = requests.at(-1)!
	destination = { lat: 38, lng: 50 }; changed.render(); await flush(changed)
	assert.equal(timers.size, 0); assert.equal(button(changed, 'article.routeMap').props.disabled, false)
	click(changed); await flush(changed); gpsSuccess(oldGps); assert.equal(timers.size, 1)
	gpsSuccess(); await flush(changed); click(changed, 'article.routeOnce'); await flush(changed)
	assert.equal(opened.pop(), webRoute.replace('destination/37.000000,49.000000', 'destination/38.000000,50.000000'))
	unmount(changed)

	const removed = createHost(); click(removed); await flush(removed)
	const removedGps = requests.at(-1)!
	unmount(removed); gpsSuccess(removedGps); removedGps.error({ code: 1 }); await advance(12_000, removed)
	assert.equal(opened.length, 0, 'unmount invalidates callbacks and timer')
	const count = requests.length
	for (const invalid of [{ lat: NaN, lng: 49 }, { lat: 91, lng: 49 }, { lat: 37, lng: -181 }, { lat: 37, lng: Infinity }]) {
		const bad = createHost(() => invalid); assert.equal(button(bad, 'article.routeMap').props.disabled, true)
		click(bad); await flush(bad); assert.equal(requests.length, count); assert.equal(opened.length, 0); unmount(bad)
	}

	device.userAgent = 'Mozilla iPhone'; device.platform = 'iPhone'
	const ios = createHost(); click(ios); await flush(ios); gpsSuccess(); await flush(ios); await choose(ios, 'app')
	click(ios, 'article.routeOnce'); await flush(ios)
	assert.equal(opened.pop(), 'neshan://?origin=35.700000,51.400000&destination=37.000000,49.000000&vehicle=d')
	assert.equal(nodes(ios.tree).find(node => node.type === 'a')!.props.href, webRoute)
	unmount(ios)
	assert.equal(neshanAppDirectionsUrl(37, 49, null, 'ios'), 'neshan://?ll=37.000000,49.000000')
	assert.equal(neshanAppDirectionsUrl(37, 49, null, 'other'), 'https://nshn.ir/?lat=37.000000&lng=49.000000')
	assert.equal(neshanPlatform({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios')
	assert.equal(neshanPlatform({ userAgent: 'Windows Chrome', platform: 'Win32', maxTouchPoints: 0 }), 'other')
	assert.equal(openedDialogs, closedDialogs, 'every native dialog is closed during cleanup')
	console.log('Neshan chooser passed: web/app routes, native intent fallback, iOS links, Always/once/reset, storage failures, user activation, GPS failures/deadlines/retries, cancellation, destination changes and cleanup.')
} finally {
	globalThis.setTimeout = realSetTimeout
	globalThis.clearTimeout = realClearTimeout
}
