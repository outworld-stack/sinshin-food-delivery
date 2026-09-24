// src/domain/order/checkout-idempotency.service.ts
import { and, eq, isNull, lt, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { checkoutIdempotency } from '#/infra/db/schema'

/** نتیجهٔ claim — سه حالت ممکن برای کلیدِ Idempotency-Key چک‌اوت */
export type IdempotencyClaim =
  | { kind: 'claimed' }
  | { kind: 'replay'; response: Record<string, unknown> }
  | { kind: 'in-flight' }

/**
 * round-20 — claim اتمیک idempotency چک‌اوت روی PK مرکب (user_id, key).
 *
 * چرا DB و نه Redis (جایگزینی کامل، نه لایهٔ دوم): چک‌اوت ذاتاً یک عمل
 * سنگینِ DB است؛ هزینهٔ یک درجِ اضافی در برابر «سفارش تکراری با کسر
 * دوبارهٔ کیف پول» صفر است. ذخیره‌سازی مقیم یعنی قطعی و ری‌استارتِ ردیس
 * (که تا امروز پنجرهٔ idempotency را بی‌صدا صفر می‌کرد) دیگر اثری بر
 * مسیر پول ندارد.
 *
 * پایداری: خطای DB در claim/complete مثل خود چک‌اوت خطای ۵۰۰ می‌دهد،
 * نه کرش؛ complete/release عمداً best-effort اند (توضیح در تک‌تک).
 */
const STALE_CLAIM = sql`now() - interval '60 seconds'`

export class CheckoutIdempotency {
  constructor(private readonly deps: { db: Db }) {}

  /**
   * ① درجِ آزاد → claim مال ماست
   * ② ردیف موجود با پاسخ → replay همان پاسخ
   * ③ ردیفِ در-حال-پردازشِ تازه → درگیری (409 در روت)
   * ④ ردیفِ در-حال-پردازشِ بی‌صاحب (>۶۰s — کرش فرایند) → تصرف اتمیک
   */
  async claim(userId: string, key: string): Promise<IdempotencyClaim> {
    const { db } = this.deps

    const inserted = await db
      .insert(checkoutIdempotency)
      .values({ userId, key })
      .onConflictDoNothing()
      .returning({ userId: checkoutIdempotency.userId })
    if (inserted.length > 0) return { kind: 'claimed' }

    const existing = await db
      .select({ response: checkoutIdempotency.response })
      .from(checkoutIdempotency)
      .where(and(eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, key)))
      .then((rows) => rows[0])
    // ردیف همین لحظه حذف شد (retention روی ردیف >۴۸h) — مثل درگیریِ
    // زنده رفتار می‌کنیم؛ retry بعدیِ فرانت با کلید تازه بی‌درنگ می‌گیرد
    if (!existing) return { kind: 'in-flight' }
    if (existing.response !== null) return { kind: 'replay', response: existing.response }

    // تصرف فقط با ساعت DB (بدون skew): claim تازه (<۶۰s) شرط را رد می‌کند.
    // tx چک‌اوت هرگز ۶۰ ثانیه طول نمی‌کشد؛ صاحبِ واقعیِ زنده حذف نمی‌شود.
    const took = await db
      .update(checkoutIdempotency)
      .set({ claimedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(checkoutIdempotency.userId, userId),
          eq(checkoutIdempotency.key, key),
          isNull(checkoutIdempotency.response),
          lt(checkoutIdempotency.claimedAt, STALE_CLAIM),
        ),
      )
      .returning({ userId: checkoutIdempotency.userId })
    return took.length > 0 ? { kind: 'claimed' } : { kind: 'in-flight' }
  }

  /**
   * ثبت پاسخ نهایی برای replay ها — best-effort و عمداً غیر-پرتاب:
   * سفارش همین حالا commit شده و پاسخ به دست کاربر رسیده؛ اگر این درج
   * شکست بخورد فقط «کشِ کلید» از دست می‌رود (replay بعدی سفارش جدید
   * می‌سازد — همان قرارداد ۴۸ ساعتهٔ پنجره)؛ خطا نباید موفقیت را بشکند.
   */
  async complete(userId: string, key: string, response: Record<string, unknown>): Promise<void> {
    try {
      await this.deps.db
        .update(checkoutIdempotency)
        .set({ response, updatedAt: sql`now()` })
        .where(and(eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, key)))
    } catch (err) {
      console.error('[idempotency] complete failed (order already committed):', err)
    }
  }

  /**
   * آزادسازی claim پس از شکست چک‌اوت — retry بلافاصله ممکن می‌شود.
   * غیر-پرتاب: خطای این پاک‌سازی نباید خطای اصلیِ چک‌اوت را بپوشاند؛
   * اگر نشد، claim بعد از ۶۰ ثانیه خودبه‌خود قابل تصرف است.
   */
  async release(userId: string, key: string): Promise<void> {
    try {
      await this.deps.db
        .delete(checkoutIdempotency)
        .where(and(eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, key)))
    } catch (err) {
      console.error('[idempotency] release failed:', err)
    }
  }
}
