/** stage-98 — تست رفتاریِ دکمهٔ «مسیریابی از موقعیت من» در بلوک موقعیت مقالات.
 *
 * پوشش (خواستهٔ تأییدشدهٔ صاحب کسب‌وکار):
 *  ۱) GPS موفق ⇒ لینکِ رسمیِ nshn.ir با origin={GPS}&destination={بلوک}&vehicle=d
 *  ۲) ردِ پرمیشن/تایم‌اوت ⇒ توستِ فارسی + همان لینکِ فقط-مقصد (کاربر مبدأ را
 *     روی نقشهٔ نشان خودش انتخاب می‌کند)
 *  ۳) مرورگرِ بدونِ Geolocation ⇒ همان فالبک
 *  ۴) GPS خراب (خارج از ±۹۰/۱۸۰) ⇒ همان فالبک + توست
 *  ۵) حینِ دریافت: دکمه disable + برچسبِ «در حال دریافت موقعیت…»
 *
 * الگوی میزبان (react mock با سلول‌های هوک) و الگوی mock جی‌پی‌اس از
 * test-maps-client.tsx / test-courier-client.ts — بدون مرورگر/شبکه.
 */
import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree?: any; render(): void }
let host: Host
mock.module('react', () => ({
        ...react, memo: (component: any) => component,
        useState(initial: any) {
                const owner = host, i = owner.cursor++
                const cell = owner.cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }
                return [cell.value, (next: any) => {
                        const value = typeof next === 'function' ? next(cell.value) : next
                        if (!Object.is(value, cell.value)) { cell.value = value; owner.dirty = true }
                }]
        },
        useRef(initial: any) { const i = host.cursor++; return (host.cells[i] ??= { value: { current: initial } }).value },
        useCallback: (fn: any) => fn,
        useMemo(compute: () => any, deps: unknown[]) {
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
const translation = { t: {
        'article.routeMap': 'Route from me',
        'article.routeLocating': 'Locating…',
        'article.routeGpsDenied': 'Pick the origin on the map yourself',
} }
mock.module('#/i18n', () => ({ useI18n: () => ({ t: translation.t }) }))
// zustand پشتِ میزبانِ هوک‌هایِ mock شده کار نمی‌کند (react واقعی می‌خواهد) —
// همان قراردادِ ToastState با store ساختگی: selector(getState()) + getState
const toastState: { message: string; type: 'success' | 'error'; isVisible: boolean; showToast: (m: string, t?: 'success' | 'error') => void; hideToast: () => void } = {
        message: '', type: 'success', isVisible: false,
        showToast: (message, type = 'success') => { Object.assign(toastState, { message, type, isVisible: true }) },
        hideToast: () => { Object.assign(toastState, { isVisible: false }) },
}
mock.module('zustand', () => ({
        create: () => {
                const useStore = (selector: (s: typeof toastState) => unknown) => selector(toastState)
                useStore.getState = () => toastState
                return useStore
        },
}))

const opened: Array<string | undefined> = []
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        open: (url?: string) => { opened.push(url) },
} })
type GeoCb = (pos: { coords: { latitude: number; longitude: number } }) => void
type GeoErr = (error: { code: number; message: string }) => void
let geoMode: 'ok' | 'denied' | 'unsupported' | 'garbage' | 'slow' = 'ok'
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
        geolocation: {
                getCurrentPosition: (success: GeoCb, error: GeoErr) => {
                        if (geoMode === 'ok') success({ coords: { latitude: 35.7, longitude: 51.4 } })
                        else if (geoMode === 'garbage') success({ coords: { latitude: 999, longitude: 51.4 } })
                        else error({ code: 1, message: 'Permission denied' })
                },
        },
} })

const { ArticleRouteButton } = await import('../src/components/site/articles/ArticleRouteButton')
const { useToastStore } = await import('../src/stores/toastStore')

type Node = { props: Record<string, any>; type: any }
function nodes(value: any): Node[] {
        if (Array.isArray(value)) return value.flatMap(nodes)
        if (!value?.props) return []
        return [value, ...nodes(value.props.children)]
}
function createHost(component: any, getProps: () => unknown): Host {
        const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, render() {
                host = owner; owner.cursor = 0; owner.dirty = false
                owner.tree = component(getProps())
                const effects = owner.effects.splice(0)
                for (const effect of effects) effect()
        } }
        owner.render()
        return owner
}
async function flush(owner: Host) {
        for (let i = 0; i < 12; i++) { await Promise.resolve(); if (owner.dirty) owner.render() }
}
function unmount(owner: Host) { for (const cell of owner.cells) cell?.cleanup?.() }
const buttonOf = (owner: Host) => nodes(owner.tree).find((node) => node.type === 'button')!
const click = (owner: Host) => buttonOf(owner).props.onClick()

try {
        // ۱) GPS موفق ⇒ لینک رسمی nshn.ir با مبدأِ GPS + مقصدِ بلوک
        geoMode = 'ok'
        const gpsHost = createHost(ArticleRouteButton, () => ({ lat: 37, lng: 49 }))
        assert.equal(buttonOf(gpsHost).props.disabled, false)
        click(gpsHost); await flush(gpsHost)
        assert.deepEqual(opened, ['https://nshn.ir?origin=35.700000,51.400000&destination=37.000000,49.000000&vehicle=d'],
                'GPS success opens the official origin-bearing nshn.ir route link')
        assert.equal(useToastStore.getState().isVisible, false, 'successful GPS needs no toast')
        unmount(gpsHost)
        opened.length = 0

        // ۲) ردِ پرمیشن ⇒ توست + فالبکِ فقط-مقصد (انتخابِ مبدأ روی نقشهٔ نشان)
        geoMode = 'denied'
        const deniedHost = createHost(ArticleRouteButton, () => ({ lat: 37, lng: 49 }))
        click(deniedHost); await flush(deniedHost)
        assert.deepEqual(opened, ['https://neshan.org/maps/routing/car/destination/37.000000,49.000000'],
                'denied GPS falls back to the destination-only link so the user picks the origin on the Neshan map')
        assert.equal(useToastStore.getState().message, 'Pick the origin on the map yourself')
        assert.equal(buttonOf(deniedHost).props.disabled, false, 'the button recovers after denial')
        unmount(deniedHost)
        opened.length = 0

        // ۳) بدونِ Geolocation ⇒ همان فالبک
        ;(navigator as unknown as { geolocation: unknown }).geolocation = undefined
        const noGeoHost = createHost(ArticleRouteButton, () => ({ lat: 37, lng: 49 }))
        click(noGeoHost); await flush(noGeoHost)
        assert.deepEqual(opened, ['https://neshan.org/maps/routing/car/destination/37.000000,49.000000'],
                'browsers without geolocation get the same destination-only fallback')
        unmount(noGeoHost)
        opened.length = 0
        ;(navigator as unknown as { geolocation: unknown }).geolocation = {
                getCurrentPosition: (success: GeoCb, error: GeoErr) => {
                        if (geoMode === 'ok') success({ coords: { latitude: 35.7, longitude: 51.4 } })
                        else if (geoMode === 'garbage') success({ coords: { latitude: 999, longitude: 51.4 } })
                        else error({ code: 1, message: 'Permission denied' })
                },
        }

        // ۴) GPS خراب (±۹۰/۱۸۰) ⇒ فالبک + توست — مختصاتِ غلط هرگز واردِ لینک نمی‌شود
        geoMode = 'garbage'
        const garbageHost = createHost(ArticleRouteButton, () => ({ lat: 37, lng: 49 }))
        click(garbageHost); await flush(garbageHost)
        assert.deepEqual(opened, ['https://neshan.org/maps/routing/car/destination/37.000000,49.000000'],
                'invalid GPS coordinates never leak into the route link')
        assert.equal(useToastStore.getState().message, 'Pick the origin on the map yourself')
        unmount(garbageHost)
        opened.length = 0

        // ۵) حینِ دریافت: disable + برچسبِ «در حال دریافت موقعیت…» (GPS کند)
        geoMode = 'slow'
        let releaseSlow!: () => void
        ;(navigator as unknown as { geolocation: unknown }).geolocation = {
                getCurrentPosition: (success: GeoCb) => {
                        releaseSlow = () => success({ coords: { latitude: 35.7, longitude: 51.4 } })
                },
        }
        const slowHost = createHost(ArticleRouteButton, () => ({ lat: 37, lng: 49 }))
        click(slowHost); await flush(slowHost)
        const pendingButton = buttonOf(slowHost)
        assert.equal(pendingButton.props.disabled, true, 'locating disables the button')
        assert(String(pendingButton.props.children).includes('Locating'), 'locating swaps the label')
        assert.equal(opened.length, 0, 'nothing opens until the position arrives')
        releaseSlow(); await flush(slowHost)
        assert.deepEqual(opened, ['https://nshn.ir?origin=35.700000,51.400000&destination=37.000000,49.000000&vehicle=d'])
        assert.equal(buttonOf(slowHost).props.disabled, false)
        unmount(slowHost)

        console.log('Article route button passed: GPS→official nshn.ir origin link · denial/unsupported/garbage→destination-only fallback + Persian toast · pending state disables the button.')
} finally {
        useToastStore.getState().hideToast()
}
