//src/domain/delivery/delivery-zone.service.ts
import { asc, eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { deliveryZones } from '#/infra/db/schema'
import type { SettingsService } from '#/domain/settings/settings.service'

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
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface DeliveryZone {
  radiusKm: number
  fee: number
}

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

  async list(): Promise<DeliveryZone[]> {
    const rows = await this.deps.db
      .select({ radiusKm: deliveryZones.radiusKm, fee: deliveryZones.fee })
      .from(deliveryZones)
      .orderBy(asc(deliveryZones.radiusKm))
    return rows
  }

  async add(radiusKm: number, fee: number): Promise<{ success: boolean; message?: string }> {
    if (radiusKm < 0.5) return { success: false, message: 'شعاع حداقل ۰.۵ کیلومتر است' }
    if (fee < 0) return { success: false, message: 'هزینه معتبر نیست' }
    const clash = await this.deps.db.query.deliveryZones.findFirst({
      where: eq(deliveryZones.radiusKm, radiusKm),
    })
    if (clash) return { success: false, message: 'ناحیه با این شعاع از قبل موجود است' }

    await this.deps.db.insert(deliveryZones).values({ radiusKm, fee })
    return { success: true }
  }

  /** round-13 — ویرایش ناحیه: شعاع (کلید یکتا) و هزینه؛ شعاع جدید نباید با ناحیه‌ی دیگری تصادم کند */
  async update(
    radiusKm: number,
    newRadiusKm: number,
    fee: number,
  ): Promise<{ success: boolean; message?: string }> {
    if (newRadiusKm < 0.5) return { success: false, message: 'شعاع حداقل ۰.۵ کیلومتر است' }
    if (fee < 0) return { success: false, message: 'هزینه معتبر نیست' }
    const zones = await this.list()
    if (!zones.some((z) => z.radiusKm === radiusKm)) {
      return { success: false, message: 'ناحیه یافت نشد' }
    }
    if (zones.some((z) => z.radiusKm === newRadiusKm && z.radiusKm !== radiusKm)) {
      return { success: false, message: 'ناحیه‌ی دیگری با این شعاع موجود است' }
    }
    await this.deps.db
      .update(deliveryZones)
      .set({ radiusKm: newRadiusKm, fee })
      .where(eq(deliveryZones.radiusKm, radiusKm))
    return { success: true }
  }

  async remove(radiusKm: number): Promise<{ success: boolean; message?: string }> {
    const zones = await this.list()
    if (zones.length <= 1) {
      return { success: false, message: 'حداقل یک ناحیه لازم است' }
    }
    const removed = await this.deps.db
      .delete(deliveryZones)
      .where(eq(deliveryZones.radiusKm, radiusKm))
      .returning({ id: deliveryZones.id })
    if (removed.length === 0) return { success: false, message: 'ناحیه یافت نشد' }
    return { success: true }
  }

  /** هزینه‌ی ارسال برای آدرس — منطق واحد */
  async feeFor(address: { lat: number; lng: number } | null): Promise<number> {
    const zones = await this.list()
    if (zones.length === 0) return 0
    if (!address) return zones[0]!.fee

    const origin = await this.deps.settings.restaurantLocation()
    const distance = haversineKm(origin, address)
    const zone = zones.find((z) => distance <= z.radiusKm) ?? zones[zones.length - 1]!
    return zone.fee
  }
}