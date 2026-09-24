//src/domain/courier/courier.service.ts
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { buildRangeCharts } from '#/domain/shared/charts'
import type { Db } from '#/infra/db/client'
import { courierDeliveries, courierTrips, couriers, orders, type OrderRow } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { RedisService } from '#/infra/redis/redis'
import type { SmsService } from '#/infra/sms/sms.service'
import { randomOtpCode, sha256, safeEqual } from '#/domain/shared/crypto'
import { asCourierId } from '#/domain/shared/brand'

const DISPLAY_RE = /^ord-[a-z0-9]{8}$/
const COURIER_TOKEN_TTL_SECONDS = 3600 // ۱ ساعت
const LOCATION_THROTTLE_MS = 3000 // حداکثر یک آپدیت در ۳ ثانیه
const COURIER_OTP_MAX_ATTEMPTS = 5

const K = {
  code: (phone: string) => `courier:otp:${phone}`,
  token: (token: string) => `courier:tok:${token}`,
  throttle: (orderId: string) => `courier:loc:${orderId}`,
  cd: (phone: string) => `courier:cd:${phone}`,
  attempts: (phone: string) => `courier:att:${phone}`,
  hour: (phone: string) => `courier:h:${phone}`,
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

    const cooldown = 60
    // phase-1: قبلاً «وجود کد» چک می‌شد (یعنی عملاً ۱۲۰ ثانیه) ولی پیام ۶۰ می‌داد
    if (await this.deps.redis.exists(K.cd(phone))) {
      throw Err.rateLimited(`کد قبلی هنوز معتبر است؛ ${cooldown} ثانیه دیگر.`, cooldown)
    }
    // phase-1: سقف ساعتی هر شماره — پیامک هزینه دارد
    const hourCount = Number((await this.deps.redis.get(K.hour(phone))) ?? 0)
    if (hourCount >= 5) {
      throw Err.rateLimited('سقف درخواست کد پیک در این ساعت پر شده است.', 3600)
    }

    const code = randomOtpCode(4)
    await this.deps.redis.set(K.code(phone), sha256(`${code}:${phone}`), { ex: 120 })
    await this.deps.redis.set(K.cd(phone), '1', { ex: cooldown })
    await this.deps.redis.incr(K.hour(phone))
    await this.deps.redis.expire(K.hour(phone), 3600)
    await this.deps.redis.del(K.attempts(phone)) // ریست تلاش‌ها با کد جدید

    // phase-1: پیامک واقعی — قبلاً فقط console.log بود؛ یعنی کدِ OTP در لاگِ prod!
    const sent = await this.deps.sms.send(phone, `کد ورود پیک سین‌شین: ${code}`)
    if (!sent && this.deps.config.isProd) {
      await this.deps.redis.del(K.code(phone))
      await this.deps.redis.del(K.cd(phone))
      throw Err.internal('ارسال پیامک ناموفق بود؛ کمی بعد تلاش کنید.')
    }

    // phase-1 (باگ 🔴۱): در prod هرگز — شرط provider===console حذف شد
    const reveal = !this.deps.config.isProd
    return { cooldownSeconds: cooldown, ...(reveal ? { devCode: code } : {}) }
  }

  async verifyOtp(phone: string, code: string): Promise<{ token: string; courierId: string }> {
    const courier = await this.deps.db.query.couriers.findFirst({
      where: eq(couriers.phone, phone),
    })
    if (!courier) throw Err.notFound('پیکی با این شماره ثبت نشده است.')

    const stored = await this.deps.redis.get(K.code(phone))
    if (!stored) throw Err.validation('کدی برای این شماره صادر نشده یا منقضی شده است.')

    // phase-1: سقف تلاش — کد ۴ رقمی با TTL ۱۲۰s و بدون سقف، brute-force می‌شد
    const attempts = Number((await this.deps.redis.get(K.attempts(phone))) ?? 0)
    if (attempts >= COURIER_OTP_MAX_ATTEMPTS) {
      await this.deps.redis.del(K.code(phone))
      throw Err.rateLimited('تلاش‌های ناموفق زیاد است؛ کد جدید بگیرید.', 60)
    }

    if (!safeEqual(stored, sha256(`${code}:${phone}`))) {
      await this.deps.redis.incr(K.attempts(phone))
      await this.deps.redis.expire(K.attempts(phone), 120)
      throw Err.validation('کد وارد شده صحیح نیست.')
    }

    await this.deps.redis.del(K.code(phone))
    await this.deps.redis.del(K.attempts(phone))

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
   * throttle: بیش از یک آپدیت در ۳ ثانیه → رد بی‌جواب.
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

    // throttle سرور — setNx با TTL کوتاه
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
    couriers: Array<{
      id: string
      name: string
      phone: string
      createdAt: Date
      trips: Array<
        typeof courierTrips.$inferSelect & {
          deliveries: Array<typeof courierDeliveries.$inferSelect>
        }
      >
    }>
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
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const row = (
      await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId))
    )[0]
    if (!row) throw Err.notFound('سفارش پیدا نشد.')
    return row
  }
}