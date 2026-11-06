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
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm'

import type { Db, DbOrTx, Tx } from '#/infra/db/client'
import { coupons, orders, payments, reconcileFindings, users, type OrderRow, type PaymentRow } from '#/infra/db/schema'
import type { PaymentId } from '#/domain/shared/brand'
import type { AppConfig } from '#/infra/config/env'
import { AppError, Err, OrderPaymentsDisabledError } from '#/domain/shared/errors'
import { lockWalletAccounts } from '#/domain/shared/wallet-sql'
import type { OrderService } from '#/domain/order/order.service'
import { SettingsService } from '#/domain/settings/settings.service'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { NotificationService } from '#/domain/notification/notification.service'
import { signState, verifyState } from './state'
import { MockAdapter } from './mock.adapter'
import { ZarinpalAdapter } from './zarinpal.adapter'
import { SepAdapter } from './sep.adapter'
import { MellatAdapter, MellatInitError } from './mellat.adapter'
import type { PaymentGateway } from './gateway.types'
import { PaymentVerification } from './payment-verification'
import type { CheckoutPreviewData } from '@sinshin/shared'

/** stage-58 — درگاه‌های واقعیِ پشتیبانی‌شده (منبع واحد بک‌اند؛ پی‌ایر حذف شد) */
export const REAL_GATEWAY_IDS = ['MELLAT', 'ZARINPAL', 'SEP'] as const

class PaymentReviewError extends AppError {
  constructor(readonly payment: PaymentRow, readonly note: string) {
    super('CONFLICT', 'اطلاعات مالی پرداخت نیاز به بررسی دارد.', 409)
  }
}

export class PaymentService {
  private readonly gateways: Map<string, PaymentGateway>
  private readonly settings: SettingsService
  private readonly verification: PaymentVerification
  private reconcileAfterId: PaymentId | null = null
  private expiryAfterId: OrderRow['id'] | null = null

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
    this.settings = new SettingsService({ db: deps.db })
    this.verification = new PaymentVerification(deps.db, deps.config.gateway.timeoutMs)
    this.gateways = new Map<string, PaymentGateway>([
      ['MOCK', new MockAdapter(deps.config)],
      ['ZARINPAL', new ZarinpalAdapter(deps.config)],
      ['SEP', new SepAdapter(deps.config)],
      ['MELLAT', new MellatAdapter(deps.config)],
    ])
    deps.orders.setPendingPaymentReconciler(userId => this.pendingPaymentAdvisory(userId))
  }

  /** stage-58 — برای روت‌های callback: مقصد امنِ خطا (به‌جای JSON خام در مرورگر مشتری) */
  get siteUrl(): string {
    return this.deps.config.siteUrl
  }

  gateway(id: string): PaymentGateway {
    const gw = this.gateways.get(id.trim().toUpperCase())
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
    _gatewayId: string,
    input: { displayId: string; amount: number; mobile?: string | null },
  ): Promise<{ paymentUrl: string }> {
    const { db } = this.deps
    const initToken = crypto.randomUUID()
    const initiation = await this.moneyTransaction(async (tx) => {
      const [candidate] = await tx.select().from(payments).where(eq(payments.id, paymentId))
      if (!candidate) throw Err.notFound('پرداخت پیدا نشد.')
      await lockWalletAccounts(tx, [candidate.userId])
      await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).for('no key update')
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, candidate.orderId)).for('update')
      const [pending] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update')
      if (!pending || pending.status !== 'PENDING' || pending.gatewayRef || pending.metadata?.paymentUrl || pending.mellatOrderId !== null ||
        this.unresolvedMellatDispatch(pending) ||
        (pending.metadata?.initToken && pending.metadata?.initFailed !== true)) {
        throw Err.conflict('این تلاش پرداخت قابل شروع نیست؛ صفحه سفارش را به‌روز کنید.')
      }
      const [order] = await tx.select().from(orders).where(eq(orders.id, pending.orderId))
      if (!order || order.status !== 'PENDING_PAYMENT') throw Err.conflict('این سفارش در انتظار پرداخت نیست.')
      if (this.paymentWindowClosed(order)) throw Err.conflict('مهلت شروع پرداخت این سفارش به پایان رسیده است.')
      const invalid = this.paymentIntegrity(pending, order)
      if (invalid) throw new PaymentReviewError(pending, invalid)
      await this.assertOnlyInitiationAttempt(tx, order.id, paymentId)
      const gw = this.gateway(pending.gateway)
      try {
        await this.settings.assertOrderPaymentsAllowed(tx)
      } catch (error) {
        if (!(error instanceof OrderPaymentsDisabledError)) throw error
        // This locked attempt has no PSP reference, URL, or active initiation.
        // Record that nothing was sent so reopening need not wait the normal
        // grace period reserved for a possibly running PSP request.
        await tx.update(payments).set({
          metadata: { ...(pending.metadata ?? {}), initFailed: true, ...(gw.id === 'MELLAT' ? { mellatDispatched: false } : {}) }, updatedAt: new Date(),
        }).where(eq(payments.id, paymentId))
        return { blocked: error }
      }
      let claimed: PaymentRow | undefined
      try {
        ;[claimed] = await tx.update(payments).set({
          ...(gw.id === 'MELLAT' ? { mellatOrderId: sql`nextval('public.mellat_order_id_seq')` } : {}),
          metadata: { ...(pending.metadata ?? {}), initToken, initFailed: false, ...(gw.id === 'MELLAT' ? { mellatDispatched: false } : {}) }, updatedAt: new Date(),
        }).where(eq(payments.id, paymentId)).returning()
      } catch (error) {
        const databaseError = error as { code?: unknown; errno?: unknown; cause?: { code?: unknown; errno?: unknown } }
        if (gw.id === 'MELLAT' && [databaseError?.code, databaseError?.errno,
          databaseError?.cause?.code, databaseError?.cause?.errno].includes('2200H')) {
          throw Err.conflict('ظرفیت شناسه‌های پرداخت ملت به پایان رسیده است؛ برای پیگیری با پشتیبانی تماس بگیرید.')
        }
        throw error
      }
      if (!claimed) throw Err.conflict('این تلاش پرداخت قابل شروع نیست؛ صفحه سفارش را به‌روز کنید.')
      return { pending: claimed, order, gw }
    })
    if ('blocked' in initiation) throw initiation.blocked
    const { pending, order, gw } = initiation
    // The persisted attempt is the authority for its gateway and amount.

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

    let r: Awaited<ReturnType<PaymentGateway['init']>>
    let mellatDispatched = false
    try {
      await this.settings.assertOrderPaymentsAllowed(db)
      if (gw.id === 'MELLAT') {
        // Commit the original bank association and callback before dispatch.
        // A timeout can then be reconciled without inventing another request ID.
        const [dispatched] = await db.update(payments).set({ callbackUrl,
          metadata: sql`coalesce(${payments.metadata}, '{}'::jsonb) || ${{ mellatDispatched: true }}::jsonb`,
        }).where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING'),
          eq(payments.mellatOrderId, pending.mellatOrderId!), sql`${payments.metadata}->>'initToken' = ${initToken}`,
        )).returning({ id: payments.id })
        if (!dispatched) throw Err.conflict('این تلاش پرداخت جایگزین شده است؛ صفحه سفارش را به‌روز کنید.')
        mellatDispatched = true
      }
      r = await gw.init({
        paymentId,
        mellatOrderId: pending.mellatOrderId?.toString(),
        displayId: order.displayId,
        amount: pending.amount,
        callbackUrl: callbackUrl ?? '',
        description: `سفارش ${order.displayId} — سین‌شین`,
        mobile: input.mobile,
      })
    } catch (error) {
      const initFailed = !mellatDispatched || (error instanceof MellatInitError && !error.indeterminate)
      await db.update(payments).set({
        metadata: sql`coalesce(${payments.metadata}, '{}'::jsonb) || ${{ initToken, initFailed }}::jsonb`,
        updatedAt: new Date(),
      }).where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING'), sql`${payments.metadata}->>'initToken' = ${initToken}`))
      throw error
    }

    const saved = await db
      .update(payments)
      .set({ gatewayRef: gw.id === 'MELLAT' ? sql`coalesce(${payments.gatewayRef}, ${r.gatewayRef})` : r.gatewayRef,
        callbackUrl, metadata: sql`coalesce(${payments.metadata}, '{}'::jsonb) || ${{ initToken, initFailed: false, paymentUrl: r.paymentUrl }}::jsonb`, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING'), sql`${payments.metadata}->>'initToken' = ${initToken}`,
        gw.id === 'MELLAT' ? sql`not coalesce(${payments.metadata}->'verification'->'result'->>'success' = 'true', false)` : undefined,
      ))
      .returning({ id: payments.id, gatewayRef: payments.gatewayRef })
    if (saved.length === 0) throw Err.conflict('این تلاش پرداخت جایگزین شده است؛ صفحه سفارش را به‌روز کنید.')
    if (gw.id === 'MELLAT' && saved[0]!.gatewayRef !== r.gatewayRef) {
      throw Err.conflict('نتیجه پرداخت قبلی هنوز در حال بررسی است؛ صفحه سفارش را به‌روز کنید.')
    }
    // A slow initialization may finish after the order deadline. Keep its
    // reference for reconciliation, but never hand out an expired session.
    if (this.paymentWindowClosed(order)) throw Err.conflict('مهلت شروع پرداخت این سفارش به پایان رسیده است.')
    // A closure during a slow PSP request must not expose another payable URL.
    // Keep its reference above so an already authorized payment can still settle.
    await this.settings.assertOrderPaymentsAllowed(db)

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
    const [mockPayment] = await this.deps.db.select().from(payments).where(eq(payments.id, paymentId))
    if (!mockPayment || mockPayment.gateway !== 'MOCK' || mockPayment.mode !== 'mock') {
      throw Err.forbidden('این پرداخت به درگاه آزمایشی تعلق ندارد.')
    }
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
    const [ownedOrder] = await this.deps.db.select().from(orders).where(eq(orders.id, payment.orderId))
    if (!ownedOrder) throw Err.notFound('سفارش این پرداخت پیدا نشد.')
    const invalid = this.paymentIntegrity(payment, ownedOrder)
    if (invalid) {
      await this.recordR12(payment, invalid)
      return { redirect: `${this.deps.config.siteUrl}/dashboard/orders/${ownedOrder.displayId}?payment=pending` }
    }

    const gw = this.gateways.get(gatewayId.toUpperCase())
    if (!gw || (gw.mode === 'mock' && (payment.mode !== 'mock' || this.deps.config.gateway.mode !== 'mock'))) {
      throw Err.forbidden('این درگاه برای پرداخت موجود مجاز نیست.')
    }
    if (payment.status === 'SUCCESS') {
      const [order] = await this.deps.db.select({ displayId: orders.displayId }).from(orders).where(eq(orders.id, payment.orderId))
      return { redirect: `${this.deps.config.siteUrl}/dashboard/orders/${order?.displayId ?? ''}` }
    }

    // Retain unsigned provider receipt candidates separately from the PSP
    // reference. A background retry must validate them with the bank too.
    const keys = gatewayId.toUpperCase() === 'MELLAT'
      ? ['ResCode', 'SaleOrderId', 'SaleReferenceId', 'RefId']
      : gatewayId.toUpperCase() === 'SEP' ? ['State', 'RefNum', 'ResNum', 'TerminalId'] : []
    const callbackQuery = Object.fromEntries(keys.flatMap(key => {
      const value = query[key] ?? Object.entries(query).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]
      return typeof value === 'string' && value.length <= 120 ? [[key, value]] : []
    }))
    if (Object.keys(callbackQuery).length) {
      await this.deps.db.update(payments).set({
        metadata: sql`jsonb_set(coalesce(${payments.metadata}, '{}'::jsonb), '{callbackQuery}', ${callbackQuery}::jsonb, true)`,
      }).where(and(eq(payments.id, payment.id), eq(payments.status, 'PENDING'),
        sql`${payments.gatewayRef} is not distinct from ${payment.gatewayRef}`))
    }

    // stage-74 — خطای شبکه به درگاه (تایم‌اوت/قطعی/Connection refused) از
    // verify بالا می‌آید؛ قبلاً تا runCallbackSafe سرریز می‌کرد و مشتریِ
    // تازه-پرداخت‌کرده JSON خامِ 500 می‌دید (سناریوی «خطای شبکه‌ی درگاه»
    // کارفرما). الان: مثلِ نتیجه‌ی indeterminate — 302 به صفحه‌ی سفارش با
    // payment=pending؛ کارِ تایم‌اوتِ ۵ دقیقه‌ای بعداً با ری-وریفای قطعی‌اش
    // می‌کند (پول در خطر نیست؛ settle/fail فقط با پاسخِ درگاه رخ می‌دهد).
    let v: Awaited<ReturnType<PaymentGateway['verify']>>
    try {
      v = await this.verification.verify(payment, gw, query, true)
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
          .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING'),
            payment.gatewayRef === null ? isNull(payments.gatewayRef) : eq(payments.gatewayRef, payment.gatewayRef)))
      }
      // stage-58 — قبلاً: throw 503 ⇒ مشتریِ تازه‌پرداخت‌کرده JSON خام خطا
      // می‌دید. حالا: 302 به صفحه‌ی سفارش با ?payment=pending — همان صفحه‌ای
      // که هر ۳ ثانیه وضعیت را پول می‌کند تا کارِ تایم‌اوت (۵ دقیقه‌ای) قطعی‌اش کند.
      const order = await this.deps.db.query.orders.findFirst({
        where: eq(orders.id, payment.orderId),
      })
      return {
        redirect: `${this.deps.config.siteUrl}/dashboard/orders/${order?.displayId ?? ''}${order?.status === 'PENDING_PAYMENT' ? '?payment=pending' : ''}`,
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
        payment.gatewayRef,
        undefined, false, payment,
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
   *     نامشخص ⇒ بازگشت به همان جلسه‌ی درگاه؛ ساخت تلاش تازه ممنوع است.
   *  ② ردیف بدون gatewayRef ⇒ شکست init ثبت‌شده یا گذشت مهلت آماده‌سازی؛
   *     آغازگرِ دیررس پس از تعویض هرگز URL ردیف قبلی را برنمی‌گرداند.
   *  ③ مبلغ/کیف‌پول دست‌نخورده — رزرو کیف پول مالِ «سفارش» است نه ردیف
   *     پرداخت؛ تسویه/بازگشت همان‌ها را می‌بیند.
   *  ④ تعویض و درج ردیف تازه اتمیک است؛ وضعیت زیر قفل دوباره بررسی می‌شود.
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
    // The deadline stops new/resumed sessions. It cannot establish whether
    // the bank already charged, so unresolved orders keep their reservations.
    if (this.paymentWindowClosed(order)) {
      const outcome = await this.expireOnePendingOrder(order)
      throw Err.conflict(
        outcome === 'settled'
          ? 'این سفارش هم‌اکنون پرداخت شد — وضعیت صفحه به‌روز می‌شود.'
          : outcome === 'expired'
            ? 'پنجرهٔ پرداخت این سفارش به پایان رسید و سفارش لغو شد — لطفاً دوباره سفارش ثبت کنید.'
            : 'مهلت شروع پرداخت به پایان رسیده است؛ نتیجه پرداخت قبلی هنوز در حال بررسی است. لطفاً منتظر به‌روزرسانی وضعیت بمانید.',
      )
    }

    // آخرین ردیف پرداخت — مبلغ و درگاه پیش‌فرضِ رِتری
    const [last] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(desc(payments.createdAt))
      .limit(1)
    if (!last) throw Err.conflict('ردیف پرداختی برای این سفارش ثبت نشده است.')
    const invalidLast = this.paymentIntegrity(last, order)
    if (invalidLast) {
      await this.recordR12(last, invalidLast)
      throw Err.conflict('اطلاعات مالی پرداخت نیاز به بررسی دارد.')
    }

    const gwId = (gatewayId ?? last.gateway ?? '').trim().toUpperCase()
    const gw = this.gateway(gwId) // اعتبارسنجی کامل: مجاز + تطابق با کانفیگ

    // ── ① وضعیت تلاش‌های PENDING قبلی (ایمنی پول) ──
    const pendingRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'PENDING')))
    let resume: { id: PaymentId; paymentUrl: string } | undefined
    const resumeExisting = (p: PaymentRow): boolean => {
      if (p.gateway.toUpperCase() !== gwId) return false
      const paymentUrl = gw.resumeUrl({ paymentId: p.id, mellatOrderId: p.mellatOrderId?.toString(), gatewayRef: p.gatewayRef, paymentUrl: p.metadata?.paymentUrl })
      if (!paymentUrl) return false
      // Multiple unresolved sessions require reconciliation; never choose one
      // arbitrarily or replace an attempt which could already have charged.
      if (resume) throw Err.conflict('چند پرداخت در انتظار بررسی است؛ لطفاً با پشتیبانی تماس بگیرید.')
      resume = { id: p.id, paymentUrl }
      return true
    }
    for (const p of pendingRows) {
      const invalid = this.paymentIntegrity(p, order)
      if (invalid) {
        await this.recordR12(p, invalid)
        throw Err.conflict('اطلاعات مالی پرداخت نیاز به بررسی دارد.')
      }
      const pGwId = (p.gateway ?? '').toUpperCase()
      const pGw = pGwId && pGwId !== 'MOCK' ? this.gateways.get(pGwId) : undefined
      const isRealWithRef = !!pGw && pGw.mode !== 'mock' && (!!p.gatewayRef || this.unresolvedMellatDispatch(p))
      if (pGwId !== 'MOCK' && !pGw) {
        throw Err.conflict('پرداخت قبلی نیاز به بررسی درگاه دارد؛ تلاش جدید فعلاً ممکن نیست.')
      }

      if (isRealWithRef && pGw) {
        let verdict: Awaited<ReturnType<PaymentGateway['verify']>> | null = null
        try {
          verdict = await this.verification.verify(p, pGw)
        } catch {
          verdict = null // استعلام خودش شکست → نامشخص
        }
        if (verdict?.success && !verdict.indeterminate) {
          // پول واقعاً گرفته شده بود و callback گم شده بود — همین حالا نهایی کن
          await this.finalize(p.id, true, verdict.gatewayRef ?? p.gatewayRef, undefined, p.gatewayRef, undefined, false, p)
          throw Err.conflict('این سفارش هم‌اکنون پرداخت شد — وضعیت صفحه به‌روز می‌شود.')
        }
        if (verdict && !verdict.indeterminate) {
          continue
        }
        // Reopen the existing session when verification is inconclusive.
        // This does not create a second payable attempt or release its hold.
        if (resumeExisting(p)) continue
        throw Err.conflict('وضعیت پرداخت قبلی هنوز قطعی نیست — پس از بررسی درگاه دوباره تلاش کنید.')
      }
      if (pGwId === 'MOCK' && resumeExisting(p)) continue
      if (this.safeMellatInitFailure(p)) continue
      if (!p.gatewayRef && (p.metadata?.paymentUrl || p.callbackUrl)) {
        // SEP does not issue RefNum until callback; a null reference does not
        // mean initiation failed. Its saved Token URL resumes the same session.
        if (resumeExisting(p)) continue
        throw Err.conflict('نتیجه پرداخت قبلی هنوز از بانک نرسیده است؛ تلاش جدید فعلاً ممکن نیست.')
      }
      if (!p.gatewayRef && p.metadata?.initFailed !== true && Date.now() - p.updatedAt.getTime() < 60_000) {
        throw Err.conflict('اتصال پرداخت قبلی هنوز در حال آماده‌سازی است؛ چند لحظه صبر کنید.')
      }
    }

    // Recheck the verified snapshot under the same lock order as finalize.
    // Concurrent retries/callbacks cannot leave two payable attempts behind.
    const attempt = await this.moneyTransaction<{ paymentUrl: string } | { row: PaymentRow }>(async (tx) => {
      await lockWalletAccounts(tx, [userId])
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update')
      const [currentOrder] = await tx.select().from(orders).where(eq(orders.id, order.id)).for('update')
      if (currentOrder?.status !== 'PENDING_PAYMENT') {
        throw Err.conflict('این سفارش در انتظار پرداخت نیست.')
      }
      if (this.paymentWindowClosed(currentOrder)) {
        throw Err.conflict('مهلت شروع پرداخت به پایان رسیده است؛ وضعیت سفارش را به‌روز کنید.')
      }
      await this.settings.assertOrderPaymentsAllowed(tx)
      const invalid = this.paymentIntegrity(last, currentOrder)
      if (invalid) throw new PaymentReviewError(last, invalid)
      const [settled] = await tx.select().from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.status, 'SUCCESS'))).limit(1)
      if (settled) throw new PaymentReviewError(settled, 'pending order already has a successful payment')
      const currentPending = await tx.select().from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.status, 'PENDING'))).for('update')
      if (currentPending.some(p => this.hasVerifiedSuccess(p))) {
        throw Err.conflict('نتیجه موفق پرداخت قبلی در انتظار نهایی‌سازی سفارش اصلی است.')
      }
      if (currentPending.length !== pendingRows.length || currentPending.some((p) => {
        const checked = pendingRows.find((old) => old.id === p.id)
        return !checked || checked.gatewayRef !== p.gatewayRef || checked.mellatOrderId !== p.mellatOrderId || checked.updatedAt.getTime() !== p.updatedAt.getTime() ||
          checked.userId !== p.userId || checked.amount !== p.amount || checked.gateway !== p.gateway || checked.mode !== p.mode ||
          checked.metadata?.paymentUrl !== p.metadata?.paymentUrl || checked.callbackUrl !== p.callbackUrl ||
          checked.metadata?.mellatDispatched !== p.metadata?.mellatDispatched
      })) {
        throw Err.conflict('وضعیت پرداخت تغییر کرد؛ صفحه سفارش را به‌روز کنید.')
      }
      // Reuse only after checking the same snapshot under settlement locks.
      // The original URL remains bound to the original amount and callback.
      if (resume) {
        // Retire the other attempts already proven safe above, so their later
        // failure callbacks/reconciliation cannot cancel this payable order.
        for (const p of currentPending) {
          if (p.id !== resume.id) await this.supersedePending(tx, p)
        }
        return { paymentUrl: resume.paymentUrl }
      }

      // A fresh attempt must respect the current gateway switch. Existing
      // sessions can still resume and settle after their gateway is disabled.
      const enabled = await this.settings.enabledGateways(tx)
      const key = gwId.toLowerCase() as keyof typeof enabled
      if (key in enabled && !enabled[key]) {
        throw Err.validation('درگاه پرداخت انتخابی در حال حاضر غیرفعال است.')
      }
      for (const p of currentPending) await this.supersedePending(tx, p)
      const [created] = await tx.insert(payments).values({
        orderId: order.id,
        userId,
        gateway: gwId,
        mode: gw.mode === 'mock' ? 'mock' : this.deps.config.gateway.mode,
        amount: last.amount,
        status: 'PENDING',
      })
      .returning()
      if (!created) throw Err.internal('ساخت ردیف پرداخت ناموفق بود.')
      return { row: created }
    })
    if ('paymentUrl' in attempt) {
      // Payment-row locks and sibling cleanup can also outlast the deadline.
      if (this.paymentWindowClosed(order)) throw Err.conflict('مهلت شروع پرداخت به پایان رسیده است؛ وضعیت سفارش را به‌روز کنید.')
      await this.settings.assertOrderPaymentsAllowed(db)
      return { paymentUrl: attempt.paymentUrl, displayId: order.displayId }
    }

    const r = await this.initiate(attempt.row.id, gwId, {
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
   *   fresh = هنوز PENDING و داخل پنجرهٔ پرداخت ⇒ replay URL معتبر است
   *   stale = PENDING ولی کهنه ⇒ replay بدون paymentUrl برگردد (رِتری از صفحه سفارش)
   */
  async paymentReplayState(userId: string, displayId: string, cachedUrl?: string): Promise<'success' | 'failed' | 'fresh' | 'stale'> {
    const order = await this.deps.db.query.orders.findFirst({
      where: and(eq(orders.displayId, displayId), eq(orders.userId, userId)),
    })
    if (!order) return 'failed'
    if (order.status === 'CANCELED') return 'failed'
    if (order.paymentStatus === 'SUCCESS') return 'success'
    if (this.paymentWindowClosed(order)) return 'stale'

    const [last] = await this.deps.db
      .select({ status: payments.status, updatedAt: payments.updatedAt, metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(desc(payments.createdAt))
      .limit(1)
    if (!last) return 'failed'
    if (last.status === 'SUCCESS') return 'success'
    if (last.status !== 'PENDING') return 'failed'
    if (await this.settings.orderPaymentsDisabled(this.deps.db)) return 'stale'
    if (cachedUrl && last.metadata?.paymentUrl !== cachedUrl) return 'stale'
    return !this.paymentWindowClosed(order) &&
      Date.now() - last.updatedAt.getTime() < this.deps.config.pendingOrderExpiryMinutes * 60_000 ? 'fresh' : 'stale'
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
    // Unresolved PSP attempts remain pending. Rotate a stable keyset so a full
    // batch of those attempts cannot starve all later payments indefinitely.
    const loadBatch = (after: PaymentId | null) => this.deps.db
      .select()
      .from(payments)
      .where(and(eq(payments.status, 'PENDING'), lt(payments.updatedAt, cutoff), after ? gt(payments.id, after) : undefined))
      .orderBy(asc(payments.id))
      .limit(100)
    let rows = await loadBatch(this.reconcileAfterId)
    if (rows.length === 0 && this.reconcileAfterId !== null) rows = await loadBatch(null)
    this.reconcileAfterId = rows.length === 100 ? rows[rows.length - 1]!.id : null

    let reverified = 0
    let failed = 0
    const checkedExpiredOrders = new Set<OrderRow['id']>()
    for (const p of rows) {
      try {
        const [order] = await this.deps.db.select().from(orders).where(eq(orders.id, p.orderId))
        const invalid = order ? this.paymentIntegrity(p, order) : 'payment order is missing'
        if (invalid) {
          await this.recordR12(p, invalid)
          continue
        }
        // The older-attempt pass must not cancel an order that the deadline
        // pass preserved because a sibling payment could already be charged.
        if (order?.status === 'PENDING_PAYMENT' && this.paymentWindowClosed(order)) {
          if (checkedExpiredOrders.has(order.id)) continue
          checkedExpiredOrders.add(order.id)
          const outcome = await this.expireOnePendingOrder(order)
          if (outcome === 'settled') reverified++
          else if (outcome === 'expired') failed++
          continue
        }
        let success = false
        let verifiedRef = p.gatewayRef
        const gwId = (p.gateway ?? '').toUpperCase()
        const gw = gwId && gwId !== 'MOCK' ? this.gateways.get(gwId) : undefined
        const isRealGateway = !!gw && gw.mode !== 'mock'

        // stage-58 — پی‌ایر حذف شد؛ ردیف تاریخی PENDING هرگز fail خودکار
        // نمی‌شود (پول ممکن است در پی‌ایر گرفته شده باشد) → finding دستی R12.
        // ادمین در پنل PSP پی‌ایر بررسی و خودش تصمیم می‌گیرد.
        if (gwId !== 'MOCK' && !isRealGateway) {
          await this.recordR12(p, 'unknown/removed gateway — manual PSP review required')
          continue
        }

        if (isRealGateway && (p.gatewayRef || p.metadata?.callbackQuery || this.unresolvedMellatDispatch(p))) {
          const v = await this.verification.verify(p, gw!)
          verifiedRef = v.gatewayRef ?? p.gatewayRef
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
        } else if (isRealGateway && !p.gatewayRef && !this.safeMellatInitFailure(p) &&
          (p.metadata?.paymentUrl || p.callbackUrl || p.metadata?.initFailed !== true)) {
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
          verifiedRef,
          success
            ? undefined
            : {
                source: 'timeout-job',
                gateway: gwId || null,
                hadGatewayRef: !!p.gatewayRef,
              },
          p.gatewayRef,
          undefined, false, p,
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

  /** New purchases read only an advisory; PSP outages cannot delay checkout. */
  private async pendingPaymentAdvisory(userId: string): Promise<CheckoutPreviewData['paymentRecovery']> {
    const [pending] = await this.deps.db.select({ displayId: orders.displayId }).from(orders).where(and(
      eq(orders.userId, userId), eq(orders.status, 'PENDING_PAYMENT'),
    )).orderBy(asc(orders.createdAt)).limit(1)
    const [sibling] = pending ? [] : await this.deps.db.select({ displayId: orders.displayId }).from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id)).where(and(
        eq(orders.userId, userId), eq(payments.status, 'PENDING'),
      )).limit(1)
    const original = pending ?? sibling
    return original ? {
      orderId: original.displayId, blocksPayment: false, retryAfterSeconds: 60,
      message: 'پرداخت سفارش قبلی جداگانه پیگیری می‌شود. می‌توانید سفارش جدید را با پرداخت مستقل ثبت کنید؛ رزروها و تخفیف اولین خرید سفارش قبلی حفظ می‌شود.',
    } : null
  }

  /** Explicit audit only; new checkout does not wait for PSP reconciliation. */
  async reconcileCustomerPendingOrders(userId: string, onlyOrderId?: OrderRow['id']): Promise<CheckoutPreviewData['paymentRecovery']> {
    const cutoff = new Date(Date.now() - this.deps.config.pendingOrderExpiryMinutes * 60_000)
    const stale = await this.deps.db.select().from(orders).where(and(
      eq(orders.userId, userId), eq(orders.status, 'PENDING_PAYMENT'), lt(orders.createdAt, cutoff),
      onlyOrderId ? eq(orders.id, onlyOrderId) : undefined,
    )).orderBy(asc(orders.createdAt)).limit(50)
    for (const order of stale) {
      try {
        await this.expireOnePendingOrder(order)
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'CONFLICT')) throw error
        // Concurrent settlement is decided by a fresh guard below.
      }
    }
    // A paid order can still have an older outstanding attempt. Reconcile its
    // terminal failures without touching the original settlement; an extra
    // success requires PSP review/reversal of this original order only.
    const siblings = await this.deps.db.select({ payment: payments, order: orders })
      .from(payments).innerJoin(orders, eq(payments.orderId, orders.id)).where(and(
        eq(payments.userId, userId), eq(payments.status, 'PENDING'), ne(orders.status, 'PENDING_PAYMENT'),
        onlyOrderId ? eq(orders.id, onlyOrderId) : undefined,
      )).limit(50)
    for (const { payment, order } of siblings) {
      const invalid = this.paymentIntegrity(payment, order)
      if (invalid) { await this.recordR12(payment, invalid); continue }
      const gateway = this.gateways.get(payment.gateway.toUpperCase())
      if (!gateway || gateway.mode === 'mock') {
        await this.recordR12(payment, 'outstanding payment on a closed order — manual PSP review required')
        continue
      }
      const result = await this.verification.verify(payment, gateway)
      if (result.indeterminate) {
        await this.recordR12(payment, 'outstanding payment on a closed order — preserve evidence pending PSP review')
        continue
      }
      try {
        await this.finalize(payment.id, result.success, result.gatewayRef, { source: 'closed-order-review' }, payment.gatewayRef, undefined, false, payment)
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'CONFLICT')) throw error
      }
    }
    return this.pendingPaymentAdvisory(userId)
  }

  /** Owner-only recovery: verification and status, never payment initiation. */
  async reconcileOwnedOrder(userId: string, displayId: string) {
    const [order] = await this.deps.db.select().from(orders).where(and(
      eq(orders.userId, userId), eq(orders.displayId, displayId),
    ))
    if (!order) throw Err.notFound('سفارش پیدا نشد.')
    if (order.status === 'PENDING_PAYMENT') {
      try { await this.expireOnePendingOrder(order) } catch (error) {
        if (!(error instanceof AppError && error.code === 'CONFLICT')) throw error
      }
    } else {
      await this.reconcileCustomerPendingOrders(userId, order.id)
    }
    const [current] = await this.deps.db.select().from(orders).where(eq(orders.id, order.id))
    return { orderId: order.displayId, status: current!.status, paymentStatus: current!.paymentStatus, retryAfterSeconds: 60 }
  }

  /** Inspect bounded rotating batches. Age blocks initiation; only conclusive
   * PSP evidence permits releasing financial reservations. */
  async expirePendingOrders(
    olderThanMinutes: number = this.deps.config.pendingOrderExpiryMinutes,
  ): Promise<{ expired: number; settled: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)
    const loadBatch = (after: OrderRow['id'] | null) => this.deps.db
      .select()
      .from(orders)
      .where(and(
        eq(orders.status, 'PENDING_PAYMENT'),
        lt(orders.createdAt, cutoff),
        after ? gt(orders.id, after) : undefined,
      ))
      .orderBy(asc(orders.id))
      .limit(50)
    let rows = await loadBatch(this.expiryAfterId)
    if (rows.length === 0 && this.expiryAfterId !== null) rows = await loadBatch(null)
    this.expiryAfterId = rows.length === 50 ? rows[rows.length - 1]!.id : null
    let expired = 0
    let settled = 0
    for (const order of rows) {
      try {
        const outcome = await this.expireOnePendingOrder(order)
        if (outcome === 'expired') expired++
        else if (outcome === 'settled') settled++
      } catch (e) {
        if (e instanceof AppError && e.code === 'CONFLICT') continue // concurrent callback/retry changed the snapshot
        console.error(`[payments] expire ${order.displayId}:`, e)
      }
    }
    if (expired + settled > 0) {
      console.log(`[payments] expiry window: ${expired} expired, ${settled} late-settled`)
    }
    return { expired, settled }
  }

  /** Check every outstanding attempt before canceling an expired order.
   * A lost callback or an expired token says nothing about an earlier charge. */
  private async expireOnePendingOrder(order: OrderRow): Promise<'settled' | 'expired' | 'none'> {
    const attempts = await this.deps.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(asc(payments.createdAt))
    const successful = attempts.find(p => p.status === 'SUCCESS')
    if (successful) {
      if (successful.verifiedAt && successful.gatewayRef && !this.paymentIntegrity(successful, order) &&
        attempts.filter(p => p.status === 'SUCCESS').length === 1) {
        await this.finalize(successful.id, true, successful.gatewayRef, undefined, successful.gatewayRef, undefined, true, successful)
        return 'settled'
      }
      await this.recordR12(successful, 'pending order already has a successful payment')
      return 'none'
    }
    const pendingRows = attempts.filter(p => p.status === 'PENDING')
    const active = pendingRows[pendingRows.length - 1]
    if (!active) {
      const last = attempts[attempts.length - 1]
      if (last) await this.recordR12(last, 'pending order has no pending payment — manual review required')
      else await this.recordMissingPayment(order)
      return 'none'
    }
    let unresolved = false
    for (const payment of pendingRows) {
      const invalid = this.paymentIntegrity(payment, order)
      if (invalid) {
        await this.recordR12(payment, invalid)
        unresolved = true
        continue
      }
      const gwId = payment.gateway.toUpperCase()
      const gateway = this.gateways.get(gwId)
      if (!gateway) {
        await this.recordR12(payment, 'unknown/removed gateway — manual PSP review required')
        unresolved = true
        continue
      }
      if (gwId === 'MOCK') continue
      if (this.safeMellatInitFailure(payment) && !payment.metadata?.callbackQuery) continue
      // A never-started attempt or a recorded init failure has no payable
      // session. An init currently in flight must finish before we decide.
      if (!this.unresolvedMellatDispatch(payment) && !payment.gatewayRef && !payment.metadata?.paymentUrl && !payment.callbackUrl && !payment.metadata?.callbackQuery &&
        (!payment.metadata?.initToken || payment.metadata?.initFailed === true)) continue
      let verdict: Awaited<ReturnType<PaymentGateway['verify']>> | null = null
      try {
        verdict = await this.verification.verify(payment, gateway)
      } catch { /* PSP outages are unresolved, including adapters that throw. */ }
      if (verdict?.success && !verdict.indeterminate) {
        await this.finalize(payment.id, true, verdict.gatewayRef ?? payment.gatewayRef, undefined, payment.gatewayRef, undefined, false, payment)
        return 'settled'
      }
      if (!verdict || verdict.indeterminate) {
        await this.recordR12(payment, 'payment window closed with unresolved PSP result — preserve reservations pending verification/review')
        unresolved = true
      }
    }
    if (unresolved) return 'none'
    const failInfo: Record<string, unknown> = {
      source: this.paymentWindowClosed(order) ? 'expiry-job' : 'payment-recheck',
      gateway: active.gateway,
      hadGatewayRef: !!active.gatewayRef,
      orderAgeMinutes: Math.round((Date.now() - order.createdAt.getTime()) / 60_000),
    }
    await this.finalize(active.id, false, active.gatewayRef, failInfo, active.gatewayRef, pendingRows)
    return 'expired'
  }

  // ── داخلی ──

  private async resolveR12(tx: DbOrTx, paymentId: PaymentId): Promise<void> {
    await tx.update(reconcileFindings).set({ status: 'auto_fixed', resolvedAt: new Date() })
      .where(and(eq(reconcileFindings.checkId, 'R12'), eq(reconcileFindings.entityId, paymentId), eq(reconcileFindings.status, 'open')))
  }

  private async recordMissingPayment(order: OrderRow): Promise<void> {
    await this.deps.db.insert(reconcileFindings).values({
      checkId: 'R12', severity: 'critical', entityType: 'order', entityId: order.id,
      detail: { orderId: order.displayId, note: 'pending order has no payment record; review original PSP records before releasing reservations' },
    }).onConflictDoUpdate({
      target: [reconcileFindings.checkId, reconcileFindings.entityId],
      set: { status: 'open', resolvedAt: null, lastSeenAt: new Date(), occurrences: sql`${reconcileFindings.occurrences} + 1` },
      setWhere: sql`${reconcileFindings.status} <> 'open' or ${reconcileFindings.lastSeenAt} < now() - interval '1 hour'`,
    })
  }

  private async assertOnlyInitiationAttempt(tx: DbOrTx, orderId: OrderRow['id'], paymentId: PaymentId): Promise<void> {
    const [otherAttempt] = await tx.select({ id: payments.id }).from(payments).where(and(
      eq(payments.orderId, orderId), ne(payments.id, paymentId),
      sql`${payments.status} in ('PENDING', 'SUCCESS')`,
    )).limit(1)
    if (otherAttempt) throw Err.conflict('تلاش پرداخت دیگری برای همین سفارش هنوز فعال یا موفق است؛ پرداخت همان سفارش را پیگیری کنید.')
  }

  private paymentWindowClosed(order: Pick<OrderRow, 'createdAt'>): boolean {
    return Date.now() >= order.createdAt.getTime() + this.deps.config.pendingOrderExpiryMinutes * 60_000
  }

  private unresolvedMellatDispatch(payment: PaymentRow): boolean {
    if (payment.gateway !== 'MELLAT') return false
    // Historical initFailed included timeouts. A missing reference cannot prove
    // that the old hashed request was never sent or safely authorize replacing it.
    if (payment.mellatOrderId === null) {
      return !!payment.metadata?.initToken && payment.metadata?.mellatDispatched !== false
    }
    return payment.metadata?.mellatDispatched === true && payment.metadata?.initFailed !== true
  }

  private safeMellatInitFailure(payment: PaymentRow): boolean {
    return payment.gateway === 'MELLAT' && payment.mellatOrderId !== null && payment.metadata?.initFailed === true
  }

  /** Persist review diagnostics only after rollback frees the transaction's
   * connection and locks. This also works with a one-connection DB pool. */
  private async moneyTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.deps.db.transaction(work)
    } catch (error) {
      if (error instanceof PaymentReviewError) await this.recordR12(error.payment, error.note)
      throw error
    }
  }

  private paymentIntegrity(payment: PaymentRow, order: OrderRow): string | null {
    if (payment.userId !== order.userId) return 'payment owner differs from order owner'
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) return 'invalid payment amount'
    if (payment.amount !== order.breakdown?.amountPaidOnline) return 'payment amount differs from order online amount'
    if ((payment.gateway === 'MOCK') !== (payment.mode === 'mock')) return 'payment gateway/mode mismatch'
    return null
  }

  /** Verification writes do not bump the business revision. A successful
   * callback may have persisted evidence while waiting for settlement locks. */
  private hasVerifiedSuccess(payment: PaymentRow): boolean {
    const raw = payment.metadata?.verification
    if (!raw || typeof raw !== 'object') return false
    const evidence = raw as Record<string, unknown>
    const result = evidence.result as Record<string, unknown> | undefined
    return evidence.reference === payment.gatewayRef && evidence.amount === payment.amount &&
      (evidence.mellatOrderId ?? null) === (payment.mellatOrderId?.toString() ?? null) &&
      evidence.gateway === payment.gateway && evidence.mode === payment.mode &&
      result?.success === true && result.indeterminate !== true
  }

  /** تعویض امن ردیف PENDING → FAILED (برچسب پیش‌فرض retry-superseded برای R11؛
   * stage-98 — انقضای پنجره با برچسبِ expiry-sibling خواهرها را می‌بندد) */
  private async supersedePending(tx: DbOrTx, p: PaymentRow, source = 'retry-superseded'): Promise<void> {
    if (this.hasVerifiedSuccess(p)) throw Err.conflict('نتیجه موفق پرداخت قبلی در انتظار نهایی‌سازی سفارش اصلی است.')
    await tx
      .update(payments)
      .set({
        status: 'FAILED',
        metadata: {
          ...(p.metadata ?? {}),
          fail: { source, at: new Date().toISOString() },
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
    const kind = /receipt already settled/.test(note) ? 'duplicate-receipt'
      : /success/.test(note) ? 'successful-payment-review'
      : /owner|amount|mode/.test(note) ? 'payment-integrity'
      : /unknown\/removed gateway/.test(note) ? 'gateway-unavailable' : 'unresolved-payment'
    try {
      const recorded = await this.deps.db.transaction(async tx => {
        // Serialize diagnostic writes with finalize's payment update/resolution.
        // If settlement wins, an old unknown response must not reopen R12. If
        // diagnostics wins, settlement resolves the finding after this commit.
        const [current] = await tx.select().from(payments).where(eq(payments.id, p.id)).for('no key update')
        if (!current) return []
        const missingPendingAttempt = note.startsWith('pending order has no pending payment')
        if ((kind === 'unresolved-payment' || kind === 'gateway-unavailable') &&
          current.status !== 'PENDING' && !missingPendingAttempt) return []
        const [order] = await tx.select({ displayId: orders.displayId, status: orders.status })
          .from(orders).where(eq(orders.id, p.orderId))
        if ((missingPendingAttempt || note === 'pending order already has a successful payment') &&
          order?.status !== 'PENDING_PAYMENT') return []
        const detail = {
          kind,
          orderId: order?.displayId ?? null,
          orderInternalId: p.orderId,
          paymentId: p.id,
          mellatOrderId: p.mellatOrderId?.toString() ?? null,
          gateway: (p.gateway ?? '').toUpperCase() || null,
          gatewayRef: p.gatewayRef ?? null,
          amount: p.amount,
          note,
          paymentUpdatedAt: p.updatedAt?.toISOString() ?? null,
          action: 'Check this original transaction in the PSP merchant panel using mellatOrderId for an allocated Mellat request. Only verified payment or terminal nonpayment/reversal permits financial settlement or release; acknowledging this finding does not resolve the payment.',
        }
        return tx
          .insert(reconcileFindings)
          .values({
            checkId: 'R12',
            severity: 'critical',
            status: 'open',
            entityType: 'payment',
            entityId: p.id,
            detail,
          })
          .onConflictDoUpdate({
            target: [reconcileFindings.checkId, reconcileFindings.entityId],
            set: {
              detail,
              status: 'open',
              resolvedAt: null,
              lastSeenAt: new Date(),
              occurrences: sql`${reconcileFindings.occurrences} + 1`,
            },
            setWhere: sql`${reconcileFindings.status} <> 'open'
              or ${reconcileFindings.lastSeenAt} < now() - interval '1 hour'
              or ${reconcileFindings.detail}->>'kind' is distinct from ${kind}
              or ${reconcileFindings.detail}->>'gatewayRef' is distinct from ${p.gatewayRef}
              or ${reconcileFindings.detail}->>'amount' is distinct from ${String(p.amount)}`,
          })
          .returning({ id: reconcileFindings.id })
      })
      if (recorded.length) console.error(`[payments] R12 UNRESOLVED: ${p.id} gateway=${p.gateway} — ${note}`)
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
    expectedReference?: string | null,
    expirySnapshot?: PaymentRow[],
    recoverVerifiedSuccess = false,
    verificationSnapshot?: PaymentRow,
  ): Promise<{ orderDisplayId: string; paymentStatus: string; userId: string }> {
    let settledOrderId: string | undefined
    const result = await this.moneyTransaction(async (tx) => {
      // metadata فعلی برای ادغام — فقط خواندن؛ تصرف اتمیک همان update
      // با status=PENDING است، پس این select مسیر رقابت را عوض نمی‌کند
      const snapshot = (
        await tx.select().from(payments).where(eq(payments.id, paymentId))
      )[0]
      if (!snapshot) throw Err.notFound('پرداخت پیدا نشد.')
      const [candidate] = await tx.select().from(orders).where(eq(orders.id, snapshot.orderId))
      if (!candidate) throw Err.notFound('سفارش این پرداخت پیدا نشد.')
      const initialInvalid = this.paymentIntegrity(snapshot, candidate)
      if (initialInvalid) throw new PaymentReviewError(snapshot, initialInvalid)
      await lockWalletAccounts(tx, [candidate.userId])
      await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).for('no key update')
      if (candidate?.couponId) {
        await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, candidate.couponId)).for('update')
      }
      const [orderRow] = await tx.select().from(orders).where(eq(orders.id, snapshot.orderId)).for('update')
      if (!orderRow) throw Err.notFound('سفارش این پرداخت پیدا نشد.')
      const [current] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update')
      if (!current) throw Err.notFound('پرداخت پیدا نشد.')
      const recovering = recoverVerifiedSuccess && success && current.status === 'SUCCESS' && !!current.verifiedAt && !!current.gatewayRef
      if (current.status !== 'PENDING' && !recovering) {
        if (success && current.status !== 'SUCCESS') throw new PaymentReviewError({ ...current, gatewayRef: gatewayRef ?? current.gatewayRef }, 'late PSP success for a previously failed payment')
        throw Err.conflict('این پرداخت قبلاً نهایی شده است.')
      }
      if (expectedReference !== undefined && current.gatewayRef !== expectedReference) {
        throw Err.conflict('مرجع پرداخت تغییر کرد؛ استعلام جدید لازم است.')
      }
      if (verificationSnapshot && (current.gateway !== verificationSnapshot.gateway || current.mode !== verificationSnapshot.mode ||
        current.mellatOrderId !== verificationSnapshot.mellatOrderId ||
        current.amount !== verificationSnapshot.amount || current.userId !== verificationSnapshot.userId || current.orderId !== verificationSnapshot.orderId)) {
        throw new PaymentReviewError(current, 'payment identity changed during PSP verification')
      }
      if (!success && this.hasVerifiedSuccess(current)) {
        throw Err.conflict('نتیجه موفق پرداخت قبلی در انتظار نهایی‌سازی سفارش اصلی است.')
      }
      const invalid = this.paymentIntegrity(current, orderRow)
      if (invalid) throw new PaymentReviewError(current, invalid)
      if (orderRow.status !== 'PENDING_PAYMENT') {
        if (recovering) throw Err.conflict('این پرداخت قبلاً نهایی شده است.')
        if (success) throw new PaymentReviewError(current, 'additional PSP success for an already closed order — review/reversal required')
        // Terminal failure concerns only this outstanding sibling, never the
        // closed original order's money or coupon/first-purchase entitlement.
        await tx.update(payments).set({ status: 'FAILED', verifiedAt: new Date(), updatedAt: new Date(),
          gatewayRef: gatewayRef ?? current.gatewayRef,
          metadata: { ...(current.metadata ?? {}), fail: { source: 'closed-order-sibling', at: new Date().toISOString() } },
        }).where(eq(payments.id, current.id))
        await this.resolveR12(tx, current.id)
        return { orderDisplayId: orderRow.displayId, paymentStatus: 'RECONCILED', userId: orderRow.userId }
      }
      // MOCK success is a new user payment action, unlike a PSP callback that
      // proves money was already charged. Never block real settlement here.
      if (success && current.gateway === 'MOCK') {
        await this.settings.assertOrderPaymentsAllowed(tx)
        await this.assertOnlyInitiationAttempt(tx, orderRow.id, current.id)
      }
      if (success) {
        const [anotherSuccess] = await tx.select().from(payments).where(and(
          eq(payments.orderId, orderRow.id), ne(payments.id, current.id), eq(payments.status, 'SUCCESS'),
        )).limit(1)
        if (anotherSuccess) throw new PaymentReviewError(anotherSuccess, 'pending order already has a successful payment')
      }
      let otherPending = false
      if (!success && !expirySnapshot) {
        const siblings = await tx.select().from(payments).where(and(
          eq(payments.orderId, orderRow.id), ne(payments.id, current.id),
          sql`${payments.status} in ('PENDING', 'SUCCESS')`,
        )).for('update')
        const successful = siblings.find(p => p.status === 'SUCCESS')
        if (successful) throw new PaymentReviewError(successful, 'pending order already has a successful payment')
        otherPending = siblings.length > 0
      }
      if (expirySnapshot) {
        const attempts = await tx.select().from(payments).where(eq(payments.orderId, orderRow.id)).for('update')
        const successful = attempts.find(p => p.status === 'SUCCESS')
        if (successful) throw new PaymentReviewError(successful, 'pending order already has a successful payment')
        const pending = attempts.filter(p => p.status === 'PENDING')
        const checked = new Map(expirySnapshot.map(p => [p.id, p]))
        if (pending.length !== checked.size || pending.some(p => {
          const old = checked.get(p.id)
          return !old || p.updatedAt.getTime() !== old.updatedAt.getTime() || p.gatewayRef !== old.gatewayRef || p.mellatOrderId !== old.mellatOrderId ||
            p.userId !== old.userId || p.amount !== old.amount || p.gateway !== old.gateway || p.mode !== old.mode ||
            p.callbackUrl !== old.callbackUrl || p.metadata?.paymentUrl !== old.metadata?.paymentUrl ||
            p.metadata?.initToken !== old.metadata?.initToken || p.metadata?.initFailed !== old.metadata?.initFailed ||
            p.metadata?.mellatDispatched !== old.metadata?.mellatDispatched
        })) throw Err.conflict('وضعیت پرداخت تغییر کرد؛ استعلام جدید لازم است.')
        // These siblings were all proven unpaid above. Close them in the same
        // transaction as cancellation, after checking the full verified set.
        for (const sibling of pending) {
          if (sibling.id !== current.id) {
            await this.supersedePending(tx, sibling, 'expiry-sibling')
            await this.resolveR12(tx, sibling.id)
          }
        }
      }
      const finalRef = gatewayRef ?? current.gatewayRef
      if (success && current.gateway !== 'MOCK') {
        if (!finalRef) {
          throw new PaymentReviewError(current, 'successful PSP verification has no receipt reference')
        }
        const receipt = current.gateway === 'MELLAT' ? /^\d+:s:(\d+)$/.exec(finalRef)?.[1] : finalRef
        if (!receipt) throw Err.conflict('مرجع تراکنش معتبر نیست.')
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment-receipt:${current.gateway}:${receipt}`}, 0))`)
        const [duplicate] = await tx.select({ id: payments.id }).from(payments).where(and(
          ne(payments.id, current.id), eq(payments.gateway, current.gateway), eq(payments.status, 'SUCCESS'),
          current.gateway === 'MELLAT'
            ? sql`${payments.gatewayRef} like '%:s:%' and split_part(${payments.gatewayRef}, ':', 3) = ${receipt}`
            : eq(payments.gatewayRef, finalRef),
        )).limit(1)
        if (duplicate) {
          throw new PaymentReviewError({ ...current, gatewayRef: finalRef }, `PSP receipt already settled by payment ${duplicate.id}`)
        }
      }

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
        .where(and(eq(payments.id, paymentId), eq(payments.status, recovering ? 'SUCCESS' : 'PENDING')))
        .returning()
      if (!payment) throw Err.conflict('این پرداخت قبلاً نهایی شده است.')
      await this.resolveR12(tx, payment.id)

      if (success) {
        await this.deps.orders.settlePayment(tx, orderRow)
        settledOrderId = orderRow.id
        return { orderDisplayId: orderRow.displayId, paymentStatus: 'SUCCESS', userId: orderRow.userId }
      }
      // A failure callback proves only this attempt failed. Keep its receipt
      // and failed status, but preserve order reservations for other attempts
      // which may have charged. Their callbacks/expiry will resolve the order.
      if (otherPending) {
        return { orderDisplayId: orderRow.displayId, paymentStatus: 'PENDING', userId: orderRow.userId }
      }
      await this.deps.orders.failPayment(tx, orderRow)
      return { orderDisplayId: orderRow.displayId, paymentStatus: 'FAILED', userId: orderRow.userId }
    })

    if (settledOrderId) this.deps.orders.recordSettlementAfterCommit(settledOrderId)

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
      // stage-98 — انقضای پنجرهٔ پرداخت: پیامِ صادقانهٔ خودش را دارد
      // («دوباره سفارش ثبت کنید»)؛ مسیرِ شکستِ عادیِ درگاه همان متنِ قبلی است.
      const expired = typeof failInfo?.source === 'string' && String(failInfo.source).startsWith('expiry')
      void this.deps.notifications
        .notifyUser(result.userId, {
          type: 'system',
          title: expired ? '⌛ پنجرهٔ پرداخت به پایان رسید' : '❌ پرداخت سفارش ناموفق بود',
          body: expired
            ? `پنجرهٔ پرداخت سفارش ${result.orderDisplayId} به پایان رسید و سفارش لغو شد. رزرو کیف پول/کد تخفیف (در صورت استفاده) آزاد شد — می‌توانید دوباره سفارش ثبت کنید.`
            : `پرداخت سفارش ${result.orderDisplayId} تکمیل نشد و سفارش لغو شد. رزرو کیف پول/کد تخفیف (در صورت استفاده) آزاد شد — می‌توانید دوباره سفارش ثبت کنید.`,
          url: `/dashboard/orders/${result.orderDisplayId}`,
          data: { order: result.orderDisplayId, source: expired ? 'payment-expired' : 'payment-failed' },
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
