// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/courier/courier.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: escape جستجو + مجموع تحویل‌ها با SQL aggregate
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/courier/courier.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با H3+M10+L4)
// تغییر فاز-۲: پیامک OTP پیک با قالب SMS.ir (courier-otp با fallback به otp)
// ═══════════════════════════════════════════════════════════════

//src/domain/courier/courier.service.ts
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { buildRangeCharts } from '#/domain/shared/charts'
import type { Db } from '#/infra/db/client'
import { courierDeliveries, courierTrips, couriers, orders, type OrderRow } from '#/infra/db/schema'
import type { CourierListRowDto } from '@sinshin/shared'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { likePattern } from '#/domain/shared/pg'
import type { RedisService } from '#/infra/redis/redis'
import type { SmsService } from '#/infra/sms/sms.service'
import type { NeshanService } from '#/infra/maps/neshan.service'
import type { SettingsService, RestaurantLocation } from '#/domain/settings/settings.service'
import { sendOtp, verifyOtp, type OtpKeys } from '#/domain/shared/otp-core'
import { asCourierId } from '#/domain/shared/brand'
import { requireOrder } from '#/domain/order/order-lookup'
import { startCourierTrip } from '#/domain/courier/courier-trip'

const COURIER_TOKEN_TTL_SECONDS = 10_800 // ۳ ساعت — stage-84: QR روی فاکتور تا ۳ ساعت قابل اسکن است
const LOCATION_THROTTLE_MS = 3000 // حداکثر یک آپدیت در ۳ ثانیه
// سیاست‌های OTP پیک — همان اعداد قبلی، حالا نام‌دار و کنار هم
const COURIER_OTP_TTL_SECONDS = 120
const COURIER_OTP_COOLDOWN_SECONDS = 60
const COURIER_OTP_MAX_PER_HOUR = 5
const COURIER_OTP_MAX_ATTEMPTS = 5

/** کلیدهای OTP پیک — بخش اول هم‌شکل قرارداد هسته‌ی مشترک (رارد ۴۸) */
const otpKeys: OtpKeys = {
  code: (phone: string) => `courier:otp:${phone}`,
  cooldown: (phone: string) => `courier:cd:${phone}`,
  attempts: (phone: string) => `courier:att:${phone}`,
  hour: (phone: string) => `courier:h:${phone}`,
}

const K = {
  ...otpKeys,
  token: (token: string) => `courier:tok:${token}`,
  throttle: (orderId: string) => `courier:loc:${orderId}`,
}

/**
 * پیک — بدون user سیستم.
 *
 * احراز (پیش‌فرض خاموش): اگر ادمین۲ موقع تایید securityEnabled روشن کند،
 * پیک با شماره‌ی خودش OTP می‌گیرد → توکن ۳ ساعته → اسکنِ فقط پیکِ تخصیصی.
 * بدون security: اسکن آزاد.
 */
export class CourierService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      redis: RedisService
      sms: SmsService
      /** stage-84 — مسیرِ نمایشی بعد از اسکن (اختیاری؛ miss-soft) */
      settings?: SettingsService
      neshan?: NeshanService
    },
  ) { }

  // ── OTP پیک (فقط برای سفارش‌های securityEnabled) ──

  async requestOtp(phone: string): Promise<{ cooldownSeconds: number; devCode?: string }> {
    const courier = await this.deps.db.query.couriers.findFirst({
      where: and(eq(couriers.phone, phone), eq(couriers.isActive, true)),
    })
    if (!courier) throw Err.notFound('پیکی با این شماره ثبت نشده است.')

    // رارد ۴۸ — مکانیزم به هسته‌ی مشترک رفت؛ سقف‌ها همان اعداد قبلی‌اند.
    // تفاوت‌های عمدی با نسخه‌ی قبل: گیتِ کول‌داون اتمیک است (قبلاً exists→set
    // بود و دو درخواست هم‌زمان دو پیامک می‌گرفتند) و سقف ساعتی قبل از گیت
    // چک می‌شود (هم‌ترتیب مسیر کاربر).
    return sendOtp(
      { redis: this.deps.redis },
      {
        phone,
        ttlSeconds: COURIER_OTP_TTL_SECONDS,
        cooldownSeconds: COURIER_OTP_COOLDOWN_SECONDS,
        maxPerHour: COURIER_OTP_MAX_PER_HOUR,
        keys: otpKeys,
        messages: {
          hourCap: 'سقف درخواست کد پیک در این ساعت پر شده است.',
          cooldown: (s) => `کد قبلی هنوز معتبر است؛ ${s} ثانیه دیگر.`,
          storeFail: 'ذخیره‌ی کد ناموفق بود؛ کمی بعد تلاش کنید.',
          smsFail: 'ارسال پیامک ناموفق بود؛ کمی بعد تلاش کنید.',
        },
        isProd: this.deps.config.isProd,
        // فاز-۲ — قالب اختصاصی پیک؛ اگر تنظیم نشده باشد همان قالب otp
        // (SmsService خودش fallback را مدیریت می‌کند)
        sendSms: (to, code) => this.deps.sms.sendCourierOtp(to, code),
      },
    )
  }

  async verifyOtp(phone: string, code: string): Promise<{ token: string; courierId: string }> {
    const courier = await this.deps.db.query.couriers.findFirst({
      where: and(eq(couriers.phone, phone), eq(couriers.isActive, true)),
    })
    if (!courier) throw Err.notFound('پیکی با این شماره ثبت نشده است.')

    // رارد ۴۸ — مکانیزم تایید روی هسته‌ی مشترک؛ پیام‌ها همان قبلی‌اند
    const result = await verifyOtp({ redis: this.deps.redis }, {
      phone,
      code,
      maxAttempts: COURIER_OTP_MAX_ATTEMPTS,
      ttlSeconds: COURIER_OTP_TTL_SECONDS,
      keys: otpKeys,
    })
    if (!result.ok && result.reason === 'no-code') {
      throw Err.validation('کدی برای این شماره صادر نشده یا منقضی شده است.')
    }
    if (!result.ok && result.reason === 'too-many') {
      throw Err.rateLimited('تلاش‌های ناموفق زیاد است؛ کد جدید بگیرید.', 60)
    }
    if (!result.ok) {
      // mismatch — شمارش همین‌جا بالا رفته (INCR اول) — فقط خطا
      throw Err.validation('کد وارد شده صحیح نیست.')
    }

    // توکن ۳ ساعته (stage-84) — QR روی فاکتور تا ۳ ساعت قابل اسکن می‌ماند
    const token = crypto.randomUUID()
    const stored = await this.deps.redis.set(K.token(token), JSON.stringify({ courierId: courier.id, phone }), {
      ex: COURIER_TOKEN_TTL_SECONDS,
    })
    if (stored !== 'OK') throw Err.serviceUnavailable('ذخیره نشست پیک ناموفق بود؛ دوباره وارد شوید.')
    return { token, courierId: courier.id }
  }

  /** از توکن — courierId یا null */
  async courierIdFromToken(token: string): Promise<string | null> {
    if (!token || token.length > 64) return null
    const v = await this.deps.redis.getJson<{ courierId: string; phone: string }>(K.token(token))
    return v?.courierId ?? null
  }

  // ── اسکن QR — رسیدن پیک → ON_THE_WAY ──

  // رارد L4 — همه‌ی مسیرهای «ناموفق اسکن» یک پیام می‌دهند تا QR-scanner
  // نتواند بین «سفارش نیست / وضعیت اشتباه / توکن غلط» تفکیک کند (status oracle).
  private static readonly SCAN_FAILED = 'اسکن ناموفق بود.'

  /** ترمیم اسکنِ استیج-۸۴ — پنجره‌ی اعتبارِ QR پس از «اولین اسکنِ موفق»:
   *  تا ۳ ساعت اسکن مجدد idempotent موفق است (خواسته‌ی کارفرما: «اگه اتفاقی
   *  پیش اومد دوباره اسکن کن»؛ قبلاً یک‌بارمصرف بود و ارور می‌داد)؛ پس از آن
   *  پیامِ انقضای صریح. لنگر = courierArrivedAt (زمانِ اولین اسکن). */
  private static readonly QR_RESCAN_WINDOW_MS = 3 * 60 * 60 * 1000
  private static readonly QR_EXPIRED = 'اعتبار این QR به پایان رسیده است.'

  /**
   * stage-84 — مسیرِ «رستوران → مقصد مشتری» برای نقشه‌ی صفحه‌ی اسکن.
   * best-effort: هر شکستی فقط polyline=null می‌دهد (خط مستقیم سمت کلاینت)؛
   * اسکنِ موفق هرگز به خاطر نقشه نمی‌شکند.
   */
  private async routeForScan(
    row: OrderRow,
  ): Promise<{
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number } | null
    address: string | null
    polyline: string | null
    distanceMeters: number | null
    durationSeconds: number | null
  }> {
    const fallback: RestaurantLocation = { lat: 37.4822056, lng: 49.4418273 }
    let origin = fallback
    try {
      origin = (await this.deps.settings?.restaurantLocation()) ?? fallback
    } catch {
      origin = fallback
    }
    const destination = row.customerLocation ?? null
    let polyline: string | null = null
    let distanceMeters: number | null = null
    let durationSeconds: number | null = null
    if (destination && this.deps.neshan) {
      try {
        const route = await this.deps.neshan.routeNoTraffic(origin, destination)
        if (route) {
          polyline = route.overviewPolyline
          distanceMeters = route.distanceMeters
          durationSeconds = route.durationSeconds
        }
      } catch {
        // بدون نقشه هم اسکن موفق است — خط مستقیم سمت کلاینت
      }
    }
    return { origin, destination, address: row.addressSnapshot ?? null, polyline, distanceMeters, durationSeconds }
  }

  async scanArrival(
    displayId: string,
    courierToken: string | null,
  ): Promise<{
    success: boolean
    message?: string
    /** ترمیم اسکنِ استیج-۸۴ — true یعنی «اسکنِ مجدد» (سفارش قبلاً در مسیر بوده)؛
     *  کلاینت توستِ متفاوت می‌دهد و وضعیت دوباره جابه‌جا نمی‌شود */
    alreadyScanned?: boolean
    trackingEnabled?: boolean
    /** stage-84 — فقط روی موفقیت: مسیر نمایشی برای نقشه‌ی اسکن */
    route?: {
      origin: { lat: number; lng: number }
      destination: { lat: number; lng: number } | null
      address: string | null
      polyline: string | null
      distanceMeters: number | null
      durationSeconds: number | null
    }
  }> {
    return this.scanArrivalOnce(displayId, courierToken, true)
  }

  private async scanArrivalOnce(
    displayId: string,
    courierToken: string | null,
    allowRetry: boolean,
  ): ReturnType<CourierService['scanArrival']> {
    let row: OrderRow
    try {
      row = await this.mustGet(displayId)
    } catch {
      return { success: false, message: CourierService.SCAN_FAILED }
    }
    if (row.deliveryType !== 'DELIVERY') {
      return { success: false, message: CourierService.SCAN_FAILED }
    }

    if (row.courierSecurityEnabled) {
      if (!courierToken) {
        return { success: false, message: CourierService.SCAN_FAILED }
      }
      const courierId = await this.courierIdFromToken(courierToken)
      if (!courierId) {
        return { success: false, message: CourierService.SCAN_FAILED }
      }
      if (!row.courierId || courierId !== row.courierId) {
        return { success: false, message: CourierService.SCAN_FAILED }
      }
    }

    // ترمیم اسکنِ استیج-۸۴ — اسکنِ مجدد: سفارشِ در مسیر، تا ۳ ساعت پس از
    // اولین اسکن، دوباره «موفق + مسیر» جواب می‌دهد (idempotent — بدون تغییرِ
    // وضعیت/زمان). حادثه/رفرش/بستنِ صفحه دیگر پیک را گیر نمی‌اندازد.
    if (row.status === 'ON_THE_WAY') {
      const arrivedAt = row.courierArrivedAt?.getTime() ?? 0
      if (
        !Number.isFinite(arrivedAt) || arrivedAt <= 0 ||
        Date.now() - arrivedAt >= CourierService.QR_RESCAN_WINDOW_MS
      ) {
        return { success: false, message: CourierService.QR_EXPIRED }
      }
      const route = await this.routeForScan(row)
      return { success: true, alreadyScanned: true, trackingEnabled: row.trackingEnabled === true, route }
    }

    if (row.status !== 'CONFIRMED') {
      return { success: false, message: CourierService.SCAN_FAILED }
    }
    // A tracked delivery cannot acquire a courier after dispatch; staff must
    // finish the deferred assignment while the order is still CONFIRMED.
    if (row.trackingEnabled && !row.courierId) {
      return { success: false, message: 'ابتدا از رستوران بخواهید پیک این سفارش را مشخص کند.' }
    }

    const updated = await this.deps.db.transaction(async (tx) => {
      const now = new Date()
      const [scanned] = await tx
        .update(orders)
        .set({ status: 'ON_THE_WAY', courierArrivedAt: now, updatedAt: now })
        .where(and(
          eq(orders.id, row.id),
          eq(orders.status, 'CONFIRMED'),
          eq(orders.deliveryType, 'DELIVERY'),
          eq(orders.courierSecurityEnabled, row.courierSecurityEnabled),
          row.courierId ? eq(orders.courierId, row.courierId) : isNull(orders.courierId),
        ))
        .returning()
      if (scanned?.courierId) await startCourierTrip(tx, scanned.courierId, now)
      return scanned
    })
    if (!updated) {
      // Another scan may have won the conditional update. Recheck security
      // and return the same rescan response instead of reporting a failure.
      if (allowRetry) return this.scanArrivalOnce(displayId, courierToken, false)
      return { success: false, message: CourierService.SCAN_FAILED }
    }

    // سفرِ پیک — باز کن اگر سشنِ بازی نیست، تحویل ثبت در confirmDelivery
    // stage-84 — مسیر رستوران→مشتری همراه پاسخ (نقشه‌ی صفحه‌ی اسکن)
    const route = await this.routeForScan(updated)
    return { success: true, alreadyScanned: false, trackingEnabled: updated.trackingEnabled === true, route }
  }

  // ── استریم موقعیت ──

  /**
   * موقعیت پیک — فقط ON_THE_WAY + سفارش trackingEnabled.
   * محدودسازی: بیش از یک آپدیت در ۳ ثانیه → رد بی‌جواب.
   */
  async updateLocation(
    courierToken: string,
    displayId: string,
    lat: number,
    lng: number,
  ): Promise<{ success: boolean; message?: string; accepted?: boolean; stopTracking?: boolean }> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw Err.validation('مختصات موقعیت معتبر نیست.')
    }
    const courierId = await this.courierIdFromToken(courierToken)
    if (!courierId) throw Err.unauthorized('نشست پیک منقضی شده است.')

    const row = await this.mustGet(displayId)
    if (row.deliveryType !== 'DELIVERY' || row.status !== 'ON_THE_WAY') {
      return { success: false, message: 'سفارش در مسیر نیست', stopTracking: true }
    }
    if (!row.trackingEnabled) {
      return { success: false, message: 'ردیابی این سفارش فعال نیست', stopTracking: true }
    }
    if (!row.courierId || courierId !== row.courierId) {
      return { success: false, message: 'این پیک به این سفارش تخصیص نیافته', stopTracking: true }
    }

    // محدودسازی سرور — setNx با TTL کوتاه
    const throttleKey = K.throttle(row.id)
    const admitted = await this.deps.redis.setNx(throttleKey, '1', { ex: Math.ceil(LOCATION_THROTTLE_MS / 1000) })
    if (admitted === false) {
      return { success: true, accepted: false }
    }
    if (admitted === null) {
      throw Err.serviceUnavailable('ارسال موقعیت موقتاً در دسترس نیست؛ دوباره تلاش کنید.')
    }

    const [updated] = await this.deps.db
      .update(orders)
      .set({ courierLocation: { lat, lng }, updatedAt: new Date() })
      .where(and(
        eq(orders.id, row.id),
        eq(orders.deliveryType, 'DELIVERY'),
        eq(orders.status, 'ON_THE_WAY'),
        eq(orders.trackingEnabled, true),
        eq(orders.courierId, asCourierId(courierId)),
      ))
      .returning({ id: orders.id })
    if (!updated) return { success: false, message: 'وضعیت یا پیک سفارش تغییر کرده است', stopTracking: true }
    return { success: true, accepted: true }
  }

  // ── مدیریت (ادمین اصلی) ──

  async listCouriers(): Promise<Array<typeof couriers.$inferSelect>> {
    return this.deps.db.select().from(couriers).orderBy(desc(couriers.createdAt))
  }

  /** SQL pagination with complete scoped totals and two recent deliveries
   * per courier. Historical filters never truncate by trip age or a row cap. */
  async listCouriersPage(filters: {
    page: number
    limit: number
    search?: string
    dateFrom?: string
    dateTo?: string
    admin2Id?: string
  }): Promise<{ couriers: CourierListRowDto[]; total: number }> {
    const { db } = this.deps
    const text = filters.search?.trim()
    const courierWhere = text
      ? or(ilike(couriers.name, likePattern(text)), ilike(couriers.phone, likePattern(text)))
      : undefined
    const parseDate = (value?: string) => {
      const date = value ? new Date(value) : undefined
      return date && Number.isFinite(date.getTime()) ? date : undefined
    }
    const from = parseDate(filters.dateFrom)
    const to = parseDate(filters.dateTo)
    if (from && to && from > to) throw Err.validation('تاریخ شروع باید پیش از تاریخ پایان باشد.')
    const filtered = Boolean(from || to || filters.admin2Id)
    const deliveryWhere = and(
      from ? gte(courierDeliveries.deliveredAt, from) : undefined,
      to ? lte(courierDeliveries.deliveredAt, to) : undefined,
      filters.admin2Id ? sql`${courierDeliveries.orderId} in (
        select ${orders.id} from ${orders} where ${orders.confirmedBy} = ${filters.admin2Id}
      )` : undefined,
    )
    const visibleWhere = and(courierWhere, filtered ? sql`exists (
      select 1 from ${courierTrips}
      join ${courierDeliveries} on ${courierDeliveries.tripId} = ${courierTrips.id}
      where ${courierTrips.courierId} = ${couriers.id} and ${deliveryWhere}
    )` : undefined)
    const page = Math.min(Math.max(1, Math.floor(filters.page || 1)), 100000)
    const limit = Math.min(Math.max(1, Math.floor(filters.limit || 10)), 100)
    const [counts, pageRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(couriers).where(visibleWhere),
      db.select().from(couriers).where(visibleWhere)
        .orderBy(desc(couriers.createdAt), desc(couriers.id)).limit(limit).offset((page - 1) * limit),
    ])
    const total = counts[0]?.count ?? 0
    const courierIds = pageRows.map((courier) => courier.id)
    if (!courierIds.length) return { couriers: [], total }

    // Aggregate the complete selected range; only the two latest deliveries
    // per courier are transferred for card previews.
    const ranked = db.select({
      id: courierDeliveries.id,
      courierId: courierTrips.courierId,
      tripId: courierDeliveries.tripId,
      startedAt: courierTrips.startedAt,
      completedAt: courierTrips.completedAt,
      orderId: orders.displayId,
      addressSnapshot: courierDeliveries.addressSnapshot,
      deliveredAt: courierDeliveries.deliveredAt,
      amount: courierDeliveries.amount,
      rank: sql<number>`row_number() over (partition by ${courierTrips.courierId}
        order by ${courierDeliveries.deliveredAt} desc, ${courierDeliveries.id} desc)`.as('delivery_rank'),
    }).from(courierDeliveries)
      .innerJoin(courierTrips, eq(courierTrips.id, courierDeliveries.tripId))
      .innerJoin(orders, eq(orders.id, courierDeliveries.orderId))
      .where(and(inArray(courierTrips.courierId, courierIds), deliveryWhere)).as('ranked_deliveries')
    const [aggregates, previews] = await Promise.all([
      db.select({
        courierId: courierTrips.courierId,
        totalTrips: filtered
          ? sql<number>`count(distinct case when ${courierDeliveries.id} is not null then ${courierTrips.id} end)::int`
          : sql<number>`count(distinct ${courierTrips.id})::int`,
        totalDeliveries: sql<number>`count(${courierDeliveries.id})::int`,
        totalAmount: sql<number>`coalesce(sum(${courierDeliveries.amount}), 0)::bigint`,
      }).from(courierTrips)
        .leftJoin(courierDeliveries, and(eq(courierDeliveries.tripId, courierTrips.id), deliveryWhere))
        .where(inArray(courierTrips.courierId, courierIds)).groupBy(courierTrips.courierId),
      db.select().from(ranked).where(lte(ranked.rank, 2)).orderBy(desc(ranked.deliveredAt)),
    ])
    const totals = new Map(aggregates.map((value) => [value.courierId, value]))
    const byCourier = new Map<string, CourierListRowDto['trips']>()
    for (const delivery of previews) {
      const trips = byCourier.get(delivery.courierId) ?? []
      let trip = trips.find((value) => value.id === delivery.tripId)
      if (!trip) {
        trip = { id: delivery.tripId, startedAt: delivery.startedAt, completedAt: delivery.completedAt, deliveries: [] }
        trips.push(trip)
      }
      trip.deliveries.push({
        id: delivery.id,
        orderId: delivery.orderId, addressSnapshot: delivery.addressSnapshot,
        deliveredAt: delivery.deliveredAt, amount: delivery.amount,
      })
      byCourier.set(delivery.courierId, trips)
    }
    return {
      couriers: pageRows.map((courier) => ({
        id: courier.id, name: courier.name, phone: courier.phone, createdAt: courier.createdAt,
        trips: byCourier.get(courier.id) ?? [],
        totalTrips: totals.get(courier.id)?.totalTrips ?? 0,
        totalDeliveries: totals.get(courier.id)?.totalDeliveries ?? 0,
        totalAmount: Number(totals.get(courier.id)?.totalAmount ?? 0),
      })),
      total,
    }
  }

  async addCourier(input: { name: string; phone: string }): Promise<{ success: boolean; message?: string }> {
    const name = input.name.trim()
    if (!name) throw Err.validation('نام پیک را وارد کنید.')
    const [created] = await this.deps.db.insert(couriers).values({ ...input, name })
      .onConflictDoNothing({ target: couriers.phone }).returning({ id: couriers.id })
    if (!created) return { success: false, message: 'پیکی با این شماره از قبل موجود است' }
    return { success: true }
  }

  // ── سفرها (گزارش پنل) ──

  /**
   * جزئیات پیک — سفرها + تحویل‌ها؛ admin2Id فقط تحویل‌های سفارشات خودش.
   *
   * round-17 — فیلتر admin2 با semi-join در SQL: قبلاً «همه‌ی» شناسه‌ی
   * سفارش‌های تاییدشده‌ی ادمین۲ بارگذاری و در JS عضویت چک می‌شد
   * (هزاران ردیف برای هر بازدید). شکل پاسخ عیناً همان است.
   */
  async courierDetail(courierId: string, admin2Id?: string) {
    const courier = await this.deps.db.query.couriers.findFirst({
      where: eq(couriers.id, asCourierId(courierId)),
    })
    if (!courier) throw Err.notFound('پیک پیدا نشد.')

    const trips = await this.deps.db
      .select()
      .from(courierTrips)
      .where(eq(courierTrips.courierId, asCourierId(courierId)))
      .orderBy(desc(courierTrips.startedAt))

    const tripIds = trips.map((t) => t.id)
    // فقط تحویل‌های سفارشاتی که خودش تایید کرده — زیرکوئری روی
    // ایندکس orders_confirmed_by_idx، بدون بارگذاری هیچ id ی
    const ownership = admin2Id
      ? sql`and ${courierDeliveries.orderId} in (
          select ${orders.id} from ${orders}
          where ${orders.confirmedBy} = ${admin2Id}
        )`
      : sql``
    const deliveries = tripIds.length
      ? await this.deps.db
        .select({ delivery: courierDeliveries, displayId: orders.displayId })
        .from(courierDeliveries)
        .innerJoin(orders, eq(orders.id, courierDeliveries.orderId))
        .where(sql`${inArray(courierDeliveries.tripId, tripIds)} ${ownership}`)
        .orderBy(desc(courierDeliveries.deliveredAt))
        .then((rows) => rows.map(({ delivery, displayId }) => ({ ...delivery, orderId: displayId })))
      : []

    // stage-55 — مجموع از SQL واقعی (قبلاً: fetch همه‌ی ردیف‌ها + reduce در JS).
    // ردیف‌ها برای chartData/trips همچنان لازم‌اند؛ فقط جمع/شمارش به دیتابیس رفت.
    // ::bigint بدون سقف + Number() چون Bun.sql مقدار bigint را string برمی‌گرداند.
    const [totals] = tripIds.length
      ? await this.deps.db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${courierDeliveries.amount}), 0)::bigint`,
        })
        .from(courierDeliveries)
        .where(sql`${inArray(courierDeliveries.tripId, tripIds)} ${ownership}`)
      : [{ count: 0, total: 0 }]

    const byTrip = new Map<string, typeof deliveries>()
    for (const delivery of deliveries) {
      const group = byTrip.get(delivery.tripId) ?? []
      group.push(delivery)
      byTrip.set(delivery.tripId, group)
    }
    return {
      courier,
      trips: trips.map((t) => ({
        ...t,
        deliveries: byTrip.get(t.id) ?? [],
      })).filter((trip) => !admin2Id || trip.deliveries.length > 0),
      totalDeliveries: totals?.count ?? 0,
      totalAmount: Number(totals?.total ?? 0),
      // ⬅ phase-3: نمودار از تحویل‌های واقعی — نقش‌محور
      // (ادمین۲ فقط تحویل‌های سفارشات خودش را می‌بیند)
      chartData: buildRangeCharts(
        deliveries.map((d) => ({ date: d.deliveredAt, value: d.amount })),
      ),
    }
  }

  // ── داخلی ──

  private async mustGet(displayId: string): Promise<OrderRow> {
    // رارد ۴۸ — همان order-lookup مشترک (قبلاً کپی محلی همین منطق بود)
    return requireOrder(this.deps.db, displayId)
  }
}
