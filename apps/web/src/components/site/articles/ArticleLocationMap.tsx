// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/articles/ArticleLocationMap.tsx (فایل جدید)
// نقشه‌ی فقط-نمایش برای بلوک «موقعیت» مقاله.
//
// الگوها (هم‌خانواده‌ی MapPicker/CourierTrackingMap):
//  · SDK نشان (MapLibre) از CDN — بدون تغییر package.json
//  · کلاینتی-فقط: نقشه در useEffect بعد از mount ساخته می‌شود →
//    SSR/کرالر متن/آدرس را می‌گیرد (درس ab-js — بدون JS هم محتوا هست)
//  · بدون کلید VITE_NESHAN_MAP_KEY → هیچ رندر نقشه‌ای (سقوط بی‌صدا)؛
//    آدرس/دکمه‌ی بیرونی از BlockContent اصلی می‌آید.
// ═══════════════════════════════════════════════════════════════

// src/components/site/articles/ArticleLocationMap.tsx
import { memo, useEffect, useRef, useState } from 'react'

const SDK_JS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js'
const SDK_CSS =
	'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.css'
const MAP_STYLE = 'https://static.neshan.org/sdk/maplibre/styles/light.json'

const NESHAN_KEY =
	(import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
	(import.meta.env.VITE_NESHAN_API_KEY as string | undefined)

/** شکل loose سمت SDK — UMD بدون تایپ است */
interface LooseMap {
	remove(): void
}
interface LooseMarker {
	setLngLat(pos: { lat: number; lng: number }): LooseMarker
	addTo(map: LooseMap): LooseMarker
	remove(): void
}
interface LooseMapLibre {
	Map: new (opts: Record<string, unknown>) => LooseMap
	Marker: new (opts: { element?: HTMLElement; anchor?: string }) => LooseMarker
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
				reject(
					new Error(
						'SDK نقشه‌ی نشان لود شد اما window.maplibregl.default خالی است',
					),
				)
			}
		}
		script.onerror = () => {
			sdkPromise = null
			reject(new Error('بارگذاری SDK نقشه‌ی نشان ناموفق بود'))
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

function pinColor(): string {
	try {
		const v = getComputedStyle(document.documentElement)
			.getPropertyValue('--color-primary')
			.trim()
		return v || '#f6339a'
	} catch {
		return '#f6339a'
	}
}

interface ArticleLocationMapProps {
	lat: number
	lng: number
	zoom?: number
}

/**
 * نقشه‌ی تعاملیِ فقط-نمایش با یک پین. interactive (زوم/جابه‌جایی) ولی
 * بدون هندلرِ کلیک — بلوکِ موقعیتِ مقاله داده‌ای تولید نمی‌کند.
 */
export const ArticleLocationMap = memo(function ArticleLocationMap({
	lat,
	lng,
	zoom = 15,
}: ArticleLocationMapProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [ready, setReady] = useState(false)
	// ترمیم اسکنِ استیج-۸۴ — cleanupِ واقعی در خودِ افکت (map.remove در ref)؛
	// قبلاً return از داخل .then بود که React نادیده می‌گیرد → نشتِ WebGL
	const mapRef = useRef<LooseMap | null>(null)

	useEffect(() => {
		if (!NESHAN_KEY) return
		let cancelled = false
		void loadNeshanSdk()
			.then((maplibregl) => {
				if (cancelled || !containerRef.current) return
				const map = new maplibregl.Map({
					container: containerRef.current,
					style: MAP_STYLE,
					center: [lng, lat],
					zoom,
					minZoom: 2,
					maxZoom: 21,
					trackResize: true,
					apiKey: NESHAN_KEY,
					rtl: { lazy: false },
				})
				mapRef.current = map
				const pinEl = document.createElement('div')
				pinEl.style.cssText =
					'width:32px;height:32px;transform:translate(-50%,-100%);'
				pinEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="${pinColor()}" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`
				new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
					.setLngLat({ lat, lng })
					.addTo(map)
				setReady(true)
			})
			.catch(() => {
				// بدون نقشه هم بلوک کار می‌کند — آدرس + دکمه‌ی بیرونی از BlockContent
			})
		return () => {
			cancelled = true
			mapRef.current?.remove()
			mapRef.current = null
		}
	}, [lat, lng, zoom])

	if (!NESHAN_KEY) return null

	return (
		<div
			ref={containerRef}
			className={
				'relative w-full h-56 sm:h-64 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] bg-gray-100 dark:bg-[#1a0a0e] ' +
				(ready ? '' : 'animate-pulse')
			}
			role="img"
			aria-label="نقشه‌ی موقعیت"
		/>
	)
})
