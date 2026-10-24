// src/workers/jobs/payment-timeout.job.ts
import type { PaymentService } from '#/domain/payment/payment.service'
import type { IntervalJob } from '#/workers/scheduler'

/**
 * phase-2 — تایم‌اوت/ری-وریفای پرداخت‌های PENDING:
 * مشتری درگاه را باز کرد ولی ریدایرکت برگشت نرسید → سفارش تا ابد PENDING
 * نمی‌ماند: ری-وریفای درگاه؛ وگرنه شکست (بازگشت کیف پول + آزادسازی کوپن).
 *
 * stage-98 — «پنجرهٔ پرداخت»: هر ۶۰ ثانیه دو تور می‌زند —
 *  ① انقضای قطعیِ سفارش‌هایِ PENDING_PAYMENTِ بالایِ TTL
 *    (PENDING_ORDER_EXPIRY_MINUTES، پیش‌فرض ۱۰ دقیقه): یک استعلامِ زندهٔ
 *    تک‌بار (پرداخت‌شده ⇒ settle؛ توکنِ مرده ⇒ لغوِ اتمیک + آزادسازیِ رزروها)
 *    — با دقتِ ~۱ دقیقه‌ای که شمارش‌معکوسِ صفحهٔ سفارش به آن قول می‌دهد.
 *  ② reconcile دوم (نتیجهٔ ۳۰ دقیقه) دست‌نخورده — تورِ اطمینان برای هر
 *    چیزی که از تورِ اول جا ماند (استعلامِ شکست‌خورده و…).
 */
export class PaymentTimeoutJob implements IntervalJob {
  readonly name = 'payment-timeout'
  readonly everySeconds = 60 // stage-98 — دقیقه‌ای: پنجرهٔ پرداختِ ۱۰ دقیقه‌ای با دقتِ ~۱ دقیقه

  constructor(private readonly deps: { payments: PaymentService }) {}

  async run(): Promise<void> {
    // stage-98 — تورِ اول: انقضای پنجرهٔ پرداخت (سنِ سفارش، همهٔ درگاه‌ها)
    await this.deps.payments.expirePendingOrders()
    // تورِ دوم (نتیجهٔ ۳۰ دقیقه): ری-وریفایِ رهاشده‌هایِ معلق + R12 — بدون تغییر
    await this.deps.payments.reconcilePending(30)
  }
}
