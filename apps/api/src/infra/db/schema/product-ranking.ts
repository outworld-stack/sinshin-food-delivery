//src/infra/db/schema/product-ranking.ts
// ═══════════════════════════════════════════════════════════════
// hundred-fifteen (فاز ۳ — «منتخب») — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/product-ranking.ts
//
// جدول رتبه‌بندی هوشمند — سوختِ مرتب‌سازی «منتخب» لیست محصول. هر شب
// (۰۳:۴۷) از بازدید/سبدِ product_daily_stats و فروشِ سفارش‌های پرداخت‌شده بازمحاسبه می‌شود:
// EMA نیم‌عمر ۱۰روزه + پیشینِ تجربی دو-سطحی + نمونه‌گیری تامپسون از
// بتای پسینی.
//
// قرارداد «بدون FK» (همان فاز ۱ و ۲): این جدول خروجیِ محاسبه است، نه
// منبع حقیقت — محصولِ حذف/غیرفعال‌شده اصلاً وارد محاسبه نمی‌شود (فیلتر
// قبل از رتبه‌بندی) و ردیفِ یتیمش با بازمحاسبه‌ی کامل شبانه (delete +
// insert) ناپدید می‌شود. خواندن با join/پرچمِ موجودی در لحظه‌ی نمایش
// فیلتر می‌شود؛ این جدول فقط «ترتیب» می‌گوید.
// ═══════════════════════════════════════════════════════════════
import { date, doublePrecision, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ProductId } from '#/domain/shared/brand'

/**
 * یک ردیف به‌ازای هر محصولِ ACTIVE — نوشتن فقط با جابِ شبانه‌ی
 * ۰۳:۴۷ (ProductRankingJob) در یک tx اتمیک؛ مسیر آنلاین فقط می‌خواند.
 */
export const productRanking = pgTable(
  'product_ranking',
  {
    productId: uuid('product_id').$type<ProductId>().primaryKey(),
    /** نمونه‌ی تامپسون از بتای پسینی — ۰..۱؛ مبنای مرتب‌سازی «منتخب».
     *  double precision (نه real): خروجی متنی و باینری پروتکل PG در float8
     *  بیت‌به‌بیت یکی است — در float4 ممیزهای آخر بین دو مسیر می‌ریزد
     *  (درسِ double-everywhere فاز ۲) */
    score: doublePrecision('score').notNull(),
    /** پارامتر الفای پسینی (موفقیت‌های وزن‌دار + پیشین) — پایش + پلِ فاز ۴ */
    alpha: doublePrecision('alpha').notNull(),
    /** پارامتر بتای پسینی (شکست‌های وزن‌دار + پیشین) */
    beta: doublePrecision('beta').notNull(),
    /** رتبه‌ی سراسری ۱-مبنا — score نزولی، تای‌بریکِ قطعی id صعودی */
    rank: integer('rank').notNull(),
    /** روزِ تقویمیِ تهرانیِ محاسبه — seed نمونه‌گیر؛ تغییر روز = نمونه‌ی تازه */
    computedDay: date('computed_day', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** کوئری‌های عملیاتی (لیست برتر / پنل ادمین) به‌ترتیب امتیاز */
    index('product_ranking_score_idx').on(t.score),
  ],
)
