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

interface MapPickerProps {
  /** مختصات انتخاب‌شده (تهی = هنوز انتخاب نشده) */
  value: { lat: number; lng: number } | null
  onChange: (coords: { lat: number; lng: number }) => void
}

/**
 * پشتیبان دستی مختصات وقتی کلید نقشه تنظیم نشده است.
 * محدوده‌ها مثل API: lat ±90 / lng ±180.
 */
const ManualCoordsFallback = memo(function ManualCoordsFallback({
  value,
  onChangeRef,
}: {
  value: { lat: number; lng: number } | null
  onChangeRef: React.RefObject<(coords: { lat: number; lng: number }) => void>
}) {
  const { t } = useI18nSafe()
  // درفت محلی — تا پاک‌کردن/تایپ جزئی وسط کار، مقدار والد را نلرزاند
  const [latDraft, setLatDraft] = useState(value ? String(value.lat) : '')
  const [lngDraft, setLngDraft] = useState(value ? String(value.lng) : '')

  useEffect(() => {
    setLatDraft(value ? String(value.lat) : '')
    setLngDraft(value ? String(value.lng) : '')
  }, [value?.lat, value?.lng])

  const push = (lat: string, lng: string) => {
    const la = Number(lat)
    const ln = Number(lng)
    if (
      lat.trim() !== '' && lng.trim() !== '' &&
      Number.isFinite(la) && Number.isFinite(ln) &&
      Math.abs(la) <= 90 && Math.abs(ln) <= 180
    ) {
      onChangeRef.current({ lat: la, lng: ln })
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600 dark:text-gray-300 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl p-4 leading-relaxed">
        {t['map.noKeyWarning']}{' '}
        <code dir="ltr">VITE_NESHAN_MAP_KEY</code> را در <code dir="ltr">.env</code> ریشه بگذار
        (کلید «web» از پنل نشان — platform.neshan.org)
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-1">
            {t['map.lat']}
          </label>
          <input
            type="number"
            inputMode="decimal"
            dir="ltr"
            value={latDraft}
            onChange={(e) => {
              setLatDraft(e.target.value)
              push(e.target.value, lngDraft)
            }}
            placeholder="37.4822"
            step="0.000001"
            min="-90"
            max="90"
            className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none text-sm text-gray-800 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-1">
            {t['map.lng']}
          </label>
          <input
            type="number"
            inputMode="decimal"
            dir="ltr"
            value={lngDraft}
            onChange={(e) => {
              setLngDraft(e.target.value)
              push(latDraft, e.target.value)
            }}
            placeholder="49.4418"
            step="0.000001"
            min="-180"
            max="180"
            className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none text-sm text-gray-800 dark:text-white"
          />
        </div>
      </div>
      {value && (
        <p className="text-xs text-green-600 dark:text-green-400 font-DanaMedium" dir="ltr">
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

const SDK_JS = 'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.umd.js'
const SDK_CSS = 'https://static.neshan.org/sdk/maplibre/5.24.3/neshan-maplibre-sdk.css'
const MAP_STYLE = 'https://static.neshan.org/sdk/maplibre/styles/light.json'

// فاز-۲: کلید web جدید + سازگاری با نام قدیمی
const NESHAN_KEY =
  (import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ||
  (import.meta.env.VITE_NESHAN_API_KEY as string | undefined)
const DEFAULT_CENTER = { lat: 37.4822056, lng: 49.4418273 } // رستوران سین‌شین — بندرانزلی

/** شکل loose سمت SDK — UMD بدون تایپ است */
interface LooseMap {
  remove(): void
  on(event: string, handler: (e: { lngLat: { lat: number; lng: number } }) => void): void
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
        reject(new Error('SDK نقشه‌ی نشان لود شد اما window.maplibregl.default خالی است'))
      }
    }
    script.onerror = () => {
      sdkPromise = null // دفعه‌ی بعد دوباره تلاش شود
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
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
    return v || '#f6339a'
  } catch {
    return '#f6339a'
  }
}

/** آدرس معکوس از API خودِ سرور (پروکسی نشان با کلید service) — best-effort */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const token = getAccessToken()
    const res = await fetch(
      `${apiBase()}/geo/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`,
      {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
        signal: AbortSignal.timeout(6_000),
      },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { available?: boolean; address?: string }
    return body.available === true && body.address ? body.address : null
  } catch {
    return null
  }
}

export const MapPicker = memo(function MapPicker({ value, onChange }: MapPickerProps) {
  const { t } = useI18nSafe()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LooseMap | null>(null)
  const markerRef = useRef<LooseMarker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [address, setAddress] = useState<string | null>(null)
  const [addressLoading, setAddressLoading] = useState(false)

  // init — یک بار؛ SDK بارگذاری می‌شود و نقشه ساخته می‌شود (SSR-safe: فقط کلاینت)
  useEffect(() => {
    if (!NESHAN_KEY) return // بدون کلید، پیام هشدار رندر می‌شود — مختصات فیک هرگز تولید نمی‌شود
    let cancelled = false

    void loadNeshanSdk()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return

        const center = value ?? DEFAULT_CENTER
        // ⚠️ نکته‌ی مستندات نشان: apiKey به‌ازای «صفحه» ذخیره می‌شود — در هر
        // صفحه فقط یک کلید نقشه استفاده شود (SDK خودش مدیریت می‌کند).
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: [center.lng, center.lat],
          zoom: value ? 15 : 12,
          minZoom: 2,
          maxZoom: 21,
          trackResize: true,
          apiKey: NESHAN_KEY,
          // فاز-۲ — RTL فارسی از همان ابتدا (lazy:false — نقشه فارسی‌محور است)
          rtl: { lazy: false },
        })

        // پین — element سفارشی (همان SVG قبلی)
        const pinEl = document.createElement('div')
        pinEl.style.cssText = 'width:32px;height:32px;transform:translate(-50%,-100%);'
        pinEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="${pinColor()}" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`
        const marker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
          .setLngLat({ lat: center.lat, lng: center.lng })
          .addTo(map)

        // کلیک → مختصات «واقعی» + جابه‌جایی پین + آدرس معکوس (debounce سبک)
        let addrTimer: ReturnType<typeof setTimeout> | null = null
        map.on('click', (e) => {
          const { lat, lng } = e.lngLat
          marker.setLngLat({ lat, lng })
          onChangeRef.current({ lat, lng })
          setAddress(null)
          if (addrTimer) clearTimeout(addrTimer)
          addrTimer = setTimeout(() => {
            setAddressLoading(true)
            void reverseGeocode(lat, lng)
              .then((a) => setAddress(a))
              .finally(() => setAddressLoading(false))
          }, 400)
        })

        mapRef.current = map
        markerRef.current = marker
      })
      .catch((err) => console.error('[MapPicker]', err))

    return () => {
      cancelled = true
      // تخریب تمیز MapLibre
      try {
        markerRef.current?.remove()
        mapRef.current?.remove()
      } catch {
        /* نقشه نیمه‌ساخته — سکوت */
      }
      mapRef.current = null
      markerRef.current = null
    }
    // فقط init — value اولیه در closure گرفته شد؛ تغییرات بعدی از effect پایین
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // تغییر value از بیرون (مودال ویرایش با مختصات موجود) → پین جابه‌جا شود
  useEffect(() => {
    if (!markerRef.current || !value) return
    markerRef.current.setLngLat({ lat: value.lat, lng: value.lng })
  }, [value?.lat, value?.lng])

  if (!NESHAN_KEY) {
    return <ManualCoordsFallback value={value} onChangeRef={onChangeRef} />
  }

  return (
    <div>
      <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">{t['map.pickLocation']}</label>
      {/* z-0 → زمینه stacking محلی؛ z-index های داخلی SDK به مودال نشت نمی‌کنند */}
      <div
        ref={containerRef}
        className="relative w-full h-48 rounded-xl overflow-hidden border border-gray-300 dark:border-white/10 z-0"
      />
      {value && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium" dir="ltr">
          {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
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
