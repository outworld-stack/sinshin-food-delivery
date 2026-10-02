//src/infra/db/schema/checkout-idempotency.ts
import { jsonb, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * round-20 — تکرارناپذیری چک‌اوت، مقیم در DB (قبلاً فقط Redis).
 *
 * PK مرکب (user_id, key) خودِ تصرف اتمیک است: دو درخواست موازی با یک
 * کلید، فقط یکی INSERT را می‌برد (ON CONFLICT DO NOTHING). برخلاف
 * نسخهٔ Redis، این تصرف در قطعیِ ردیس، ری‌استارتش و حتی چرخش به پشتیبان پابرجاست —
 * یعنی مسیر پول (سفارش تکراری/کسر دوبارهٔ کیف پول) دیگر به ردیس وابسته
 * نیست و سلامتِ ردیس می‌تواند از مسیر مسیریابی خارج شود (واپسینی /health).
 *
 *  • response = null → تصرف «در حال پردازش» است؛ پس از موفقیت چک‌اوت
 *    پاسخ نهایی در همان ردیف ثبت و تا ۴۸ ساعت (نگهداشت) به تلاش‌های مجدد
 *    برگردانده می‌شود.
 *  • تصرفِ بی‌صاحب (کرش فرایند در میانهٔ چک‌اوت) بعد از ۶۰ ثانیه با
 *    UPDATE شرطی قابل تصرف است — ساعت DB، بدون انحراف.
 *  • کاربر حذف شود (امروز حذف نداریم) → تصرف‌هایش هم آبشاری حذف می‌شوند.
 */
export const checkoutIdempotency = pgTable(
  'checkout_idempotency',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** همان قاعدهٔ هدر Idempotency-Key در order.routes — ۸ تا ۶۴ کاراکتر */
    key: varchar('key', { length: 64 }).notNull(),
    /** پاسخ نهایی چک‌اوت برای replay — null یعنی هنوز در حال پردازش */
    response: jsonb('response').$type<Record<string, unknown> | null>(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)