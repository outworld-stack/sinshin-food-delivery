import { memo, useEffect, useRef, useState } from 'react'
import { useI18n } from '#/i18n'
import {
	loadNeshanSdk,
	NESHAN_KEY,
	NESHAN_STYLE,
	type NeshanMap,
	type NeshanMarker,
} from '#/lib/neshan-sdk'
import { isNeshanCoord } from '#/utils/neshanLinks'

interface ArticleLocationMapProps {
	lat: number
	lng: number
	zoom?: number
	label?: string
}

function fallbackMapUrl(lat: number, lng: number, zoom: number): string {
	const scale = 2 ** (15 - Math.max(2, Math.min(21, zoom)))
	const params = new URLSearchParams({
		bbox: [
			Math.max(-180, lng - 0.008 * scale),
			Math.max(-90, lat - 0.004 * scale),
			Math.min(180, lng + 0.008 * scale),
			Math.min(90, lat + 0.004 * scale),
		].join(','),
		layer: 'mapnik',
		marker: `${lat},${lng}`,
	})
	return `https://www.openstreetmap.org/export/embed.html?${params}`
}

export const ArticleLocationMap = memo(function ArticleLocationMap({
	lat,
	lng,
	zoom = 15,
	label,
}: ArticleLocationMapProps) {
	const { t } = useI18n()
	const containerRef = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const valid = isNeshanCoord(lat, lng)
	const embedUrl = valid ? fallbackMapUrl(lat, lng, zoom) : ''

	// Long articles can contain many locations. Defer SDK/WebGL/tile work until
	// each block approaches the viewport; leave its text and links server-rendered.
	useEffect(() => {
		if (!NESHAN_KEY || !valid || !containerRef.current) return
		if (typeof IntersectionObserver === 'undefined') {
			setVisible(true)
			return
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true)
					observer.disconnect()
				}
			},
			{ rootMargin: '200px' },
		)
		observer.observe(containerRef.current)
		return () => observer.disconnect()
	}, [valid])

	useEffect(() => {
		if (!NESHAN_KEY || !valid || !visible) return
		let cancelled = false
		let map: NeshanMap | undefined
		let marker: NeshanMarker | undefined
		setState('loading')
		const fail = () => {
			if (cancelled) return
			cancelled = true
			marker?.remove()
			map?.remove()
			marker = undefined
			map = undefined
			setState('failed')
		}
		const timer = setTimeout(fail, 20_000)
		void loadNeshanSdk()
			.then((sdk) => {
				if (cancelled || !containerRef.current) return
				map = new sdk.Map({
					container: containerRef.current,
					style: NESHAN_STYLE,
					center: [lng, lat],
					zoom,
					minZoom: 2,
					maxZoom: 21,
					trackResize: true,
					apiKey: NESHAN_KEY,
					rtl: { lazy: false },
				})
				marker = new sdk.Marker().setLngLat({ lat, lng }).addTo(map)
				map.on('load', () => {
					if (cancelled) return
					clearTimeout(timer)
					setState('ready')
				})
			})
			.catch(() => {
				clearTimeout(timer)
				fail()
			})
		return () => {
			cancelled = true
			clearTimeout(timer)
			marker?.remove()
			map?.remove()
		}
	}, [lat, lng, zoom, valid, visible])

	if (!valid) return null
	const useFallback = !NESHAN_KEY || state === 'failed'
	const mapLabel = label || t['map.locationLabel']
	return (
		<div
			className={
				'relative w-full h-56 sm:h-64 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] bg-gray-100 dark:bg-[#1a0a0e] ' +
				(!useFallback && state === 'loading' ? 'animate-pulse' : '')
			}
		>
			{/* Keep a sized container mounted when a failed map is retried with a
			    new destination, even if the cached SDK resolves before React renders. */}
			<div
				ref={containerRef}
				className="absolute inset-0"
				role="img"
				aria-label={mapLabel}
				aria-hidden={useFallback}
			/>
			{/* The public map remains usable without an API key or WebGL. Native
			    iframe lazy loading also keeps offscreen article blocks inexpensive. */}
			{useFallback && (
				<iframe
					key={embedUrl}
					title={mapLabel}
					src={embedUrl}
					loading="lazy"
					referrerPolicy="no-referrer"
					className="absolute inset-0 h-full w-full border-0"
				/>
			)}
		</div>
	)
})
