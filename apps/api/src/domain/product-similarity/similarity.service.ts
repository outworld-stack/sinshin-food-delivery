// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/product-similarity/similarity.service.ts
//
// محرکِ توصیه‌ی «محصولات مشابه» — هر شب (۰۳:۴۱) کل جدول
// product_similarity از دو سیگنالِ رفتاریِ «واقعی» بازمحاسبه می‌شود:
//
//   ۱) هم‌بازدید (co-view): جفت‌محصول‌هایی که یک بازدیدکننده‌ی واحد
//      هر دو را دیده — از لاگِ فاز ۱ (۶۰ روز اخیر، دداپ ۲۴h از قبل).
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

import type { Db } from '#/infra/db/client'

/** پنجره‌ی هم‌بازدید — هم‌عرضِ رتینشن لاگ (۶۰ روز؛ ایندکس day می‌خواباند) */
const COVIEW_WINDOW_DAYS = 60
/** وزن سیگنال هم‌بازدید (ضعیف‌تر — کنجکاوی، نه قصد خرید) */
export const W_COVIEW = 0.35
/** وزن سیگنال هم‌خرید (قوی‌تر — پول واقعی روی میز است) */
export const W_COPURCHASE = 0.65
/** کفِ شاهد: جفتِ فقط-یک‌بار-دیده‌شده نویز است؛ یک هم‌خریدِ واقعی کافی است */
const MIN_COVIEWS = 2
/** سقف ضدخزنده: بازدیدکننده‌ای که بیش از این تعداد محصول دیده = روبات/کاول */
const MAX_PRODUCTS_PER_VISITOR = 30
/** سقف سبدِ معنادار: سفارشِ پارتی/کترینگ جفت‌های بی‌معنا می‌سازد */
const MAX_ITEMS_PER_ORDER = 12
/** حداکثر همسایه به‌ازای هر محصول، پس از رتبه‌بندیِ هر دو جهت */
export const TOP_N_PER_PRODUCT = 20

export class ProductSimilarityService {
        constructor(private readonly deps: { db: Db }) {}

        /**
         * بازمحاسبه‌ی کامل — یک tx اتمیک: delete + insert … select.
         * خواننده‌ها هیچ‌وقت جدولِ نیمه‌کار را نمی‌بینند؛ شکست = بدون
         * تغییر می‌ماند (شبِ بعد دوباره). بعد از موفقیت، فراخواننده
         * (جاب) کشِ منو را باطل می‌کند تا «مشابه‌ها» تازه شود.
         */
        async recompute(): Promise<{ pairs: number }> {
                return this.deps.db.transaction(async (tx) => {
                        await tx.execute(sql`delete from product_similarity`)

                        await tx.execute(sql`
                                insert into product_similarity
                                        (product_id, similar_id, score, co_views, co_purchases, updated_at)
                                with
                                -- ── سیگنال ۱: هم‌بازدید ──
                                vv as (
                                        select distinct product_id, visitor_id
                                        from product_view_log
                                        where day >= current_date - ${COVIEW_WINDOW_DAYS}
                                ),
                                vpop as (
                                        select visitor_id, count(*)::int as n from vv group by visitor_id
                                ),
                                vvz as (
                                        select product_id, visitor_id
                                        from vv join vpop using (visitor_id)
                                        where vpop.n <= ${MAX_PRODUCTS_PER_VISITOR}
                                ),
                                coview as (
                                        select a.product_id as a, b.product_id as b, count(*)::int as n
                                        from vvz a
                                        join vvz b on a.visitor_id = b.visitor_id and a.product_id < b.product_id
                                        group by 1, 2
                                ),
                                vhub as (select product_id, count(*)::int as n from vvz group by product_id),
                                -- ── سیگنال ۲: هم‌خرید (پرداخت‌شده و غیر-لغو) ──
                                paid_items as (
                                        select distinct it.product_id, it.order_id
                                        from order_items it
                                        join orders o on o.id = it.order_id
                                        where o.payment_status = 'SUCCESS' and o.status <> 'CANCELED'
                                ),
                                opop as (select order_id, count(*)::int as n from paid_items group by order_id),
                                oiz as (
                                        select product_id, order_id
                                        from paid_items join opop using (order_id)
                                        where opop.n <= ${MAX_ITEMS_PER_ORDER}
                                ),
                                copurch as (
                                        select a.product_id as a, b.product_id as b, count(*)::int as n
                                        from oiz a
                                        join oiz b on a.order_id = b.order_id and a.product_id < b.product_id
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
                                scored as (
                                        select
                                                p.a, p.b, p.cv, p.cp,
                                                (${W_COVIEW} * p.cv
                                                        / greatest(sqrt(coalesce(va.n, 0)::double precision * coalesce(vb.n, 0)), 1.0))
                                                + (${W_COPURCHASE} * p.cp
                                                        / greatest(sqrt(coalesce(oa.n, 0)::double precision * coalesce(ob.n, 0)), 1.0)) as score
                                        from pairs p
                                        left join vhub va on va.product_id = p.a
                                        left join vhub vb on vb.product_id = p.b
                                        left join ohub oa on oa.product_id = p.a
                                        left join ohub ob on ob.product_id = p.b
                                ),
                                -- Filter deleted products before they can occupy rank slots.
                                live_pairs as (
                                        select s.*
                                        from scored s
                                        join products pa on pa.id = s.a
                                        join products pb on pb.id = s.b
                                        where s.score > 0
                                ),
                                -- Expand first: neighbors on either UUID side share one top-N budget.
                                directed as (
                                        select a, b, cv, cp, score from live_pairs
                                        union all
                                        select b, a, cv, cp, score from live_pairs
                                ),
                                ranked as (
                                        select a, b, cv, cp, score,
                                                row_number() over (partition by a order by score desc, b) as rank
                                        from directed
                                )
                                select a, b, score::real, cv, cp, now()
                                from ranked
                                where rank <= ${TOP_N_PER_PRODUCT}
                        `)

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
