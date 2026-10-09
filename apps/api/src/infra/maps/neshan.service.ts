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
  /** شمارنده‌ی مدخل‌های کش — جلوگیری از رشد بی‌سقف */
  private cacheCount = 0
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
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key)
      this.cacheCount--
      return null
    }
    return hit.value as T
  }

  private cacheSet<T>(key: string, value: T): void {
    if (this.cacheCount >= this.cacheMaxEntries) {
      // تخلیه‌ی کامل — ساده و کافی (TTL کوتاه است)
      this.cache.clear()
      this.cacheCount = 0
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.config.neshan.cacheTtlSeconds * 1000 })
    this.cacheCount++
  }

  private roundCoord(v: number): string {
    // ۵ رقم اعشار (~۱ متر) — کلید کش پایدار
    return v.toFixed(5)
  }

  // ═══ تبدیل نقطه به آدرس (v5/reverse) ═══

  async reverseGeocode(lat: number, lng: number): Promise<NeshanReverseResult | null> {
    if (!this.isCoord(lat, lng)) return null
    const key = `rev:${this.roundCoord(lat)},${this.roundCoord(lng)}`
    const cached = this.cacheGet<NeshanReverseResult>(key)
    if (cached) return cached

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
    if (!raw || raw.status !== 'OK' || !raw.formatted_address) return null

    const result: NeshanReverseResult = {
      formattedAddress: raw.formatted_address,
      routeName: raw.route_name ?? '',
      neighbourhood: raw.neighbourhood ?? null,
      city: raw.city ?? '',
      state: raw.state ?? '',
      municipalityZone: raw.municipality_zone ?? null,
      inTrafficZone: raw.in_traffic_zone === true,
      inOddEvenZone: raw.in_odd_even_zone === true,
    }
    this.cacheSet(key, result)
    return result
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
    const waypoints = (opts?.waypoints ?? [])
      .filter((w) => this.isCoord(w.lat, w.lng))
      .slice(0, 5)
    const wpStr = waypoints.length > 0
      ? `&waypoints=${encodeURIComponent(waypoints.map((w) => `${w.lat},${w.lng}`).join('|'))}`
      : ''
    const key =
      `route:${this.roundCoord(origin.lat)},${this.roundCoord(origin.lng)}→` +
      `${this.roundCoord(destination.lat)},${this.roundCoord(destination.lng)}${wpStr}`
    const cached = this.cacheGet<NeshanRoute>(key)
    if (cached) return cached

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
    if (!r?.overview_polyline?.points || !r.legs?.[0]) return null

    const leg = r.legs[0]
    const result: NeshanRoute = {
      distanceMeters: leg.distance?.value ?? 0,
      durationSeconds: leg.duration?.value ?? 0,
      coordinates: decodePolyline(r.overview_polyline.points),
      summary: leg.summary ?? '',
      overviewPolyline: r.overview_polyline.points,
    }
    this.cacheSet(key, result)
    return result
  }

  // ═══ ماتریس فاصله (v1/distance-matrix[/no-traffic]) ═══

  async distanceMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    opts?: { type?: 'car' | 'motorcycle'; traffic?: boolean },
  ): Promise<NeshanMatrixElement[][] | null> {
    const cleanOrigins = origins.filter((p) => this.isCoord(p.lat, p.lng)).slice(0, MATRIX_MAX)
    const cleanDests = destinations.filter((p) => this.isCoord(p.lat, p.lng)).slice(0, MATRIX_MAX)
    if (cleanOrigins.length === 0 || cleanDests.length === 0) return null

    const type = opts?.type === 'motorcycle' ? 'motorcycle' : 'car'
    const traffic = opts?.traffic === true
    const key =
      `matrix:${type}:${traffic ? 't' : 'n'}:` +
      cleanOrigins.map((p) => `${this.roundCoord(p.lat)},${this.roundCoord(p.lng)}`).join(';') +
      '|' +
      cleanDests.map((p) => `${this.roundCoord(p.lat)},${this.roundCoord(p.lng)}`).join(';')
    const cached = this.cacheGet<NeshanMatrixElement[][]>(key)
    if (cached) return cached

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
    if (!raw?.rows) return null

    const matrix: NeshanMatrixElement[][] = raw.rows.map((row) =>
      (row.elements ?? []).map((el) => ({
        status:
          el.status === 'Ok' ? 'Ok' : el.status === 'NoRoute' ? 'NoRoute' : 'UnknownError',
        distanceMeters: el.distance?.value ?? null,
        durationSeconds: el.duration?.value ?? null,
      })),
    )
    this.cacheSet(key, matrix)
    return matrix
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
    return Math.round(2 * R * Math.asin(Math.sqrt(h)))
  }

  private isCoord(lat: number, lng: number): boolean {
    return (
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    )
  }
}

/**
 * رمزگشایی Encoded Polyline (الگوریتم گوگل) — خروجی [lat, lng][].
 * برای رسم مسیر روی MapLibre در فرانت.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    // latitude
    let result = 0
    let shift = 0
    let b: number
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    // longitude
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
