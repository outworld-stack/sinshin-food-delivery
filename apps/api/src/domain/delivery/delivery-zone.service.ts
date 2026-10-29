//src/domain/delivery/delivery-zone.service.ts
import { asc, eq, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import { deliveryZones, SETTING_KEYS } from '#/infra/db/schema'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { DeliveryQuote, DeliveryZone } from '@sinshin/shared'
import { isUniqueViolation } from '#/domain/shared/pg'
import { Err } from '#/domain/shared/errors'
import type { LatLng, NeshanMatrixElement, NeshanService } from '#/infra/maps/neshan.service'

/** Provider measurement only; prices are always resolved from current settings. */
export interface PreparedDeliveryRoute {
  origin: LatLng
  destination: LatLng
  route: NeshanMatrixElement | null
}

/** فاصله‌ی هیورساین — کیلومتر (عین فرانت) */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

// رارد ۴۶ — تایپ DeliveryZone به قرارداد مشترک (@sinshin/shared) منتقل شد؛
// کپی‌های موازی لایه‌ی سرور فرانت و کامپوننت مدیر هم با همان منبع بسته شدند.

/**
 * Shared preview/payment pricing: Neshan road distance from the restaurant,
 * using the first matching distance tier (or the outermost tier beyond it).
 */
export class DeliveryZoneService {
  constructor(
    private readonly deps: { db: Db; settings: SettingsService; neshan: Pick<NeshanService, 'distanceMatrix'> },
  ) {}

  // رارد M9 — کش ۳۰ ثانیه‌ای: feeFor در هر چک‌اوت/پیش‌نمایش صدا می‌شود و
  // جدول ناحیه‌ها کوچک و به‌ندرت تغییر می‌کند. تغییر → listCacheClear().
  private listCache: { at: number; rows: DeliveryZone[] } | null = null
  private listPending: Promise<DeliveryZone[]> | null = null
  private listGeneration = 0
  private static readonly LIST_TTL_MS = 30_000

  private listCacheClear(): void {
    this.listCache = null
    this.listPending = null
    this.listGeneration++
  }

  async list(db?: DbOrTx): Promise<DeliveryZone[]> {
    if (
      !db && this.listCache &&
      Date.now() - this.listCache.at < DeliveryZoneService.LIST_TTL_MS
    ) {
      return this.listCache.rows
    }
    if (!db && this.listPending) return this.listPending
    const generation = this.listGeneration
    const load = async () => {
      const rows = await (db ?? this.deps.db)
        .select({ radiusKm: deliveryZones.radiusKm, fee: deliveryZones.fee })
        .from(deliveryZones).orderBy(asc(deliveryZones.radiusKm))
      if (!db && generation === this.listGeneration) this.listCache = { at: Date.now(), rows }
      return rows
    }
    if (db) return load()
    const pending = load()
    this.listPending = pending
    try { return await pending } finally {
      if (this.listPending === pending) this.listPending = null
    }
  }

  async add(radiusKm: number, fee: number): Promise<{ success: boolean; message?: string }> {
    const error = validateZone(radiusKm, fee)
    if (error) return { success: false, message: error }
    const [added] = await this.deps.db.insert(deliveryZones).values({ radiusKm, fee })
      .onConflictDoNothing({ target: deliveryZones.radiusKm }).returning({ id: deliveryZones.id })
    if (!added) return { success: false, message: 'ناحیه با این شعاع از قبل موجود است' }
    this.listCacheClear() // رارد M9
    return { success: true }
  }

  /** round-13 — ویرایش ناحیه: شعاع (کلید یکتا) و هزینه؛ شعاع جدید نباید با ناحیه‌ی دیگری تصادم کند */
  async update(
    radiusKm: number,
    newRadiusKm: number,
    fee: number,
  ): Promise<{ success: boolean; message?: string }> {
    const error = validateZone(newRadiusKm, fee) ?? validateZone(radiusKm, fee)
    if (error) return { success: false, message: error }
    try {
      const [updated] = await this.deps.db.update(deliveryZones)
        .set({ radiusKm: newRadiusKm, fee }).where(eq(deliveryZones.radiusKm, radiusKm))
        .returning({ id: deliveryZones.id })
      if (!updated) return { success: false, message: 'ناحیه یافت نشد' }
    } catch (error) {
      if (isUniqueViolation(error)) return { success: false, message: 'ناحیه‌ی دیگری با این شعاع موجود است' }
      throw error
    }
    this.listCacheClear() // رارد M9
    return { success: true }
  }

  async remove(radiusKm: number): Promise<{ success: boolean; message?: string }> {
    const error = validateZone(radiusKm, 0)
    if (error) return { success: false, message: error }
    const result = await this.deps.db.transaction(async (tx) => {
      // Serialize writers across processes: concurrent removals must leave one zone.
      await tx.execute(sql`lock table ${deliveryZones} in share row exclusive mode`)
      const zones = await this.list(tx)
      if (!zones.some((z) => z.radiusKm === radiusKm)) return { success: false, message: 'ناحیه یافت نشد' }
      if (zones.length <= 1) return { success: false, message: 'حداقل یک ناحیه لازم است' }
      await tx.delete(deliveryZones).where(eq(deliveryZones.radiusKm, radiusKm))
      return { success: true }
    })
    if (!result.success) return result
    this.listCacheClear() // رارد M9
    return { success: true }
  }

  async fallbackFee(db?: DbOrTx): Promise<number | null> {
    // Read this monetary setting fresh, including across API processes, using
    // the checkout transaction's connection when one is provided.
    const saved = await this.deps.settings.get<unknown>(SETTING_KEYS.deliveryFallbackFee, null, db ?? this.deps.db)
    if (typeof saved === 'number' && !validateFee(saved)) return saved
    // Existing installations start with an already configured delivery price.
    // Once explicitly saved (including zero), this amount is independent of tiers.
    const zones = await this.list(db)
    return zones.at(-1)?.fee ?? null
  }

  async setFallbackFee(fee: number): Promise<{ success: boolean; message?: string }> {
    const error = validateFee(fee)
    if (error) return { success: false, message: error }
    await this.deps.settings.set(SETTING_KEYS.deliveryFallbackFee, fee)
    return { success: true }
  }

  private async fallbackQuote(db?: DbOrTx): Promise<DeliveryQuote> {
    const fee = await this.fallbackFee(db)
    return fee !== null
      ? { status: 'fallback', fee }
      : { status: 'unavailable', message: 'ناحیه‌های ارسال هنوز تنظیم نشده‌اند.' }
  }

  private async readRoute(origin: LatLng, destination: LatLng): Promise<NeshanMatrixElement | null> {
    try {
      const matrix = await this.deps.neshan.distanceMatrix([origin], [destination], { type: 'car', traffic: false })
      return matrix?.[0]?.[0] ?? null
    } catch {
      return null
    }
  }

  /** Wait for Neshan before opening checkout's wallet/coupon transaction. */
  async prepareRoute(address: LatLng | null): Promise<PreparedDeliveryRoute | null> {
    if (!address || !validCoordinate(address)) return null
    // Bypass the settings cache, just as final checkout does.
    const origin = await this.deps.settings.restaurantLocation(this.deps.db)
    if (!validCoordinate(origin)) return null
    const prepared = { origin: { ...origin }, destination: { ...address } }
    return { ...prepared, route: await this.readRoute(prepared.origin, prepared.destination) }
  }

  async quoteFor(address: LatLng | null, db?: DbOrTx, prepared?: PreparedDeliveryRoute | null): Promise<DeliveryQuote> {
    if (!address) return { status: 'address_required', message: 'برای محاسبه هزینه ارسال، آدرس تحویل را انتخاب کنید.' }
    if (!validCoordinate(address)) return { status: 'no_route', message: 'موقعیت آدرس معتبر نیست؛ آن را روی نقشه اصلاح کنید.' }
    const zones = await this.list(db)
    if (zones.length === 0) return { status: 'unavailable', message: 'ناحیه‌های ارسال هنوز تنظیم نشده‌اند.' }
    const origin = await this.deps.settings.restaurantLocation(db)
    const unavailable: DeliveryQuote = { status: 'unavailable', message: 'محاسبه هزینه ارسال موقتاً ممکن نیست؛ دوباره تلاش کنید.' }
    if (!validCoordinate(origin)) return unavailable
    // Successful routes use distance tiers; provider outages use the saved fee.
    if (prepared !== undefined && (!prepared ||
      prepared.origin.lat !== origin.lat || prepared.origin.lng !== origin.lng ||
      prepared.destination.lat !== address.lat || prepared.destination.lng !== address.lng)) {
      throw Err.conflict('موقعیت ارسال تغییر کرده است؛ هزینه ارسال را دوباره بررسی و تلاش کنید.')
    }
    const route = prepared !== undefined ? prepared?.route : await this.readRoute(origin, address)
    if (route?.status === 'NoRoute') return { status: 'no_route', message: 'مسیری برای ارسال به این آدرس پیدا نشد؛ موقعیت آدرس را بررسی کنید.' }
    if (route?.status !== 'Ok' || route.distanceMeters === null || !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0) return this.fallbackQuote(db)
    const distanceKm = route.distanceMeters / 1000
    const zone = zones.find((z) => distanceKm <= z.radiusKm) ?? zones[zones.length - 1]!
    return { status: 'ready', distanceKm, radiusKm: zone.radiusKm, fee: zone.fee }
  }

  /** Final checkout must have a valid server quote before charging. */
  async feeFor(address: LatLng | null, db?: DbOrTx, prepared?: PreparedDeliveryRoute | null): Promise<number> {
    const quote = await this.quoteFor(address, db, prepared)
    if (quote.status === 'ready' || quote.status === 'fallback') return quote.fee
    if (quote.status === 'unavailable') throw Err.serviceUnavailable(quote.message)
    throw Err.validation(quote.message)
  }
}

function validCoordinate(point: LatLng): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
}

function validateZone(radiusKm: number, fee: number): string | null {
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 500) return 'شعاع باید بین ۰.۵ و ۵۰۰ کیلومتر باشد'
  return validateFee(fee)
}

function validateFee(fee: number): string | null {
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) return 'هزینه معتبر نیست'
  return null
}
