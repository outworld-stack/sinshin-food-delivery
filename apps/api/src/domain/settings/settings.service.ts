// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 13 از 49
// مسیر مقصد: apps/api/src/domain/settings/settings.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/domain/settings/settings.service.ts

import { eq, inArray, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import { settings, SETTING_KEYS } from '#/infra/db/schema'
import { assertContentSourceRevision, DEFAULT_RESTAURANT_HOURS, isRestaurantHours, localizeContentRecord, reconcileContentTranslation, type ContentTranslationState, type RestaurantHoursDto, type RestaurantStatusDto, type TranslationEdit } from '@sinshin/shared'
import type { Lang } from '#/domain/shared/lang'
import { Err, OrderPaymentsDisabledError } from '#/domain/shared/errors'

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
  private closeContentRevision = 0
  private closeContentCache?: { at: number; row: { id: string; reason: string; reasonAr: string; translationState: ContentTranslationState | null } }

  async get<T>(key: string, fallback: T, db?: DbOrTx): Promise<T> {
    // Money transactions must not wait for a second pool connection or share
    // an outside in-flight read. Do not publish transactional values to cache.
    if (db) {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key))
      return row ? row.value as T : fallback
    }
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
    if (key === SETTING_KEYS.temporaryCloseReason || key === SETTING_KEYS.temporaryCloseReasonAr) this.invalidateContentTranslationCache()
  }

  /** Called after source/translation persistence, including worker writes outside this service. */
  invalidateContentTranslationCache(): void {
    this.closeContentRevision++
    this.closeContentCache = undefined
    this.cache.delete(SETTING_KEYS.temporaryCloseReason)
    this.cache.delete(SETTING_KEYS.temporaryCloseReasonAr)
  }

  async readTemporaryCloseContent(db?: DbOrTx): Promise<{ id: string; reason: string; reasonAr: string; translationState: ContentTranslationState | null }> {
    const hit = this.closeContentCache
    if (!db && hit && Date.now() - hit.at < SETTINGS_CACHE_TTL_MS) return structuredClone(hit.row)
    const revision = this.closeContentRevision
    const queryDb = db ?? this.deps.db
    const rows = await queryDb.select().from(settings).where(inArray(settings.key, [SETTING_KEYS.temporaryCloseReason, SETTING_KEYS.temporaryCloseReasonAr]))
    const source = rows.find(row => row.key === SETTING_KEYS.temporaryCloseReason)
    const arabic = rows.find(row => row.key === SETTING_KEYS.temporaryCloseReasonAr)
    const row = { id: 'temporaryCloseReason', reason: typeof source?.value === 'string' ? source.value : '',
      reasonAr: typeof arabic?.value === 'string' ? arabic.value : '', translationState: source?.translationState ?? null }
    if (!db) {
      if (revision !== this.closeContentRevision) return this.readTemporaryCloseContent()
      this.closeContentCache = { at: Date.now(), row }
    }
    return structuredClone(row)
  }

  /** Serialize the bilingual message with the existing closure/payment policy in one transaction. */
  async setTemporaryCloseContent(input: {
    closed: boolean; reason: string; reasonAr?: string | null; reopenTime?: string | null; disablePayments: boolean
    translationEdits?: TranslationEdit[]; sourceRevision?: string
  }): Promise<void> {
    const writes = await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('content:temporaryClose'))`)
      await tx.insert(settings).values({ key: SETTING_KEYS.temporaryCloseReason, value: '' }).onConflictDoNothing()
      const [source] = await tx.select().from(settings).where(eq(settings.key, SETTING_KEYS.temporaryCloseReason)).for('update')
      const [arabic] = await tx.select().from(settings).where(eq(settings.key, SETTING_KEYS.temporaryCloseReasonAr))
      const current = { id: 'temporaryCloseReason', reason: typeof source?.value === 'string' ? source.value : '',
        reasonAr: typeof arabic?.value === 'string' ? arabic.value : '', translationState: source?.translationState ?? null }
      if (!assertContentSourceRevision('temporaryClose', current, input.sourceRevision)) throw Err.validation('علت بسته بودن تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
      const previous = !current.reason && !current.reasonAr && !current.translationState ? null : current
      const next = reconcileContentTranslation('temporaryClose', current.id, previous, { ...current,
        reason: input.closed ? input.reason : '', reasonAr: input.closed ? input.reasonAr ?? current.reasonAr : '',
      }, input.closed ? input.translationEdits : [])
      const updates: Array<{ key: string; value: unknown; translationState?: ContentTranslationState }> = []
      if (!input.closed) updates.push({ key: SETTING_KEYS.temporarilyClosed, value: false })
      updates.push({ key: SETTING_KEYS.temporaryCloseReason, value: next.reason, translationState: next.translationState },
        { key: SETTING_KEYS.temporaryCloseReasonAr, value: input.closed ? next.reasonAr ?? '' : '' },
        { key: SETTING_KEYS.temporaryReopenTime, value: input.closed ? (input.reopenTime ?? '').trim().slice(0, 40) : '' },
        { key: SETTING_KEYS.temporaryPaymentsDisabled, value: input.closed && input.disablePayments })
      if (input.closed) updates.push({ key: SETTING_KEYS.temporarilyClosed, value: true })
      for (const update of updates) await tx.insert(settings).values({ ...update, value: update.value as never }).onConflictDoUpdate({
        target: settings.key, set: { value: update.value as never, updatedAt: new Date(),
          ...(update.translationState ? { translationState: update.translationState } : {}) },
      })
      return updates
    })
    for (const { key, value } of writes) this.cache.set(key, { value, at: Date.now() })
    this.invalidateContentTranslationCache()
  }

  /** One KV value keeps the opening and closing times consistent on every read. */
  async restaurantHours(db?: DbOrTx): Promise<RestaurantHoursDto> {
    const raw = await this.get<unknown>(SETTING_KEYS.restaurantHours, DEFAULT_RESTAURANT_HOURS, db)
    const hours = isRestaurantHours(raw) ? raw : DEFAULT_RESTAURANT_HOURS
    return { openingTime: hours.openingTime, closingTime: hours.closingTime }
  }

  async setRestaurantHours(value: RestaurantHoursDto): Promise<RestaurantHoursDto> {
    if (!isRestaurantHours(value)) {
      throw Err.validation('ساعت باز و بسته شدن باید معتبر و متفاوت باشند.')
    }
    const hours = { openingTime: value.openingTime, closingTime: value.closingTime }
    await this.set(SETTING_KEYS.restaurantHours, hours)
    return hours
  }

  /** وضعیت کامل رستوران — دو نوع بسته‌بودن
   *  round-34 — lang='ar': علت بسته‌بودن موقت از کلید موازی عربی
   *  (temporary_close_reason_ar) می‌آید؛ خالی = همان فارسی (fallback). */
  async restaurantStatus(lang: Lang = 'fa', db?: DbOrTx): Promise<RestaurantStatusDto> {
    const [open, tempClosed, closeContent, tempReopen, hours, busy, paymentsDisabled] = await Promise.all([
      this.get<boolean>(SETTING_KEYS.restaurantOpen, true, db),
      this.get<boolean>(SETTING_KEYS.temporarilyClosed, false, db),
      this.readTemporaryCloseContent(db),
      this.get<string>(SETTING_KEYS.temporaryReopenTime, '', db),
      this.restaurantHours(db),
      this.get<boolean>(SETTING_KEYS.restaurantBusy, false, db),
      this.get<boolean>(SETTING_KEYS.temporaryPaymentsDisabled, false, db),
    ])
    // round-34 — COALESCE: عربی خالی → همان فارسی (بدون ترجمه‌ی برچسب‌های زمانی —
    // ساعت‌ها عددی‌اند و فرانت با فرمتر خودش ارقام را عربی می‌کند)
    const validContent = localizeContentRecord('temporaryClose', closeContent)
    const reason = validContent.reason
    const reasonAr = typeof validContent.reasonAr === 'string' ? validContent.reasonAr : ''
    const effectiveReason =
      lang === 'ar' && reasonAr.trim() !== '' ? reasonAr : reason || 'بسته موقت'
    return {
      isOpen: open,
      temporarilyClosed: tempClosed,
      temporaryCloseReason: tempClosed ? effectiveReason : null,
      temporaryReopenTime: tempClosed ? tempReopen : '',
      nextOpenTime: hours.openingTime,
      anyClosed: !open || tempClosed,
      // stage-84 — شلوغی: مستقل از بسته‌بودن (رستورانِ بازِ شلوغ ممکن است)
      isBusy: busy,
      paymentsDisabled: tempClosed === true && paymentsDisabled === true,
    }
  }

  /** Money paths need fresh settings, including callers outside a transaction. */
  async orderPaymentsDisabled(db?: DbOrTx): Promise<boolean> {
    const readDb = db ?? this.deps.db
    const [tempClosed, disabled] = await Promise.all([
      this.get<boolean>(SETTING_KEYS.temporarilyClosed, false, readDb),
      this.get<boolean>(SETTING_KEYS.temporaryPaymentsDisabled, false, readDb),
    ])
    return tempClosed === true && disabled === true
  }

  async assertOrderPaymentsAllowed(db?: DbOrTx): Promise<void> {
    if (await this.orderPaymentsDisabled(db)) {
      throw new OrderPaymentsDisabledError()
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

  async liveTrackingEnabled(db?: DbOrTx): Promise<boolean> {
    return this.get<boolean>(SETTING_KEYS.liveTrackingEnabled, false, db)
  }

  /**
   *  stage-84 — وضعیت «شلوغی» رستوران (فقط اطلاع‌رسانی؛ سفارش‌دهی آزاد).
   *  ادمین اصلی + ادمین۲ با مجوزِ canAnnounceBusy (گارد در Admin2Service).
   */
  async isBusy(db?: DbOrTx): Promise<boolean> {
    return this.get<boolean>(SETTING_KEYS.restaurantBusy, false, db)
  }

  async setBusy(busy: boolean): Promise<void> {
    await this.set<boolean>(SETTING_KEYS.restaurantBusy, busy)
  }

  /**
   *  stage-84 — درگاه‌های پرداختِ فعال (سوئیچ‌های ادمین اصلی).
   *  شکلِ ذخیره: { mellat, zarinpal, sep } — کلید غایب/false = خاموش.
   *  مقدار پیش‌فرض (بدون کلید): همه فعال — پشتیبانِ ایمنِ نصب‌های موجود.
   */
  async enabledGateways(db?: DbOrTx): Promise<{
    mellat: boolean
    zarinpal: boolean
    sep: boolean
  }> {
    const raw = await this.get<{
      mellat?: unknown
      zarinpal?: unknown
      sep?: unknown
    }>(SETTING_KEYS.paymentGateways, {}, db)
    return {
      mellat: raw.mellat !== false,
      zarinpal: raw.zarinpal !== false,
      sep: raw.sep !== false,
    }
  }

  async setGateways(value: {
    mellat: boolean
    zarinpal: boolean
    sep: boolean
  }): Promise<void> {
    await this.set(SETTING_KEYS.paymentGateways, value)
  }

  /**
   * مختصات رستوران — مبدأ محاسبه‌ی فاصله‌ی ناحیه‌های ارسال.
   * round-13 — اولویت: متغیر محیطی RESTAURANT_LAT/RESTAURANT_LNG، بعد کلید
   * تنظیمات DB، بعد پیش‌فرض تهران. env «منبع حقیقت» عملیاتاتی است — بدون
   * ری‌استارت عوض نمی‌شود (مثل GEO_BYPASS_IPS).
   */
  async restaurantLocation(db?: DbOrTx): Promise<RestaurantLocation> {
    if (this.deps.config?.restaurantLocation) {
      return this.deps.config.restaurantLocation
    }
    return this.get<RestaurantLocation>(SETTING_KEYS.restaurantLocation, {
      lat: 37.4822056,
      lng: 49.4418273,
    }, db)
  }
}
