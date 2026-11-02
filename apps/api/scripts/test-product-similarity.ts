/** Product similarity (hundred-twelve, phase 2) integration regressions. Creates/drops only a uniquely named scratch database on local PostgreSQL. */
import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { SQL } from 'bun'
import { Elysia } from 'elysia'

import { ProductSimilarityService, TOP_N_PER_PRODUCT, W_COVIEW, W_COPURCHASE, COVIEW_PRIOR_SUPPORT, COPURCHASE_PRIOR_SUPPORT, COVIEW_WINDOW_DAYS } from '../src/domain/product-similarity/similarity.service'
import { tehranDay } from '../src/domain/product-stats/product-stats.service'
import { MenuService } from '../src/domain/menu/menu.service'
import { Database } from '../src/infra/db/client'
import {
        mainCategories,
        categories,
        orderItems,
        orders,
        productSimilarity,
        productViewLog,
        products,
        users,
} from '../src/infra/db/schema'
import { menuRoutes } from '../src/http/routes/menu.routes'
import type { RedisService } from '../src/infra/redis/redis'

const source = new URL(
        process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin',
)
assert.ok(
        ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname),
        'Product-similarity tests require a local PostgreSQL server',
)
const scratch = `sinshin_sim_test_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
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
        const similarity = new ProductSimilarityService({ db })
        const menu = new MenuService({ db, redis })

        // ── سید: کاربر + دسته‌ها + چهار محصول اصلی ──
        const user = (await db
                .insert(users)
                .values({ phone: '09150000000' })
                .returning())[0]!
        const main = (await db
                .insert(mainCategories)
                .values({ name: 'تست', slug: 'test-main', isActive: true })
                .returning())[0]!
        const cat = (await db
                .insert(categories)
                .values({ mainCategoryId: main.id, name: 'دسته تست', slug: 'test-cat' })
                .returning())[0]!
        const pizza = (await db
                .insert(products)
                .values({ categoryId: cat.id, name: 'پیتزا', originalPrice: 100_000, slug: 'pizza-test' })
                .returning())[0]!
        const salad = (await db
                .insert(products)
                .values({ categoryId: cat.id, name: 'سالاد', originalPrice: 50_000 })
                .returning())[0]!
        const drink = (await db
                .insert(products)
                .values({ categoryId: cat.id, name: 'نوشیدنی', originalPrice: 20_000 })
                .returning())[0]!
        const hub = (await db
                .insert(products)
                .values({ categoryId: cat.id, name: 'هاب', originalPrice: 10_000 })
                .returning())[0]!

        // ── سیگنال هم‌بازدید (روی کاغذ محاسبه‌شده — مبنا برای assert امتیاز) ──
        //  v1..v3: پیتزا+سالاد (cv=3) │ v4,v5: پیتزا+نوشیدنی (cv=2) │ v6: پیتزا+هاب (cv=1 → زیر کف)
        // روز = ۵ روز پیش (داخل پنجره‌ی ۶۰روزه‌ی جاب، فارغ از اختلاف TZ دیتابیس)
        const recentDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
        const viewRow = (productId: string, visitor: string) => ({
                productId: productId as typeof pizza.id,
                visitorId: visitor,
                day: recentDay,
        })
        await db.insert(productViewLog).values([
                viewRow(pizza.id, 'v1'), viewRow(salad.id, 'v1'),
                viewRow(pizza.id, 'v2'), viewRow(salad.id, 'v2'),
                viewRow(pizza.id, 'v3'), viewRow(salad.id, 'v3'),
                viewRow(pizza.id, 'v4'), viewRow(drink.id, 'v4'),
                viewRow(pizza.id, 'v5'), viewRow(drink.id, 'v5'),
                viewRow(pizza.id, 'v6'), viewRow(hub.id, 'v6'),
        ])

        // ── خزنده: ۳۱ محصولِ دیده‌شده توسط یک بازدیدکننده — باید فیلتر شود ──
        const crawlerRows = await db
                .insert(products)
                .values(
                        Array.from({ length: 31 }, (_, i) => ({
                                categoryId: cat.id,
                                name: `کراولر ${i}`,
                                originalPrice: 1000,
                        })),
                )
                .returning()
        await db.insert(productViewLog).values(
                crawlerRows.map((r) => viewRow(r.id, 'crawler')),
        )

        // ── سیگنال هم‌خرید ──
        const breakdown = {
                foodTotal: 150_000,
                discount: 0,
                walletDeduction: 0,
                deliveryFee: 0,
                packagingFee: 0,
                totalAmount: 150_000,
                amountPaidOnline: 150_000,
        }
        const paid = (await db
                .insert(orders)
                .values({
                        displayId: 'sim-test-01',
                        userId: user.id,
                        status: 'PAID',
                        deliveryType: 'PICKUP',
                        paymentStatus: 'SUCCESS',
                        totalAmount: 150_000,
                        breakdown,
                })
                .returning())[0]!
        await db.insert(orderItems).values([
                { orderId: paid.id, productId: pizza.id, name: 'پیتزا', unitPrice: 100_000, quantity: 2 },
                { orderId: paid.id, productId: salad.id, name: 'سالاد', unitPrice: 50_000, quantity: 1 },
        ])
        const pending = (await db
                .insert(orders)
                .values({
                        displayId: 'sim-test-02',
                        userId: user.id,
                        status: 'PENDING_PAYMENT',
                        paymentStatus: 'SUCCESS',
                        deliveryType: 'PICKUP',
                        totalAmount: 100_000,
                        breakdown,
                })
                .returning())[0]!
        await db.insert(orderItems).values([
                { orderId: pending.id, productId: pizza.id, name: 'پیتزا', unitPrice: 100_000, quantity: 1 },
                { orderId: pending.id, productId: drink.id, name: 'نوشیدنی', unitPrice: 20_000, quantity: 1 },
        ])
        const canceled = (await db
                .insert(orders)
                .values({
                        displayId: 'sim-test-03',
                        userId: user.id,
                        status: 'CANCELED',
                        deliveryType: 'PICKUP',
                        paymentStatus: 'SUCCESS',
                        totalAmount: 60_000,
                        breakdown,
                })
                .returning())[0]!
        await db.insert(orderItems).values([
                { orderId: canceled.id, productId: salad.id, name: 'سالاد', unitPrice: 50_000, quantity: 1 },
                { orderId: canceled.id, productId: hub.id, name: 'هاب', unitPrice: 10_000, quantity: 1 },
        ])

        // ── بازمحاسبه ──
        await similarity.recompute()
        const allPairs = await db.select().from(productSimilarity)
        const pair = (a: string, b: string) =>
                allPairs.find((r) => r.productId === a && r.similarId === b)
        check(pair(pizza.id, salad.id) !== undefined, 'pizza→salad row exists (both directions stored)')
        check(pair(salad.id, pizza.id) !== undefined, 'salad→pizza row exists (symmetric)')
        check(
                allPairs.every((r) => pair(r.similarId, r.productId) !== undefined),
                'every directed row has its mirror',
        )

        const ab = pair(pizza.id, salad.id)!
        check(ab.coViews === 3, 'co-view count for (pizza,salad) is 3')
        check(ab.coPurchases === 1, 'co-purchase count for (pizza,salad) is 1 (paid order)')
        const ac = pair(pizza.id, drink.id)!
        check(ac.coViews === 2, 'co-view count for (pizza,drink) is 2')
        check(ac.coPurchases === 0, 'PENDING_PAYMENT order contributes no co-purchase')

        // امتیاز — فرمول سرویس با جمعیت‌های روی کاغذ:
        //   vhub: پیتزا=۶، سالاد=۳ │ ohub: پیتزا=۱، سالاد=۱
        // Each cosine is shrunk by independent support before blending.
        const expectedAB = (W_COVIEW * 3) / Math.sqrt(6 * 3) * 3 / (3 + COVIEW_PRIOR_SUPPORT)
                + W_COPURCHASE / (1 + COPURCHASE_PRIOR_SUPPORT)
        check(
                Math.abs(ab.score - expectedAB) < 1e-12,
                `score(pizza,salad) matches confidence-shrunk cosine (${expectedAB.toFixed(4)})`,
        )
        check(ab.purchaseScore === 1 / (1 + COPURCHASE_PRIOR_SUPPORT),
                'cart score uses purchase evidence alone with confidence shrinkage')
        const expectedAC = (W_COVIEW * 2) / Math.sqrt(6 * 2) * 2 / (2 + COVIEW_PRIOR_SUPPORT)
        check(
                Math.abs(ac.score - expectedAC) < 1e-12,
                `score(pizza,drink) matches formula (${expectedAC.toFixed(4)})`,
        )
        check(ab.score > ac.score, 'purchase-backed pair outranks view-only pair')
        check(ac.purchaseScore === 0, 'view-only alternatives have no cart complement score')

        check(pair(pizza.id, hub.id) === undefined, 'single co-view below evidence floor is dropped')
        check(pair(salad.id, hub.id) === undefined, 'CANCELED order contributes no pair')
        check(
                allPairs.every((r) => !crawlerRows.some((c) => c.id === r.productId || c.id === r.similarId)),
                'crawler visitor (>30 products) contributes no pairs',
        )

        // ── هم‌بازدیدِ تکراری (رفرش) — distinct جفت را متورم نمی‌کند ──
        await db.insert(productViewLog).values([
                viewRow(pizza.id, 'v1'),
                viewRow(salad.id, 'v1'),
        ])
        await similarity.recompute()
        const afterDup = (await db.select().from(productSimilarity))
                .find((r) => r.productId === pizza.id && r.similarId === salad.id)!
        check(afterDup.coViews === 3, 'duplicate log rows do not inflate co-view (distinct visitor pairs)')

        // ── لایه‌ی HTTP — همان مسیر پروداکشن (ETag + کش نسخه‌دار) ──
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
        const get = (path: string, headers: Record<string, string> = {}) =>
                app.handle(new Request(`http://localhost${path}`, { method: 'GET', headers }))

        const res1 = await get(`/menu/products/${pizza.id}/similar`)
        check(res1.status === 200, 'similar endpoint answers 200')
        check(
                res1.headers.get('cache-control') === 'public, no-cache',
                'similar response requires HTTP revalidation after client invalidation',
        )
        const body1 = (await res1.json()) as {
                products: Array<{ id: string; name: string; isAvailable: boolean }>
                strict: boolean
        }
        check(body1.strict === false, 'available anchor → non-strict mode')
        check(body1.products.length === 2, 'two similar products for pizza (salad, drink)')
        check(body1.products[0]!.id === salad.id, 'highest-score similar comes first')
        check(body1.products[1]!.id === drink.id, 'view-only similar comes second')
        check(
                body1.products.every((p) => typeof p.isAvailable === 'boolean'),
                'similar DTOs carry the full Product contract (isAvailable present)',
        )

        const etag = res1.headers.get('etag') ?? ''
        check(etag.length > 0, 'ETag is emitted')
        const res304 = await get(`/menu/products/${pizza.id}/similar`, {
                'if-none-match': etag,
        })
        check(res304.status === 304, 'If-None-Match revalidation returns 304')
        check(res304.headers.get('cache-control') === 'public, no-cache',
                '304 similarity responses preserve mandatory HTTP revalidation')

        const bySlug = await get('/menu/products/pizza-test/similar')
        const slugBody = (await bySlug.json()) as { products: unknown[] }
        check(slugBody.products.length === 2, 'anchor by SEO slug works too')

        const missing = await get(`/menu/products/${crypto.randomUUID()}/similar`)
        check(missing.status === 200, 'missing anchor responds 200 (null body, not 500)')

        check((await menu.similarProducts(pizza.id, 'fa', 1))?.products.length === 1,
                'a cached default response respects a later one-product limit')
        check((await menu.similarProducts(pizza.id, 'fa', 2))?.products.length === 2,
                'different recommendation limits have independent cached responses')
        check((await menu.similarProducts(pizza.id, 'fa', 0))?.products.length === 0,
                'zero recommendation limit returns an empty list')
        check((await menu.similarProducts(pizza.id, 'fa', Number.NaN))?.products.length === 2,
                'non-finite recommendation limit uses the safe default')

        // ── حالت سختگیرانه (تصمیم قفل‌شده): لنگرِ ناموجود ⇒ فقط موجود ──
        await db
                .update(products)
                .set({ isAvailable: false })
                .where(eq(products.id, drink.id))
        await db
                .update(products)
                .set({ isAvailable: false })
                .where(eq(products.id, pizza.id))
        await menu.bustCache()
        const strictRes = await get(`/menu/products/${pizza.id}/similar`, { 'if-none-match': etag })
        check(strictRes.status === 200 && strictRes.headers.get('etag') !== etag,
                'availability changes plus cache bust return fresh data and a changed ETag')
        check(strictRes.headers.get('cache-control') === 'public, no-cache',
                'updated similarity responses keep HTTP revalidation enabled')
        const strictBody = (await strictRes.json()) as {
                products: Array<{ id: string; isAvailable: boolean }>
                strict: boolean
        }
        check(strictBody.strict === true, 'unavailable anchor → strict mode flag')
        check(
                strictBody.products.length === 1 && strictBody.products[0]!.id === salad.id,
                'strict mode returns only the available alternative',
        )
        check(
                strictBody.products.every((p) => p.isAvailable !== false),
                'strict mode never leaks unavailable similars',
        )

        await db.update(categories).set({ purchaseEnabled: false }).where(eq(categories.id, cat.id))
        await menu.bustCache()
        check((await menu.similarProducts(pizza.id))?.products.length === 0,
                'strict alternatives exclude categories with purchasing disabled')
        await db.update(categories).set({ purchaseEnabled: true }).where(eq(categories.id, cat.id))
        await db.update(mainCategories).set({ purchaseEnabled: false }).where(eq(mainCategories.id, main.id))
        await menu.bustCache()
        check((await menu.similarProducts(pizza.id))?.products.length === 0,
                'strict alternatives exclude main categories with purchasing disabled')
        await db.update(mainCategories).set({ purchaseEnabled: true }).where(eq(mainCategories.id, main.id))
        await menu.bustCache()

        // ── بازمحاسه بعد از حذف محصول — ردیف یتیم نمی‌ماند ──
        await db.delete(products).where(eq(products.id, drink.id))
        await similarity.recompute()
        const afterDelete = await db.select().from(productSimilarity)
        check(
                afterDelete.every((r) => r.productId !== drink.id && r.similarId !== drink.id),
                'deleted product leaves no orphan similarity rows',
        )

        // A middle UUID has neighbors on both sides of the canonical a<b pairs.
        // The cap must cover its complete outgoing list, with a stable UUID tie-break.
        const rankedAnchorId = '80000000-0000-4000-8000-000000000000' as typeof pizza.id
        const rankedNeighborIds = ['40000000', 'c0000000'].flatMap((prefix) =>
                Array.from({ length: 25 }, (_, i) =>
                        `${prefix}-0000-4000-8000-${String(i + 1).padStart(12, '0')}` as typeof pizza.id,
                ),
        )
        await db.insert(products).values([rankedAnchorId, ...rankedNeighborIds].map((id) => ({
                id, categoryId: cat.id, name: `rank ${id}`, originalPrice: 1000,
        })))
        await db.insert(productViewLog).values(rankedNeighborIds.flatMap((id, i) =>
                [0, 1].flatMap((n) => [viewRow(rankedAnchorId, `rank-${i}-${n}`), viewRow(id, `rank-${i}-${n}`)]),
        ))
        const rankedIds = async () => (await db.select().from(productSimilarity)
                .where(eq(productSimilarity.productId, rankedAnchorId)))
                .sort((a, b) => b.score - a.score || a.similarId.localeCompare(b.similarId))
                .map((r) => r.similarId)
        await similarity.recompute()
        const beforeRankDelete = await rankedIds()
        check(beforeRankDelete.length === TOP_N_PER_PRODUCT, 'top-N caps the combined neighbors on both UUID sides')
        check(beforeRankDelete.every((id, i) => id === rankedNeighborIds[i]),
                'top-N uses one deterministic score/UUID ranking for each product')
        const tiedResponse = await menu.similarProducts(rankedAnchorId)
        check(tiedResponse?.products.length === 8 && tiedResponse.products.every((p, i) => p.id === rankedNeighborIds[i]),
                'similar API preserves the deterministic UUID order for tied scores')

        await db.update(products).set({ isAvailable: false }).where(sql`${products.id} in (${sql.join(
                [rankedAnchorId, ...rankedNeighborIds.slice(0, 4)].map((id) => sql`${id}::uuid`), sql`, `,
        )})`)
        await menu.bustCache()
        const filteredResponse = await menu.similarProducts(rankedAnchorId, 'fa', 1)
        check(filteredResponse?.strict === true && filteredResponse.products[0]?.id === rankedNeighborIds[4],
                'strict availability filtering precedes the limit and can skip several unavailable neighbors')

        // Historical view logs remain after deletion, but cannot occupy recommendation slots.
        await db.delete(products).where(sql`${products.id} in (${sql.join(
                rankedNeighborIds.slice(0, TOP_N_PER_PRODUCT).map((id) => sql`${id}::uuid`), sql`, `,
        )})`)
        await similarity.recompute()
        const afterRankDelete = await rankedIds()
        check(afterRankDelete.length === TOP_N_PER_PRODUCT && afterRankDelete.every((id, i) => id === rankedNeighborIds[i + TOP_N_PER_PRODUCT]),
                'deleted products are excluded before selecting top-N neighbors')

        await db.update(products).set({ status: 'INACTIVE' }).where(sql`${products.id} in (${sql.join(
                rankedNeighborIds.slice(TOP_N_PER_PRODUCT, TOP_N_PER_PRODUCT * 2).map((id) => sql`${id}::uuid`), sql`, `,
        )})`)
        await similarity.recompute()
        const afterDeactivate = await rankedIds()
        check(afterDeactivate.length === 10 && afterDeactivate.every((id, i) => id === rankedNeighborIds[i + TOP_N_PER_PRODUCT * 2]),
                'inactive products cannot crowd active neighbors out of the stored top-N')

        const newProducts = async (count: number, prefix: string) => db.insert(products).values(
                Array.from({ length: count }, (_, i) => ({ categoryId: cat.id, name: `${prefix} ${i}`, originalPrice: 1000 })),
        ).returning()
        const day = tehranDay()
        const dayOffset = (offset: number) => {
                const date = new Date(`${day}T00:00:00Z`)
                date.setUTCDate(date.getUTCDate() + offset)
                return date.toISOString().slice(0, 10)
        }
        const temporal = await newProducts(10, 'temporal')
        await db.insert(productViewLog).values([
                // Two people saw these products on different days: no shopping context in common.
                ...[0, 1].flatMap((i) => [
                        { ...viewRow(temporal[0]!.id, `split-${i}`), day: dayOffset(-5) },
                        { ...viewRow(temporal[1]!.id, `split-${i}`), day: dayOffset(-6) },
                ]),
                // One person repeatedly seeing a pair must not pass the two-person evidence floor.
                ...[-2, -3].flatMap((offset) => temporal.slice(2, 4).map((p) => ({
                        ...viewRow(p.id, 'repeat-context'), day: dayOffset(offset),
                }))),
                ...[-(COVIEW_WINDOW_DAYS - 1), -COVIEW_WINDOW_DAYS, 1].flatMap((offset, group) =>
                        [0, 1].flatMap((i) => temporal.slice(4 + group * 2, 6 + group * 2).map((p) => ({
                                ...viewRow(p.id, `boundary-${group}-${i}`), day: dayOffset(offset),
                        }))),
                ),
        ])
        // Loyal visitors see >30 products across many days, but only two per shopping day.
        const loyal = await newProducts(32, 'loyal')
        await db.insert(productViewLog).values([0, 1].flatMap((visitor) => loyal.map((p, i) => ({
                ...viewRow(p.id, `loyal-${visitor}`), day: dayOffset(-Math.floor(i / 2)),
        }))))
        await similarity.recompute(day)
        const temporalRows = await db.select().from(productSimilarity)
        const temporalPair = (a: string, b: string) => temporalRows.find((r) => r.productId === a && r.similarId === b)
        check(!temporalPair(temporal[0]!.id, temporal[1]!.id),
                'visits on separate shopping days do not create false co-view associations')
        check(!temporalPair(temporal[2]!.id, temporal[3]!.id),
                'repeat visits by one person do not manufacture independent evidence')
        check(temporalPair(temporal[4]!.id, temporal[5]!.id)?.coViews === 2,
                'the earliest day inside the exact Tehran 60-day window is included')
        check(!temporalPair(temporal[6]!.id, temporal[7]!.id) && !temporalPair(temporal[8]!.id, temporal[9]!.id),
                'out-of-window and future view rows are excluded')
        check(temporalPair(loyal[0]!.id, loyal[1]!.id)?.coViews === 2,
                'per-day crawler filtering preserves loyal visitors across multiple days')
        check(!temporalPair(loyal[0]!.id, loyal[2]!.id),
                'retained loyal visitors do not connect unrelated shopping days')

        const support = await newProducts(4, 'support')
        await db.execute(sql`
                insert into orders (display_id, user_id, status, delivery_type, payment_status, total_amount, breakdown)
                select 'sim-support-' || n, ${user.id}::uuid, 'PAID', 'PICKUP', 'SUCCESS', 2000, '{}'::jsonb
                from generate_series(0, 40) n
        `)
        await db.execute(sql`
                insert into order_items (order_id, product_id, name, unit_price, quantity)
                select o.id, p.id, 'support', 1000, 1
                from orders o
                join generate_series(0, 40) n on o.display_id = 'sim-support-' || n
                join (values
                        (${support[0]!.id}::uuid, 0, 0), (${support[1]!.id}::uuid, 0, 0),
                        (${support[2]!.id}::uuid, 1, 30), (${support[3]!.id}::uuid, 11, 40)
                ) p(id, first_order, last_order)
                  on n between p.first_order and p.last_order
        `)

        // Strong co-view alternatives may fill every mixed slot; keep an independent
        // budget for purchase-backed cart complements instead of losing them at truncation.
        const contexts = await newProducts(41, 'contexts')
        const contextAnchor = contexts[0]!
        const viewNeighbors = contexts.slice(1, 21)
        const purchaseNeighbors = contexts.slice(21)
        await db.execute(sql`
                insert into product_view_log (product_id, visitor_id, day)
                select p.id, 'context-' || n, ${day}::date
                from generate_series(1, 100) n
                cross join (values ${sql.join([contextAnchor, ...viewNeighbors].map((p) => sql`(${p.id}::uuid)`), sql`, `)}) p(id)
        `)
        for (const [i, p] of purchaseNeighbors.entries()) {
                const order = (await db.insert(orders).values({
                        displayId: `sim-context-${i}`, userId: user.id, status: 'PAID', deliveryType: 'PICKUP',
                        paymentStatus: 'SUCCESS', totalAmount: 2000, breakdown,
                }).returning())[0]!
                await db.insert(orderItems).values([contextAnchor, p].map((item) => ({
                        orderId: order.id, productId: item.id, name: item.name, unitPrice: 1000, quantity: 1,
                })))
        }
        await similarity.recompute(day)
        const supportRows = await db.select().from(productSimilarity)
        const rare = supportRows.find((r) => r.productId === support[0]!.id && r.similarId === support[1]!.id)!
        const established = supportRows.find((r) => r.productId === support[2]!.id && r.similarId === support[3]!.id)!
        check(established.purchaseScore > rare.purchaseScore,
                'twenty supporting baskets outrank an accidental singleton even with lower raw cosine')
        const contextRows = supportRows.filter((r) => r.productId === contextAnchor.id)
        check(contextRows.length === 2 * TOP_N_PER_PRODUCT,
                'mixed recommendations and cart complements retain independent top-N budgets')
        const topMixed = [...contextRows].sort((a, b) => b.score - a.score).slice(0, TOP_N_PER_PRODUCT)
        check(topMixed.every((r) => viewNeighbors.some((p) => p.id === r.similarId)),
                'co-view alternatives can lead the mixed ranking without diluting cart evidence')
        check(contextRows.filter((r) => r.purchaseScore > 0).length === TOP_N_PER_PRODUCT,
                'purchase-backed neighbors survive outside the mixed top-N')
        const beforeConcurrent = supportRows.map((r) => `${r.productId}:${r.similarId}:${r.score}:${r.purchaseScore}`).sort()
        await Promise.all([similarity.recompute(day), similarity.recompute(day)])
        const afterConcurrent = (await db.select().from(productSimilarity))
                .map((r) => `${r.productId}:${r.similarId}:${r.score}:${r.purchaseScore}`).sort()
        check(JSON.stringify(beforeConcurrent) === JSON.stringify(afterConcurrent),
                'concurrent rebuilds serialize and preserve the complete deterministic snapshot')

        // Multiplying two int4 popularity counts overflows at just 46,341 each.
        const popular = await db.insert(products).values([0, 1].map((n) => ({
                categoryId: cat.id, name: `popular ${n}`, originalPrice: 1000,
        }))).returning()
        await db.execute(sql`
                insert into product_view_log (product_id, visitor_id, day)
                select p.id, 'popular-' || n, ${recentDay}::date
                from generate_series(1, 46341) n
                cross join (values (${popular[0]!.id}::uuid), (${popular[1]!.id}::uuid)) p(id)
        `)
        await db.execute(sql`
                insert into orders (display_id, user_id, status, delivery_type, payment_status, total_amount, breakdown)
                select 'sim-big-' || n, ${user.id}::uuid, 'PAID', 'PICKUP', 'SUCCESS', 2000, '{}'::jsonb
                from generate_series(1, 46341) n
        `)
        await db.execute(sql`
                insert into order_items (order_id, product_id, name, unit_price, quantity)
                select o.id, p.id, 'popular', 1000, 1
                from orders o
                cross join (values (${popular[0]!.id}::uuid), (${popular[1]!.id}::uuid)) p(id)
                where o.display_id like 'sim-big-%'
        `)
        await similarity.recompute()
        const popularPair = (await db.select().from(productSimilarity)
                .where(eq(productSimilarity.productId, popular[0]!.id)))[0]!
        check(popularPair.coViews === 46341 && popularPair.coPurchases === 46341,
                'large popularity counts recompute without integer multiplication overflow')
        check(Math.abs(popularPair.score - 1) < 0.001,
                'large-popularity score preserves cosine normalization for both signals')

        await db.execute(sql`select 1`)
        console.log(`\n══ Product similarity: ${checks} پاس ══`)
} finally {
        if (database) await database.close().catch(() => undefined)
        try {
                await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
        } catch {
                /* تمیزکاری بهترین‌تلاش */
        }
        await boot.close({ timeout: 5 })
}
