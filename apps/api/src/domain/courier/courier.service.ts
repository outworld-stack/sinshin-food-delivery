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
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
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
      where: eq(couriers.phone, phone),
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
      where: eq(couriers.phone, phone),
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
    await this.deps.redis.setJson(K.token(token), { courierId: courier.id, phone }, {
      ex: COURIER_TOKEN_TTL_SECONDS,
    })
    return { token, courierId: courier.id }
  }

  /** از توکن — courierId یا null */
  async courierIdFromToken(token: string): Promise<string | null> {
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
      if (row.courierId && courierId !== row.courierId) {
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
      return { success: true, alreadyScanned: true, route }
    }

    if (row.status !== 'CONFIRMED') {
      return { success: false, message: CourierService.SCAN_FAILED }
    }

    const [updated] = await this.deps.db
      .update(orders)
      .set({
        status: 'ON_THE_WAY',
        courierArrivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, row.id), eq(orders.status, 'CONFIRMED')))
      .returning()
    if (!updated) {
      // Another scan may have won the conditional update. Recheck security
      // and return the same rescan response instead of reporting a failure.
      if (allowRetry) return this.scanArrivalOnce(displayId, courierToken, false)
      return { success: false, message: CourierService.SCAN_FAILED }
    }

    // سفرِ پیک — باز کن اگر سشنِ بازی نیست، تحویل ثبت در confirmDelivery
    // stage-84 — مسیر رستوران→مشتری همراه پاسخ (نقشه‌ی صفحه‌ی اسکن)
    const route = await this.routeForScan(updated)
    return { success: true, alreadyScanned: false, route }
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
  ): Promise<{ success: boolean; message?: string }> {
    const courierId = await this.courierIdFromToken(courierToken)
    if (!courierId) throw Err.unauthorized('نشست پیک منقضی شده است.')

    const row = await this.mustGet(displayId)
    if (row.status !== 'ON_THE_WAY') {
      return { success: false, message: 'سفارش در مسیر نیست' }
    }
    if (!row.trackingEnabled) {
      return { success: false, message: 'ردیابی این سفارش فعال نیست' }
    }
    if (row.courierSecurityEnabled && row.courierId && courierId !== row.courierId) {
      return { success: false, message: 'این پیک به این سفارش تخصیص نیافته' }
    }

    // محدودسازی سرور — setNx با TTL کوتاه
    const throttleKey = K.throttle(displayId)
    if (!(await this.deps.redis.setNx(throttleKey, '1', { ex: Math.ceil(LOCATION_THROTTLE_MS / 1000) }))) {
      return { success: true } // ردِ بی‌جواب — مشتری بعدی را می‌گیرد
    }

    await this.deps.db
      .update(orders)
      .set({ courierLocation: { lat, lng }, updatedAt: new Date() })
      .where(eq(orders.id, row.id))
    return { success: true }
  }

  // ── مدیریت (ادمین اصلی) ──

  async listCouriers(): Promise<Array<typeof couriers.$inferSelect>> {
    return this.deps.db.select().from(couriers).orderBy(desc(couriers.createdAt))
  }

  /**
   * لیست پیک‌ها با فیلتر و شکل واقعی صفحهٔ پنل:
   * { couriers: [{id,name,phone,trips:[{...,deliveries:[]}]}], total }
   * بازهٔ زمانی روی deliveredAt اعمال می‌شود؛ پیک/سفرِ بدون تحویل در بازه حذف می‌شود.
   * (تاریخچه: round-11 شکل پاسخ ساخت؛ round-17 کوئری‌ها به SQL منتقل شدند)
   *
   * round-17 — صفحه‌بندی لیست پیک‌ها با push-down کامل به SQL:
   *
   * قبلاً «همه‌ی» سفرها و «همه‌ی» تحویل‌های تاریخچه به حافظه بارگذاری و
   * بعد در JS فیلتر/صفحه‌بندی می‌شدند — با رشد ماه‌ها، هر بازدید این
   * صفحه کل past را می‌کشید.
   *
   * حالا:
   *  • «پیک‌های قابل‌دیدن» با EXISTS زیرکوئری در SQL (فیلتر بازه)
   *  • سفرها/تحویل‌ها فقط برای پیک‌های «صفحه‌ی» فعلی
   *  • فیلتر بازه‌ی تحویل‌ها داخل SQL (ایندکس delivered_at)
   *
   * شکل پاسخ عیناً دست‌نخورده ماند (قرارداد فرانت همان است).
   */
  async listCouriersPage(filters: {
    page: number
    limit: number
    search?: string
    dateFrom?: string
    dateTo?: string
  }): Promise<{
    // رارد ۴۷ — شکل ردیف از قرارداد مشترک (CourierListRowDto)؛ trips روی
    // سیم ستون‌های بیشتری دارد ولی مصرف‌کننده فقط زیرمجموعه‌ی قرارداد را می‌خواند
    couriers: CourierListRowDto[]
    total: number
  }> {
    const { db } = this.deps

    // فیلتر متن روی نام/موبایل (مثل «محمد یا 0912...»)
    const text = filters.search?.trim()
    // stage-55 — escape wildcard جستجو (٪ و _ و \) — الگوی امنِ «شامل»
    const courierWhere = text
      ? or(ilike(couriers.name, likePattern(text)), ilike(couriers.phone, likePattern(text)))
      : undefined

    // بازهٔ تحویل — تاریخ‌های خراب بی‌اثرند (نه ۵۰۰)
    const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : undefined
    const toDate = filters.dateTo ? new Date(filters.dateTo) : undefined
    const from = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined
    const to = toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined
    const hasRange = from !== undefined || to !== undefined

    // پیکِ قابل‌دیدن = (بدون بازه: همه) یا (با بازه: دارای حداقل یک
    // تحویلِ داخل بازه) — EXISTS، بدون بارگذاری هیچ ردیفی
    const rangeExists = hasRange
      ? sql`exists (
          select 1 from ${courierTrips} t
          join ${courierDeliveries} d on d.trip_id = t.id
          where t.courier_id = ${couriers.id}
            ${from ? sql`and d.delivered_at >= ${from}` : sql``}
            ${to ? sql`and d.delivered_at <= ${to}` : sql``}
        )`
      : undefined
    const visibleWhere = and(courierWhere, rangeExists)

    // رارد M10 — شمارش و صفحه‌بندی در SQL: قبلاً «همه‌ی» ردیف‌های پیکِ
    // منطبق بارگذاری و در JS برش می‌شد. سقف دفاعی صفحه هم اینجاست.
    const total = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(couriers)
      .where(visibleWhere)
      .then((r) => r[0]?.count ?? 0)

    const page = Math.min(Math.max(1, filters.page || 1), 500)
    const limit = Math.min(Math.max(1, filters.limit || 10), 50)
    const pageRows = await db
      .select()
      .from(couriers)
      .where(visibleWhere)
      .orderBy(desc(couriers.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    // سفرها و تحویل‌ها فقط برای همین صفحه — نه کل پیک‌ها
    // رارد M10 — سفرها به پنجره‌ی ۹۰ روزه (یا بازه‌ی گزارش با ۱ روز مهلت)
    // محدود شدند: قبلاً تاریخچه‌ی نامحدود هر پیک در هر بازدید لود می‌شد.
    const courierIds = pageRows.map((c) => c.id)
    const tripsFloor = from
      ? new Date(from.getTime() - 24 * 3600 * 1000) // مهلت ۱ روز قبل از بازه
      : new Date(Date.now() - 90 * 24 * 3600 * 1000) // پیش‌فرض: ۹۰ روز اخیر
    const trips = courierIds.length
      ? await db
        .select()
        .from(courierTrips)
        .where(
          and(
            inArray(courierTrips.courierId, courierIds),
            gte(courierTrips.startedAt, tripsFloor),
          ),
        )
        .orderBy(desc(courierTrips.startedAt))
        .limit(600)
      : []

    // فیلتر بازه داخل SQL — ایندکس courier_deliveries_delivered_idx
    const tripIds = trips.map((t) => t.id)
    const dConds: SQL[] = []
    if (tripIds.length > 0) dConds.push(inArray(courierDeliveries.tripId, tripIds))
    if (from) dConds.push(gte(courierDeliveries.deliveredAt, from))
    if (to) dConds.push(lte(courierDeliveries.deliveredAt, to))
    const deliveries =
      tripIds.length > 0
        ? await db
          .select()
          .from(courierDeliveries)
          .where(dConds.length > 0 ? and(...dConds) : undefined)
        : []

    const byTrip = new Map<string, Array<typeof courierDeliveries.$inferSelect>>()
    for (const d of deliveries) {
      const list = byTrip.get(d.tripId as string) ?? []
      list.push(d)
      byTrip.set(d.tripId as string, list)
    }
    const byCourier = new Map<string, Array<typeof courierTrips.$inferSelect>>()
    for (const t of trips) {
      const list = byCourier.get(t.courierId as string) ?? []
      list.push(t)
      byCourier.set(t.courierId as string, list)
    }

    return {
      couriers: pageRows.map((c) => ({
        id: c.id as string,
        name: c.name,
        phone: c.phone,
        createdAt: c.createdAt,
        trips: (byCourier.get(c.id as string) ?? [])
          .map((t) => ({ ...t, deliveries: byTrip.get(t.id as string) ?? [] }))
          // در حالت بازه: سفرهای بی‌تحویلِ داخل بازه نمایش داده نمی‌شوند
          .filter((t) => (hasRange ? t.deliveries.length > 0 : true)),
      })),
      total,
    }
  }

  async addCourier(input: { name: string; phone: string }): Promise<{ success: boolean; message?: string }> {
    const clash = await this.deps.db.query.couriers.findFirst({
      where: eq(couriers.phone, input.phone),
    })
    if (clash) return { success: false, message: 'پیکی با این شماره از قبل موجود است' }
    await this.deps.db.insert(couriers).values(input)
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
        .select()
        .from(courierDeliveries)
        .where(sql`${inArray(courierDeliveries.tripId, tripIds)} ${ownership}`)
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

    return {
      courier,
      trips: trips.map((t) => ({
        ...t,
        deliveries: deliveries.filter((d) => d.tripId === t.id),
      })),
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
