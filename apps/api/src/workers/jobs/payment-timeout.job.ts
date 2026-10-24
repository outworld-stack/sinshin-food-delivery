// src/workers/jobs/payment-timeout.job.ts
import type { PaymentService } from '#/domain/payment/payment.service'
import type { IntervalJob } from '#/workers/scheduler'

/** Every minute, inspect a bounded batch of orders beyond their payment
 * window, then reconcile older attempts. Unknown PSP results retain their
 * reservations and are flagged for review; elapsed time alone never refunds. */
export class PaymentTimeoutJob implements IntervalJob {
  readonly name = 'payment-timeout'
  readonly everySeconds = 60 // stage-98 — دقیقه‌ای: پنجرهٔ پرداختِ ۱۰ دقیقه‌ای با دقتِ ~۱ دقیقه

  constructor(private readonly deps: { payments: PaymentService }) {}

  async run(): Promise<void> {
    // Deadline pass uses order creation time, including newly retried attempts.
    await this.deps.payments.expirePendingOrders()
    // Older-attempt pass also detects unresolved payments on settled orders.
    await this.deps.payments.reconcilePending(30)
  }
}
