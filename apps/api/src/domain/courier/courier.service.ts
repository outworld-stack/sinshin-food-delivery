//src/domain/courier/courier.service.ts
import { and, desc, eq, sql } from 'drizzle-orm'
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

  async addCourier(input: { name: string; phone: string }): Promise<{ success: boolean; message?: string }> {
    const clash = await this.deps.db.query.couriers.findFirst({
      where: eq(couriers.phone, input.phone),
    })
    if (clash) return { success: false, message: 'پیکی با این شماره از قبل موجود است' }
    await this.deps.db.insert(couriers).values(input)
    return { success: true }
  }

  // ── سفرها (گزارش پنل) ──

  /** جزئیات پیک — سفرها + تحویل‌ها؛ admin2Id فقط تحویل‌های سفارشات خودش */
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
    let deliveries = tripIds.length
      ? await this.deps.db
        .select()
        .from(courierDeliveries)
        .where(sql`${courierDeliveries.tripId} in ${tripIds}`)
      : []

    // فیلتر admin2 — فقط تحویل‌های سفارشاتی که خودش تایید کرده
    if (admin2Id) {
      const myOrderIds = await this.deps.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.confirmedBy, admin2Id))
        .then((rows) => rows.map((r) => r.id))
      deliveries = deliveries.filter((d) => myOrderIds.includes(d.orderId))
    }

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