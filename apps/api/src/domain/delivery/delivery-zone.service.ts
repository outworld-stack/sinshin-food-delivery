//src/domain/delivery/delivery-zone.service.ts
import { asc, eq, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import { deliveryZones } from '#/infra/db/schema'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { DeliveryZone } from '@sinshin/shared'
import { isUniqueViolation } from '#/domain/shared/pg'

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
 * ناحیه‌های ارسال — منطق واحد نمایش و پرداخت (عین فرانت):
 *  - آدرس تهی → نرخ ناحیه‌ی داخلی (کوچک‌ترین)
 *  - بیرون از همه → نرخ ناحیه‌ی بیرونی (بزرگ‌ترین)
 *  - مبدأ: مختصات رستوران از settings
 */
export class DeliveryZoneService {
  constructor(
    private readonly deps: { db: Db; settings: SettingsService },
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

  /** هزینه‌ی ارسال برای آدرس — منطق واحد */
  async feeFor(address: { lat: number; lng: number } | null, db?: DbOrTx): Promise<number> {
    const zones = await this.list(db)
    if (zones.length === 0) return 0
    if (!address) return zones[0]!.fee

    const origin = await this.deps.settings.restaurantLocation(db)
    const distance = haversineKm(origin, address)
    const zone = zones.find((z) => distance <= z.radiusKm) ?? zones[zones.length - 1]!
    return zone.fee
  }
}

function validateZone(radiusKm: number, fee: number): string | null {
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 500) return 'شعاع باید بین ۰.۵ و ۵۰۰ کیلومتر باشد'
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) return 'هزینه معتبر نیست'
  return null
}
