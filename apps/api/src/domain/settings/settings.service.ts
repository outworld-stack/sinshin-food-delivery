//src/domain/settings/settings.service.ts

import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { settings, SETTING_KEYS } from '#/infra/db/schema'

export interface RestaurantLocation {
  lat: number
  lng: number
}

/**
 * تنظیمات — فاز ۵ مستقیم DB (مصرف کم).
 *
 * دو نوع بسته‌بودن:
 *  restaurant_open    → ساعتی (روزانه) — فقط ادمین اصلی؛ بسته = لاگین ادمین۲ رد
 *  temporarily_closed → موقت (گاز/برق/...) — ادمین اصلی + ادمین۲ با permission؛ ادمین۲ می‌تواند لاگین/بماند
 */
export class SettingsService {
  constructor(private readonly deps: { db: Db }) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.deps.db.query.settings.findFirst({ where: eq(settings.key, key) })
    if (!row) return fallback
    return row.value as T
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.deps.db
      .insert(settings)
      .values({ key, value: value as never })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: value as never, updatedAt: new Date() },
      })
  }

  /** وضعیت کامل رستوران — دو نوع بسته‌بودن */
  async restaurantStatus(): Promise<{
    isOpen: boolean
    temporarilyClosed: boolean
    temporaryCloseReason: string | null
    nextOpenTime: string
    anyClosed: boolean
  }> {
    const [open, tempClosed, reason, nextOpenTime] = await Promise.all([
      this.get<boolean>(SETTING_KEYS.restaurantOpen, true),
      this.get<boolean>(SETTING_KEYS.temporarilyClosed, false),
      this.get<string>(SETTING_KEYS.temporaryCloseReason, ''),
      this.get<string>(SETTING_KEYS.nextOpenTime, '۱۱:۰۰ صبح'),
    ])
    return {
      isOpen: open,
      temporarilyClosed: tempClosed,
      temporaryCloseReason: tempClosed ? reason || 'بسته موقت' : null,
      nextOpenTime,
      anyClosed: !open || tempClosed,
    }
  }

  /** قدیمی — سازگاری با فاز ۴: هر نوع بسته → isOpen=false برای نمایش کاربر */
  async restaurantOpen(): Promise<{ isOpen: boolean; nextOpenTime: string }> {
    const s = await this.restaurantStatus()
    return { isOpen: s.isOpen && !s.temporarilyClosed, nextOpenTime: s.nextOpenTime }
  }

  /** لاگین ادمین۲ فقط با بسته‌بودن ساعتی رد می‌شود — موقت آزاد است */
  async admin2LoginAllowed(): Promise<boolean> {
    return this.get<boolean>(SETTING_KEYS.restaurantOpen, true)
  }

  async liveTrackingEnabled(): Promise<boolean> {
    return this.get<boolean>(SETTING_KEYS.liveTrackingEnabled, false)
  }

  async restaurantLocation(): Promise<RestaurantLocation> {
    return this.get<RestaurantLocation>(SETTING_KEYS.restaurantLocation, {
      lat: 35.6892,
      lng: 51.389,
    })
  }

  /** هزینه بسته‌بندی PICKUP */
  async packagingFee(): Promise<number> {
    return this.get<number>(SETTING_KEYS.packagingFee, 5000)
  }
}