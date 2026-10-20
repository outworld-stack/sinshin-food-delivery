// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/infra/maps/neshan.service.ts
// ═══════════════════════════════════════════════════════════════

// src/infra/maps/neshan.service.ts
/**
 * فاز-۲ — کلاینت سرویس‌های REST نشان (https://api.neshan.org).
 *
 * کلید «service» (NESHAN_SERVICE_API_KEY) فقط همین‌جاست — هرگز به
 * باندل وب نمی‌رود؛ فرانت نقشه را با کلید web جدا (MapLibre SDK) می‌سازد.
 *
 * سرویس‌های فعال (تیک‌خورده در اشتراک):
 *  • مسیریابی بدون ترافیک  — GET /v4/direction/no-traffic
 *  • ماتریس فاصله (ترافیک/بدون ترافیک) — GET /v1/distance-matrix[/no-traffic]
 *  • تبدیل نقطه به آدرس — GET /v5/reverse
 *
 * ضد-کرش:
 *  • هر متد در صورت هر خطایی «null» برمی‌گرداند — کالر به مسیر
 *    جایگزین (هیورساین / خط مستقیم) برمی‌گردد؛ سایت هرگز به نشان وابسته نیست.
 *  • کش حافظه‌ای TTL-دار (پیش‌فرض ۵ دقیقه) — صرفه‌جویی در سهمیه‌ی API.
 *  • سقف‌های ورودی (تعداد نقاط ماتریس) قبل از فراخوانی.
 */

import type { AppConfig } from '#/infra/config/env'

const BASE = 'https://api.neshan.org'

export interface LatLng {
  lat: number
  lng: number
}

export interface NeshanRoute {
  /** مسافت بهترین مسیر (متر) */
  distanceMeters: number
  /** زمان سفر (ثانیه) */
  durationSeconds: number
  /** مسیر رمزگشایی‌شده — [lat, lng] به ترتیب مسیر */
  coordinates: Array<[number, number]>
  /** خلاصه‌ی نام خیابان‌ها */
  summary: string
  /** polyline خام (encode شده) — برای پاس مستقیم به کلاینت */
  overviewPolyline: string
}

export interface NeshanReverseResult {
  formattedAddress: string
  routeName: string
  neighbourhood: string | null
  city: string
  state: string
  municipalityZone: string | null
  inTrafficZone: boolean
  inOddEvenZone: boolean
}

export interface NeshanMatrixElement {
  status: 'Ok' | 'NoRoute' | 'UnknownError'
  distanceMeters: number | null
  durationSeconds: number | null
}

/** سقف اندازه‌ی ماتریس — محافظ سهمیه‌ی API (مستندات نشان: ۱۰×۱۰) */
const MATRIX_MAX = 10

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class NeshanService {
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  private readonly inFlight = new Map<string, Promise<unknown | null>>()
  private readonly cacheMaxEntries = 2_000

  constructor(private readonly config: AppConfig) {}

  private get hasKey(): boolean {
    return this.config.neshan.serviceApiKey.length > 0
  }

  /** GET با هدر Api-Key + timeout + fail-soft (null) */
  private async get<T>(path: string): Promise<T | null> {
    if (!this.hasKey) return null
    try {
      const res = await Bun.fetch(`${BASE}${path}`, {
        headers: { 'Api-Key': this.config.neshan.serviceApiKey },
        signal: AbortSignal.timeout(this.config.neshan.timeoutMs),
      })
      if (!res.ok) {
        // خطاهای کلید/سهمیه — فقط یک‌بار لاگ (نباشد هر درخواست اسپم)
        if (res.status !== 400) {
          console.warn(`[neshan] ${path.split('?')[0]} → HTTP ${res.status}`)
        }
        return null
      }
      return (await res.json()) as T
    } catch {
      return null
    }
  }

  // ── کش ──

  private cacheGet<T>(key: string): T | null {
    const hit = this.cache.get(key)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return null
    }
    return hit.value as T
  }

  private cacheSet<T>(key: string, value: T): void {
    if (!this.cache.has(key) && this.cache.size >= this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.config.neshan.cacheTtlSeconds * 1000 })
  }

  /** Coalesce identical requests before spending provider quota. Invalid provider
   * payloads must fail as softly as transport errors, and failures remain retryable. */
  private async cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = this.cacheGet<T>(key)
    if (hit !== null) return hit
    const pending = this.inFlight.get(key)
    if (pending) return pending as Promise<T | null>
    const task = (async () => {
      try {
        const value = await load()
        if (value !== null) this.cacheSet(key, value)
        return value
      } catch {
        return null
      }
    })()
    this.inFlight.set(key, task)
    try { return await task } finally { this.inFlight.delete(key) }
  }

  private roundCoord(v: number): string {
    // ۵ رقم اعشار (~۱ متر) — کلید کش پایدار
    return v.toFixed(5)
  }

  // ═══ تبدیل نقطه به آدرس (v5/reverse) ═══

  async reverseGeocode(lat: number, lng: number): Promise<NeshanReverseResult | null> {
    if (!this.isCoord(lat, lng)) return null
    const key = `rev:${this.roundCoord(lat)},${this.roundCoord(lng)}`
    return this.cached(key, async () => {
    interface RawReverse {
      status?: string
      formatted_address?: string
      route_name?: string
      neighbourhood?: string | null
      city?: string
      state?: string
      municipality_zone?: string | null
      in_traffic_zone?: boolean
      in_odd_even_zone?: boolean
    }
    const raw = await this.get<RawReverse>(`/v5/reverse?lat=${lat}&lng=${lng}`)
    if (!raw || raw.status !== 'OK' || typeof raw.formatted_address !== 'string' || !raw.formatted_address.trim()) return null

    const result: NeshanReverseResult = {
      formattedAddress: raw.formatted_address,
      routeName: typeof raw.route_name === 'string' ? raw.route_name : '',
      neighbourhood: typeof raw.neighbourhood === 'string' ? raw.neighbourhood : null,
      city: typeof raw.city === 'string' ? raw.city : '',
      state: typeof raw.state === 'string' ? raw.state : '',
      municipalityZone: typeof raw.municipality_zone === 'string' ? raw.municipality_zone : null,
      inTrafficZone: raw.in_traffic_zone === true,
      inOddEvenZone: raw.in_odd_even_zone === true,
    }
    return result
    })
  }

  // ═══ مسیریابی بدون ترافیک (v4/direction/no-traffic) ═══

  async routeNoTraffic(
    origin: LatLng,
    destination: LatLng,
    opts?: { waypoints?: LatLng[]; alternative?: boolean },
  ): Promise<NeshanRoute | null> {
    if (!this.isCoord(origin.lat, origin.lng) || !this.isCoord(destination.lat, destination.lng)) {
      return null
    }
    const waypoints = opts?.waypoints ?? []
    if (waypoints.length > 5 || waypoints.some((w) => !this.isCoord(w.lat, w.lng))) return null
    const wpStr = waypoints.length > 0
      ? `&waypoints=${encodeURIComponent(waypoints.map((w) => `${w.lat},${w.lng}`).join('|'))}`
      : ''
    const key =
      `route:${this.roundCoord(origin.lat)},${this.roundCoord(origin.lng)}→` +
      `${this.roundCoord(destination.lat)},${this.roundCoord(destination.lng)}${wpStr}:alt=${opts?.alternative === true}`
    return this.cached(key, async () => {
    interface RawRoute {
      routes?: Array<{
        overview_polyline?: { points?: string }
        legs?: Array<{
          summary?: string
          distance?: { value?: number }
          duration?: { value?: number }
        }>
      }>
    }
    const raw = await this.get<RawRoute>(
      `/v4/direction/no-traffic?type=car` +
      `&origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `${wpStr}` +
      `&alternative=${opts?.alternative === true ? 'true' : 'false'}`,
    )
    const r = raw?.routes?.[0]
    if (typeof r?.overview_polyline?.points !== 'string' || !Array.isArray(r.legs) || r.legs.length === 0) return null
    if (r.legs.some((leg) => !nonnegative(leg?.distance?.value) || !nonnegative(leg?.duration?.value))) return null
    const coordinates = decodePolyline(r.overview_polyline.points)
    if (coordinates.length < 2) return null
    const distanceMeters = r.legs.reduce((sum, leg) => sum + leg.distance!.value!, 0)
    const durationSeconds = r.legs.reduce((sum, leg) => sum + leg.duration!.value!, 0)
    if (!nonnegative(distanceMeters) || !nonnegative(durationSeconds)) return null
    const result: NeshanRoute = {
      distanceMeters,
      durationSeconds,
      coordinates,
      summary: r.legs.map((leg) => typeof leg.summary === 'string' ? leg.summary : '').filter(Boolean).join(' — '),
      overviewPolyline: r.overview_polyline.points,
    }
    return result
    })
  }

  // ═══ ماتریس فاصله (v1/distance-matrix[/no-traffic]) ═══

  async distanceMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    opts?: { type?: 'car' | 'motorcycle'; traffic?: boolean },
  ): Promise<NeshanMatrixElement[][] | null> {
    // Never filter/truncate points: doing so silently changes matrix row/column identities.
    if (origins.length === 0 || destinations.length === 0 || origins.length > MATRIX_MAX || destinations.length > MATRIX_MAX ||
      [...origins, ...destinations].some((p) => !this.isCoord(p.lat, p.lng))) return null
    const cleanOrigins = origins
    const cleanDests = destinations

    const type = opts?.type === 'motorcycle' ? 'motorcycle' : 'car'
    const traffic = opts?.traffic === true
    const key =
      `matrix:${type}:${traffic ? 't' : 'n'}:` +
      cleanOrigins.map((p) => `${this.roundCoord(p.lat)},${this.roundCoord(p.lng)}`).join(';') +
      '|' +
      cleanDests.map((p) => `${this.roundCoord(p.lat)},${this.roundCoord(p.lng)}`).join(';')
    return this.cached(key, async () => {
    interface RawMatrix {
      rows?: Array<{
        elements?: Array<{
          status?: string
          distance?: { value?: number }
          duration?: { value?: number }
        }>
      }>
    }
    const path = traffic ? '/v1/distance-matrix' : '/v1/distance-matrix/no-traffic'
    const raw = await this.get<RawMatrix>(
      `${path}?type=${type}` +
      `&origins=${encodeURIComponent(cleanOrigins.map((p) => `${p.lat},${p.lng}`).join('|'))}` +
      `&destinations=${encodeURIComponent(cleanDests.map((p) => `${p.lat},${p.lng}`).join('|'))}`,
    )
    if (!Array.isArray(raw?.rows) || raw.rows.length !== origins.length ||
      raw.rows.some((row) => !Array.isArray(row?.elements) || row.elements.length !== destinations.length)) return null

    const matrix: NeshanMatrixElement[][] = raw.rows.map((row) =>
      (row.elements ?? []).map((el) => ({
        status:
          el?.status === 'Ok' && nonnegative(el.distance?.value) && nonnegative(el.duration?.value)
            ? 'Ok' : el?.status === 'NoRoute' ? 'NoRoute' : 'UnknownError',
        distanceMeters: el?.status === 'Ok' && nonnegative(el.distance?.value) && nonnegative(el.duration?.value) ? el.distance.value : null,
        durationSeconds: el?.status === 'Ok' && nonnegative(el.distance?.value) && nonnegative(el.duration?.value) ? el.duration.value : null,
      })),
    )
    return matrix
    })
  }

  /** فاصله‌ی هوایی هیورساین — fallback همیشه در دسترس (بدون API) */
  haversineMeters(a: LatLng, b: LatLng): number {
    const R = 6_371_000
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const la1 = (a.lat * Math.PI) / 180
    const la2 = (b.lat * Math.PI) / 180
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    return Math.round(2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))))
  }

  private isCoord(lat: number, lng: number): boolean {
    return (
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    )
  }
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * رمزگشایی Encoded Polyline (الگوریتم گوگل) — خروجی [lat, lng][].
 * برای رسم مسیر روی MapLibre در فرانت.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  if (typeof encoded !== 'string' || encoded.length > 200_000) return []
  const points: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  const readDelta = (): number | null => {
    let result = 0
    for (let shift = 0; shift <= 25; shift += 5) {
      if (index >= encoded.length) return null
      const b = encoded.charCodeAt(index++) - 63
      if (b < 0 || b > 63) return null
      result += (b & 0x1f) * 2 ** shift
      if (b < 0x20) return result % 2 ? -(Math.floor(result / 2) + 1) : result / 2
    }
    return null
  }
  while (index < encoded.length) {
    const dLat = readDelta()
    const dLng = readDelta()
    if (dLat === null || dLng === null) return []
    lat += dLat
    lng += dLng
    if (Math.abs(lat) > 90e5 || Math.abs(lng) > 180e5) return []
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}
