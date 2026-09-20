// src/workers/jobs/payment-timeout.job.ts
import type { PaymentService } from '#/domain/payment/payment.service'
import type { IntervalJob } from '#/workers/scheduler'

/**
 * phase-2 — تایم‌اوت/ری-وریفای پرداخت‌های PENDING:
 * مشتری درگاه را باز کرد ولی ریدایرکت برگشت نرسید → سفارش تا ابد PENDING
 * نمی‌ماند: ری-وریفای درگاه؛ وگرنه fail (بازگشت کیف پول + آزادسازی کوپن).
 */
export class PaymentTimeoutJob implements IntervalJob {
  readonly name = 'payment-timeout'
  readonly everySeconds = 5 * 60 // هر ۵ دقیقه

  constructor(private readonly deps: { payments: PaymentService }) {}

  async run(): Promise<void> {
    // PENDING های قدیمی‌تر از ۳۰ دقیقه — سشن درگاه‌ها ~۱۵ دقیقه است، امن
    await this.deps.payments.reconcilePending(30)
  }
}