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
// بماند؛ اجتماعِ ۲۰ همسایهٔ ترکیبی و ۲۰ مکملِ خرید ذخیره می‌شود (حداکثر ۴۰).
// ═══════════════════════════════════════════════════════════════
import { doublePrecision, index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ProductId } from '#/domain/shared/brand'

/**
 * Union of the mixed and purchase-only top-N lists for each product.
 * Both scores use confidence-shrunk cosine; each source has at most 2N rows.
 */
export const productSimilarity = pgTable(
  'product_similarity',
  {
    productId: uuid('product_id').$type<ProductId>().notNull(),
    similarId: uuid('similar_id').$type<ProductId>().notNull(),
    /** ۰..۱ تقریبی — وزن‌دار: هم‌خرید قوی‌تر از هم‌بازدید */
    score: doublePrecision('score').notNull(),
    /** Confidence-shrunk co-purchase cosine for cart complements; zero means no purchase evidence. */
    purchaseScore: doublePrecision('purchase_score').notNull().default(0),
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
