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
	unavailableMessage?: string
}

export const ArticleLocationMap = memo(function ArticleLocationMap({
	lat,
	lng,
	zoom = 15,
	unavailableMessage,
}: ArticleLocationMapProps) {
	const { t } = useI18n()
	const containerRef = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const valid = isNeshanCoord(lat, lng)

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
	const unavailable = !NESHAN_KEY || state === 'failed'
	return (
		<div
			className={
				'relative w-full h-56 sm:h-64 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] bg-gray-100 dark:bg-[#1a0a0e] ' +
				(!unavailable && state === 'loading' ? 'animate-pulse' : '')
			}
		>
			{/* Keep a sized container mounted when a failed map is retried with a
			    new destination, even if the cached SDK resolves before React renders. */}
			<div
				ref={containerRef}
				className="absolute inset-0"
				role="img"
				aria-label={t['map.locationLabel']}
				aria-hidden={unavailable}
			/>
			{unavailable && (
				<output className="absolute inset-0 flex items-center justify-center bg-gray-50 p-6 text-center text-sm leading-7 text-gray-500 dark:bg-[#1a0a0e] dark:text-gray-400">
					{unavailableMessage ?? t['map.directionsUnavailable']}
				</output>
			)}
		</div>
	)
})
