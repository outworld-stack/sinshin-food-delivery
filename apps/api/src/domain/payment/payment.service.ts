// src/domain/payment/payment.service.ts
import { and, eq, lt } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders, payments, type OrderRow } from '#/infra/db/schema'
import type { PaymentId } from '#/domain/shared/brand'
import type { AppConfig } from '#/infra/config/env'
import { AppError, Err } from '#/domain/shared/errors'
import type { OrderService } from '#/domain/order/order.service'
import type { SseHub } from '#/infra/realtime/sse-hub'
import { signState, verifyState } from './state'
import { MockAdapter } from './mock.adapter'
import { ZarinpalAdapter } from './zarinpal.adapter'
import { PayirAdapter } from './payir.adapter'
import { SepAdapter } from './sep.adapter'
import type { PaymentGateway } from './gateway.types'


export class PaymentService {
  private readonly gateways: Map<string, PaymentGateway>

  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      orders: OrderService
      /** round-16 — اعلام سفارش جدید/نهایی‌شده به پنل زنده (SSE) */
      hub: SseHub
    },
  ) {
    this.gateways = new Map<string, PaymentGateway>([
      ['MOCK', new MockAdapter(deps.config)],
      ['ZARINPAL', new ZarinpalAdapter(deps.config)],
      ['PAYIR', new PayirAdapter(deps.config)],
      ['SEP', new SepAdapter()],
    ])
  }

  gateway(id: string): PaymentGateway {
    const gw = this.gateways.get(id.toUpperCase())
    if (!gw) throw Err.validation('درگاه پرداخت انتخابی معتبر نیست.')

    // phase-1 (باگ 🔴۳): تطابق «دو جهته» درگاه با کانفیگ —
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
        ? `${this.deps.config.siteUrl}/api/payments/mock/callback`
        : `${this.deps.config.siteUrl}/api/payments/${gw.id.toLowerCase()}/callback?state=${state}`

    const r = await gw.init({
      paymentId,
      displayId: input.displayId,
      amount: input.amount,
      callbackUrl,
      description: `سفارش ${input.displayId} — سین‌شین`,
      mobile: input.mobile,
    })

    await db
      .update(payments)
      .set({ gatewayRef: r.gatewayRef, callbackUrl, updatedAt: new Date() })
      .where(eq(payments.id, paymentId))

    return { paymentUrl: r.paymentUrl }
  }

  /** پرداخت mock — POST {success} با state امضاشده */
  async handleMockPay(token: string, success: boolean) {
    // phase-1 (باگ 🔴۳): در حالت real هیچ مسیری به MOCK نمی‌رسد —
    // حتی state های قدیمی مانده از دوره‌ی mock
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

  /** callback درگاه واقعی — state + تطبیق درگاه + query خام درگاه */
  async handleCallback(gatewayId: string, query: Record<string, string>) {
    const paymentId = verifyState(query.state ?? '', this.deps.config.jwtSecret)
    if (!paymentId) throw Err.forbidden('state نامعتبر است.')

    const payment = await this.deps.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    })
    if (!payment) throw Err.notFound('پرداخت پیدا نشد.')

    // phase-2: تطبیق درگاه callback با درگاهِ خود پرداخت —
    // قبلاً می‌شد state یک درگاه را از مسیر درگاه دیگر verify کرد
    if ((payment.gateway ?? '').toUpperCase() !== gatewayId.toUpperCase()) {
      throw Err.forbidden('این state به این درگاه تعلق ندارد.')
    }

    const gw = this.gateway(gatewayId)
    const v = await gw.verify({ gatewayRef: payment.gatewayRef, amount: payment.amount, query })

    // phase-fix: نتیجه‌ی قطعی نیست (خطای گذرای درگاه) — سفارش را fail نکن؛
    // job تایم‌اوت دوباره verify می‌کند و مشتری به صفحه سفارشش برمی‌گردد.
    if (v.indeterminate) {
      throw Err.serviceUnavailable(
        'نتیجه‌ی پرداخت فعلاً از درگاه قابل دریافت نیست — چند دقیقه بعد صفحه‌ی سفارش را دوباره باز کنید.',
      )
    }

    // callback تکراری (رفرش صفحه‌ی برگشت / دوبارفرستادن درگاه) →
    // claim اتمیک CONFLICT می‌دهد؛ به‌جای 409 خام، همان صفحه‌ی سفارش را نشان بده
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
 * phase-2 — job تایم‌اوت: پرداخت‌های PENDING رهاشده.
 * درگاه واقعی + gatewayRef → ری-وریفای (مشتری پرداخت کرده ولی callback
 * نرسیده — تب بسته شده/قطعی). وگرنه fail → CANCELED + بازگستِ کیف پول
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
        if (gwId && gwId !== 'MOCK' && p.gatewayRef) {
          const gw = this.gateways.get(gwId) // مستقیم — بدون گارد حالت
          if (gw && gw.mode !== 'mock') {
            const v = await gw.verify({ gatewayRef: p.gatewayRef, amount: p.amount, query: {} })
            if (v.indeterminate) continue
            success = v.success
          }
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

  /**
   * نهایی‌سازی — claim اتمیک (status=PENDING → نتیجه) داخل tx؛
   * callback تکراری/موازی با conflict رد می‌شود. سپس settle/fail سفارش در همان tx.
   *
   * امن-۸: در شکست، failInfo (منبع/درگاه) داخل payments.metadata
   * ثبت می‌شود — برای تحلیل پس از حادثه و چک R11 (spot-check دستی PSP).
   */
  private async finalize(
    paymentId: PaymentId,
    success: boolean,
    gatewayRef: string | null | undefined,
    failInfo?: Record<string, unknown>,
  ): Promise<{ orderDisplayId: string; paymentStatus: string }> {
    const { db } = this.deps

    const result = await db.transaction(async (tx) => {
      // metadata فعلی برای merge — فقط خواندن؛ claim اتمیک همان update
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

      const orderRow: OrderRow | undefined = (
        await tx.select().from(orders).where(eq(orders.id, payment.orderId))
      )[0]
      if (!orderRow) throw Err.notFound('سفارش این پرداخت پیدا نشد.')

      if (success) {
        await this.deps.orders.settlePayment(tx, orderRow)
        return { orderDisplayId: orderRow.displayId, paymentStatus: 'SUCCESS' }
      }
      await this.deps.orders.failPayment(tx, orderRow)
      return { orderDisplayId: orderRow.displayId, paymentStatus: 'FAILED' }
    })

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
      /* noop — publish هرگز نباید مسیر پرداخت را بشکند */
    }
    return result
  }
}