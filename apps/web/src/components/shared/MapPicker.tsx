// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/shared/MapPicker.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر فاز-۲:
//   • SDK جدید نشان (MapLibre) به‌جای OpenLayers قدیمی (v4.6.2)
//   • آدرس معکوس (Reverse Geocoding) زیر نقشه — از API خود سرور
//     (کلید service نشان هرگز وارد باندل وب نمی‌شود)
//   • کلید: VITE_NESHAN_MAP_KEY (جدید) یا VITE_NESHAN_API_KEY (قدیمی)
// ═══════════════════════════════════════════════════════════════

// src/components/shared/MapPicker.tsx
import { memo, useRef, useEffect, useState } from 'react'
import { useI18nSafe } from '#/i18n'
import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'
import { MapBrowserNote } from '#/components/shared/MapBrowserNote'
import { fetchWithTimeout } from '#/lib/api-fetch'
import {
	loadNeshanSdk,
	NESHAN_KEY,
	NESHAN_STYLE,
	type NeshanMap,
	type NeshanMarker,
} from '#/lib/neshan-sdk'
import { normalizeMapPoint, validMapPoint } from '#/utils/mapGeometry'
import { useMapPoint } from '#/hooks/shared/useMapPoint'

interface MapPickerProps {
	/** مختصات انتخاب‌شده (تهی = هنوز انتخاب نشده) */
	value: { lat: number; lng: number } | null
	onChange: (coords: { lat: number; lng: number }) => void
	onValidityChange?: (valid: boolean) => void
}

function manualPoint(lat: string, lng: string) {
	if (!lat.trim() || !lng.trim()) return null
	return validMapPoint({ lat: Number(lat), lng: Number(lng) })
}

/**
 * پشتیبان دستی مختصات وقتی کلید نقشه تنظیم نشده است.
 * محدوده‌ها مثل API: lat ±90 / lng ±180.
 */
const ManualCoordsFallback = memo(function ManualCoordsFallback({
	value,
	onChangeRef,
	unavailable,
	onValidityChange,
}: {
	value: { lat: number; lng: number } | null
	onChangeRef: React.RefObject<(coords: { lat: number; lng: number }) => void>
	unavailable?: boolean
	onValidityChange?: (valid: boolean) => void
}) {
	const { t } = useI18nSafe()
	// درفت محلی — تا پاک‌کردن/تایپ جزئی وسط کار، مقدار والد را نلرزاند
	const lat = value?.lat
	const lng = value?.lng
	const [latDraft, setLatDraft] = useState(lat === undefined ? '' : String(lat))
	const [lngDraft, setLngDraft] = useState(lng === undefined ? '' : String(lng))
	const valid = manualPoint(latDraft, lngDraft) !== null

	useEffect(() => {
		onValidityChange?.(valid)
	}, [onValidityChange, valid])

	useEffect(() => {
		setLatDraft(lat === undefined ? '' : String(lat))
		setLngDraft(lng === undefined ? '' : String(lng))
	}, [lat, lng])

	const push = (lat: string, lng: string) => {
		const point = manualPoint(lat, lng)
		onValidityChange?.(point !== null)
		if (point) onChangeRef.current(point)
	}

	return (
		<div className="space-y-3">
			<div className="text-sm text-gray-600 dark:text-gray-300 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl p-4 leading-relaxed">
				{t[unavailable ? 'map.unavailable' : 'map.noKeyWarning']}
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<p className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-1">
						{t['map.lat']}
					</p>
					<input
						type="number"
						aria-label={t['map.lat']}
						required
						aria-invalid={!valid}
						inputMode="decimal"
						dir="ltr"
						value={latDraft}
						onChange={(e) => {
							setLatDraft(e.target.value)
							push(e.target.value, lngDraft)
						}}
						placeholder="37.4822"
						step="any"
						min="-90"
						max="90"
						className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none text-sm text-gray-800 dark:text-white"
					/>
				</div>
				<div>
					<p className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-1">
						{t['map.lng']}
					</p>
					<input
						type="number"
						aria-label={t['map.lng']}
						required
						aria-invalid={!valid}
						inputMode="decimal"
						dir="ltr"
						value={lngDraft}
						onChange={(e) => {
							setLngDraft(e.target.value)
							push(latDraft, e.target.value)
						}}
						placeholder="49.4418"
						step="any"
						min="-180"
						max="180"
						className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none text-sm text-gray-800 dark:text-white"
					/>
				</div>
			</div>
			{!valid && (
				<output className="block text-xs text-red-600 dark:text-red-400">
					{t['map.invalidCoordinates']}
				</output>
			)}
			{value && valid && (
				<p
					className="text-xs text-green-600 dark:text-green-400 font-DanaMedium"
					dir="ltr"
				>
					✓ {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
				</p>
			)}
		</div>
	)
})

// ═══ فاز-۲ — نقشه‌ی واقعی نشان (SDK جدید MapLibre) ═══
// بارگذاری از CDN (UMD) — بدون تغییر package.json / bun.lock:
//   https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js
// قرارداد نسخه‌ی UMD: مقدار از window.maplibregl.default خوانده می‌شود.

const DEFAULT_CENTER = { lat: 37.4822056, lng: 49.4418273 }

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

/** آدرس معکوس از API خودِ سرور (پروکسی نشان با کلید service) — best-effort */
async function reverseGeocode(
	lat: number,
	lng: number,
	signal: AbortSignal,
): Promise<string | null> {
	try {
		const token = getAccessToken()
		const res = await fetchWithTimeout(
			`${apiBase()}/geo/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`,
			{
				headers: token ? { authorization: `Bearer ${token}` } : undefined,
				credentials: 'include',
				signal,
			},
			{ timeoutMs: 6_000 },
		)
		const body = (await res.json()) as { available?: boolean; address?: string }
		return res.ok && body.available === true && typeof body.address === 'string'
			? body.address
			: null
	} catch {
		return null
	}
}

export const MapPicker = memo(function MapPicker({
	value,
	onChange,
	onValidityChange,
}: MapPickerProps) {
	const { t } = useI18nSafe()
	const containerRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<NeshanMap | null>(null)
	const markerRef = useRef<NeshanMarker | null>(null)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const selected = useMapPoint(value)
	const valueRef = useRef(selected)
	valueRef.current = selected
	const [address, setAddress] = useState<string | null>(null)
	const [addressLoading, setAddressLoading] = useState(false)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		if (!NESHAN_KEY || failed) return
		let cancelled = false
		const timer = setTimeout(() => {
			if (!cancelled) setFailed(true)
		}, 20_000)
		void loadNeshanSdk()
			.then((sdk) => {
				if (cancelled || !containerRef.current) return
				// Props can change while the CDN is loading (e.g. hydrating an address).
				const point = valueRef.current
				const center = point ?? DEFAULT_CENTER
				const map = new sdk.Map({
					container: containerRef.current,
					style: NESHAN_STYLE,
					center: [center.lng, center.lat],
					zoom: point ? 15 : 12,
					minZoom: 2,
					maxZoom: 21,
					trackResize: true,
					apiKey: NESHAN_KEY,
					rtl: { lazy: false },
				})
				mapRef.current = map
				map.on('load', () => {
					clearTimeout(timer)
				})
				const pinEl = document.createElement('div')
				pinEl.style.cssText = 'width:32px;height:32px;'
				pinEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="${pinColor()}" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`
				const marker = new sdk.Marker({ element: pinEl, anchor: 'bottom' })
				markerRef.current = marker
				// An unselected form must not show a pin at a made-up address.
				if (point) marker.setLngLat(point).addTo(map)
				map.on('click', (event) => {
					if (cancelled) return
					const coords = normalizeMapPoint(event.lngLat)
					if (!coords) return
					onChangeRef.current(coords)
				})
			})
			.catch(() => {
				clearTimeout(timer)
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
			clearTimeout(timer)
			markerRef.current?.remove()
			mapRef.current?.remove()
			markerRef.current = null
			mapRef.current = null
		}
	}, [failed])

	useEffect(() => {
		const map = mapRef.current
		const marker = markerRef.current
		if (!map || !marker) return
		if (selected) {
			marker.setLngLat(selected).addTo(map)
			map.jumpTo({ center: [selected.lng, selected.lat] })
		} else marker.remove()
	}, [selected])

	// The selected value owns both the displayed address and its request. Cleanup
	// also covers external edits, closing the editor and out-of-order responses.
	useEffect(() => {
		setAddress(null)
		setAddressLoading(false)
		if (!selected) return
		const controller = new AbortController()
		const timer = setTimeout(() => {
			setAddressLoading(true)
			void reverseGeocode(selected.lat, selected.lng, controller.signal).then(
				(next) => {
					if (controller.signal.aborted) return
					setAddress(next)
					setAddressLoading(false)
				},
			)
		}, 400)
		return () => {
			clearTimeout(timer)
			controller.abort()
		}
	}, [selected])

	if (!NESHAN_KEY || failed) {
		return (
			<ManualCoordsFallback
				value={selected}
				onChangeRef={onChangeRef}
				unavailable={failed}
				onValidityChange={onValidityChange}
			/>
		)
	}

	return (
		<div>
			<p className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
				{t['map.pickLocation']}
			</p>
			{/* z-0 → زمینه stacking محلی؛ z-index های داخلی SDK به مودال نشت نمی‌کنند */}
			<div
				ref={containerRef}
				className="relative w-full h-48 rounded-xl overflow-hidden border border-gray-300 dark:border-white/10 z-0"
			/>
			{/* stage-59 — حداقل نسخه‌ی مرورگر برای تایل‌های نقشه (DecompressionStream) */}
			<MapBrowserNote />
			{selected && (
				<p
					className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium"
					dir="ltr"
				>
					{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
				</p>
			)}
			{/* فاز-۲ — آدرس معکوس نشان (از API خود سرور) */}
			{(addressLoading || address) && (
				<p className="text-xs text-gray-600 dark:text-gray-300 mt-1 font-DanaMedium bg-gray-50 dark:bg-white/5 rounded-lg px-3 py-2 leading-relaxed">
					{addressLoading
						? t['map.loadingAddress']
						: `${t['map.addressFound']} ${address}`}
				</p>
			)}
		</div>
	)
})
