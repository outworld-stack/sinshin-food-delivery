//src/infra/db/schema/product-stats.ts
// ═══════════════════════════════════════════════════════════════
// hundred-eleven (فاز ۱ — آمار واقعی) — sinshin-food-delivery
// دو جدول آمار محصول: لاگ بازدید (Co-view فاز ۲ + روندها) و
// شمارنده‌ی روزانه (views/cartAdds/orders به تفکیک روزِ تهرانی).
//
// قرارداد «بدون FK» (همان snapshot semantics اقلام سفارش):
//   • بافر ۶۰ثانیه‌ایِ آمار هیچ‌وقت نباید روی حذفِ محصول بشکند یا
//     poison-pill بشود — ردیف‌های یتیم در sync شبانه پاک می‌شوند.
//   • حذفِ محصول حذفِ داده‌ی آماری‌اش را اجباری نمی‌کند (تاریخ
//     سفارش/بازدید واقعی حفظ می‌شود؛ daily views بعد از sync می‌رود).
// ═══════════════════════════════════════════════════════════════
import { date, index, integer, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { ProductId } from '#/domain/shared/brand'

/**
 * لاگ بازدید محصول — هر «بازدیدِ پذیرفته‌شده» (بعد از دداپ ۲۴ ساعته‌ی
 * ردیس و فیلتر بات) یک ردیف. منبعِ Co-view فاز ۲ (جفت‌های دیده‌شده توسط
 * یک بازدیدکننده) و روندها. رتینشن: ۶۰ روز (RetentionJob).
 */
export const productViewLog = pgTable(
  'product_view_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').$type<ProductId>().notNull(),
    /** sha256(کوکی ناشناس sinshin_vid) — ۶۴ hex؛ هیچ داده‌ی شخصی نیست */
    visitorId: varchar('visitor_id', { length: 64 }).notNull(),
    /** روزِ تقویمیِ تهرانیِ بازدید ('YYYY-MM-DD') — مبنا برای روندها/رتینشن */
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('product_view_log_product_idx').on(t.productId),
    /** رتینشن شبانه: حذفِ برشِ قدیمی با این ایندکس می‌خوابد */
    index('product_view_log_day_idx').on(t.day),
    /** Co-view فاز ۲: جوین روی بازدیدکننده */
    index('product_view_log_visitor_idx').on(t.visitorId),
  ],
)

/**
 * شمارنده‌ی روزانه‌ی هر محصول (PK = محصول+روز). سوختِ شمارنده‌های
 * افتان و نرخ‌های تبدیل فاز ۳. نوشتن: فقط upsert افزونه‌ای از بافر
 * ۶۰ثانیه‌ای (هرگز جایگزین نمی‌شود — شمارش تجمعی است).
 */
export const productDailyStats = pgTable(
  'product_daily_stats',
  {
    productId: uuid('product_id').$type<ProductId>().notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
    cartAdds: integer('cart_adds').notNull().default(0),
    /** تعداد واحدِ فروخته‌شده (sum quantity) — نه تعداد سفارش */
    orders: integer('orders').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.day] }),
    index('product_daily_stats_day_idx').on(t.day),
  ],
)
