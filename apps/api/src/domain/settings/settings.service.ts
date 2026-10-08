// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 13 از 49
// مسیر مقصد: apps/api/src/domain/settings/settings.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/domain/settings/settings.service.ts

import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import { settings, SETTING_KEYS } from '#/infra/db/schema'
import type { RestaurantStatusDto } from '@sinshin/shared'
import type { Lang } from '#/domain/shared/lang'

// رارد ۴۶ — تایپ inline خروجی restaurantStatus با قرارداد مشترک
// RestaurantStatusDto جایگزین شد (تولیدکننده حالا تایپ‌چک می‌شود)؛
// Lang هم از منبع واحد می‌آید — هر دو بدون تغییر شکل.

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
 *
 * perf-fix (کار-۱): کش درون‌حافظه با TTL ۳۰ ثانیه + write-through روی set().
 * کلیدها مجموعه‌ی ثابت و کوچکی هستند (SETTING_KEYS) — بدون سقف اندازه.
 * restaurantStatus در هر checkout سه‌چهار بار get می‌زد (۴ کوئری)؛ حالا فقط
 * اولین فراخوانی بعد از انقضای TTL به DB می‌رود. چند‌رپلیکایی: حداکثر ۳۰ ثانیه
 * کهنگی — برای این نوع تنظیمات (باز/بسته، هزینه بسته‌بندی، ...) قابل قبول است.
 */
const SETTINGS_CACHE_TTL_MS = 30_000

export class SettingsService {
  constructor(
    private readonly deps: { db: Db; config?: AppConfig },
  ) {}

  private cache = new Map<string, { value: unknown; at: number }>()

  // رارد L8 — پروازهای در-جریان (single-flight): انقضای TTL با پیک‌ترافیک
  // یعنی ده‌ها کوئری موازی برای همان کلید؛ اولین صاحب پرواز است، بقیه می‌پیوندند.
  private readonly inflight = new Map<string, Promise<unknown>>()

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < SETTINGS_CACHE_TTL_MS) {
      return hit.value as T
    }
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const p = (async () => {
      try {
        const row = await this.deps.db.query.settings.findFirst({ where: eq(settings.key, key) })
        const value = row ? (row.value as T) : fallback
        this.cache.set(key, { value, at: Date.now() })
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, p)
    return p
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.deps.db
      .insert(settings)
      .values({ key, value: value as never })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: value as never, updatedAt: new Date() },
      })
    // write-through — رپلیکای خودش بلافاصله مقدار تازه را می‌بیند
    this.cache.set(key, { value, at: Date.now() })
  }

  /** وضعیت کامل رستوران — دو نوع بسته‌بودن
   *  round-34 — lang='ar': علت بسته‌بودن موقت از کلید موازی عربی
   *  (temporary_close_reason_ar) می‌آید؛ خالی = همان فارسی (fallback). */
  async restaurantStatus(lang: Lang = 'fa'): Promise<RestaurantStatusDto> {
    const [open, tempClosed, reason, reasonAr, tempReopen, nextOpenTime] = await Promise.all([
      this.get<boolean>(SETTING_KEYS.restaurantOpen, true),
      this.get<boolean>(SETTING_KEYS.temporarilyClosed, false),
      this.get<string>(SETTING_KEYS.temporaryCloseReason, ''),
      this.get<string>(SETTING_KEYS.temporaryCloseReasonAr, ''),
      this.get<string>(SETTING_KEYS.temporaryReopenTime, ''),
      this.get<string>(SETTING_KEYS.nextOpenTime, '۱۱:۰۰ صبح'),
    ])
    // round-34 — COALESCE: عربی خالی → همان فارسی (بدون ترجمه‌ی برچسب‌های زمانی —
    // ساعت‌ها عددی‌اند و فرانت با فرمتر خودش ارقام را عربی می‌کند)
    const effectiveReason =
      lang === 'ar' && reasonAr.trim() !== '' ? reasonAr : reason || 'بسته موقت'
    return {
      isOpen: open,
      temporarilyClosed: tempClosed,
      temporaryCloseReason: tempClosed ? effectiveReason : null,
      temporaryReopenTime: tempClosed ? tempReopen : '',
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

  /**
   * مختصات رستوران — مبدأ محاسبه‌ی فاصله‌ی ناحیه‌های ارسال.
   * round-13 — اولویت: متغیر محیطی RESTAURANT_LAT/RESTAURANT_LNG، بعد کلید
   * تنظیمات DB، بعد پیش‌فرض تهران. env «منبع حقیقت» عملیاتاتی است — بدون
   * ری‌استارت عوض نمی‌شود (مثل GEO_BYPASS_IPS).
   */
  async restaurantLocation(): Promise<RestaurantLocation> {
    if (this.deps.config?.restaurantLocation) {
      return this.deps.config.restaurantLocation
    }
    return this.get<RestaurantLocation>(SETTING_KEYS.restaurantLocation, {
      lat: 37.4822056,
      lng: 49.4418273,
    })
  }
}