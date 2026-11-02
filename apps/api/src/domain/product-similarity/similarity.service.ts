// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/product-similarity/similarity.service.ts
//
// محرکِ توصیه‌ی «محصولات مشابه» — هر شب (۰۳:۴۱) کل جدول
// product_similarity از دو سیگنالِ رفتاریِ «واقعی» بازمحاسبه می‌شود:
//
//   ۱) هم‌بازدید (co-view): جفت‌محصول‌هایی که یک بازدیدکننده‌ی واحد
//      در یک روز تهران دیده — از لاگِ فاز ۱ (۶۰ روز اخیر).
//   ۲) هم‌خرید (co-purchase): جفت‌محصول‌هایی که در یک سفارشِ
//      پرداخت‌شده و غیر-لغو با هم خریداری شده‌اند (منبع حقیقت: order_items).
//
// نرمال‌سازیِ cosine-like (co / sqrt(pop_a × pop_b)): پیتزای پرفروش
// نباید فقط چون پرمخاطب است با همه «مشابه» شود — تقسیم بر هندسه‌ی
// جمعیت، اثر هاب را می‌گیرد و جفت‌های «واقعاً همراه» بالا می‌آیند.
//
// چرا شبانه و چرا بازمحاسبه‌ی کامل؟ داده‌ی رفتاریِ نویزآلود نباید در
// مسیر آنلاین باشد؛ یک delete+insert اتمیک در ساعت مرده ارزان‌تر و
// سالم‌تر از incremental-patch است (هیچ ردیفِ زامبی نمی‌ماند: محصولِ
// حذف‌شده، پنجره‌ی ۶۰روزه، refund — همه با بازمحاسبه محو می‌شوند).
// این همان «آستانه‌ی ONNX» از سند فاز ۴ است: ساده، قابل‌توضیح، کافی.
// ═══════════════════════════════════════════════════════════════

// src/domain/product-similarity/similarity.service.ts
import { sql } from 'drizzle-orm'

import { tehranDay } from '#/domain/product-stats/product-stats.service'
import type { Db } from '#/infra/db/client'

/** پنجره‌ی هم‌بازدید — هم‌عرضِ رتینشن لاگ (۶۰ روز؛ ایندکس day می‌خواباند) */
export const COVIEW_WINDOW_DAYS = 60
/** وزن سیگنال هم‌بازدید (ضعیف‌تر — کنجکاوی، نه قصد خرید) */
export const W_COVIEW = 0.35
/** وزن سیگنال هم‌خرید (قوی‌تر — پول واقعی روی میز است) */
export const W_COPURCHASE = 0.65
/** کفِ شاهد: جفتِ فقط-یک‌بار-دیده‌شده نویز است؛ یک هم‌خریدِ واقعی کافی است */
const MIN_COVIEWS = 2
/** Shrink weak evidence toward zero: perfect cosine from one basket is not certainty. */
export const COVIEW_PRIOR_SUPPORT = 5
export const COPURCHASE_PRIOR_SUPPORT = 3
/** سقف ضدخزنده برای هر بازدیدکننده در یک روز، نه کل تاریخچهٔ او */
const MAX_PRODUCTS_PER_VISITOR = 30
/** سقف سبدِ معنادار: سفارشِ پارتی/کترینگ جفت‌های بی‌معنا می‌سازد */
const MAX_ITEMS_PER_ORDER = 12
/** Top-N budget per context; union of mixed + purchase recommendations stores at most 2N. */
export const TOP_N_PER_PRODUCT = 20

export class ProductSimilarityService {
        constructor(private readonly deps: { db: Db }) {}

        /**
         * بازمحاسبه‌ی کامل — یک tx اتمیک: delete + insert … select.
         * خواننده‌ها هیچ‌وقت جدولِ نیمه‌کار را نمی‌بینند؛ شکست = بدون
         * تغییر می‌ماند (شبِ بعد دوباره). بعد از موفقیت، فراخواننده
         * (جاب) کشِ منو را باطل می‌کند تا «مشابه‌ها» تازه شود.
         */
        async recompute(day = tehranDay()): Promise<{ pairs: number }> {
                return this.deps.db.transaction(async (tx) => {
                        // Serialize rebuilds even when the table is initially empty.
                        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-similarity:recompute'))`)
                        await tx.execute(sql`delete from product_similarity`)

                        const rebuild = sql`
                                insert into product_similarity
                                        (product_id, similar_id, score, purchase_score, co_views, co_purchases, updated_at)
                                with
                                -- ── سیگنال ۱: هم‌بازدید ──
                                vv as (
                                        select distinct product_id, visitor_id, day
                                        from product_view_log
                                        where day >= ${day}::date - ${COVIEW_WINDOW_DAYS - 1}
                                                and day <= ${day}::date
                                ),
                                vpop as (
                                        select visitor_id, day, count(*)::int as n from vv group by visitor_id, day
                                ),
                                vvz as (
                                        select product_id, visitor_id, vv.day
                                        from vv join vpop using (visitor_id, day)
                                        join products p on p.id = vv.product_id and p.status = 'ACTIVE'
                                        where vpop.n <= ${MAX_PRODUCTS_PER_VISITOR}
                                ),
                                coview as (
                                        -- A shared shopping day is evidence of association; browsing
                                        -- weeks apart is not. Repeat visits still count only once.
                                        -- Expand only each capped context, never a global self-join:
                                        -- stale planner statistics must not turn this into N² work.
                                        select a.id as a, b.id as b, count(distinct context.visitor_id)::int as n
                                        from (
                                                select visitor_id, day, array_agg(product_id) as ids
                                                from vvz group by visitor_id, day
                                        ) context
                                        cross join lateral unnest(context.ids) a(id)
                                        cross join lateral unnest(context.ids) b(id)
                                        where a.id < b.id
                                        group by 1, 2
                                ),
                                vhub as (select product_id, count(distinct visitor_id)::int as n from vvz group by product_id),
                                -- ── سیگنال ۲: هم‌خرید (پرداخت‌شده و غیر-لغو) ──
                                paid_items as (
                                        select distinct it.product_id, it.order_id
                                        from order_items it
                                        join orders o on o.id = it.order_id
                                        where o.payment_status = 'SUCCESS'
                                                and o.status not in ('PENDING_PAYMENT', 'CANCELED')
                                ),
                                opop as (select order_id, count(*)::int as n from paid_items group by order_id),
                                oiz as (
                                        select product_id, order_id
                                        from paid_items join opop using (order_id)
                                        join products p on p.id = paid_items.product_id and p.status = 'ACTIVE'
                                        where opop.n <= ${MAX_ITEMS_PER_ORDER}
                                ),
                                copurch as (
                                        select a.id as a, b.id as b, count(*)::int as n
                                        from (
                                                select order_id, array_agg(product_id) as ids
                                                from oiz group by order_id
                                        ) context
                                        cross join lateral unnest(context.ids) a(id)
                                        cross join lateral unnest(context.ids) b(id)
                                        where a.id < b.id
                                        group by 1, 2
                                ),
                                ohub as (select product_id, count(*)::int as n from oiz group by product_id),
                                -- ── ترکیب: full join روی جفت‌های مرتب (a<b) ──
                                pairs as (
                                        select
                                                coalesce(cv.a, cp.a) as a,
                                                coalesce(cv.b, cp.b) as b,
                                                coalesce(cv.n, 0) as cv,
                                                coalesce(cp.n, 0) as cp
                                        from coview cv
                                        full join copurch cp on cv.a = cp.a and cv.b = cp.b
                                        where coalesce(cv.n, 0) >= ${MIN_COVIEWS}
                                                or coalesce(cp.n, 0) >= 1
                                ),
                                -- ── امتیاز: وزن‌دار + نرمالِ cosine (ضد-هاب) ──
                                signal_scores as (
                                        select
                                                p.a, p.b, p.cv, p.cp,
                                                (p.cv::double precision / (p.cv::double precision + ${COVIEW_PRIOR_SUPPORT}))
                                                        * p.cv / greatest(sqrt(coalesce(va.n, 0)::double precision * coalesce(vb.n, 0)), 1.0) as view_score,
                                                (p.cp::double precision / (p.cp::double precision + ${COPURCHASE_PRIOR_SUPPORT}))
                                                        * p.cp / greatest(sqrt(coalesce(oa.n, 0)::double precision * coalesce(ob.n, 0)), 1.0) as purchase_score
                                        from pairs p
                                        left join vhub va on va.product_id = p.a
                                        left join vhub vb on vb.product_id = p.b
                                        left join ohub oa on oa.product_id = p.a
                                        left join ohub ob on ob.product_id = p.b
                                ),
                                scored as (
                                        select a, b, cv, cp, purchase_score,
                                                ${W_COVIEW} * view_score + ${W_COPURCHASE} * purchase_score as score
                                        from signal_scores
                                ),
                                -- Expand first: neighbors on either UUID side share one top-N budget.
                                directed as (
                                        select a, b, cv, cp, score, purchase_score from scored
                                        union all
                                        select b, a, cv, cp, score, purchase_score from scored
                                ),
                                ranked as (
                                        select a, b, cv, cp, score, purchase_score,
                                                row_number() over (partition by a order by score desc, b) as rank,
                                                row_number() over (partition by a order by purchase_score desc, b) as purchase_rank
                                        from directed
                                )
                                select a, b, score, purchase_score, cv, cp, now()
                                from ranked
                                where rank <= ${TOP_N_PER_PRODUCT}
                                        or (purchase_score > 0 and purchase_rank <= ${TOP_N_PER_PRODUCT})
                        `
                        await tx.execute(rebuild)

                        // شمارش با select صریح — شکلِ خروجیِ execute بین
                        // درایورها فرق دارد؛ count(*) همیشه همان عدد است
                        const counted = await tx.execute(
                                sql`select count(*)::int as n from product_similarity`,
                        )
                        const rows = counted as unknown as Array<{ n: number }>
                        const pairs = Array.isArray(rows) ? Number(rows[0]?.n ?? 0) : 0
                        console.log(
                                `[product-similarity] recompute: ${pairs} directed rows ` +
                                        `(co-view ${COVIEW_WINDOW_DAYS}d, w=${W_COVIEW}/${W_COPURCHASE})`,
                        )
                        return { pairs }
                })
        }
}
