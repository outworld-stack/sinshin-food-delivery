//src/infra/db/schema/backfill-runs.ts
/**
 * stage-73 — دفتر ثبتِ «بک‌فیل‌های نسخه‌دار».
 *
 * چرا این جدول؟ (اسکن راند ۷۳ — یافته‌ی ۲ کارفرما)
 * postMigrateDeviceBackfills در stage-72 در «هر» اجرای db:migrate فراخوانی
 * می‌شد و بندِ ③ آن (آزادسازی مسدودی‌های auto:%) هر بار دوباره اجرا
 * می‌شد؛ یعنی هر دستگاهی که «بعد از» deploy قبلی به‌درستی مسدودِ خودکار
 * شده بود، در deploy بعدی آزاد می‌شد — دقیقاً برعکسِ سیاست.
 *
 * ریشه‌ای‌ترین رفع: بک‌فیل داده‌ی یک‌باره باید «نسخه‌دار» باشد و فقط
 * یک‌بار اجرا شود — نه ایدمپوتنتِ همیشگی، نه تکرارشونده در هر deploy.
 * این جدول همان دفتر ثبت است: هر بک‌فیل با نام + نسخه‌اش وقتی «به‌طور
 * کامل» اجرا شد (یا به تشخیصِ شواهد، اجرا شدنش ثابت شد) یک ردیف می‌گیرد؛
 * db:migrate ردیفِ (name, version≥جاری) را دید → برای همیشه رد.
 *
 * این جدول DDL خالص است → با همان جریانِ stage-72 تولید می‌شود:
 *   bun run db:generate   →  0006_*.sql + snapshot + journal
 * (هیچ SQL داده‌ای داخل زنجیره نمی‌آید — اصل ۲-۱۰-۴ حفظ شد.)
 */
import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

export const backfillRuns = pgTable('backfill_runs', {
  /** نام منطقی بک‌فیل — مثلاً 'device-backfills' */
  name: varchar('name', { length: 64 }).primaryKey(),
  /** نسخه‌ی اجراشده — اجرای مجدد فقط وقتی نسخه بالاتر صریحاً بخواهد */
  version: integer('version').notNull(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
})

export type BackfillRunRow = typeof backfillRuns.$inferSelect
