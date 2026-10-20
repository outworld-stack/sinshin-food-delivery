import type { MapPoint } from '#/utils/mapGeometry'

export const NESHAN_STYLE =
	'https://static.neshan.org/sdk/maplibre/styles/light.json'
export const NESHAN_KEY =
	(import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
	(import.meta.env.VITE_NESHAN_API_KEY as string | undefined)
const SDK_JS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js'
const SDK_CSS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.css'

export interface NeshanMap {
	remove(): void
	on(event: string, handler: (event: { lngLat: MapPoint }) => void): void
	addSource(id: string, spec: Record<string, unknown>): void
	getSource(id: string): { setData(data: unknown): void } | undefined
	addLayer(spec: Record<string, unknown>): void
	fitBounds(
		bounds: [[number, number], [number, number]],
		opts?: Record<string, unknown>,
	): void
	jumpTo(opts: Record<string, unknown>): void
}
export interface NeshanMarker {
	setLngLat(point: MapPoint): NeshanMarker
	addTo(map: NeshanMap): NeshanMarker
	remove(): void
}
export interface NeshanSdk {
	Map: new (opts: Record<string, unknown>) => NeshanMap
	Marker: new (opts?: {
		element?: HTMLElement
		anchor?: string
	}) => NeshanMarker
}

let sdkPromise: Promise<NeshanSdk> | null = null

/** Share the CDN request across every map, including simultaneous article/editor mounts. */
export function loadNeshanSdk(): Promise<NeshanSdk> {
	if (sdkPromise) return sdkPromise
	const pending = new Promise<NeshanSdk>((resolve, reject) => {
		if (typeof window === 'undefined') {
			reject(new Error('The map SDK requires a browser'))
			return
		}
		if (!document.querySelector(`link[href="${SDK_CSS}"]`)) {
			const link = document.createElement('link')
			link.rel = 'stylesheet'
			link.href = SDK_CSS
			document.head.appendChild(link)
		}
		const getSdk = () =>
			(window as unknown as { maplibregl?: { default?: NeshanSdk } }).maplibregl
				?.default
		const existing = getSdk()
		if (existing) {
			resolve(existing)
			return
		}
		const script = document.createElement('script')
		script.src = SDK_JS
		script.async = true
		const cleanup = () => {
			clearTimeout(timer)
			script.onload = null
			script.onerror = null
		}
		const fail = () => {
			cleanup()
			script.remove()
			reject(new Error('Unable to load the Neshan map SDK'))
		}
		const timer = setTimeout(fail, 15_000)
		script.onload = () => {
			const sdk = getSdk()
			if (!sdk) {
				fail()
				return
			}
			cleanup()
			resolve(sdk)
		}
		script.onerror = fail
		document.head.appendChild(script)
	})
	sdkPromise = pending
	void pending.catch(() => {
		if (sdkPromise === pending) sdkPromise = null
	})
	return pending
}
