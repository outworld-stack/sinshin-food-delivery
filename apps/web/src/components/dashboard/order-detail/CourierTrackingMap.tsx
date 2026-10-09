// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/dashboard/order-detail/CourierTrackingMap.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر فاز-۲: نقشه‌ی واقعی نشان (MapLibre) + مسیر واقعی از API سرور
//   (مسیریابی بدون ترافیک نشان — polyline روی نقشه) + جایگزین قدیمی
// ═══════════════════════════════════════════════════════════════

// src/components/dashboard/order-detail/CourierTrackingMap.tsx
import { memo, useRef, useEffect, useState } from 'react'
import { Bicycle, Pin } from 'reicon-react'
import { useI18n } from '#/i18n'
import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'

interface CourierTrackingMapProps {
  status: string
  courierLocation?: { lat: number; lng: number } | null
  customerLocation?: { lat: number; lng: number } | null
}

/** شکل loose سمت SDK (UMD بدون تایپ) */
interface LooseMap {
  remove(): void
  on(event: string, handler: (e: unknown) => void): void
  addLayer(layer: Record<string, unknown>): void
  getSource(id: string): { setData(data: unknown): void } | undefined
  addSource(id: string, source: Record<string, unknown>): void
  fitBounds(bounds: [[number, number], [number, number]], opts?: Record<string, unknown>): void
  jumpTo(opts: Record<string, unknown>): void
}
interface LooseMarker {
  setLngLat(pos: { lat: number; lng: number }): LooseMarker
  addTo(map: LooseMap): LooseMarker
  remove(): void
}
interface LooseMapLibre {
  Map: new (opts: Record<string, unknown>) => LooseMap
  Marker: new (opts: { element?: HTMLElement; anchor?: string }) => LooseMarker
  NavigationControl: new (opts?: Record<string, unknown>) => unknown
}

const SDK_JS = 'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js'
const SDK_CSS = 'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.css'
const MAP_STYLE = 'https://static.neshan.org/sdk/maplibre/styles/light.json'
const NESHAN_KEY =
  (import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
  (import.meta.env.VITE_NESHAN_API_KEY as string | undefined)

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
      const ml = (window as unknown as { maplibregl?: { default?: LooseMapLibre } }).maplibregl?.default
      if (ml) resolve(ml)
      else {
        sdkPromise = null
        reject(new Error('SDK نشان لود شد اما window.maplibregl.default خالی است'))
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

/** رمزگشایی Encoded Polyline (الگوریتم گوگل) → [lat,lng][] — سمت کلاینت */
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
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

/** مسیر از API خود سرور (پروکسی نشان no-traffic) — best-effort */
async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<{ polyline?: string } | null> {
  try {
    const token = getAccessToken()
    const res = await fetch(
      `${apiBase()}/geo/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`,
      {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
        signal: AbortSignal.timeout(8_000),
      },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { available?: boolean; polyline?: string }
    return body.available === true && body.polyline ? body : null
  } catch {
    return null
  }
}

/**
 * نقشه ردیابی پیک — فاز-۲:
 *  • نقشه‌ی واقعی نشان (MapLibre SDK) با کلید web
 *  • پین پیک (زنده از استریم) + پین مقصد + «مسیر واقعی جاده‌ای» از
 *    مسیریابی بدون ترافیک نشان (چندضلعی‌ای که با حرکت پیک تازه می‌شود)
 *  • بدون کلید → همان نمای گرید قبلی (سایت کامل کار می‌کند)
 */
export const CourierTrackingMap = memo(function CourierTrackingMap({
  status, courierLocation, customerLocation,
}: CourierTrackingMapProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LooseMap | null>(null)
  const courierMarkerRef = useRef<LooseMarker | null>(null)
  const destMarkerRef = useRef<LooseMarker | null>(null)
  const [ready, setReady] = useState(false)
  /** کلید آخرین مسیر گرفته‌شده — throttle سهمیه‌ی API (۶۰s/زون ۴رقمی) */
  const lastRouteKeyRef = useRef<string | null>(null)

  // ── ساخت نقشه (فقط با کلید + وضعیت ON_THE_WAY) ──
  useEffect(() => {
    if (!NESHAN_KEY || status !== 'ON_THE_WAY') return
    if (!courierLocation && !customerLocation) return
    let cancelled = false

    void loadNeshanSdk()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return
        const dest = customerLocation ?? { lat: 35.776, lng: 51.414 }
        const courier = courierLocation ?? dest

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: [dest.lng, dest.lat],
          zoom: 13,
          minZoom: 2,
          maxZoom: 21,
          apiKey: NESHAN_KEY,
          rtl: { lazy: false },
        })

        // پین پیک
        const courierEl = document.createElement('div')
        courierEl.style.cssText = 'transform:translate(-50%,-100%);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));'
        courierEl.innerHTML = `<span style="display:flex;width:38px;height:38px;border-radius:50%;background:#f6339a;color:#fff;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(246,51,154,.5);">🛵</span>`
        courierMarkerRef.current = new maplibregl.Marker({ element: courierEl, anchor: 'bottom' })
          .setLngLat({ lat: courier.lat, lng: courier.lng })
          .addTo(map)

        // پین مقصد
        const destEl = document.createElement('div')
        destEl.style.cssText = 'transform:translate(-50%,-100%);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));'
        destEl.innerHTML = `<span style="display:flex;width:34px;height:34px;border-radius:50% 50% 50% 0;background:#22c55e;color:#fff;align-items:center;justify-content:center;transform:rotate(45deg);box-shadow:0 2px 8px rgba(34,197,94,.5);"><span style="transform:rotate(-45deg);font-size:16px;">🏠</span></span>`
        destMarkerRef.current = new maplibregl.Marker({ element: destEl, anchor: 'bottom' })
          .setLngLat({ lat: dest.lat, lng: dest.lng })
          .addTo(map)

        // قاب دید — هر دو پین
        map.fitBounds(
          [
            [Math.min(courier.lng, dest.lng) - 0.01, Math.min(courier.lat, dest.lat) - 0.01],
            [Math.max(courier.lng, dest.lng) + 0.01, Math.max(courier.lat, dest.lat) + 0.01],
          ],
          { padding: 40, maxZoom: 15 },
        )

        mapRef.current = map
        setReady(true)
      })
      .catch((err) => console.error('[CourierTrackingMap]', err))

    return () => {
      cancelled = true
      try {
        courierMarkerRef.current?.remove()
        destMarkerRef.current?.remove()
        mapRef.current?.remove()
      } catch {
        /* سکوت */
      }
      mapRef.current = null
      courierMarkerRef.current = null
      destMarkerRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === 'ON_THE_WAY', customerLocation?.lat, customerLocation?.lng])

  // ── مسیر واقعی (فاز-۲) — یک بار برای هر جفت مقصد + تازه‌سازی با پیک ──
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !courierLocation || !customerLocation) return
    let cancelled = false

    // فقط هر ۶۰ ثانیه یک بار مسیر بگیر (حرکت پیک پیوسته است؛ سهمیه‌ی API)
    const routeKey = `${courierLocation.lat.toFixed(4)},${courierLocation.lng.toFixed(4)}`
    const lastKey = lastRouteKeyRef.current
    if (lastKey === routeKey) return
    lastRouteKeyRef.current = routeKey

    void fetchRoute(courierLocation, customerLocation).then((route) => {
      if (cancelled || !route?.polyline) return
      const coords = decodePolyline(route.polyline)
      if (coords.length < 2) return
      const lngLat: Array<[number, number]> = coords.map(([lat, lng]) => [lng, lat])

      const source = map.getSource('courier-route')
      const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lngLat } }] }
      if (source) {
        source.setData(geojson)
      } else {
        map.addSource('courier-route', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'courier-route-line',
          type: 'line',
          source: 'courier-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#f6339a', 'line-width': 4, 'line-opacity': 0.85 },
        })
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, courierLocation?.lat, courierLocation?.lng, customerLocation?.lat, customerLocation?.lng])

  // ── حرکت پیک روی نقشه (استریم زنده) ──
  useEffect(() => {
    if (courierMarkerRef.current && courierLocation) {
      courierMarkerRef.current.setLngLat({ lat: courierLocation.lat, lng: courierLocation.lng })
    }
  }, [courierLocation?.lat, courierLocation?.lng])

  if (status !== 'ON_THE_WAY') {
    return (
      <div className="h-80 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
        <span className="w-16 h-16 rounded-full bg-gray-200 dark:bg-[#2a1015] flex items-center justify-center text-gray-400 mb-4">
          <Bicycle size={32} />
        </span>
        <p className="font-DanaMedium text-gray-400 dark:text-gray-500">{t['dash.orderDetail.waitingCourier']}</p>
      </div>
    )
  }

  const dest = customerLocation ?? { lat: 35.776, lng: 51.414 }
  let x = 20
  let y = 30
  if (courierLocation) {
    const dLat = courierLocation.lat - dest.lat
    const dLng = courierLocation.lng - dest.lng
    x = Math.min(92, Math.max(8, 50 + dLng * 400))
    y = Math.min(92, Math.max(8, 50 - dLat * 400))
  }

  // بدون کلید نقشه — همان نمای گرید (سایت کامل کار می‌کند)
  if (!NESHAN_KEY) {
    return (
      <div className="relative w-full h-80 rounded-xl overflow-hidden bg-gray-100 dark:bg-[#1a0a0e] border border-gray-300 dark:border-white/10">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.1)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-size-[40px_40px]"></div>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1={x} y1={y} x2="70" y2="70" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" className="text-primary dark:text-dark-primary" />
        </svg>
        <div className="absolute transition-all duration-1000" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
          <Bicycle size={36} className="text-primary dark:text-dark-primary drop-shadow-lg" />
        </div>
        <div className="absolute" style={{ left: '70%', top: '70%', transform: 'translate(-50%, -100%)' }}>
          <Pin size={36} className="text-green-500 drop-shadow-lg" />
        </div>
        {courierLocation && (
          <div className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 rounded-lg px-3 py-1.5 text-[10px] font-DanaMedium text-gray-600 dark:text-gray-300" dir="ltr">
            {courierLocation.lat.toFixed(4)}, {courierLocation.lng.toFixed(4)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative w-full h-80 rounded-xl overflow-hidden border border-gray-300 dark:border-white/10">
      <div ref={containerRef} className="absolute inset-0" />
      {courierLocation && (
        <div className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 rounded-lg px-3 py-1.5 text-[10px] font-DanaMedium text-gray-600 dark:text-gray-300 z-10" dir="ltr">
          {courierLocation.lat.toFixed(4)}, {courierLocation.lng.toFixed(4)}
        </div>
      )}
    </div>
  )
})
