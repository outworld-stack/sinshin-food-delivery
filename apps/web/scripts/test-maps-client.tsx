import assert from 'node:assert/strict'
import { mock } from 'bun:test'

// Exercise real effects, dependencies, asynchronous SDK callbacks and handlers
// against a deterministic hook/SDK host, without a browser or external network.
const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree?: unknown; render(): void }
let host: Host
mock.module('react', () => ({
        ...react, memo: (component: unknown) => component,
        useState(initial: any) {
                const owner = host, i = owner.cursor++
                const cell = owner.cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }
                return [cell.value, (next: any) => {
                        const value = typeof next === 'function' ? next(cell.value) : next
                        if (!Object.is(value, cell.value)) { cell.value = value; owner.dirty = true }
                }]
        },
        useRef(initial: unknown) { const i = host.cursor++; return (host.cells[i] ??= { value: { current: initial } }).value },
        useCallback: (fn: unknown) => fn,
        useMemo(compute: () => unknown, deps: unknown[]) {
                const cell = host.cells[host.cursor++] ??= {}
                if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) { cell.value = compute(); cell.deps = deps }
                return cell.value
        },
        useEffect(effect: () => (() => void) | void, deps: unknown[]) {
                const cell = host.cells[host.cursor++] ??= {}
                if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
                        host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
                }
        },
}))
const translation = { t: new Proxy({}, { get: (_target, key) => String(key) }), apiError: (message: string) => message }
mock.module('#/i18n', () => ({ useI18n: () => translation, useI18nSafe: () => translation }))
mock.module('#/lib/api', () => ({ apiBase: () => '/api' }))
mock.module('#/lib/auth-session', () => ({ getAccessToken: () => 'test-token' }))
const requests: Array<{ url: string; signal: AbortSignal; resolve(body: unknown): void }> = []
mock.module('#/lib/api-fetch', () => ({ fetchWithTimeout: (url: string, init: RequestInit) => new Promise((resolve) => {
        requests.push({ url, signal: init.signal!, resolve: (body) => resolve(new Response(JSON.stringify(body))) })
}) }))

let time = 0, nextTimer = 0
const timers = new Map<number, { due: number; callback(): void }>()
globalThis.setTimeout = ((callback: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { due: time + delay, callback }); return id }) as any
globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as any
const maps: FakeMap[] = []
class FakeMap {
        loaded = false; removed = false; markers = new Set<FakeMarker>(); events = new Map<string, (event: any) => void>()
        sources = new Map<string, { data: any; setData(data: unknown): void }>()
        bounds: unknown; jumps: unknown[] = []
        constructor(readonly options: any) { maps.push(this) }
        on(event: string, callback: (event: any) => void) { this.events.set(event, callback) }
        fire(event: string, data: unknown = {}) { if (event === 'load') this.loaded = true; this.events.get(event)?.(data) }
        remove() { this.removed = true; this.markers.clear() }
        addSource(id: string, spec: any) {
                assert(this.loaded, 'route sources must wait for map style load')
                this.sources.set(id, { data: spec.data, setData(data) { this.data = data } })
        }
        getSource(id: string) { return this.sources.get(id) }
        addLayer() { assert(this.loaded) }
        fitBounds(bounds: unknown) { this.bounds = bounds }
        jumpTo(options: unknown) { this.jumps.push(options) }
}
class FakeMarker {
        point: any; map?: FakeMap
        setLngLat(point: unknown) { this.point = point; return this }
        addTo(map: FakeMap) { this.map = map; map.markers.add(this); return this }
        remove() { this.map?.markers.delete(this) }
}
const sdk = { Map: FakeMap, Marker: FakeMarker }
let sdkLoader = () => Promise.resolve(sdk)
mock.module('#/lib/neshan-sdk', () => ({ NESHAN_KEY: 'test-key', NESHAN_STYLE: 'test-style', loadNeshanSdk: () => sdkLoader() }))
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ style: {}, innerHTML: '', textContent: '' }) } })
type Node = { props: Record<string, any>; type: any }
function nodes(value: any): Node[] {
        if (Array.isArray(value)) return value.flatMap(nodes)
        if (!value?.props) return []
        return [value, ...nodes(value.props.children)]
}
function createHost(component: any, getProps: () => unknown): Host {
        const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, render() {
                host = owner; owner.cursor = 0; owner.dirty = false
                const previousRefs = nodes(owner.tree).map(node => node.props.ref).filter(Boolean)
                owner.tree = component(getProps())
                const currentRefs = nodes(owner.tree).map(node => node.props.ref).filter(Boolean)
                for (const ref of previousRefs) if (!currentRefs.includes(ref)) ref.current = null
                for (const node of nodes(owner.tree)) if (node.props.ref) node.props.ref.current ??= {}
                const effects = owner.effects.splice(0)
                for (const effect of effects) effect()
        } }
        owner.render()
        return owner
}
async function flush(owner: Host) {
        for (let i = 0; i < 12; i++) { await Promise.resolve(); if (owner.dirty) owner.render() }
}
async function advance(ms: number, owner: Host) {
        const end = time + ms
        while (true) {
                const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
                if (!next) break
                time = next[1].due; timers.delete(next[0]); next[1].callback(); await flush(owner)
        }
        time = end; await flush(owner)
}
function unmount(owner: Host) { for (const cell of owner.cells) cell?.cleanup?.() }
const { MapPicker } = await import('../src/components/shared/MapPicker')
const { ScanRouteMap } = await import('../src/components/courier/ScanRouteMap')
const { CourierTrackingMap } = await import('../src/components/dashboard/order-detail/CourierTrackingMap')
const { ArticleLocationMap } = await import('../src/components/site/articles/ArticleLocationMap')

let finishSdk!: (sdk: any) => void
sdkLoader = () => new Promise((resolve) => { finishSdk = resolve })
let selected: { lat: number; lng: number } | null = null
const picker = createHost(MapPicker, () => ({ value: selected, onChange: (point: typeof selected) => { selected = point } }))
selected = { lat: 37, lng: 49 }; picker.render()
finishSdk(sdk); await flush(picker)
const pickerMap = maps.at(-1)!
assert.deepEqual(pickerMap.options.center, [49, 37], 'delayed SDK initialization uses the latest saved address')
pickerMap.fire('load')
await advance(400, picker)
const firstReverse = requests.at(-1)!
pickerMap.fire('click', { lngLat: { lat: 38, lng: 410 } }); picker.render()
assert.deepEqual(selected, { lat: 38, lng: 50 }, 'clicking a wrapped map copy stores a valid longitude')
assert(firstReverse.signal.aborted, 'moving the pin cancels the previous reverse request')
await advance(400, picker)
requests.at(-1)!.resolve({ available: true, address: 'current address' }); await flush(picker)
firstReverse.resolve({ available: true, address: 'obsolete address' }); await flush(picker)
assert(JSON.stringify(picker.tree).includes('current address'))
assert(!JSON.stringify(picker.tree).includes('obsolete address'))
selected = null; picker.render()
assert.equal(pickerMap.markers.size, 0, 'clearing selection removes the pin')
unmount(picker)
assert(pickerMap.removed)
assert.equal(timers.size, 0, 'closing a picker clears pending debounce and loading timers')

sdkLoader = () => Promise.reject(new Error('WebGL/CDN unavailable'))
const broken = createHost(MapPicker, () => ({ value: null, onChange() {} }))
await flush(broken)
assert(nodes(broken.tree).some((node) => node.type.name === 'ManualCoordsFallback'), 'map initialization failure keeps location entry usable')
unmount(broken)
sdkLoader = () => Promise.resolve(sdk)
const stalled = createHost(MapPicker, () => ({ value: null, onChange() {} }))
await flush(stalled)
const stalledMap = maps.at(-1)!
await advance(20_000, stalled)
assert(nodes(stalled.tree).some((node) => node.type.name === 'ManualCoordsFallback'), 'a stalled map style also exposes coordinate entry')
assert(stalledMap.removed, 'timed-out maps release their WebGL context')
unmount(stalled)

const beforeScan = maps.length
const scan = createHost(ScanRouteMap, () => ({ origin: { lat: 37, lng: 49 }, destination: { lat: 38, lng: 50 }, polyline: '_' }))
await flush(scan)
const scanMap = maps.at(-1)!
assert.equal(scanMap.sources.size, 0)
scanMap.fire('load')
assert.deepEqual(scanMap.sources.get('scan-route')!.data.geometry.coordinates, [[49, 37], [50, 38]], 'malformed route falls back to endpoints')
scan.render(); await flush(scan)
assert.equal(maps.length, beforeScan + 1, 'equivalent new coordinate objects do not recreate WebGL maps')
assert.equal(nodes(scan.tree).filter((node) => node.type === 'a').length, 2, 'navigation links remain available with an embedded map')
// stage-98 — بدونِ GPS زنده، مبدأِ لینکِ مسیر = رستوران (فقط-مقصد دیگر نیست)
const scanLinks = nodes(scan.tree).filter((node) => node.type === 'a').map((node) => node.props.href)
assert(
        scanLinks.includes('https://nshn.ir?origin=37.000000,49.000000&destination=38.000000,50.000000&vehicle=d'),
        'stage-98 — route link carries an explicit restaurant origin in the official nshn.ir format',
)
unmount(scan)

// stage-98 — با موقعیتِ زندهٔ پیک، مبدأ خودِ پیک است (بدونِ نقشه‌ی جدید —
// لینک در رندر محاسبه می‌شود؛ نقشه با هر تیکِ GPS بازسازی نمی‌شود)
const scanWithCourier = createHost(ScanRouteMap, () => ({ origin: { lat: 37, lng: 49 }, destination: { lat: 38, lng: 50 }, polyline: '_', courierPosition: { lat: 37.5, lng: 49.5 } }))
await flush(scanWithCourier)
const courierScanLinks = nodes(scanWithCourier.tree).filter((node) => node.type === 'a').map((node) => node.props.href)
assert(
        courierScanLinks.includes('https://nshn.ir?origin=37.500000,49.500000&destination=38.000000,50.000000&vehicle=d'),
        'stage-98 — with live courier GPS the route origin is the courier itself',
)
unmount(scanWithCourier)

// Invalid GPS never enters a navigation URL; successive live updates reuse the map.
let scanPosition: { lat: number; lng: number } | null = { lat: NaN, lng: 49 }
let scanOrigin = { lat: 37, lng: 49 }
const changingScan = createHost(ScanRouteMap, () => ({ origin: scanOrigin, destination: { lat: 38, lng: 50 }, polyline: null, courierPosition: scanPosition }))
await flush(changingScan)
const changingScanMap = maps.at(-1)!
const beforeScanUpdates = maps.length
const scanRouteHref = () => nodes(changingScan.tree).filter((node) => node.type === 'a').at(-1)!.props.href
assert.equal(scanRouteHref(), 'https://nshn.ir?origin=37.000000,49.000000&destination=38.000000,50.000000&vehicle=d')
scanPosition = { lat: 37.5, lng: 49.5 }; changingScan.render(); await flush(changingScan)
assert.equal(scanRouteHref(), 'https://nshn.ir?origin=37.500000,49.500000&destination=38.000000,50.000000&vehicle=d')
scanPosition = { lat: 37.6, lng: 49.6 }; changingScan.render(); await flush(changingScan)
assert.equal(scanRouteHref(), 'https://nshn.ir?origin=37.600000,49.600000&destination=38.000000,50.000000&vehicle=d')
assert.equal(maps.length, beforeScanUpdates, 'courier GPS changes update links without allocating another WebGL map')
scanPosition = null
scanOrigin = { lat: 91, lng: 49 }; changingScan.render(); await flush(changingScan)
assert(changingScanMap.removed)
assert.equal(scanRouteHref(), 'https://neshan.org/maps/routing/car/destination/38.000000,50.000000', 'missing valid origins still leave a destination-only navigation fallback')
unmount(changingScan)

let courier: { lat: number; lng: number } | null = null
let destination: { lat: number; lng: number } | null = null
const tracking = createHost(CourierTrackingMap, () => ({ status: 'ON_THE_WAY', courierLocation: courier, customerLocation: destination }))
const beforeLocation = maps.length
await flush(tracking)
assert.equal(maps.length, beforeLocation, 'missing coordinates do not generate fake positions')
destination = { lat: 38, lng: 50 }; tracking.render(); await flush(tracking)
const trackingMap = maps.at(-1)!
trackingMap.fire('load'); await flush(tracking)
assert.equal(trackingMap.markers.size, 1, 'waiting for GPS renders only the known destination')
// stage-98 — تا نخستین موقعیتِ پیک، لینکِ «مسیریابی» معنا ندارد (مسیرِ مشتری
// تا خانه‌ی خودش!) و فقط «مشاهدهٔ مقصد» هست.
assert.equal(
        nodes(tracking.tree).filter((node) => node.type === 'a').length, 1,
        'stage-98 — before the first courier position only the view link is available',
)
const beforeRoute = requests.length
courier = { lat: 37, lng: 49 }; tracking.render(); await flush(tracking)
assert.equal(requests.length, beforeRoute + 1)
assert.equal(trackingMap.markers.size, 2)
// stage-98 — با رسیدنِ موقعیتِ پیک، لینکِ مسیر با مبدأِ صریح = خودِ پیک ظاهر می‌شود
// (server-fed — بدونِ GPS در دستگاهِ مشتری).
assert.deepEqual(
        nodes(tracking.tree).filter((node) => node.type === 'a').map((node) => node.props.href),
        [
                'https://neshan.org/maps/@38.000000,50.000000,15z',
                'https://nshn.ir?origin=37.000000,49.000000&destination=38.000000,50.000000&vehicle=d',
        ],
        'stage-98 — once the courier is live, the route link is origin-bearing (courier → customer address)',
)
requests.at(-1)!.resolve({ available: true, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }); await flush(tracking)
for (let i = 0; i < 10; i++) { courier = { lat: 37 + i / 100, lng: 49 }; tracking.render(); await flush(tracking) }
assert.equal(requests.length, beforeRoute + 1, 'GPS updates never bypass the route throttle')
await advance(59_999, tracking)
assert.equal(requests.length, beforeRoute + 1)
await advance(1, tracking)
assert.equal(requests.length, beforeRoute + 2)
assert(requests.at(-1)!.url.includes('37.090000'), 'throttled refresh uses the newest GPS position')
const oldRoute = requests.at(-1)!
destination = { lat: 39, lng: 51 }; tracking.render(); await flush(tracking)
assert(oldRoute.signal.aborted, 'changing destination cancels obsolete routing')
assert.equal(trackingMap.sources.get('courier-route')!.data.features.length, 0, 'old destination route is cleared immediately')
assert(requests.at(-1)!.url.includes('to=39.000000,51.000000'))
const activeRoute = requests.at(-1)!
unmount(tracking)
assert(activeRoute.signal.aborted)
assert(trackingMap.removed)
const beforeStyleRequest = requests.length
const loadingTracking = createHost(CourierTrackingMap, () => ({ status: 'ON_THE_WAY', courierLocation: { lat: 37, lng: 49 }, customerLocation: { lat: 38, lng: 50 } }))
await flush(loadingTracking)
assert.equal(requests.length, beforeStyleRequest, 'known coordinates do not start drawing a route before the style loads')
maps.at(-1)!.fire('load'); await flush(loadingTracking)
assert.equal(requests.length, beforeStyleRequest + 1)
requests.at(-1)!.resolve({ available: true, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }); await flush(loadingTracking)
assert(maps.at(-1)!.sources.has('courier-route'))
unmount(loadingTracking)

let intersect!: (entries: { isIntersecting: boolean }[]) => void
let disconnected = false
Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
        constructor(callback: typeof intersect) { intersect = callback }
        observe() {}
        disconnect() { disconnected = true }
} })
const beforeArticle = maps.length
const article = createHost(ArticleLocationMap, () => ({ lat: 37, lng: 49 }))
await flush(article)
assert.equal(maps.length, beforeArticle, 'offscreen article maps allocate no WebGL context')
intersect([{ isIntersecting: true }]); await flush(article)
assert.equal(maps.length, beforeArticle + 1)
assert(disconnected)
assert.deepEqual(maps.at(-1)!.options.center, [49, 37], 'the article map centers on the saved admin location')
assert.deepEqual([...maps.at(-1)!.markers][0].point, { lat: 37, lng: 49 }, 'the pin uses the same saved coordinates')
assert(!nodes(article.tree).some(node => node.type === 'iframe'), 'working Neshan maps do not load a second provider')
maps.at(-1)!.fire('load'); await flush(article); unmount(article)
assert(maps.at(-1)!.removed)

sdkLoader = () => Promise.reject(new Error('Map CDN unavailable'))
let articleDestination = { lat: 37, lng: 49 }
const failedArticle = createHost(ArticleLocationMap, () => articleDestination)
intersect([{ isIntersecting: true }]); await flush(failedArticle)
const fallbackFrame = (owner: Host) => nodes(owner.tree).find(node => node.type === 'iframe')!
const firstFallback = fallbackFrame(failedArticle)
assert.equal(new URL(firstFallback.props.src).origin, 'https://www.openstreetmap.org')
assert.equal(new URL(firstFallback.props.src).searchParams.get('marker'), '37,49', 'SDK failures still display a map with the saved pin')
assert.equal(firstFallback.props.loading, 'lazy')
assert.equal(firstFallback.props.title, 'map.locationLabel')
assert(!nodes(failedArticle.tree).some(node => node.type === 'output'), 'an available fallback map replaces the unavailable message')
assert.equal(timers.size, 0, 'a rejected SDK releases the map deadline')
articleDestination = { lat: 37.4822056, lng: 49.4418273 }; failedArticle.render(); await flush(failedArticle)
assert.equal(new URL(fallbackFrame(failedArticle).props.src).searchParams.get('marker'), '37.4822056,49.4418273', 'the fallback preserves the precision of replacement destinations')
sdkLoader = () => Promise.resolve(sdk)
articleDestination = { lat: 38, lng: 50 }; failedArticle.render(); await flush(failedArticle)
const recoveredArticleMap = maps.at(-1)!
assert.deepEqual(recoveredArticleMap.options.center, [50, 38], 'changing a failed map destination can initialize immediately with the cached SDK')
recoveredArticleMap.fire('load'); await flush(failedArticle)
assert(!nodes(failedArticle.tree).some(node => node.type === 'output'))
assert(!fallbackFrame(failedArticle), 'recovering Neshan maps release the fallback iframe')
assert(nodes(failedArticle.tree).some(node => node.props['aria-label'] === 'map.locationLabel'), 'map descriptions follow the selected language')
unmount(failedArticle)
assert(recoveredArticleMap.removed)

const stalledArticle = createHost(ArticleLocationMap, () => ({ lat: 37, lng: 49, label: 'Restaurant location' }))
intersect([{ isIntersecting: true }]); await flush(stalledArticle)
const stalledArticleMap = maps.at(-1)!
await advance(20_000, stalledArticle)
assert(stalledArticleMap.removed, 'a stalled article map releases its WebGL context')
assert.equal(fallbackFrame(stalledArticle).props.title, 'Restaurant location', 'About can label its restaurant map')
assert.equal(new URL(fallbackFrame(stalledArticle).props.src).searchParams.get('marker'), '37,49')
stalledArticleMap.fire('load'); await flush(stalledArticle)
assert(fallbackFrame(stalledArticle), 'a late load cannot revive a timed-out map')
unmount(stalledArticle)
assert.equal(timers.size, 0, 'all map lifecycles release their timers')

// Address drafts are independent from profile object identity and keep the
// user's address text while the map supplies the explicit selected coordinate.
let mutationOptions: any
let isPending = false
const submitted: any[] = [], toasts: string[] = []
mock.module('@tanstack/react-query', () => ({
        useQueryClient: () => ({ invalidateQueries() {} }),
        useMutation: (options: any) => { mutationOptions = options; return { isPending, mutate: (data: unknown) => submitted.push(data) } },
}))
mock.module('#/server/user', () => ({ addUserAddress() {}, updateUserAddress() {} }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast: (message: string) => toasts.push(message) }) }))
const { AddressFormModal } = await import('../src/components/dashboard/addresses/AddressFormModal')
const { AddAddressModal } = await import('../src/components/site/checkout/AddAddressModal')
let editing = { id: 'address-a', title: 'Home', address: 'Original street', lat: 37, lng: 49 }
const addressForm = createHost(AddressFormModal, () => ({ editing, onClose() {} }))
await flush(addressForm)
const control = (owner: Host, type: string) => nodes(owner.tree).find((node) => node.type === type)!
control(addressForm, 'textarea').props.onChange({ target: { value: 'Entrance B, floor 2' } }); addressForm.render()
editing = { ...editing }; addressForm.render(); await flush(addressForm)
assert.equal(control(addressForm, 'textarea').props.value, 'Entrance B, floor 2', 'profile refetch cannot discard an address draft')
nodes(addressForm.tree).find((node) => node.type === MapPicker)!.props.onChange({ lat: 38, lng: 50 }); addressForm.render()
control(addressForm, 'form').props.onSubmit({ preventDefault() {} })
assert.deepEqual(submitted.at(-1), { id: 'address-a', title: 'Home', address: 'Entrance B, floor 2', lat: 38, lng: 50 })
const manualElement = nodes(broken.tree).find((node) => node.type.name === 'ManualCoordsFallback')!
const addressPickerProps = () => nodes(addressForm.tree).find((node) => node.type === MapPicker)!.props
const manualAddress = createHost(manualElement.type, () => ({
        value: addressPickerProps().value, onChangeRef: { current: addressPickerProps().onChange }, onValidityChange: addressPickerProps().onValidityChange,
}))
await flush(manualAddress)
const manualInputs = () => nodes(manualAddress.tree).filter((node) => node.type === 'input')
assert(manualInputs().every((node) => node.props.required && node.props.step === 'any'), 'article forms reject empty coordinates without rejecting high-precision GPS')
manualInputs()[0]!.props.onChange({ target: { value: '' } }); manualAddress.render(); addressForm.render()
const beforeIncomplete = submitted.length
control(addressForm, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, beforeIncomplete, 'clearing a manual latitude blocks saving the previous selected coordinates')
assert(nodes(addressForm.tree).find((node) => node.props.type === 'submit')!.props.disabled)
manualInputs()[0]!.props.onChange({ target: { value: '37.4822056' } }); addressForm.render(); manualAddress.render(); await flush(manualAddress)
control(addressForm, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.at(-1).lat, 37.4822056, 'completing the manual draft re-enables the current selection at full precision')
manualInputs()[1]!.props.onChange({ target: { value: '181' } }); manualAddress.render(); addressForm.render()
const beforeInvalid = submitted.length
control(addressForm, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, beforeInvalid, 'an out-of-range manual draft cannot save an earlier valid point')
manualInputs()[1]!.props.onChange({ target: { value: '50' } }); addressForm.render(); manualAddress.render(); await flush(manualAddress)
unmount(manualAddress)
isPending = true; addressForm.render()
const submittedCount = submitted.length
control(addressForm, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, submittedCount, 'pending address saves cannot submit twice')
mutationOptions.onError(new Error('Address service unavailable'))
assert.equal(toasts.at(-1), 'Address service unavailable')
isPending = false
editing = { id: 'address-b', title: 'Work', address: 'New street', lat: 36, lng: 48 }
addressForm.render(); await flush(addressForm)
assert.equal(control(addressForm, 'textarea').props.value, 'New street', 'switching addresses does hydrate the new record')
unmount(addressForm)
const checkoutAddress = createHost(AddAddressModal, () => ({ onClose() {} }))
nodes(checkoutAddress.tree).find((node) => node.type === MapPicker)!.props.onChange({ lat: NaN, lng: 49 }); checkoutAddress.render()
control(checkoutAddress, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, submittedCount, 'invalid coordinates never leave the checkout form')
nodes(checkoutAddress.tree).find((node) => node.type === MapPicker)!.props.onChange({ lat: 37, lng: 49 }); checkoutAddress.render()
control(checkoutAddress, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, submittedCount + 1)
nodes(checkoutAddress.tree).find((node) => node.type === MapPicker)!.props.onValidityChange(false); checkoutAddress.render()
control(checkoutAddress, 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.length, submittedCount + 1, 'checkout also blocks saving an incomplete manual draft over a valid selected point')
unmount(checkoutAddress)

// A stopped/restarted scan page must not feed old coordinates into its new live-origin link.
let scanTracking: { onPosition(point: { lat: number; lng: number }): void; onStopped(): void }
let scanWatchStops = 0
mock.module('@tanstack/react-router', () => ({
        createFileRoute: () => (options: any) => ({ ...options, useParams: () => ({ orderId: 'order-scan' }) }),
        Link: () => null,
}))
mock.module('#/server/courier', () => ({ courierScan: async () => ({
        success: true, trackingEnabled: true,
        route: { origin: { lat: 37, lng: 49 }, destination: { lat: 38, lng: 50 }, polyline: null },
}) }))
mock.module('#/utils/courierSession', () => ({ getCourierToken: () => 'courier-session' }))
mock.module('#/utils/courierTracking', () => ({ startCourierTracking: (callbacks: typeof scanTracking) => {
        scanTracking = callbacks
        return () => { scanWatchStops++ }
} }))
const { Route: scanPageRoute } = await import('../src/routes/courier/scan/$orderId')
const scanPage = createHost((scanPageRoute as any).component, () => ({}))
const scanPageButton = () => nodes(scanPage.tree).find((node) => node.type === 'button')!
const scanPageMap = () => nodes(scanPage.tree).find((node) => node.type === ScanRouteMap)!
await scanPageButton().props.onClick(); await flush(scanPage)
assert.equal(scanPageMap().props.courierPosition, null, 'a new delivery uses the restaurant until live GPS arrives')
scanTracking!.onPosition({ lat: 37.5, lng: 49.5 }); await flush(scanPage)
assert.deepEqual(scanPageMap().props.courierPosition, { lat: 37.5, lng: 49.5 })
scanPageButton().props.onClick(); await flush(scanPage)
assert.equal(scanWatchStops, 1)
assert.equal(scanPageMap().props.courierPosition, null, 'manually stopping tracking discards its live navigation origin')
await scanPageButton().props.onClick(); await flush(scanPage)
assert.equal(scanPageMap().props.courierPosition, null, 'restarting tracking waits for a fresh coordinate')
scanTracking!.onPosition({ lat: 37.6, lng: 49.6 }); await flush(scanPage)
scanTracking!.onStopped(); await flush(scanPage)
assert.equal(scanPageMap().props.courierPosition, null, 'permission/session/server stops also discard stale coordinates')
unmount(scanPage)
console.log('Map client regressions passed: async initialization, reverse races, wrapped clicks, failure fallback, scan lifecycle and GPS-origin updates, style readiness, late GPS, route throttling, destination changes, lazy article maps, cleanup and address draft/save safety.')
