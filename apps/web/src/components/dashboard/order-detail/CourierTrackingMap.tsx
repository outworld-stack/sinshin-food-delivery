import { memo, useRef, useEffect, useState } from 'react'
import { Bicycle } from 'reicon-react'
import { useI18n } from '#/i18n'
import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'
import { fetchWithTimeout } from '#/lib/api-fetch'
import {
	loadNeshanSdk,
	NESHAN_KEY,
	NESHAN_STYLE,
	type NeshanMap,
	type NeshanMarker,
} from '#/lib/neshan-sdk'
import { MapBrowserNote } from '#/components/shared/MapBrowserNote'
import {
	decodePolyline,
	lineFeature,
	mapBounds,
	type MapPoint,
} from '#/utils/mapGeometry'
import { neshanRouteFromUrl, neshanViewUrl } from '#/utils/neshanLinks'
import { useMapPoint } from '#/hooks/shared/useMapPoint'

interface CourierTrackingMapProps {
	status: string
	courierLocation?: MapPoint | null
	customerLocation?: MapPoint | null
}

async function fetchRoute(
	from: MapPoint,
	to: MapPoint,
	signal: AbortSignal,
): Promise<string | null> {
	try {
		const token = getAccessToken()
		const res = await fetchWithTimeout(
			`${apiBase()}/geo/route?from=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&to=${to.lat.toFixed(6)},${to.lng.toFixed(6)}`,
			{
				headers: token ? { authorization: `Bearer ${token}` } : undefined,
				credentials: 'include',
				signal,
			},
			{ timeoutMs: 8_000 },
		)
		const body = (await res.json()) as {
			available?: boolean
			polyline?: string
		}
		return res.ok &&
			body.available === true &&
			typeof body.polyline === 'string'
			? body.polyline
			: null
	} catch {
		return null
	}
}

export const CourierTrackingMap = memo(function CourierTrackingMap({
	status,
	courierLocation,
	customerLocation,
}: CourierTrackingMapProps) {
	const { t } = useI18n()
	const courier = useMapPoint(courierLocation)
	const destination = useMapPoint(customerLocation)
	const hasCourier = Boolean(courier)
	const active = status === 'ON_THE_WAY'
	const hasLocation = Boolean(courier || destination)
	const latest = useRef({ courier, destination })
	latest.current = { courier, destination }
	const containerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<NeshanMap | null>(null)
	const courierMarkerRef = useRef<NeshanMarker | null>(null)
	const destMarkerRef = useRef<NeshanMarker | null>(null)
	const [ready, setReady] = useState(false)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		if (!NESHAN_KEY || !active || !hasLocation || failed) return
		let cancelled = false
		setReady(false)
		const timer = setTimeout(() => {
			if (!cancelled) setFailed(true)
		}, 20_000)
		void loadNeshanSdk()
			.then((sdk) => {
				if (cancelled || !containerRef.current) return
				const center = latest.current.destination ?? latest.current.courier
				if (!center) return
				const map = new sdk.Map({
					container: containerRef.current,
					style: NESHAN_STYLE,
					center: [center.lng, center.lat],
					zoom: 15,
					minZoom: 2,
					maxZoom: 21,
					trackResize: true,
					apiKey: NESHAN_KEY,
					rtl: { lazy: false },
				})
				mapRef.current = map
				const courierEl = document.createElement('div')
				courierEl.textContent = '🛵'
				courierEl.style.cssText =
					'font-size:32px;filter:drop-shadow(0 2px 4px #3338);'
				courierMarkerRef.current = new sdk.Marker({
					element: courierEl,
					anchor: 'bottom',
				})
				const destEl = document.createElement('div')
				destEl.textContent = '📍'
				destEl.style.cssText = 'font-size:32px;'
				destMarkerRef.current = new sdk.Marker({
					element: destEl,
					anchor: 'bottom',
				})
				map.on('load', () => {
					if (cancelled) return
					clearTimeout(timer)
					setReady(true)
				})
			})
			.catch(() => {
				clearTimeout(timer)
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
			clearTimeout(timer)
			courierMarkerRef.current?.remove()
			destMarkerRef.current?.remove()
			mapRef.current?.remove()
			mapRef.current = null
			courierMarkerRef.current = null
			destMarkerRef.current = null
		}
	}, [active, hasLocation, failed])

	useEffect(() => {
		const map = mapRef.current
		if (!ready || !map) return
		if (courier) courierMarkerRef.current?.setLngLat(courier).addTo(map)
		else courierMarkerRef.current?.remove()
		if (destination) destMarkerRef.current?.setLngLat(destination).addTo(map)
		else destMarkerRef.current?.remove()
	}, [ready, courier, destination])

	// Fit initially and when a previously missing endpoint arrives. Live GPS
	// moves its marker without interrupting the customer's pan/zoom gestures.
	useEffect(() => {
		const points = [
			hasCourier ? latest.current.courier : null,
			destination,
		].filter((point): point is MapPoint => Boolean(point))
		if (ready && points.length)
			mapRef.current?.fitBounds(
				mapBounds(points.map(({ lat, lng }) => [lat, lng])),
				{ padding: 40, maxZoom: 15 },
			)
	}, [ready, hasCourier, destination])

	useEffect(() => {
		const map = mapRef.current
		if (!active || !ready || !map) return
		// Clear the previous destination's route immediately, including missing GPS.
		map
			.getSource('courier-route')
			?.setData({ type: 'FeatureCollection', features: [] })
		if (!destination || !hasCourier) return
		let cancelled = false
		let lastKey: string | null = null
		let timer: ReturnType<typeof setTimeout> | undefined
		const controller = new AbortController()
		const refresh = async () => {
			const from = latest.current.courier
			if (!from || cancelled) return
			const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`
			if (key !== lastKey) {
				const encoded = await fetchRoute(from, destination, controller.signal)
				if (cancelled) return
				const points = encoded ? decodePolyline(encoded) : []
				if (points.length >= 2) {
					lastKey = key
					const data = lineFeature(points)
					const source = map.getSource('courier-route')
					if (source) source.setData(data)
					else {
						map.addSource('courier-route', { type: 'geojson', data })
						map.addLayer({
							id: 'courier-route-line',
							type: 'line',
							source: 'courier-route',
							layout: { 'line-join': 'round', 'line-cap': 'round' },
							paint: {
								'line-color': '#f6339a',
								'line-width': 4,
								'line-opacity': 0.85,
							},
						})
					}
				}
			}
			if (!cancelled)
				timer = setTimeout(() => {
					void refresh()
				}, 60_000)
		}
		void refresh()
		return () => {
			cancelled = true
			clearTimeout(timer)
			controller.abort()
		}
	}, [active, ready, hasCourier, destination])

	if (!active)
		return (
			<div className="h-80 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
				<Bicycle size={32} className="text-gray-400 mb-4" />
				<p className="font-DanaMedium text-gray-400 dark:text-gray-500">
					{t['dash.orderDetail.waitingCourier']}
				</p>
			</div>
		)

	return (
		<div className="space-y-2">
			{NESHAN_KEY && hasLocation && !failed ? (
				<>
					<div
						ref={containerRef}
						className="relative w-full h-80 rounded-xl overflow-hidden border border-gray-300 dark:border-white/10"
					/>
					<MapBrowserNote />
				</>
			) : (
				<p className="p-4 text-sm text-gray-500 dark:text-gray-400">
					{t[hasLocation ? 'map.unavailable' : 'map.waitingLocation']}
				</p>
			)}
			{!courier && hasLocation && (
				<p className="text-xs text-gray-500 dark:text-gray-400">
					{t['map.waitingLocation']}
				</p>
			)}
			{courier && (
				<p className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">
					{courier.lat.toFixed(6)}, {courier.lng.toFixed(6)}
				</p>
			)}
			{destination && (
				<div className="flex flex-wrap gap-3 text-xs text-primary dark:text-dark-primary">
					<a
						href={neshanViewUrl(destination.lat, destination.lng)}
						target="_blank"
						rel="noopener noreferrer"
					>
						{t['map.viewDestination']}
					</a>
					{/* stage-98 — مسیریابی با مبدأِ صریح = موقعیتِ زندهٔ خودِ پیک
                                            (server-fed — بدونِ GPS در دستگاهِ مشتری) و مقصد = آدرسِ مشتری؛
                                            مبدأی که نشان از کاربر می‌پرسید دیگر خالی نیست. تا نخستین
                                            ارسالِ موقعیتِ پیک (پیامِ «در انتظار موقعیت پیک») لینکِ
                                            مسیر معنایی ندارد (مسیرِ «مشتری تا خانه‌ی خودش»!) و پنهان است. */}
					{courier && (
						<a
							href={neshanRouteFromUrl(
								courier.lat,
								courier.lng,
								destination.lat,
								destination.lng,
							)}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t['map.routeDestination']}
						</a>
					)}
				</div>
			)}
		</div>
	)
})
