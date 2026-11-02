// Nightly catalog ranking: daily funnel evidence → decayed utility →
// leave-one-product-out hierarchical prior → deterministic Thompson sample.
// Views are detail visits, not attributable impressions. This is a bounded
// preference score, not a calibrated purchase probability. See
// docs/117-product-algorithm.md for assumptions and the evaluation plan.
import { sql } from 'drizzle-orm'

import { tehranDay } from '#/domain/product-stats/product-stats.service'
import type { ProductId } from '#/domain/shared/brand'
import { productRanking } from '#/infra/db/schema'
import type { Db, DbOrTx } from '#/infra/db/client'

/** پنجره‌ی EMA — روزهای اخیرِ شمارنده‌ی فاز ۱ */
export const EMA_WINDOW_DAYS = 45
/** نیم‌عمر وزنِ روزها — دیروز ۲ برابرِ ۱۱ روز پیش */
export const EMA_HALF_LIFE_DAYS = 10
/** Partial reward for cart intent not already represented by purchases. */
export const CART_ADD_WEIGHT = 0.3
/** Evidence at which the category contributes half of its prior; no hard cutoff. */
export const CATEGORY_PRIOR_STRENGTH = 300
/** قدرتِ پیشین — تعداد شبه‌مشاهده‌ای که نرخِ دسته/سراسری با آن وارد بتا می‌شود */
export const PRIOR_STRENGTH = 25
/** Conservative cold-start utility baseline; a tunable prior, not a measured rate. */
export const PRIOR_FALLBACK_RATE = 0.02
/** کف/سقف نرخِ پیشین — دسته‌ی بدون تبدیلِ واقعی هم ۰٪ نمی‌شود (الفای صفر = بتای تباه) */
export const PRIOR_RATE_MIN = 0.005
export const PRIOR_RATE_MAX = 0.5

/** حداکثر ردیف در هر دسته‌ی insert — پرهیز از کوئری‌های چندمگابایتی */
const INSERT_CHUNK = 500

/** خروجیِ بازمحاسبه — برای لاگ جاب و تست‌ها */
export interface RankingRecomputeResult {
  products: number
  day: string
  globalRate: number
  categories: Array<{ mainId: string; rate: number; views: number; fallback: boolean }>
}

/** Decayed effective opportunities (v) and fractional rewards (r), all float8. */
interface ProductSignal {
  productId: ProductId
  mainId: string
  v: number
  r: number
}

// ── نمونه‌گیرِ قطعی — همان زبانِ seeded-random سایت (فاز ۲ فرانت) ──

/** FNV-1a — رشته‌ی seed را به عدد ۳۲بیتی بدون علامت می‌برد */
function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — PRNG قطعی و سبک (همان seed ⇒ همان دنباله) */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** نرمال استاندارد از یونیفرم — Box-Muller (نصفِ cos؛ قطعی و بی‌حالت) */
function normal01(rng: () => number): number {
  const u = Math.max(rng(), Number.MIN_VALUE)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/**
 * گامای واحد — Marsaglia-Tsang برای shape ≥ ۱ + تقویتِ shape < ۱
 * (gamma(α) = gamma(α+۱)·U^(1/α)). صفر و اعدادِ نامعتبر = ۰؛ گاردِ
 * ۲۵۶تایی فقط ضدِ حلقهٔ بی‌نهایت است (در عمل هرگز نمی‌رسد).
 */
function gammaSample(shape: number, rng: () => number): number {
  if (!Number.isFinite(shape) || shape <= 0) return 0
  if (shape < 1) {
    const u = rng()
    return u <= 0 ? 0 : gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (let i = 0; i < 256; i++) {
    const x = normal01(rng)
    const v = 1 + c * x
    if (v <= 0) continue
    const v3 = v * v * v
    if (Math.log(Math.max(rng(), Number.MIN_VALUE)) < 0.5 * x * x + d - d * v3 + d * Math.log(v3)) {
      return d * v3
    }
  }
  return d
}

/** نمونه‌ی تامپسون از بتا(α, β) — نسبت دو گاما؛ تباهی = میانگینِ پیشین */
function betaSample(alpha: number, beta: number, fallback: number, rng: () => number): number {
  const g1 = gammaSample(alpha, rng)
  const g2 = gammaSample(beta, rng)
  const sum = g1 + g2
  return sum > 0 && Number.isFinite(sum) ? g1 / sum : fallback
}

export class ProductRankingService {
  constructor(private readonly deps: { db: Db }) {}

  /**
   * بازمحاسبه‌ی کامل — tx اتمیک: delete + insert. خواننده‌ها هیچ‌وقت
   * جدولِ نیمه‌کار نمی‌بینند؛ شکست = بدون تغییر (شبِ بعدِ catchUp).
   * پارامتر day فقط برای تست است (قطعیت/تغییر روز)؛ پروداکشن همیشه
   * روزِ تهرانیِ حال را می‌گیرد.
   */
  async recompute(opts?: { day?: string }): Promise<RankingRecomputeResult> {
    const day = opts?.day ?? tehranDay()
    return this.deps.db.transaction(async (tx) => {
      // Serialize rebuilds before reading evidence, including an empty table.
      // Readers continue to see the last committed snapshot through MVCC.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-ranking:recompute'))`)

      // ── لایه ۱: سیگنال‌های EMA هر محصولِ ACTIVE (فیلترِ مرده‌ها قبل از
      // هر رتبه‌بندی — همان درسِ فاز ۲) ──
      const signals = await this.loadSignals(day, tx)

      // ── لایه ۲: نرخِ سراسری + نرخِ هر دسته (جمع‌ها از خودِ ردیف‌ها) ──
      let globalR = 0
      let globalV = 0
      const byMain = new Map<string, { r: number; v: number }>()
      for (const s of signals) {
        globalR += s.r
        globalV += s.v
        const cur = byMain.get(s.mainId) ?? { r: 0, v: 0 }
        cur.r += s.r
        cur.v += s.v
        byMain.set(s.mainId, cur)
      }
      const clampRate = (x: number) => Math.min(PRIOR_RATE_MAX, Math.max(PRIOR_RATE_MIN, x))
      const smoothedGlobal = (r: number, v: number) =>
        clampRate((Math.max(0, r) + PRIOR_STRENGTH * PRIOR_FALLBACK_RATE) / (Math.max(0, v) + PRIOR_STRENGTH))
      const globalRate = smoothedGlobal(globalR, globalV)
      const categories = [...byMain.entries()].map(([mainId, t]) => ({
        mainId,
        rate: clampRate((t.r + CATEGORY_PRIOR_STRENGTH * globalRate) / (t.v + CATEGORY_PRIOR_STRENGTH)),
        views: t.v,
        fallback: t.v === 0,
      }))

      // ── لایه ۳: پسینی + تامپسون (seed = روز + محصول ⇒ قطعی در طول
      // روز، تازه با هر روزِ نو) ──
      const scored = signals.map((s) => {
        // Leave this product out of both levels: its observations enter the
        // posterior once. Sparse categories blend continuously toward global.
        const peers = byMain.get(s.mainId)!
        const peerGlobal = smoothedGlobal(globalR - s.r, globalV - s.v)
        const priorRate = clampRate(
          (Math.max(0, peers.r - s.r) + CATEGORY_PRIOR_STRENGTH * peerGlobal) /
            (Math.max(0, peers.v - s.v) + CATEGORY_PRIOR_STRENGTH),
        )
        const alpha = PRIOR_STRENGTH * priorRate + s.r
        const beta = PRIOR_STRENGTH * (1 - priorRate) + Math.max(s.v - s.r, 0)
        const score = betaSample(alpha, beta, priorRate, mulberry32(hashSeed(`${day}:${s.productId}`)))
        return { productId: s.productId, score, alpha, beta }
      })

      // رتبه‌ی سراسری — امتیاز نزولی، تای‌بریکِ id صعودی (قطعیتِ مطلق)
      scored.sort((a, b) => b.score - a.score || (a.productId < b.productId ? -1 : 1))

      await tx.execute(sql`delete from product_ranking`)
      const updatedAt = new Date()
      const rows = scored.map((s, i) => ({
        productId: s.productId,
        score: s.score,
        alpha: s.alpha,
        beta: s.beta,
        rank: i + 1,
        computedDay: day,
        updatedAt,
      }))
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await tx.insert(productRanking).values(rows.slice(i, i + INSERT_CHUNK))
      }

      console.log(
        `[product-ranking] recompute: ${scored.length} products ` +
          `(day ${day}, global ${(globalRate * 100).toFixed(2)}%, ` +
          `ema ${EMA_WINDOW_DAYS}d/hl ${EMA_HALF_LIFE_DAYS}d, prior ${PRIOR_STRENGTH})`,
      )
      return { products: scored.length, day, globalRate, categories }
    })
  }

  /**
   * One SQL snapshot: buyers and accepted browsing events, combined per Tehran
   * day before decay. Quantity and repeated orders never multiply confidence.
   */
  private async loadSignals(day: string, db: DbOrTx): Promise<ProductSignal[]> {
    const weight = sql`power(0.5, (${day}::date - d.day)::double precision / ${EMA_HALF_LIFE_DAYS})`
    // Daily order counters are buffered and additive: refunds and lost buffers are
    // not repaired there. Rebuild buyer evidence from current paid orders. Successful
    // gateway verification supplies the settlement day; wallet checkout settles in
    // its creation transaction, and legacy orders fall back to creation time too.
    // Collapse payment attempts before joining items so settlement is unambiguous.
    const result = await db.execute(sql`
      with paid_orders as (
        select o.id, o.user_id,
          (coalesce(p.settled_at, o.created_at) at time zone 'Asia/Tehran')::date as day
        from orders o
        left join (
          select order_id, min(verified_at) as settled_at
          from payments
          where status = 'SUCCESS'
          group by order_id
        ) p on p.order_id = o.id
        where o.payment_status = 'SUCCESS'
          and o.status not in ('PENDING_PAYMENT', 'CANCELED')
      ), sales as (
        -- One buyer/product/Tehran day, regardless of units, sizes or repeat
        -- orders. Match the daily, deduplicated browsing signals' granularity.
        select it.product_id, o.day, count(distinct o.user_id)::double precision as buyers
        from paid_orders o
        join order_items it on it.order_id = o.id
        where o.day >= ${day}::date - ${EMA_WINDOW_DAYS - 1}
          and o.day <= ${day}::date
          and it.product_id is not null and it.quantity > 0
        group by it.product_id, o.day
      ), daily as (
        select product_id, day, views::double precision as views,
          cart_adds::double precision as carts, 0::double precision as buyers
        from product_daily_stats
        where day >= ${day}::date - ${EMA_WINDOW_DAYS - 1} and day <= ${day}::date
        union all
        select product_id, day, 0, 0, buyers from sales
      ), daily_signals as (
        select product_id, day,
          greatest(sum(views), 0) as views,
          greatest(sum(carts), 0) as carts,
          greatest(sum(buyers), 0) as buyers
        from daily
        group by product_id, day
      ), weighted as (
        -- Detail views are not impressions: quick-add needs no detail visit.
        -- Use the largest observed funnel stage as an opportunity lower bound;
        -- credit purchases fully and only residual cart intent fractionally.
        -- Apply this per day so unrelated days cannot cancel each other out.
        select d.product_id,
          sum(greatest(d.views, d.carts, d.buyers) * ${weight}) as v,
          sum((d.buyers + ${CART_ADD_WEIGHT} * greatest(d.carts - d.buyers, 0)) * ${weight}) as r
        from daily_signals d
        group by d.product_id
      )
      select
        p.id as product_id,
        c.main_category_id as main_id,
        coalesce(w.v, 0)::double precision as v,
        coalesce(w.r, 0)::double precision as r
      from products p
      join categories c on c.id = p.category_id
      left join weighted w on w.product_id = p.id
      where p.status = 'ACTIVE'
      order by p.id
    `)
    const rows = (Array.isArray(result) ? result : []) as unknown as Array<{
      product_id: ProductId
      main_id: string
      v: number | null
      r: number | null
    }>
    return rows.map((row) => ({
      productId: row.product_id,
      mainId: row.main_id,
      v: Number(row.v ?? 0),
      r: Number(row.r ?? 0),
    }))
  }
}
