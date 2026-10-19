// src/components/courier/ScanRouteMap.tsx
// stage-84 — نقشه‌ی مسیر «رستوران → مقصد مشتری» در صفحه‌ی اسکن پیک.
//
// الگوها (هم‌خانواده‌ی CourierTrackingMap/MapPicker):
//  · SDK نشان (MapLibre) از CDN — بدون تغییر package.json
//  · کلاینتی-فقط: نقشه بعد از mount ساخته می‌شود (SSR-سِیف)
//  · polyline مسیر واقعی (no-traffic) اگر سرور داد؛ وگرنه خط مستقیم
//  · بدون کلید نقشه → فقط کارت متنی/فاصله (بدون شکستن صفحه)
import { memo, useEffect, useRef } from 'react'
import { neshanRouteUrl, neshanViewUrl } from '#/utils/neshanLinks'

const SDK_JS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js'
const SDK_CSS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.css'
const MAP_STYLE = 'https://static.neshan.org/sdk/maplibre/styles/light.json'

const NESHAN_KEY =
	(import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
	(import.meta.env.VITE_NESHAN_API_KEY as string | undefined)

interface LooseMap {
	remove(): void
	on(event: string, handler: (e: unknown) => void): void
	addSource(id: string, spec: Record<string, unknown>): void
	addLayer(spec: Record<string, unknown>): void
	fitBounds(
		bounds: [[number, number], [number, number]],
		opts?: Record<string, unknown>,
	): void
}
interface LooseMarker {
	setLngLat(pos: { lat: number; lng: number }): LooseMarker
	addTo(map: LooseMap): LooseMarker
	remove(): void
}
interface LooseMapLibre {
	Map: new (opts: Record<string, unknown>) => LooseMap
	Marker: new (opts?: { element?: HTMLElement; anchor?: string }) => LooseMarker
}

let sdkPromise: Promise<LooseMapLibre> | null = null
function loadNeshanSdk(): Promise<LooseMapLibre> {
	if (sdkPromise) return sdkPromise
	sdkPromise = new Promise<LooseMapLibre>((resolve, reject) => {
		const w = window as unknown as { maplibregl?: { default?: LooseMapLibre } }
		if (w.maplibregl?.default) return resolve(w.maplibregl.default)
		const script = document.createElement('script')
		script.src = SDK_JS
		script.async = true
		script.onload = () => {
			const ml = (
				window as unknown as { maplibregl?: { default?: LooseMapLibre } }
			).maplibregl?.default
			if (ml) resolve(ml)
			else {
				sdkPromise = null
				reject(new Error('SDK نقشه لود نشد'))
			}
		}
		script.onerror = () => {
			sdkPromise = null
			reject(new Error('بارگذاری SDK ناموفق'))
		}
		document.head.appendChild(script)
		if (!document.querySelector(`link[href="${SDK_CSS}"]`)) {
			const link = document.createElement('link')
			link.rel = 'stylesheet'
			link.href = SDK_CSS
			document.head.appendChild(link)
		}
	})
	return sdkPromise
}

/** رمزگشایی polyline (الگوریتم استاندارد Encoded Polyline)
 *  ترمیم اسکنِ استیج-۸۴: نسخهٔ قبلی سه خطای مرگبار داشت — result=1 به‌جای ۰،
 *  += به‌جای |=، و -۶۳ روی charCode اعمال نمی‌شد → خروجی زباله (یک نقطهٔ
 *  نامعتبر) و خطِ مسیر هرگز رسم نمی‌شد. حالا عین الگوریتم CourierTrackingMap
 *  (تست‌شده با بردار مرجع گوگل). */
function decodePolyline(encoded: string): Array<[number, number]> {
	const points: Array<[number, number]> = []
	let index = 0
	let lat = 0
	let lng = 0
	while (index < encoded.length) {
		let result = 0
		let shift = 0
		let b: number
		do {
			b = encoded.charCodeAt(index++) - 63
			result |= (b & 0x1f) << shift
			shift += 5
		} while (b >= 0x20)
		lat += result & 1 ? ~(result >> 1) : result >> 1
		result = 0
		shift = 0
		do {
			b = encoded.charCodeAt(index++) - 63
			result |= (b & 0x1f) << shift
			shift += 5
		} while (b >= 0x20)
		lng += result & 1 ? ~(result >> 1) : result >> 1
		points.push([lat * 1e-5, lng * 1e-5])
	}
	return points
}

export interface ScanRouteMapProps {
	origin: { lat: number; lng: number }
	destination: { lat: number; lng: number } | null
	polyline: string | null
	address?: string | null
}

function pinEl(color: string, label: string): HTMLElement {
	const el = document.createElement('div')
	el.style.cssText =
		'display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);'
	el.innerHTML =
		`<svg width="30" height="30" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1">` +
		'<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>' +
		`<span style="font-size:10px;color:#1f2937;background:#ffffffcc;border-radius:6px;padding:1px 5px;margin-top:2px;white-space:nowrap;">${label}</span>`
	return el
}

export const ScanRouteMap = memo(function ScanRouteMap({
	origin,
	destination,
	polyline,
	address,
}: ScanRouteMapProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	// ترمیم اسکنِ استیج-۸۴ — map در ref نگه داشته می‌شود تا cleanupِ واقعیِ افکت
	// (نه داخل .then که React آن را نادیده می‌گیرد) آن را remove کند؛ وگرنه
	// هر unmount یک WebGL context نشت می‌کرد و re-mount «Container is already
	// initialized» می‌داد (الگوی CourierTrackingMap).
	const mapRef = useRef<LooseMap | null>(null)

	useEffect(() => {
		if (!NESHAN_KEY || !destination) return
		let cancelled = false
		void loadNeshanSdk()
			.then((maplibregl) => {
				if (cancelled || !containerRef.current) return
				const map = new maplibregl.Map({
					container: containerRef.current,
					style: MAP_STYLE,
					center: [destination.lng, destination.lat],
					zoom: 13,
					minZoom: 2,
					maxZoom: 21,
					trackResize: true,
					apiKey: NESHAN_KEY,
					rtl: { lazy: false },
				})
				mapRef.current = map

				// ترمیم اسکنِ استیج-۸۴ — استایل از CDN async می‌آید؛ addSource/addLayer
				// قبل از لود کامل «Style is not done loading» می‌داد و خطِ مسیر گم می‌شد —
				// همه‌چیز داخل رخدادِ load
				const draw = () => {
					if (cancelled) return
					new maplibregl.Marker({
						element: pinEl('#059669', 'رستوران'),
						anchor: 'bottom',
					})
						.setLngLat({ lat: origin.lat, lng: origin.lng })
						.addTo(map)
					new maplibregl.Marker({
						element: pinEl('#ed0741', 'مقصد'),
						anchor: 'bottom',
					})
						.setLngLat({ lat: destination.lat, lng: destination.lng })
						.addTo(map)

					// مسیر: polyline واقعی یا خط مستقیم (بدون مسیر، خط ساده)
					const coords: Array<[number, number]> = polyline
						? decodePolyline(polyline)
						: [
								[origin.lat, origin.lng],
								[destination.lat, destination.lng],
							]
					if (coords.length >= 2) {
						map.addSource('scan-route', {
							type: 'geojson',
							data: {
								type: 'Feature',
								properties: {},
								geometry: {
									type: 'LineString',
									// geojson = [lng, lat]
									coordinates: coords.map(([la, ln]) => [ln, la]),
								},
							},
						})
						map.addLayer({
							id: 'scan-route-line',
							type: 'line',
							source: 'scan-route',
							layout: { 'line-join': 'round', 'line-cap': 'round' },
							paint: { 'line-color': '#f6339a', 'line-width': 4 },
						})
					}

					map.fitBounds(
						[
							[origin.lng, origin.lat],
							[destination.lng, destination.lat],
						],
						{ padding: 48 },
					)
				}
				map.on('load', draw)
			})
			.catch(() => {
				// بدون نقشه هم صفحه‌ی اسکن کار می‌کند
			})
		return () => {
			cancelled = true
			mapRef.current?.remove()
			mapRef.current = null
		}
	}, [origin, destination, polyline])

	if (!destination) {
		return (
			<div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
				موقعیت مشتری برای این سفارش ثبت نشده است.
			</div>
		)
	}
	if (!NESHAN_KEY) {
		return (
			<div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-1">
				<p
					className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium"
					dir="ltr"
				>
					مقصد: {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}
				</p>
				{address && (
					<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
						{address}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<a
						href={neshanViewUrl(destination.lat, destination.lng)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-block text-xs text-primary dark:text-dark-primary font-DanaDemiBold"
					>
						مشاهده مقصد روی نقشه ↗
					</a>
					<a
						href={neshanRouteUrl(destination.lat, destination.lng)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-block text-xs text-primary dark:text-dark-primary font-DanaDemiBold"
					>
						مسیریابی تا مقصد در نشان ↗
					</a>
				</div>
			</div>
		)
	}

	return (
		<div
			ref={containerRef}
			className="w-full h-64 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] bg-gray-100 dark:bg-[#1a0a0e]"
			role="img"
			aria-label="نقشه مسیر رستوران تا مقصد مشتری"
		/>
	)
})
