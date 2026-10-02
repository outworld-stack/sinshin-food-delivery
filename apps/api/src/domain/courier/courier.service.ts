//src/domain/courier/courier.service.ts
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { buildRangeCharts } from '#/domain/shared/charts'
import type { Db } from '#/infra/db/client'
import { courierDeliveries, courierTrips, couriers, orders, type OrderRow } from '#/infra/db/schema'
import type { CourierListRowDto } from '@sinshin/shared'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { RedisService } from '#/infra/redis/redis'
import type { SmsService } from '#/infra/sms/sms.service'
import { sendOtp, verifyOtp, type OtpKeys } from '#/domain/shared/otp-core'
import { asCourierId } from '#/domain/shared/brand'
import { requireOrder } from '#/domain/order/order-lookup'

const COURIER_TOKEN_TTL_SECONDS = 3600 // ۱ ساعت
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
 * پیک با شماره‌ی خودش OTP می‌گیرد → توکن ۱ ساعته → اسکنِ فقط پیکِ تخصیصی.
 * بدون security: اسکن آزاد.
 */
export class CourierService {
  constructor(
    private readonly deps: { db: Db; config: AppConfig; redis: RedisService; sms: SmsService },
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
    return sendOtp(this.deps, {
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
      smsText: (code) => `کد ورود پیک سین‌شین: ${code}`,
      isProd: this.deps.config.isProd,
    })
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

    // توکن ۱ ساعته
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

  async scanArrival(
    displayId: string,
    courierToken: string | null,
  ): Promise<{ success: boolean; message?: string }> {
    const row = await this.mustGet(displayId)
    if (row.status !== 'CONFIRMED') {
      return { success: false, message: 'وضعیت سفارش اجازه اسکن نمی‌دهد' }
    }
    if (row.deliveryType !== 'DELIVERY') {
      return { success: false, message: 'این سفارش ارسال با پیک ندارد' }
    }

    if (row.courierSecurityEnabled) {
      if (!courierToken) {
        return { success: false, message: 'این سفارش نیاز به احراز هویت پیک دارد' }
      }
      const courierId = await this.courierIdFromToken(courierToken)
      if (!courierId) {
        return { success: false, message: 'نشست پیک منقضی شده؛ دوباره کد بگیرید' }
      }
      if (row.courierId && courierId !== row.courierId) {
        return { success: false, message: 'این پیک به این سفارش تخصیص نیافته' }
      }
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
    if (!updated) return { success: false, message: 'وضعیت تغییر کرد؛ دوباره تلاش کنید' }

    // سفرِ پیک — باز کن اگر سشنِ بازی نیست، تحویل ثبت در confirmDelivery
    return { success: true }
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
    const courierWhere = text
      ? or(ilike(couriers.name, `%${text}%`), ilike(couriers.phone, `%${text}%`))
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

    const courierRows = await db
      .select()
      .from(couriers)
      .where(visibleWhere)
      .orderBy(desc(couriers.createdAt))

    const total = courierRows.length
    const start = (filters.page - 1) * filters.limit
    const pageRows = courierRows.slice(start, start + filters.limit)

    // سفرها و تحویل‌ها فقط برای همین صفحه — نه کل پیک‌ها
    const courierIds = pageRows.map((c) => c.id)
    const trips = courierIds.length
      ? await db
        .select()
        .from(courierTrips)
        .where(inArray(courierTrips.courierId, courierIds))
        .orderBy(desc(courierTrips.startedAt))
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

    return {
      courier,
      trips: trips.map((t) => ({
        ...t,
        deliveries: deliveries.filter((d) => d.tripId === t.id),
      })),
      totalDeliveries: deliveries.length,
      totalAmount: deliveries.reduce((s, d) => s + d.amount, 0),
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