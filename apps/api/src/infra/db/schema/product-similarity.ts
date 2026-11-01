//src/infra/db/schema/product-similarity.ts
// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/product-similarity.ts
//
// جدول شباهتِ محصول‌ها — سوختِ بلوک «محصولات مشابه» صفحه‌ی محصول و
// «مکمل خرید شما» سبد. هر شب (۰۳:۴۱) از دو سیگنالِ رفتاری بازمحاسبه
// می‌شود: هم‌بازدید (product_view_log) و هم‌خرید (order_itemsِ پرداخت‌شده).
//
// قرارداد «بدون FK» (همان فاز ۱): این جدول خروجیِ محاسبه است، نه
// منبع حقیقت — محصولِ حذف‌شده با joinِ خواندن بیرون می‌افتد و ردیفِ
// یتیمش شبِ بعد با بازمحاسبه‌ی کامل (delete + insert) ناپدید می‌شود.
// هر دو جهتِ جفت رتبه‌بندی می‌شود (a→b و b→a) تا خواندن یک select ساده
// بماند؛ score متقارن است، اما هر محصول فقط ۲۰ همسایهٔ برتر خودش را نگه می‌دارد.
// ═══════════════════════════════════════════════════════════════
import { index, integer, pgTable, primaryKey, real, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ProductId } from '#/domain/shared/brand'

/**
 * شبیه‌ترین محصول‌ها به هر محصول — حداکثرِ TOP_N_PER_PRODUCT ردیف
 * به‌ازای هر جهت (ثابتِ SimilarityService). score = ترکیبِ نرمال‌شده‌ی
 * هم‌بازدید و هم‌خرید (cosine-like؛ از خودِ جاب درج می‌شود).
 */
export const productSimilarity = pgTable(
  'product_similarity',
  {
    productId: uuid('product_id').$type<ProductId>().notNull(),
    similarId: uuid('similar_id').$type<ProductId>().notNull(),
    /** ۰..۱ تقریبی — وزن‌دار: هم‌خرید قوی‌تر از هم‌بازدید */
    score: real('score').notNull(),
    /** تعداد بازدیدکننده‌ای که هر دو محصول را دیده (پس از فیلتر نویز) */
    coViews: integer('co_views').notNull().default(0),
    /** تعداد سفارشِ پرداخت‌شده‌ای که هر دو محصول را داشته */
    coPurchases: integer('co_purchases').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.similarId] }),
    /** مسیر خواندن: مشابه‌های یک محصول به‌ترتیب امتیاز */
    index('product_similarity_score_idx').on(t.productId, t.score),
  ],
)
