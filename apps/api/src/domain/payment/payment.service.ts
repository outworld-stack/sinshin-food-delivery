// ══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/payment/payment.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (سلامت پول در پروداکشن — درخواست کاربر «پرداخت خطاپذیر است»):
//   ① حذف کامل درگاه Pay.ir (آداپتر + رجیستری) — ملت/زرین‌پال/سامان ماندند.
//   ② callback نامشخص (indeterminate) دیگر 503/JSON خام به مشتری نمی‌دهد —
//      302 به صفحه‌ی سفارش با ?payment=pending (پولینگ ۳ ثانیه‌ای خودش حل می‌کند).
//   ③ رِتری پرداخت برای سفارش‌های PENDING_PAYMENT («ادامه پرداخت از صفحه‌ی
//      سفارش» که پیامِ خطای چک‌اوت قولش را می‌داد ولی مسیرش وجود نداشت).
//   ④ R12 واقعی شد: پرداخت ۲۴ساعته‌ی حل‌نشده به‌جای console.error ابدی،
//      ردیف reconcile_findings می‌سازد (دیده در پنل مغایرت‌گیری).
//   ⑤ ردیف‌های تاریخی PENDING با gateway=PAYIR هرگز fail خودکار نمی‌شوند
//      (پول ممکن است در پی‌ایر گرفته شده باشد) → finding دستی R12.
//   ⑥ callbackUrl مسیر MOCK (که روتش وجود نداشت) دیگر در DB ثبت نمی‌شود.
// ══════════════════════════════════════════════════════════════

// src/domain/payment/payment.service.ts
import { and, desc, eq, lt, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders, payments, reconcileFindings, type PaymentRow } from '#/infra/db/schema'
import type { PaymentId } from '#/domain/shared/brand'
import type { AppConfig } from '#/infra/config/env'
import { AppError, Err } from '#/domain/shared/errors'
import type { OrderService } from '#/domain/order/order.service'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { NotificationService } from '#/domain/notification/notification.service'
import { signState, verifyState } from './state'
import { MockAdapter } from './mock.adapter'
import { ZarinpalAdapter } from './zarinpal.adapter'
import { SepAdapter } from './sep.adapter'
import { MellatAdapter } from './mellat.adapter'
import type { PaymentGateway } from './gateway.types'

/** stage-58 — درگاه‌های واقعیِ پشتیبانی‌شده (منبع واحد بک‌اند؛ پی‌ایر حذف شد) */
export const REAL_GATEWAY_IDS = ['MELLAT', 'ZARINPAL', 'SEP'] as const

/** پنجره‌ی «callback شاید هنوز در راه است» — رِتریِ زودتر از این رد می‌شود */
const RETRY_GRACE_MS = 15 * 60_000

export class PaymentService {
  private readonly gateways: Map<string, PaymentGateway>

  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      orders: OrderService
      /** round-16 — اعلام سفارش جدید/نهایی‌شده به پنل زنده (SSE) */
      hub: SseHub
      /** stage-52 — سفارش جدید صف زنده: Web Push به ادمین‌های سطح ۲ */
      notifications: NotificationService
    },
  ) {
    this.gateways = new Map<string, PaymentGateway>([
      ['MOCK', new MockAdapter(deps.config)],
      ['ZARINPAL', new ZarinpalAdapter(deps.config)],
      ['SEP', new SepAdapter(deps.config)],
      ['MELLAT', new MellatAdapter(deps.config)],
    ])
  }

  /** stage-58 — برای روت‌های callback: مقصد امنِ خطا (به‌جای JSON خام در مرورگر مشتری) */
  get siteUrl(): string {
    return this.deps.config.siteUrl
  }

  gateway(id: string): PaymentGateway {
    const gw = this.gateways.get(id.toUpperCase())
    if (!gw) throw Err.validation('درگاه پرداخت انتخابی معتبر نیست.')

    // phase-1 (باگ 🔴۳): تطابق «دو جهانه» درگاه با کانفیگ —
    // gatewayId=MOCK در حالت real → پرداخت صفر تومانی؛ درگاه real در mock → مسدود
    if (gw.mode === 'mock' && this.deps.config.gateway.mode !== 'mock') {
      throw Err.conflict('درگاه MOCK فقط در حالت توسعه (GATEWAY_MODE=mock) فعال است.')
    }
    if (gw.mode !== 'mock' && this.deps.config.gateway.mode === 'mock') {
      throw Err.conflict('درگاه واقعی فعال نیست — GATEWAY_MODE را تنظیم کنید.')
    }
    return gw
  }

  /** شروع پرداخت — بعد از commit چک‌اوت (شبکه بیرون تراکنش) */
  async initiate(
    paymentId: PaymentId,
    gatewayId: string,
    input: { displayId: string; amount: number; mobile?: string | null },
  ): Promise<{ paymentUrl: string }> {
    const { db } = this.deps
    const gw = this.gateway(gatewayId)

    // phase-2 (باگ 🔴۲): state داخل callbackUrl —
    // قبلاً callbackUrl بدون ?state ساخته می‌شد و verifyState(query.state ?? '')
    // همیشه null → callback همیشه 403 → سفارش تا ابد PENDING و پول مشتری گیر
    const state = signState(paymentId, this.deps.config.jwtSecret)
    const callbackUrl =
      gw.mode === 'mock'
        ? // stage-58 — روت mock/callback وجود ندارد؛ ثبت URL ساختگی در DB فقط
          // داده‌ی ممیزی را آلوده می‌کرد. MOCK از state داخل paymentUrl خودش استفاده می‌کند.
          null
        : `${this.deps.config.siteUrl}/api/payments/${gw.id.toLowerCase()}/callback?state=${state}`

    const r = await gw.init({
      paymentId,
      displayId: input.displayId,
      amount: input.amount,
      callbackUrl: callbackUrl ?? '',
      description: `سفارش ${input.displayId} — سین‌شین`,
      mobile: input.mobile,
    })

    await db
      .update(payments)
      .set({ gatewayRef: r.gatewayRef, callbackUrl, updatedAt: new Date() })
      .where(eq(payments.id, paymentId))

    return { paymentUrl: r.paymentUrl }
  }

  /** پرداخت ساختگی — POST {success} با state امضاشده */
  async handleMockPay(token: string, success: boolean) {
    // phase-1 (باگ 🔴۳): در حالت real هیچ مسیری به MOCK نمی‌رسد —
    // حتی state های قدیمی مانده از دوره‌ی ساختگی
    if (this.deps.config.gateway.mode !== 'mock') {
      throw Err.forbidden('درگاه MOCK غیرفعال است.')
    }
    const paymentId = verifyState(token, this.deps.config.jwtSecret)
    if (!paymentId) throw Err.forbidden('توکن پرداخت نامعتبر است.')
    const r = await this.finalize(
      paymentId,
      success,
      undefined,
      success ? undefined : { source: 'mock', reason: 'mock-failed' },
    )
    return { orderDisplayId: r.orderDisplayId, paymentStatus: r.paymentStatus }
  }

  /** callback درگاه واقعی — state + تطبیق درگاه + کوئری خام درگاه */
  async handleCallback(gatewayId: string, query: Record<string, string>) {
    const paymentId = verifyState(query.state ?? '', this.deps.config.jwtSecret)
    if (!paymentId) throw Err.forbidden('state نامعتبر است.')

    const payment = await this.deps.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    })
    if (!payment) throw Err.notFound('پرداخت پیدا نشد.')

    // phase-2: تطبیق درگاه callback با درگاهِ خود پرداخت —
    // قبلاً می‌شد state یک درگاه را از مسیر درگاه دیگر تایید کرد
    if ((payment.gateway ?? '').toUpperCase() !== gatewayId.toUpperCase()) {
      throw Err.forbidden('این state به این درگاه تعلق ندارد.')
    }

    const gw = this.gateway(gatewayId)

    // stage-74 — خطای شبکه به درگاه (تایم‌اوت/قطعی/Connection refused) از
    // verify بالا می‌آید؛ قبلاً تا runCallbackSafe سرریز می‌کرد و مشتریِ
    // تازه-پرداخت‌کرده JSON خامِ 500 می‌دید (سناریوی «خطای شبکه‌ی درگاه»
    // کارفرما). الان: مثلِ نتیجه‌ی indeterminate — 302 به صفحه‌ی سفارش با
    // payment=pending؛ کارِ تایم‌اوتِ ۵ دقیقه‌ای بعداً با ری-وریفای قطعی‌اش
    // می‌کند (پول در خطر نیست؛ settle/fail فقط با پاسخِ درگاه رخ می‌دهد).
    let v: Awaited<ReturnType<PaymentGateway['verify']>>
    try {
      v = await gw.verify({ gatewayRef: payment.gatewayRef, amount: payment.amount, query })
    } catch (e) {
      console.error(`[payments] callback ${gatewayId}: خطای شبکه در verify — indeterminate:`, e)
      v = { success: false, gatewayRef: payment.gatewayRef, indeterminate: true }
    }

    // phase-fix: نتیجه‌ی قطعی نیست (خطای گذرای درگاه) — سفارش را شکست نده؛
    // کارِ تایم‌اوت دوباره تایید می‌کند و مشتری به صفحه سفارشش برمی‌گردد.
    if (v.indeterminate) {
      // round-23 (سامان): اگر آداپتور در این تلاش مرجع تازه‌ای یافته (RefNum
      // سامان — فقط در callback می‌رسد)، همین‌جا ذخیره کن تا تاییدِ مجددِ بعدیِ
      // کارِ تایم‌اوت بدون کوئری هم ممکن باشد. برای زرین‌پال/ملت مرجع
      // ثابت است و این نوشتن عملاً بی‌اثر می‌شود.
      if (v.gatewayRef && v.gatewayRef !== payment.gatewayRef) {
        await this.deps.db
          .update(payments)
          .set({ gatewayRef: v.gatewayRef, updatedAt: new Date() })
          .where(eq(payments.id, paymentId))
      }
      // stage-58 — قبلاً: throw 503 ⇒ مشتریِ تازه‌پرداخت‌کرده JSON خام خطا
      // می‌دید. حالا: 302 به صفحه‌ی سفارش با ?payment=pending — همان صفحه‌ای
      // که هر ۳ ثانیه وضعیت را پول می‌کند تا کارِ تایم‌اوت (۵ دقیقه‌ای) قطعی‌اش کند.
      const order = await this.deps.db.query.orders.findFirst({
        where: eq(orders.id, payment.orderId),
      })
      return {
        redirect: `${this.deps.config.siteUrl}/dashboard/orders/${order?.displayId ?? ''}?payment=pending`,
      }
    }

    // callback تکراری (رفرش صفحه‌ی برگشت / دوبارفرستادن درگاه) →
    // تصرف اتمیک CONFLICT می‌دهد؛ به‌جای 409 خام، همان صفحه‌ی سفارش را نشان بده
    let orderDisplayId: string
    try {
      const r = await this.finalize(
        paymentId,
        v.success,
        v.gatewayRef,
        // امن-۸: منبع/درگاهِ شکست در metadata — قبلاً FAILED کور بود
        v.success ? undefined : { source: 'callback', gateway: gatewayId.toUpperCase() },
      )
      orderDisplayId = r.orderDisplayId
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFLICT') {
        const order = await this.deps.db.query.orders.findFirst({
          where: eq(orders.id, payment.orderId),
        })
        if (order) {
          return { redirect: `${this.deps.config.siteUrl}/dashboard/orders/${order.displayId}` }
        }
      }
      throw e
    }
    return { redirect: `${this.deps.config.siteUrl}/dashboard/orders/${orderDisplayId}` }
  }

  /**
   * stage-58 — «ادامه‌ی پرداخت» از صفحه‌ی سفارش (سفارش PENDING_PAYMENT).
   *
   * چرا؟ پیامِ خطای چک‌اوت قولِ «پرداخت را از صفحه‌ی سفارش ادامه دهید» را
   * می‌داد ولی چنین مسیری وجود نداشت — سفارشِ بدون initiate موفق تا ۲۴ ساعت
   * (یا تا ابد) در PENDING_PAYMENT گیر می‌کرد و کیف پول/کوپن قفل می‌ماند.
   *
   * ایمنی پول (قانون پروژه: «failPayment بدون اطلاع ممنوع»):
   *  ① ردیف PENDING قبلی با gatewayRefِ درگاه واقعی → یک استعلام زنده:
   *     موفق ⇒ finalize (سفارش همان لحظه PAID؛ رِتری رد می‌شود)؛
   *     شکست قطعی از زبان خود درگاه ⇒ تعویضِ امن؛
   *     نامشخص ⇒ فقط اگر ردیف ≥۱۵ دقیقه قدیمی است تعویض (وگرنه 409 «بعداً
   *     بیا») — و تعویضش با برچسب retry-superseded در metadata → چک R11
   *     مغایرت‌گیری روزانه اگر پولی گرفته شده بود پیدا می‌کند.
   *  ② ردیف بدون gatewayRef (init هرگز موفق نشد) ⇒ تعویض بی‌قید — جلسه‌ی
   *     بانکی وجود نداشته، پس هیچ پولی در PSP نیست.
   *  ③ مبلغ/کیف‌پول دست‌نخورده — رزرو کیف پول مالِ «سفارش» است نه ردیف
   *     پرداخت؛ تسویه/بازگشت همان‌ها را می‌بیند.
   *  ④ هر تلاش یک ردیف تازه («هر تلاش پرداخت یک ردیف» — طرح ممیزی payments).
   */
  async retryInitiation(
    userId: string,
    displayId: string,
    gatewayId?: string | null,
    mobile?: string | null,
  ): Promise<{ paymentUrl: string; displayId: string }> {
    const { db } = this.deps

    const order = await db.query.orders.findFirst({
      where: and(eq(orders.displayId, displayId), eq(orders.userId, userId)),
    })
    if (!order) throw Err.notFound('سفارش پیدا نشد.')
    if (order.status !== 'PENDING_PAYMENT') {
      throw Err.conflict('این سفارش در انتظار پرداخت نیست.')
    }

    // آخرین ردیف پرداخت — مبلغ و درگاه پیش‌فرضِ رِتری
    const [last] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(desc(payments.createdAt))
      .limit(1)
    if (!last) throw Err.conflict('ردیف پرداختی برای این سفارش ثبت نشده است.')

    const gwId = (gatewayId ?? last.gateway ?? '').trim().toUpperCase()
    const gw = this.gateway(gwId) // اعتبارسنجی کامل: مجاز + تطابق با کانفیگ

    // ── ① وضعیت تلاش‌های PENDING قبلی (ایمنی پول) ──
    const pendingRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'PENDING')))
    for (const p of pendingRows) {
      const pGwId = (p.gateway ?? '').toUpperCase()
      const pGw = pGwId && pGwId !== 'MOCK' ? this.gateways.get(pGwId) : undefined
      const isRealWithRef = !!pGw && pGw.mode !== 'mock' && !!p.gatewayRef

      if (isRealWithRef && pGw) {
        let verdict: Awaited<ReturnType<PaymentGateway['verify']>> | null = null
        try {
          verdict = await pGw.verify({ gatewayRef: p.gatewayRef, amount: p.amount, query: {} })
        } catch {
          verdict = null // استعلام خودش شکست → نامشخص
        }
        if (verdict?.success) {
          // پول واقعاً گرفته شده بود و callback گم شده بود — همین حالا نهایی کن
          await this.finalize(p.id, true, verdict.gatewayRef ?? p.gatewayRef, undefined)
          throw Err.conflict('این سفارش هم‌اکنون پرداخت شد — وضعیت صفحه به‌روز می‌شود.')
        }
        if (verdict && !verdict.indeterminate) {
          // شکست قطعی از خود درگاه — تعویض امن
          await this.supersedePending(p)
          continue
        }
        // نامشخص — پول ممکن است گرفته شده باشد؛ فقط ردیفِ کهنه تعویض می‌شود
        const ageMs = Date.now() - p.updatedAt.getTime()
        if (ageMs < RETRY_GRACE_MS) {
          throw Err.conflict(
            'وضعیت پرداخت قبلی هنوز از درگاه قابل استعلام نیست — چند دقیقه بعد دوباره تلاش کنید.',
          )
        }
      }
      // بدون gatewayRef (init ناموفق — رایج‌ترین سناریوی «درگاه خطا داد») یا
      // نامشخصِ کهنه → تعویض
      await this.supersedePending(p)
    }

    // ── ② ردیف تازه + initiate ──
    const [row] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        userId,
        gateway: gwId,
        mode: gw.mode === 'mock' ? 'mock' : this.deps.config.gateway.mode,
        amount: last.amount,
        status: 'PENDING',
      })
      .returning()
    if (!row) throw Err.internal('ساخت ردیف پرداخت ناموفق بود.')

    const r = await this.initiate(row.id, gwId, {
      displayId: order.displayId,
      amount: last.amount,
      mobile: mobile ?? undefined,
    })
    return { paymentUrl: r.paymentUrl, displayId: order.displayId }
  }

  /**
   * stage-58 — وضعیتِ واقعیِ آخرین پرداخت سفارش برای تازه‌سازی پاسخِ replay
   * چک‌اوت. replayِ ۴۸ساعته paymentUrl کش‌شده را برمی‌گرداند — اگر آن جلسه‌ی
   * بانکی مدتها مصرف/منقضی شده باشد، کاربر به صفحه‌ی مرده‌ی بانک می‌رود.
   * خروجی: 'success' | 'failed' | 'fresh' | 'stale'
   *   fresh = هنوز PENDING و به‌تازه‌ساخته (≤۱۵ دقیقه) ⇒ replay URL معتبر است
   *   stale = PENDING ولی کهنه ⇒ replay بدون paymentUrl برگردد (رِتری از صفحه سفارش)
   */
  async paymentReplayState(userId: string, displayId: string): Promise<'success' | 'failed' | 'fresh' | 'stale'> {
    const order = await this.deps.db.query.orders.findFirst({
      where: and(eq(orders.displayId, displayId), eq(orders.userId, userId)),
    })
    if (!order) return 'failed'

    const [last] = await this.deps.db
      .select({ status: payments.status, updatedAt: payments.updatedAt })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(desc(payments.createdAt))
      .limit(1)
    if (!last) return 'failed'
    if (last.status === 'SUCCESS') return 'success'
    if (last.status !== 'PENDING') return 'failed'
    return Date.now() - last.updatedAt.getTime() <= RETRY_GRACE_MS ? 'fresh' : 'stale'
  }

  /**
   * phase-2 — کارِ تایم‌اوت: پرداخت‌های PENDING رهاشده.
   * درگاه واقعی + gatewayRef → ری-وریفای (مشتری پرداخت کرده ولی callback
   * نرسیده — تب بسته شده/قطعی). وگرنه شکست → CANCELED + بازگشتِ کیف پول
   * + آزادسازی کوپن (failPayment). از گاردهای gateway() عمداً عبور
   * می‌کنیم — این پرداختِ موجود است، نه انتخاب جدید.
   */
  async reconcilePending(olderThanMinutes = 30): Promise<{ reverified: number; failed: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)
    const rows = await this.deps.db
      .select()
      .from(payments)
      .where(and(eq(payments.status, 'PENDING'), lt(payments.updatedAt, cutoff)))
      .limit(100)

    let reverified = 0
    let failed = 0
    for (const p of rows) {
      try {
        let success = false
        const gwId = (p.gateway ?? '').toUpperCase()
        const gw = gwId && gwId !== 'MOCK' ? this.gateways.get(gwId) : undefined
        const isRealGateway = !!gw && gw.mode !== 'mock'

        // stage-58 — پی‌ایر حذف شد؛ ردیف تاریخی PENDING هرگز fail خودکار
        // نمی‌شود (پول ممکن است در پی‌ایر گرفته شده باشد) → finding دستی R12.
        // ادمین در پنل PSP پی‌ایر بررسی و خودش تصمیم می‌گیرد.
        if (gwId === 'PAYIR') {
          await this.recordR12(p, 'payir-removed: درگاه حذف شده — بررسی دستی پنل پی‌ایر')
          continue
        }

        if (isRealGateway && p.gatewayRef) {
          const v = await gw!.verify({ gatewayRef: p.gatewayRef, amount: p.amount, query: {} })
          if (v.indeterminate) {
            // رارد H6 — پنجره‌ی ۲۴ ساعت: پول ممکن است در PSP گرفته شده باشد.
            // بعد از آن فقط «هشدار قطعی R12» — fail خودکار ممنوع (بازگشت وجه اشتباه).
            const ageHours = (Date.now() - p.updatedAt.getTime()) / 3_600_000
            if (ageHours < 24) continue
            // stage-58 — R12 واقعی: finding در reconcile_findings (پنل
            // مغایرت‌گیری) + لاگ؛ قبلاً فقط console.error ابدیِ ۵ دقیقه‌ای بود.
            await this.recordR12(p, `unresolved بعد از ${ageHours.toFixed(1)}h — بررسی دستی پنل PSP`)
            continue
          }
          success = v.success
        } else if (isRealGateway && !p.gatewayRef) {
          // رارد H6 — درگاه واقعی بدون callback/RefNum: همان پنجره‌ی ۲۴h + R12.
          // قبلاً این پرداخت ۳۰ دقیقه بعد fail و کیف پول آزاد می‌شد در حالی که
          // پولِ مشتری در PSP captured بود.
          const ageHours = (Date.now() - p.updatedAt.getTime()) / 3_600_000
          if (ageHours < 24) continue
          await this.recordR12(p, 'no-callback بعد از 24h — بررسی دستی پنل PSP')
          continue
        }
        await this.finalize(
          p.id,
          success,
          p.gatewayRef,
          success
            ? undefined
            : {
                source: 'timeout-job',
                gateway: gwId || null,
                hadGatewayRef: !!p.gatewayRef,
              },
        )
        if (success) reverified++
        else failed++
      } catch (e) {
        if (e instanceof AppError && e.code === 'CONFLICT') continue // callback دیر رسید
        console.error(`[payments] reconcile ${p.id}:`, e)
      }
    }
    if (rows.length > 0) {
      console.log(
        `[payments] reconcile: ${reverified} re-verified, ${failed} failed (of ${rows.length})`,
      )
    }
    return { reverified, failed }
  }

  // ── داخلی ──

  /** تعویض امن ردیف PENDING → FAILED (برچسب retry-superseded برای R11) */
  private async supersedePending(p: PaymentRow): Promise<void> {
    await this.deps.db
      .update(payments)
      .set({
        status: 'FAILED',
        metadata: {
          ...(p.metadata ?? {}),
          fail: { source: 'retry-superseded', at: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, p.id), eq(payments.status, 'PENDING')))
  }

  /**
   * stage-58 — R12: یافته‌ی «پرداخت ۲۴ساعته‌ی حل‌نشده» در reconcile_findings.
   * قرارداد یکتایی (check_id, entity_id) — ردیف موجود به‌روز می‌شود
   * (occurrences++/lastSeenAt) نه تکراری. خطای ثبت هرگز مسیر را نمی‌شکند.
   */
  private async recordR12(p: PaymentRow, note: string): Promise<void> {
    console.error(
      `[payments] R12 UNRESOLVED: ${p.id} gateway=${(p.gateway ?? '').toUpperCase()} — ${note}`,
    )
    try {
      await this.deps.db
        .insert(reconcileFindings)
        .values({
          checkId: 'R12',
          severity: 'critical',
          status: 'open',
          entityType: 'payment',
          entityId: p.id,
          detail: {
            gateway: (p.gateway ?? '').toUpperCase() || null,
            gatewayRef: p.gatewayRef ?? null,
            amount: p.amount,
            note,
            paymentUpdatedAt: p.updatedAt?.toISOString() ?? null,
          },
        })
        .onConflictDoUpdate({
          target: [reconcileFindings.checkId, reconcileFindings.entityId],
          set: {
            lastSeenAt: new Date(),
            occurrences: sql`${reconcileFindings.occurrences} + 1`,
          },
        })
    } catch (e) {
      console.error('[payments] ثبت finding R12 ناموفق:', e)
    }
  }

  /**
   * نهایی‌سازی — تصرف اتمیک (status=PENDING → نتیجه) داخل tx؛
   * callback تکراری/موازی با conflict رد می‌شود. سپس تسویه/شکست سفارش در همان tx.
   *
   * امن-۸: در شکست، failInfo (منبع/درگاه) داخل payments.metadata
   * ثبت می‌شود — برای تحلیل پس از حادثه و چک R11 (spot-check دستی PSP).
   */
  private async finalize(
    paymentId: PaymentId,
    success: boolean,
    gatewayRef: string | null | undefined,
    failInfo?: Record<string, unknown>,
  ): Promise<{ orderDisplayId: string; paymentStatus: string; userId: string }> {
    const { db } = this.deps

    const result = await db.transaction(async (tx) => {
      // metadata فعلی برای ادغام — فقط خواندن؛ تصرف اتمیک همان update
      // با status=PENDING است، پس این select مسیر رقابت را عوض نمی‌کند
      const current = (
        await tx.select().from(payments).where(eq(payments.id, paymentId))
      )[0]

      const [payment] = await tx
        .update(payments)
        .set({
          status: success ? 'SUCCESS' : 'FAILED',
          verifiedAt: new Date(),
          updatedAt: new Date(),
          ...(gatewayRef !== undefined ? { gatewayRef } : {}),
          ...(success
            ? {}
            : {
                metadata: {
                  ...(current?.metadata ?? {}),
                  fail: {
                    ...(failInfo ?? {}),
                    at: new Date().toISOString(),
                  },
                },
              }),
        })
        .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')))
        .returning()
      if (!payment) throw Err.conflict('این پرداخت قبلاً نهایی شده است.')

      const orderRow = (
        await tx.select().from(orders).where(eq(orders.id, payment.orderId))
      )[0]
      if (!orderRow) throw Err.notFound('سفارش این پرداخت پیدا نشد.')

      if (success) {
        await this.deps.orders.settlePayment(tx, orderRow)
        return { orderDisplayId: orderRow.displayId, paymentStatus: 'SUCCESS', userId: orderRow.userId }
      }
      await this.deps.orders.failPayment(tx, orderRow)
      return { orderDisplayId: orderRow.displayId, paymentStatus: 'FAILED', userId: orderRow.userId }
    })

    // رارد M9 — اعطای کوپنِ «بعد از commit»: grantCouponsAfterCommit خودش
    // try/catch دارد و هرگز مسیر پرداخت را نمی‌شکند.
    await this.deps.orders.grantCouponsAfterCommit(result.userId)

    // stage-77 (N4) — شکستِ پرداخت دیگر برای مشتری «بی‌خبر» تمام نمی‌شود:
    // سفارش CANCELED/FAILED می‌شود ولی کاربر فقط با بازگشت به سایت متوجه
    // می‌شد (callback درگاه عملاً به صفحه‌ی سفارش برمی‌گرداند؛ ولی مسیرِ
    // کارِ تایم‌اوت ۳۰ دقیقه‌ای/۲۴ ساعته و شکستِ قطعیِ درگاهِ غیر-eager
    // هیچ خبری نمی‌فرستاد). اعلان درون‌بری + پوش — فایر-اند-فورگت،
    // قانون طلایی: نوتیف هرگز مسیر پول را زمین نمی‌خواباند.
    if (result.paymentStatus === 'FAILED') {
      void this.deps.notifications
        .notifyUser(result.userId, {
          type: 'system',
          title: '❌ پرداخت سفارش ناموفق بود',
          body: `پرداخت سفارش ${result.orderDisplayId} تکمیل نشد. پولی از حساب شما کسر نشده و رزرو کیف پول/کد تخفیف (در صورت استفاده) آزاد شد — از صفحه‌ی سفارش می‌توانید دوباره تلاش کنید.`,
          url: `/dashboard/orders/${result.orderDisplayId}`,
          data: { order: result.orderDisplayId, source: 'payment-failed' },
        })
        .catch(() => { /* ضد-کرش دوبل — قانون طلایی نوتیف */ })
    }

    // round-16 — پس از commit (نه داخل tx): پنل زنده با SSE فوراً باخبر می‌شود.
    // موفق = سفارش جدید در صف | شکست = حذف از صف (پنل رفرش می‌کند)
    try {
      this.deps.hub.publish(
        'orders:new',
        result.paymentStatus === 'SUCCESS'
          ? { event: 'order-created', data: { id: result.orderDisplayId } }
          : { event: 'order-updated', data: { id: result.orderDisplayId } },
      )
    } catch {
      /* هیچ‌کاری نمی‌کند — publish هرگز نباید مسیر پرداخت را بشکند */
    }
    // stage-52 — سفارشِ «واقعاً جدید» (پرداخت موفق، داخل صف زنده ظاهر شد):
    // علاوه بر SSE، Web Push به ادمین‌ها (اصلی + سطح ۲ — stage-64) — مرورگر
    // بسته هم می‌گیرد و کلیک ⇒ پنل سفارشات زنده. فایر-اند-فورگت: redirect
    // مشتری هرگز منتظر ارسال پوش نمی‌ماند و سرویس هرگز throw نمی‌کند.
    // (تصرف اتمیک PENDING تضمین می‌کند callback و job تایم‌اوت فقط یکی
    // به اینجا می‌رسند ⇒ پوش تکراری وجود ندارد.)
    if (result.paymentStatus === 'SUCCESS') {
      void this.deps.notifications
        .notifyAdminsNewOrder({ displayId: result.orderDisplayId })
        .catch(() => { /* ضد-کرش دوبل — قانون طلایی */ })
    }
    return result
  }
}