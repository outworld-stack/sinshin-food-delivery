import type { MapPoint } from '#/utils/mapGeometry'

export const NESHAN_STYLE =
	'https://static.neshan.org/sdk/maplibre/styles/light.json'
export const NESHAN_KEY =
	(import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
	(import.meta.env.VITE_NESHAN_API_KEY as string | undefined)

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

/** Load the bundled SDK and its CSS only in the browser, once for all maps. */
export function loadNeshanSdk(): Promise<NeshanSdk> {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('The map SDK requires a browser'))
	}
	if (sdkPromise) return sdkPromise
	const pending = import('./neshan-sdk-client').then(
		({ default: sdk }) => sdk as unknown as NeshanSdk,
	)
	sdkPromise = pending
	void pending.catch(() => {
		if (sdkPromise === pending) sdkPromise = null
	})
	return pending
}
