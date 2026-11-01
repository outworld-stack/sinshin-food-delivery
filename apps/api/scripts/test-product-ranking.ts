/** Product ranking (hundred-fifteen, phase 3 «منتخب») integration regressions. Creates/drops only a uniquely named scratch database on local PostgreSQL. */
import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { SQL } from 'bun'
import { Elysia } from 'elysia'

import {
        CART_ADD_WEIGHT,
        EMA_HALF_LIFE_DAYS,
        PRIOR_STRENGTH,
        ProductRankingService,
} from '../src/domain/product-ranking/ranking.service'
import { MenuService } from '../src/domain/menu/menu.service'
import { Database } from '../src/infra/db/client'
import {
        categories,
        mainCategories,
        orderItems,
        orders,
        payments,
        productDailyStats,
        productRanking,
        products,
        users,
} from '../src/infra/db/schema'
import { menuRoutes } from '../src/http/routes/menu.routes'
import type { CategoryId, ProductId } from '../src/domain/shared/brand'
import type { RedisService } from '../src/infra/redis/redis'

const source = new URL(
        process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin',
)
assert.ok(
        ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname),
        'Product-ranking tests require a local PostgreSQL server',
)
const scratch = `sinshin_rank_test_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const testUrl = new URL(source)
testUrl.pathname = `/${scratch}`
const boot = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
let database: Database | undefined
let checks = 0
const check = (condition: unknown, message: string) => {
        assert.ok(condition, message)
        checks++
        console.log(`  ✓ ${message}`)
}

/** درایور Bun ستون date را به Date آبجکت می‌آورد؛ برای مقایسه‌ی رشته‌ای
 * روز را به 'YYYY-MM-DD' برمی‌گردانیم (فقط خواندنِ تست — نوشتن رشته است) */
const dayOf = (v: unknown): string =>
        v instanceof Date ? v.toISOString().slice(0, 10) : String(v)

/** ردیسِ درون‌حافظه‌ای — همان قرارداد VersionedCache (TTL واقعی + incr) */
function fakeRedis(): RedisService {
        const store = new Map<string, { value: string; expiresAt: number }>()
        const alive = (key: string) => {
                const entry = store.get(key)
                if (!entry) return null
                if (entry.expiresAt < Date.now()) {
                        store.delete(key)
                        return null
                }
                return entry
        }
        return {
                get: async (key: string) => alive(key)?.value ?? null,
                set: async (key: string, value: string, opts?: { ex?: number }) => {
                        store.set(key, {
                                value,
                                expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : Number.MAX_SAFE_INTEGER,
                        })
                        return 'OK'
                },
                setNx: async (key: string, value: string, opts: { ex: number }) => {
                        if (alive(key)) return false
                        store.set(key, { value, expiresAt: Date.now() + opts.ex * 1000 })
                        return true
                },
                incr: async (key: string) => {
                        const next = Number(alive(key)?.value ?? 0) + 1
                        store.set(key, { value: String(next), expiresAt: Number.MAX_SAFE_INTEGER })
                        return next
                },
                getJson: async <T,>(key: string) => {
                        const raw = alive(key)?.value
                        return raw ? (JSON.parse(raw) as T) : null
                },
                setJson: async (key: string, value: unknown, opts?: { ex?: number }) => {
                        store.set(key, {
                                value: JSON.stringify(value),
                                expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : Number.MAX_SAFE_INTEGER,
                        })
                },
                expire: async (key: string, seconds: number) => {
                        const entry = alive(key)
                        if (entry) entry.expiresAt = Date.now() + seconds * 1000
                        return 1
                },
        } as unknown as RedisService
}

try {
        await boot.unsafe(`create database "${scratch}"`)
        const migration = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], {
                cwd: `${import.meta.dir}/..`,
                env: { ...process.env, DATABASE_URL: testUrl.toString() },
                stdout: 'pipe',
                stderr: 'pipe',
        })
        const [stdout, stderr, exit] = await Promise.all([
                new Response(migration.stdout).text(),
                new Response(migration.stderr).text(),
                migration.exited,
        ])
        assert.equal(exit, 0, `Scratch migrations failed:\n${stdout}\n${stderr}`)

        database = new Database(testUrl.toString(), { max: 8 })
        const db = database.db
        const redis = fakeRedis()
        const ranking = new ProductRankingService({ db })
        const menu = new MenuService({ db, redis })

        // ── سید: دو Main (یکی با شاهدِ کافی برای پیشینِ اختصاصی، یکی کم‌داده) ──
        const main1 = (await db
                .insert(mainCategories)
                .values({ name: 'رستوران', slug: 'rest-main', isActive: true })
                .returning())[0]!
        const main2 = (await db
                .insert(mainCategories)
                .values({ name: 'کافه', slug: 'cafe-main', isActive: true })
                .returning())[0]!
        const cat1 = (await db
                .insert(categories)
                .values({ mainCategoryId: main1.id, name: 'غذا', slug: 'rest-cat' })
                .returning())[0]!
        const cat2 = (await db
                .insert(categories)
                .values({ mainCategoryId: main2.id, name: 'نوشیدنی', slug: 'cafe-cat' })
                .returning())[0]!

        // روزِ مرجعِ ثابت — همه‌ی محاسبات/قطعیت روی همین روز
        const day = '2025-06-15'
        const dayMinus10 = '2025-06-05'
        const buyer = (await db.insert(users).values({ phone: '09120000001', name: 'Ranking buyer' }).returning())[0]!
        let orderNumber = 0
        const sale = async (
                productId: ProductId,
                quantity: number,
                saleDay = day,
                extra: Partial<typeof orders.$inferInsert> = {},
        ) => {
                const order = (await db.insert(orders).values({
                        displayId: `rank-${++orderNumber}`,
                        userId: buyer.id,
                        status: 'PAID', deliveryType: 'PICKUP', paymentStatus: 'SUCCESS', paymentMethod: 'WALLET',
                        createdAt: new Date(`${saleDay}T12:00:00+03:30`),
                        totalAmount: 100_000,
                        breakdown: {
                                foodTotal: 100_000, discount: 0, walletDeduction: 100_000,
                                deliveryFee: 0, packagingFee: 0, totalAmount: 100_000, amountPaidOnline: 0,
                        },
                        ...extra,
                }).returning())[0]!
                await db.insert(orderItems).values({
                        orderId: order.id, productId,
                        name: 'Ranking product', unitPrice: 100_000, quantity,
                })
                return order
        }
        const mk = (categoryId: CategoryId, name: string, extra: Record<string, unknown> = {}) =>
                db
                        .insert(products)
                        .values({ categoryId, name, originalPrice: 100_000, ...extra })
                        .returning()
                        .then((rs) => rs[0]!)

        // cat1 — نرخِ تبدیلِ روشن (شاهدِ ≥ ۳۰۰ بازدیدِ وزن‌دار)
        const p1 = await mk(cat1.id, 'پیتزا') // v=1000, r=100
        const p2 = await mk(cat1.id, 'سرد') // بدون هیچ آمار (سردِ مطلق)
        const p5 = await mk(cat1.id, 'ای‌ام‌ا') // دو روز: ۱۰ + ۱۰×۰.۵ = ۱۵
        const p6 = await mk(cat1.id, 'ناموجود', { isAvailable: false }) // v=50, r=25 — موجودی تصمیمِ لحظه‌ی نمایش است
        const p7 = await mk(cat1.id, 'غیرفعال', { status: 'INACTIVE' }) // v=500, r=500 — فیلترِ مرده‌ها قبل از رتبه
        // cat2 — زیر سقفِ شاهد ⇒ پیشینِ سراسری
        const p3 = await mk(cat2.id, 'لاته') // v=100, r=1
        const p4 = await mk(cat2.id, 'سبدسنگین') // v=100, c=30 ⇒ r=9

        const stat = (productId: string, d: string, views: number, cartAdds = 0, orders = 0) => ({
                productId: productId as typeof p1.id,
                day: d,
                views,
                cartAdds,
                orders,
        })
        await db.insert(productDailyStats).values([
                stat(p1.id, day, 1000, 0, 100),
                stat(p5.id, day, 10),
                stat(p5.id, dayMinus10, 10),
                stat(p6.id, day, 50, 0, 25),
                stat(p7.id, day, 500, 0, 500),
                stat(p3.id, day, 100, 0, 1),
                stat(p4.id, day, 100, 30, 0),
        ])
        await sale(p1.id, 100)
        await sale(p6.id, 25)
        await sale(p7.id, 500)
        await sale(p3.id, 1)

        // ── تخریبِ امن: قبل از اولین جاب، همه‌ی smartScoreها null ──
        const beforeRanking = await menu.productsByMain('rest-main')
        check(
                beforeRanking.products.length === 4 &&
                        beforeRanking.products.every((p) => p.smartScore === null && p.smartRank === null),
                'before the first nightly job every DTO degrades to smartScore=null',
        )

        // ── محاسبه‌ی مرحله‌ی A — اعدادِ روی کاغذ ──
        // cat1 (فقط ACTIVEها): v=1000+15+50=1065، r=100+25=125 ⇒ نرخ=125/1065
        // cat2: v=200، r=10 — زیر ۳۰۰ ⇒ پیشینِ سراسری
        // سراسری: v=1265، r=135 ⇒ نرخ=135/1265
        const catRate = 125 / 1065
        const globalRate = 135 / 1265
        const a0c = PRIOR_STRENGTH * catRate
        const b0c = PRIOR_STRENGTH * (1 - catRate)
        const a0g = PRIOR_STRENGTH * globalRate
        const b0g = PRIOR_STRENGTH * (1 - globalRate)

        const resultA = await ranking.recompute({ day })
        const rowsA = await db.select().from(productRanking)
        const rowOf = (id: string) => rowsA.find((r) => r.productId === id)
        const T = 1e-4

        check(resultA.products === 6 && rowsA.length === 6, 'exactly the six ACTIVE products get ranked')
        check(rowOf(p7.id) === undefined, 'INACTIVE product is filtered before ranking (no row)')
        check(
                rowOf(p6.id) !== undefined,
                'unavailable-but-ACTIVE product is still ranked (availability is a read-time gate)',
        )
        check(
                resultA.categories.find((c) => c.mainId === main1.id)?.fallback === false &&
                        resultA.categories.find((c) => c.mainId === main2.id)?.fallback === true,
                'two-level prior: big category keeps its own rate, small one falls back to global',
        )

        // پارامترهای پسینی — فرمول روی کاغذ در برابر ستون‌های alpha/beta
        check(
                Math.abs(rowOf(p1.id)!.alpha - (a0c + 100)) < T,
                `pizza alpha = prior(${a0c.toFixed(4)}) + 100 sales`,
        )
        check(
                Math.abs(rowOf(p1.id)!.beta - (b0c + 900)) < T,
                'pizza beta = prior + (1000−100) non-converted views',
        )
        check(
                Math.abs(rowOf(p2.id)!.alpha - a0c) < T && Math.abs(rowOf(p2.id)!.beta - b0c) < T,
                'cold-start product gets the finite category prior (alpha/beta = 25 pseudo-views)',
        )
        check(
                Math.abs(rowOf(p3.id)!.alpha - (a0g + 1)) < T && Math.abs(rowOf(p3.id)!.beta - (b0g + 99)) < T,
                'small-category product uses the global prior',
        )
        check(
                Math.abs(rowOf(p4.id)!.alpha - (a0g + CART_ADD_WEIGHT * 30)) < T,
                `r = S + ${CART_ADD_WEIGHT}·C (30 cart adds ⇒ +9 successes)`,
        )
        check(
                Math.abs(rowOf(p5.id)!.beta - (b0c + 15)) < T,
                'EMA half-life: 10 views today + 10 views 10 days ago ⇒ 15 weighted views',
        )
        check(
                Math.abs(rowOf(p6.id)!.alpha - (a0c + 25)) < T,
                'sales below views retain their full weight (25 sales, 50 views)',
        )
        check(rowsA.every((r) => r.score >= 0 && r.score <= 1), 'every Thompson sample stays within 0..1')
        check(rowsA.every((r) => dayOf(r.computedDay) === day), 'computed_day records the reference day')

        // ── رتبه: یکتا، هم‌ارزِ امتیاز نزولی ──
        check(
                [...rowsA].sort((a, b) => a.rank - b.rank).every((r, i) => r.rank === i + 1),
                'ranks are dense 1..N',
        )
        check(
                !rowsA.some((r) => rowsA.some((o) => o.rank < r.rank && o.score < r.score)),
                'higher score never sits below a lower one (rank ≡ score order)',
        )

        // ── قطعیت: دو اجرا روی همان روز ⇒ بایت‌به‌بایت همان جدول ──
        const snapshot = (rs: typeof rowsA) =>
                rs
                        .map((r) => `${r.productId}|${r.score}|${r.alpha}|${r.beta}|${r.rank}|${dayOf(r.computedDay)}`)
                        .sort()
                        .join(';')
        await ranking.recompute({ day })
        const rowsA2 = await db.select().from(productRanking)
        check(
                snapshot(rowsA) === snapshot(rowsA2),
                'same day + same data ⇒ identical scores/ranks (seeded PRNG, byte-for-byte)',
        )

        // ── تغییر روز ⇒ نمونه‌ی تازه (seed تازه) ──
        const nextDay = '2025-06-16'
        await ranking.recompute({ day: nextDay })
        const rowsB = await db.select().from(productRanking)
        check(rowsB.every((r) => dayOf(r.computedDay) === nextDay), 'a new day is recorded in computed_day')
        check(
                rowsB.some((r) => {
                        const before = rowsA.find((x) => x.productId === r.productId)!
                        return before && Math.abs(before.score - r.score) > 1e-9
                }),
                'a new day draws fresh Thompson samples (exploration window rolls over)',
        )
        // برگشت به روزِ قبل ⇒ همان نمونه‌ی قبلی (قطعیتِ دو-جهته)
        await ranking.recompute({ day })
        const rowsA3 = await db.select().from(productRanking)
        check(snapshot(rowsA) === snapshot(rowsA3), 're-running an old day reproduces its exact snapshot')

        // ── سرریز: یک میلیارد بازدید/فروش — بدون کرش، بدون NaN ──
        const p8 = await mk(cat2.id, 'وایرال')
        await db.insert(productDailyStats).values([stat(p8.id, day, 1_000_000_000, 0, 1_000_000_000)])
        await sale(p8.id, 1_000_000_000)
        const resultB = await ranking.recompute({ day })
        const rowsC = await db.select().from(productRanking)
        const overflowRow = rowsC.find((r) => r.productId === p8.id)
        check(
                overflowRow !== undefined &&
                        Number.isFinite(overflowRow.score) &&
                        overflowRow.score >= 0 &&
                        overflowRow.score <= 1 &&
                        Number.isFinite(overflowRow.alpha) &&
                        overflowRow.alpha > 1e8,
                'a billion-view product recomputes without overflow (double precision all the way)',
        )
        check(
                resultB.products === 7 &&
                        [...rowsC].sort((a, b) => a.rank - b.rank).every((r, i) => r.rank === i + 1),
                'rank sequence stays dense 1..7 after the overflow product joins',
        )

        // ── خواندن: MenuService روی کشِ نسخه‌دار — DTO هم‌ارزِ جدول ──
        await menu.bustCache()
        const mainData = await menu.productsByMain('rest-main')
        const pizzaDto = mainData.products.find((p) => p.id === p1.id)!
        const pizzaRow = rowsC.find((r) => r.productId === p1.id)!
        check(
                pizzaDto.smartScore === pizzaRow.score && pizzaDto.smartRank === pizzaRow.rank,
                'productsByMain DTO carries the exact table score/rank',
        )
        const detailDto = await menu.productById(p1.id)
        check(detailDto?.smartScore === pizzaRow.score, 'productById DTO carries the smart score too')
        const adminPage = await menu.adminProducts({ page: 1, limit: 50 })
        check(
                adminPage.products.find((p) => p.id === p3.id)!.smartScore ===
                        rowsC.find((r) => r.productId === p3.id)!.score &&
                        adminPage.products.find((p) => p.id === p7.id)!.smartScore === null,
                'adminProducts carries the chip data (and unranked products degrade to null)',
        )

        // ── HTTP واقعی — همان مسیر پروداکشن ──
        const app = new Elysia()
                .use(
                        menuRoutes({
                                menu: menu as never,
                                cart: {} as never,
                                settings: {} as never,
                                redis,
                                stats: {} as never,
                        }),
                )
                .compile()
        const res = await app.handle(new Request('http://localhost/menu/mains/rest-main/products'))
        check(res.status === 200, 'products endpoint answers 200')
        const body = (await res.json()) as {
                products: Array<{ id: string; smartScore: number | null; smartRank: number | null }>
        }
        const httpPizza = body.products.find((p) => p.id === p1.id)!
        check(
                httpPizza.smartScore === pizzaRow.score && httpPizza.smartRank === pizzaRow.rank,
                'HTTP layer exposes smartScore/smartRank on the public menu',
        )

        // ── کشِ نسخه‌دار: رتبه‌ی حذف‌شده فقط بعد از bustCache دیده می‌شود ──
        await db.execute(sql`delete from product_ranking where product_id = ${p1.id}`)
        const cached = await menu.productsByMain('rest-main')
        check(
                cached.products.find((p) => p.id === p1.id)!.smartScore === pizzaRow.score,
                'versioned cache keeps serving the computed ranking until invalidated',
        )
        await menu.bustCache()
        const busted = await menu.productsByMain('rest-main')
        check(
                busted.products.find((p) => p.id === p1.id)!.smartScore === null,
                'after bustCache a removed ranking row degrades to null (no stale score)',
        )

        // ── یتیم: حذفِ محصول ⇒ ردیفش با بازمحاسبه محو ──
        await db.delete(products).where(eq(products.id, p1.id))
        await ranking.recompute({ day })
        const afterDelete = await db.select().from(productRanking)
        check(
                afterDelete.every((r) => r.productId !== p1.id) && afterDelete.length === 6,
                'deleted product leaves no orphan ranking row',
        )

        // Exercise real order state, not just manually seeded daily sale counters.
        await db.update(products).set({ status: 'INACTIVE' })
        const cold = await mk(cat1.id, 'Signal prior reference')
        const historical = await mk(cat1.id, 'Historical and refunded sales')
        await db.insert(productDailyStats).values(stat(historical.id, day, 100, 0, 777))
        const walletOrder = await sale(historical.id, 3)
        const legacyOrder = await sale(historical.id, 2, day, { paymentMethod: 'GATEWAY' })
        await sale(historical.id, 100, day, { status: 'PENDING_PAYMENT', paymentStatus: 'SUCCESS' })
        await sale(historical.id, 100, day, { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })
        await sale(historical.id, 100, day, { paymentStatus: 'FAILED' })
        await sale(historical.id, 100, day, { status: 'CANCELED', paymentStatus: 'SUCCESS' })
        await db.insert(orderItems).values({
                orderId: walletOrder.id, productId: null, name: 'Legacy snapshot', unitPrice: 100_000, quantity: 999,
        })
        const signal = async (productId: string) => {
                await ranking.recompute({ day })
                const rows = await db.select().from(productRanking)
                const row = rows.find((r) => r.productId === productId)!
                const prior = rows.find((r) => r.productId === cold.id)!
                return { r: row.alpha - prior.alpha, v: row.alpha + row.beta - PRIOR_STRENGTH }
        }
        check(Math.abs((await signal(historical.id)).r - 5) < T,
                'wallet and legacy paid orders backfill sales without a buffer; stale daily counters and unpaid orders are ignored')
        await db.update(orders).set({ status: 'CANCELED', paymentStatus: 'REFUNDED' }).where(eq(orders.id, walletOrder.id))
        check(Math.abs((await signal(historical.id)).r - 2) < T,
                'refunded units disappear on recompute even though the additive daily counter remains')
        await db.update(orders).set({ status: 'CANCELED' }).where(eq(orders.id, legacyOrder.id))
        check(Math.abs((await signal(historical.id)).r) < T,
                'canceled orders are excluded even if their payment status is still SUCCESS')

        const dated = await mk(cat1.id, 'Gateway settlement day')
        await db.insert(productDailyStats).values(stat(dated.id, day, 100))
        const gatewayOrder = await sale(dated.id, 8, '2025-04-01', { paymentMethod: 'GATEWAY' })
        const payment = (orderId: typeof gatewayOrder.id, verifiedAt: string, status = 'SUCCESS') =>
                db.insert(payments).values({
                        orderId, userId: buyer.id, gateway: 'MOCK', mode: 'mock', amount: 100_000,
                        status, verifiedAt: new Date(verifiedAt),
                })
        // 20:30 UTC is already the next calendar day in Tehran.
        await payment(gatewayOrder.id, '2025-06-04T20:30:00.000Z')
        await payment(gatewayOrder.id, '2025-06-05T20:30:00.000Z')
        await payment(gatewayOrder.id, '2025-04-01T10:00:00.000Z', 'FAILED')
        const futureOrder = await sale(dated.id, 100, day, { paymentMethod: 'GATEWAY' })
        await payment(futureOrder.id, '2025-06-15T20:30:00.000Z')
        check(Math.abs((await signal(dated.id)).r - 4) < T,
                'gateway sales use the first successful Tehran settlement day, count duplicate attempts once, and exclude future settlements')

        const clipped = await mk(cat1.id, 'Clipped conversions')
        await db.insert(productDailyStats).values(stat(clipped.id, day, 2, 10))
        await sale(clipped.id, 3)
        const clippedSignal = await signal(clipped.id)
        check(Math.abs(clippedSignal.r - 2) < T && Math.abs(clippedSignal.v - 2) < T,
                'sales plus weighted cart additions above views are actually clipped to views')
        const noViews = await mk(cat1.id, 'Sales without views')
        await sale(noViews.id, 10)
        const noViewSignal = await signal(noViews.id)
        check(Math.abs(noViewSignal.r) < T && Math.abs(noViewSignal.v) < T,
                'backfilled sales with zero views retain only the finite prior')

        const boundary = await mk(cat1.id, 'Window boundaries')
        const firstDay = '2025-05-02' // Reference day minus 44: included.
        const expiredDay = '2025-05-01' // Reference day minus 45: excluded.
        await db.insert(productDailyStats).values([
                stat(boundary.id, firstDay, 160, 20),
                stat(boundary.id, expiredDay, 100_000, 100_000),
                stat(boundary.id, '2025-06-16', 100_000, 100_000),
        ])
        await sale(boundary.id, 16, firstDay)
        await sale(boundary.id, 100_000, expiredDay)
        await sale(boundary.id, 100_000, '2025-06-16')
        const edgeSignal = await signal(boundary.id)
        const oldestWeight = Math.pow(0.5, 44 / EMA_HALF_LIFE_DAYS)
        check(Math.abs(edgeSignal.v - 160 * oldestWeight) < T &&
                Math.abs(edgeSignal.r - (16 + CART_ADD_WEIGHT * 20) * oldestWeight) < T,
                'views, carts, and sales share the inclusive 45-day window and exclude old and future days')

        await db.update(products).set({ status: 'INACTIVE' })
        const empty = await ranking.recompute({ day })
        check(empty.products === 0 && (await db.select().from(productRanking)).length === 0,
                'an empty active catalog atomically clears obsolete ranks')

        await db.execute(sql`select 1`)
        console.log(`\n══ Product ranking: ${checks} پاس ══`)
} finally {
        if (database) await database.close().catch(() => undefined)
        try {
                await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
        } catch {
                /* تمیزکاری بهترین‌تلاش */
        }
        await boot.close({ timeout: 5 })
}
