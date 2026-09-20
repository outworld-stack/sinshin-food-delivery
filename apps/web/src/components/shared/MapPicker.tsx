// src/components/shared/MapPicker.tsx
import { memo, useRef, useEffect } from 'react'

interface MapPickerProps {
  /** مختصات انتخاب‌شده (تهی = هنوز انتخاب نشده) */
  value: { lat: number; lng: number } | null
  onChange: (coords: { lat: number; lng: number }) => void
}

// ═══ phase-3 — نقشه‌ی واقعی نشان ═══
// قبلاً: مختصات از «پیکسل کلیک» ساخته می‌شد → آدرس‌های آشغال در DB.
// حالا: SDK نشان (فورک OpenLayers) + کلیک واقعی → lonLat واقعی.

// ⚠️ نسخه‌ی SDK را از Getting Started نشان چک کن — الگوی کد مستقل از نسخه است
const SDK_JS = 'https://cdn.neshan.org/sdk/ol/v4.6.2/ol.js'
const SDK_CSS = 'https://cdn.neshan.org/sdk/ol/v4.6.2/ol.css'

const NESHAN_KEY = import.meta.env.VITE_NESHAN_API_KEY as string | undefined
const DEFAULT_CENTER = { lat: 35.6892, lng: 51.389 } // تهران

let sdkPromise: Promise<void> | null = null
function loadNeshanSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    if ((window as unknown as { ol?: unknown }).ol) return resolve()
    const script = document.createElement('script')
    script.src = SDK_JS
    script.async = true
    script.onload = () => resolve()
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

export const MapPicker = memo(function MapPicker({ value, onChange }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<{ setTarget(t: unknown): void } | null>(null)
  const markerRef = useRef<{ setPosition(p: number[] | null): void } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // init — یک بار؛ SDK بارگذاری می‌شود و نقشه ساخته می‌شود (SSR-safe: فقط کلاینت)
  useEffect(() => {
    if (!NESHAN_KEY) return // بدون کلید، پیام هشدار رندر می‌شود — مختصات فیک هرگز تولید نمی‌شود
    let cancelled = false

    void loadNeshanSdk()
      .then(() => {
        if (cancelled || !containerRef.current) return
        const ol = (window as unknown as { ol: any }).ol

        const center = value ?? DEFAULT_CENTER
        const map = new ol.Map({
          target: containerRef.current,
          key: NESHAN_KEY,
          maptype: 'neshan',
          view: new ol.View({
            center: ol.proj.fromLonLat([center.lng, center.lat]),
            zoom: value ? 15 : 12,
          }),
        })

        // پین — ol.Overlay (بدون position رندر نمی‌شود)
        const pinEl = document.createElement('div')
        pinEl.style.cssText = 'width:32px;height:32px;transform:translate(-50%,-100%);'
        pinEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="${pinColor()}" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`
        const marker = new ol.Overlay({ element: pinEl, positioning: 'bottom-center', stopEvent: false })
        if (value) marker.setPosition(ol.proj.fromLonLat([value.lng, value.lat]))
        map.addOverlay(marker)

        // کلیک → مختصات «واقعی» (lonLat) + جابه‌جایی پین
        map.on('click', (e: { coordinate: number[] }) => {
          const [lng, lat] = ol.proj.toLonLat(e.coordinate)
          marker.setPosition(e.coordinate)
          onChangeRef.current({ lat, lng })
        })

        mapRef.current = map
        markerRef.current = marker
      })
      .catch((err) => console.error('[MapPicker]', err))

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.setTarget(undefined) // تخریب تمیز OL
        mapRef.current = null
        markerRef.current = null
      }
    }
    // فقط init — value اولیه در closure گرفته شد؛ تغییرات بعدی از effect پایین
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // تغییر value از بیرون (مودال ویرایش با مختصات موجود) → پین جابه‌جا شود
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !value) return
    const ol = (window as unknown as { ol: any }).ol
    markerRef.current.setPosition(ol.proj.fromLonLat([value.lng, value.lat]))
  }, [value?.lat, value?.lng])

  if (!NESHAN_KEY) {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-300 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl p-4 leading-relaxed">
        کلید نقشه‌ی نشان تنظیم نشده — <code dir="ltr">VITE_NESHAN_API_KEY</code> را در <code dir="ltr">apps/web/.env</code> بگذار (ثبت‌نام: platform.neshan.org)
      </div>
    )
  }

  return (
    <div>
      <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">انتخاب موقعیت روی نقشه</label>
      {/* z-0 → زمینه stacking محلی؛ z-index های داخلی OpenLayers به مودال نشت نمی‌کنند */}
      <div
        ref={containerRef}
        className="relative w-full h-48 rounded-xl overflow-hidden border border-gray-300 dark:border-white/10 z-0"
      />
      {value && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium" dir="ltr">
          {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
        </p>
      )}
    </div>
  )
})