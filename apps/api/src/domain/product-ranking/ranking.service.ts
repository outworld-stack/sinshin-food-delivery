// ═══════════════════════════════════════════════════════════════
// hundred-fifteen (فاز ۳ — «منتخب») — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/product-ranking/ranking.service.ts
//
// رتبه‌بندی هوشمند «منتخب» — هر شب (۰۳:۴۷) از آمار بازدید/سبدِ فاز ۱
// و اقلام سفارش‌های پرداخت‌شده برای هر محصولِ ACTIVE یک امتیاز ۰..۱ ساخته
// می‌شود. سه لایه:
//
//   ۱) EMA نیم‌عمرِ ۱۰ روز روی پنجره‌ی ۴۵روزه: دیروز ۲ برابرِ ۱۱ روز
//      پیش وزن دارد؛ روندها دیده می‌شوند و چاله/قمارِ یک روز نمی‌چسبد.
//      r = min(S + ۰.۳·C, V) — «موفقیت» = فروش + افزودن‌به‌سبدِ نیم‌بوز،
//      بریده به سقفِ بازدید (نرخِ تبدیل هرگز > ۱ نمی‌شود؛ بتا-دوجمله‌ای
//      این را می‌خواهد).
//   ۲) پیشینِ تجربی دو-سطحی: نرخِ تبدیلِ دسته‌ی اصلی (اگر ≥ ۳۰۰ بازدیدِ
//      وزن‌دار داشته باشد) وگرنه نرخِ سراسری؛ با قدرتِ ۲۵ شبه‌مشاهده —
//      محصولِ تازه/کم‌داده نه قربانیِ صفرِ آمار می‌شود نه پادشاهِ نویز.
//   ۳) نمونه‌گیری تامپسون از بتای پسینی: به‌جای میانگینِ خشک، یک نمونه‌ی
//      تصادفیِ «قطعی» (seed = hash(روز+محصول)) — محصولِ مبهم فردا шансِ
//      دوباره دارد (اکتشاف) و محصولِ اثبات‌شده بالا می‌ماند (بهره‌برداری).
//
// چرا شبانه و چرا بازمحاسبه‌ی کامل؟ همان حکمِ فاز ۲ — محاسبه‌ی آماری
// در مسیر آنلاین جایی ندارد؛ یک delete+insert اتمیک در ساعت مرده، و
// کشِ منو بعدش باطل می‌شود. seed وابسته به روز است ⇒ جدول هر شب
// «نمونه‌ی تازه» می‌گیرد اما در طول روز کاملاً پایدار می‌ماند (کشِ منو
// هم‌قدم با آن است). این همان نقطه‌ی تعویضِ فاز ۴ است: پسینی/تامپسون
// امروز، ONNX فردا — قراردادِ جدول و مسیر خواندن دست‌نخورده.
// ═══════════════════════════════════════════════════════════════

// src/domain/product-ranking/ranking.service.ts
import { sql } from 'drizzle-orm'

import { tehranDay } from '#/domain/product-stats/product-stats.service'
import type { ProductId } from '#/domain/shared/brand'
import { productRanking } from '#/infra/db/schema'
import type { Db } from '#/infra/db/client'

/** پنجره‌ی EMA — روزهای اخیرِ شمارنده‌ی فاز ۱ */
export const EMA_WINDOW_DAYS = 45
/** نیم‌عمر وزنِ روزها — دیروز ۲ برابرِ ۱۱ روز پیش */
export const EMA_HALF_LIFE_DAYS = 10
/** وزنِ افزودن‌به‌سبد در شمارِ موفقیت — نیم‌نرخِ خرید واقعی */
export const CART_ADD_WEIGHT = 0.3
/** حداقل بازدیدِ وزن‌دارِ یک دسته برای پیشینِ اختصاصی (زیرش: پیشینِ سراسری) */
export const CATEGORY_MIN_VIEWS = 300
/** قدرتِ پیشین — تعداد شبه‌مشاهده‌ای که نرخِ دسته/سراسری با آن وارد بتا می‌شود */
export const PRIOR_STRENGTH = 25
/** نرخِ پیشینِ پشتیبان — نصبِ تازه بدون هیچ آمار (۲٪ تبدیلِ صنعتیِ معقول) */
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

/** ردیفِ ورودیِ محاسبه (خروجی SQL — همه double precision) */
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

    // ── لایه ۱: سیگنال‌های EMA هر محصولِ ACTIVE (فیلترِ مرده‌ها قبل از
    // هر رتبه‌بندی — همان درسِ فاز ۲) ──
    const signals = await this.loadSignals(day)

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
    const globalRate = globalV > 0 ? clampRate(globalR / globalV) : PRIOR_FALLBACK_RATE
    const categories = [...byMain.entries()].map(([mainId, t]) => ({
      mainId,
      rate: t.v >= CATEGORY_MIN_VIEWS ? clampRate(t.r / t.v) : globalRate,
      views: t.v,
      fallback: t.v < CATEGORY_MIN_VIEWS,
    }))
    const rateByMain = new Map(categories.map((c) => [c.mainId, c.rate]))

    // ── لایه ۳: پسینی + تامپسون (seed = روز + محصول ⇒ قطعی در طول
    // روز، تازه با هر روزِ نو) ──
    const scored = signals.map((s) => {
      // پیشین: دسته‌ی این محصول اگر به سقفِ شاهد رسیده؛ وگرنه سراسری
      const priorRate = rateByMain.get(s.mainId) ?? globalRate
      const alpha = PRIOR_STRENGTH * priorRate + s.r
      const beta = PRIOR_STRENGTH * (1 - priorRate) + Math.max(s.v - s.r, 0)
      const score = betaSample(alpha, beta, priorRate, mulberry32(hashSeed(`${day}:${s.productId}`)))
      return { productId: s.productId, score, alpha, beta }
    })

    // رتبه‌ی سراسری — امتیاز نزولی، تای‌بریکِ id صعودی (قطعیتِ مطلق)
    scored.sort((a, b) => b.score - a.score || (a.productId < b.productId ? -1 : 1))

    await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`delete from product_ranking`)
      const rows = scored.map((s, i) => ({
        productId: s.productId,
        score: s.score,
        alpha: s.alpha,
        beta: s.beta,
        rank: i + 1,
        computedDay: day,
        updatedAt: new Date(),
      }))
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await tx.insert(productRanking).values(rows.slice(i, i + INSERT_CHUNK))
      }
    })

    console.log(
      `[product-ranking] recompute: ${scored.length} products ` +
        `(day ${day}, global ${(globalRate * 100).toFixed(2)}%, ` +
        `ema ${EMA_WINDOW_DAYS}d/hl ${EMA_HALF_LIFE_DAYS}d, prior ${PRIOR_STRENGTH})`,
    )
    return { products: scored.length, day, globalRate, categories }
  }

  /**
   * سیگنال‌های وزن‌دارِ همه‌ی محصولات ACTIVE — یک کوئری:
   * EMA روی بازدید/سبدِ product_daily_stats و فروشِ order_items (پنجره نسبت به «روزِ مرجع»، نه ساعتِ
   * سرور) + برشِ r = min(S + ۰.۳·C, V) داخل SQL با double precision
   * (درسِ سرریزِ فاز ۲ — جمع‌های بزرگ هرگز داخل int4 نمی‌روند).
   */
  private async loadSignals(day: string): Promise<ProductSignal[]> {
    const weight = sql`power(0.5, (${day}::date - s.day)::double precision / ${EMA_HALF_LIFE_DAYS})`
    // Daily order counters are buffered and additive: refunds and lost buffers are
    // not repaired there. Rebuild S from current paid orders instead. Successful
    // gateway verification supplies the settlement day; wallet checkout settles in
    // its creation transaction, and legacy orders fall back to creation time too.
    // Collapse payment attempts before joining items so each sold unit counts once.
    const result = await this.deps.db.execute(sql`
      with paid_orders as (
        select o.id,
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
        select it.product_id,
          sum(it.quantity::double precision *
            power(0.5, (${day}::date - o.day)::double precision / ${EMA_HALF_LIFE_DAYS})) as units
        from paid_orders o
        join order_items it on it.order_id = o.id
        where o.day >= ${day}::date - ${EMA_WINDOW_DAYS - 1}
          and o.day <= ${day}::date
        group by it.product_id
      )
      select
        p.id as product_id,
        c.main_category_id as main_id,
        greatest(coalesce(w.v, 0), 0)::double precision as v,
        least(
          coalesce(sales.units, 0) + ${CART_ADD_WEIGHT} * coalesce(w.c, 0),
          greatest(coalesce(w.v, 0), 0)
        )::double precision as r
      from products p
      join categories c on c.id = p.category_id
      left join (
        select
          s.product_id,
          sum(s.views::double precision * ${weight}) as v,
          sum(s.cart_adds::double precision * ${weight}) as c
        from product_daily_stats s
        where s.day >= ${day}::date - ${EMA_WINDOW_DAYS - 1}
          and s.day <= ${day}::date
        group by s.product_id
      ) w on w.product_id = p.id
      left join sales on sales.product_id = p.id
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
