/** Product stats (hundred-eleven) integration regressions. Creates/drops only a uniquely named scratch database on local PostgreSQL. */
import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { SQL } from 'bun'
import { Elysia } from 'elysia'

import { ProductStatsService, tehranDay } from '../src/domain/product-stats/product-stats.service'
import { Database } from '../src/infra/db/client'
import {
        categories,
        mainCategories,
        orderItems,
        orders,
        productDailyStats,
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
        'Product-stats tests require a local PostgreSQL server',
)
const scratch = `sinshin_stats_test_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const testUrl = new URL(source)
testUrl.pathname = `/${scratch}`
const boot = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
let database: Database | undefined
let service: ProductStatsService | undefined
let checks = 0
const check = (condition: unknown, message: string) => {
        assert.ok(condition, message)
        checks++
        console.log(`  ✓ ${message}`)
}

/** ردیسِ درون‌حافظه‌ای — همان قراردادی که سرویس/سقفِ نرخ می‌خواهند (TTL واقعی) */
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
                        const entry = alive(key)
                        const next = Number(entry?.value ?? 0) + 1
                        store.set(key, {
                                value: String(next),
                                expiresAt: entry?.expiresAt ?? Number.MAX_SAFE_INTEGER,
                        })
                        return next
                },
                expire: async (key: string, seconds: number) => {
                        const entry = alive(key)
                        if (entry) entry.expiresAt = Date.now() + seconds * 1000
                        return 1
                },
        } as unknown as RedisService
}

/** درایور Bun SQL ستون date را به Date پارس می‌کند (mode در drizzle بر آن
 *  بی‌اثر است — PgDateString بدون mapFromDriverValue است) — نرمال‌سازیِ یکسان */
const dayStr = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

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
        service = new ProductStatsService({ db, redis })

        // ── سید: کاربر + والد + دسته + دو محصول ──
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
                .values({ categoryId: cat.id, name: 'پیتزا', originalPrice: 100_000 })
                .returning())[0]!
        const salad = (await db
                .insert(products)
                .values({ categoryId: cat.id, name: 'سالاد', originalPrice: 50_000 })
                .returning())[0]!

        // ── بیکن‌ها از لایه‌ی HTTP (همان مسیر پروداکشن: کوکی + بات + سقف نرخ) ──
        const app = new Elysia()
                .use(
                        menuRoutes({
                                menu: {} as never,
                                cart: {} as never,
                                settings: {} as never,
                                redis,
                                stats: service,
                        }),
                )
                .compile()
        const post = (path: string, headers: Record<string, string>) =>
                app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers }))

        const bot = await post(`/menu/products/${pizza.id}/view`, {
                'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        })
        const botBody = (await bot.json()) as { counted: boolean }
        check(botBody.counted === false, 'bot UA is not counted')
        check(!bot.headers.get('set-cookie'), 'bot UA gets no cookie')

        // hundred-twelve — گارد کراس‌سایت: بیکنِ مرورگری که از دامنه‌ی دیگری
        // آمده شمرده نمی‌شود (کوکی Lax همراهش نمی‌آید ⇒ هر بار vid تازه = تورم)
        const crossSite = await post(`/menu/products/${pizza.id}/view`, {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
                'sec-fetch-site': 'cross-site',
        })
        const crossSiteBody = (await crossSite.json()) as { counted: boolean }
        check(crossSiteBody.counted === false, 'cross-site browser beacon is not counted')
        check(!crossSite.headers.get('set-cookie'), 'cross-site beacon gets no cookie')
        // same-origin (سایت خودمان) شمرده می‌شود — گاردِ هدفمند، نه بسته‌ی کامل
        const sameOrigin = await post(`/menu/products/${salad.id}/view`, {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
                'sec-fetch-site': 'same-origin',
        })
        const sameOriginBody = (await sameOrigin.json()) as { counted: boolean }
        check(sameOriginBody.counted === true, 'same-origin browser beacon is counted')

        const first = await post(`/menu/products/${pizza.id}/view`, {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
        })
        const cookieHeader = first.headers.get('set-cookie') ?? ''
        const firstBody = (await first.json()) as { counted: boolean }
        check(firstBody.counted === true, 'first view counts')
        check(
                cookieHeader.includes('sinshin_vid=') && cookieHeader.includes('HttpOnly'),
                'fresh visitor gets HttpOnly sinshin_vid cookie',
        )
        const vid = /sinshin_vid=([^;]+)/.exec(cookieHeader)?.[1] ?? ''

        const repeat = await post(`/menu/products/${pizza.id}/view`, {
                'user-agent': 'Mozilla/5.0',
                cookie: `sinshin_vid=${vid}`,
        })
        const repeatBody = (await repeat.json()) as { counted: boolean }
        check(repeatBody.counted === false, 'same visitor refresh is deduped (24h)')

        const secondVid = crypto.randomUUID()
        const second = await post(`/menu/products/${pizza.id}/view`, {
                'user-agent': 'Mozilla/5.0',
                cookie: `sinshin_vid=${secondVid}`,
        })
        const secondBody = (await second.json()) as { counted: boolean }
        check(secondBody.counted === true, 'a different visitor counts')
        check(
                (second.headers.get('set-cookie') ?? '').length === 0,
                'existing cookie is not re-issued',
        )

        const cartFirst = await post(`/menu/products/${pizza.id}/cart-event`, {
                'user-agent': 'Mozilla/5.0',
                cookie: `sinshin_vid=${vid}`,
        })
        const cartFirstBody = (await cartFirst.json()) as { counted: boolean }
        check(cartFirstBody.counted === true, 'first cart event counts')
        const cartRepeat = await post(`/menu/products/${pizza.id}/cart-event`, {
                'user-agent': 'Mozilla/5.0',
                cookie: `sinshin_vid=${vid}`,
        })
        const cartRepeatBody = (await cartRepeat.json()) as { counted: boolean }
        check(cartRepeatBody.counted === false, 'same-visitor cart event is deduped')

        const invalid = await post(`/menu/products/not-a-uuid/view`, { 'user-agent': 'Mozilla/5.0' })
        check(invalid.status === 422, 'non-UUID id is rejected by the route schema')

        // ── فلش (close) → همه‌چیز یکجا می‌نشیند ──
        await service.close()
        const pizzaRow = (await db.select().from(products).where(eq(products.id, pizza.id)))[0]!
        check(pizzaRow.views === 2, 'products.views got both unique visitors (2)')
        const logRows = await db.select().from(productViewLog)
        check(logRows.length === 3, 'view log carries one row per accepted view (2 pizza + 1 salad)')
        check(
                logRows.every((r) => dayStr(r.day) === tehranDay()),
                'log day is Tehran-today',
        )
        check(
                logRows.every((r) => !r.visitorId.includes(vid)),
                'visitor id is hashed (no raw cookie in log)',
        )
        const todayStats = (
                await db.select().from(productDailyStats).where(eq(productDailyStats.productId, pizza.id))
        )[0]!
        check(todayStats.views === 2 && todayStats.cartAdds === 1, 'daily cell: 2 views + 1 cart add')

        // ── صدور فروش — سفارشِ تسویه‌شده اعمال می‌شود، ناتسویه رد می‌شود ──
        const breakdown = {
                foodTotal: 250_000,
                discount: 0,
                walletDeduction: 0,
                deliveryFee: 0,
                packagingFee: 0,
                totalAmount: 250_000,
                amountPaidOnline: 250_000,
        }
        const paid = (await db
                .insert(orders)
                .values({
                        displayId: 'ord-test01',
                        userId: user.id,
                        status: 'PAID',
                        deliveryType: 'PICKUP',
                        paymentStatus: 'SUCCESS',
                        totalAmount: 250_000,
                        breakdown,
                })
                .returning())[0]!
        await db.insert(orderItems).values([
                { orderId: paid.id, productId: pizza.id, name: 'پیتزا', unitPrice: 100_000, quantity: 2 },
                { orderId: paid.id, productId: salad.id, name: 'سالاد', unitPrice: 50_000, quantity: 1 },
        ])
        service.recordOrderSettlement(paid.id)

        const pending = (await db
                .insert(orders)
                .values({
                        displayId: 'ord-test02',
                        userId: user.id,
                        status: 'PENDING_PAYMENT',
                        deliveryType: 'PICKUP',
                        totalAmount: 100_000,
                        breakdown,
                })
                .returning())[0]!
        await db.insert(orderItems).values([
                { orderId: pending.id, productId: pizza.id, name: 'پیتزا', unitPrice: 100_000, quantity: 5 },
        ])
        service.recordOrderSettlement(pending.id)

        await service.flush()
        const afterPizza = (await db.select().from(products).where(eq(products.id, pizza.id)))[0]!
        const afterSalad = (await db.select().from(products).where(eq(products.id, salad.id)))[0]!
        check(afterPizza.sales === 2, 'settled order adds sales (pizza x2)')
        check(afterSalad.sales === 1, 'settled order adds sales (salad x1)')
        check(
                afterPizza.views === 2,
                'flush kept earlier views (buffer re-queue after close is lossless)',
        )
        const cells = await db.select().from(productDailyStats)
        const pizzaCell = cells.find((c) => c.productId === pizza.id)!
        check(pizzaCell.orders === 2, 'daily cell carries sold units (pizza x2)')
        const saladCell = cells.find((c) => c.productId === salad.id)!
        check(saladCell.orders === 1, 'daily cell carries sold units (salad x1)')

        // ── sync شبانه — خودترمیمی refund + پاکسازی یتیم ──
        await db
                .update(orders)
                .set({ status: 'CANCELED', paymentStatus: 'REFUNDED' })
                .where(eq(orders.id, paid.id))
        await service.syncSales()
        const healedPizza = (await db.select().from(products).where(eq(products.id, pizza.id)))[0]!
        const healedSalad = (await db.select().from(products).where(eq(products.id, salad.id)))[0]!
        check(healedPizza.sales === 0 && healedSalad.sales === 0, 'refunded order is removed by the nightly sync')

        // ردیف یتیم: محصولِ حذف‌شده (FK عمداً نیست — snapshot semantics اقلام سفارش)
        await db.execute(
                sql`insert into product_view_log (product_id, visitor_id, day) values (${crypto.randomUUID()}, 'orphan-hash', ${tehranDay()})`,
        )
        const orphansBefore = await db.select().from(productViewLog)
        check(orphansBefore.length === 4, 'orphan log row exists before sync (3 real + 1 orphan)')
        await service.syncSales()
        const orphansAfter = await db.select().from(productViewLog)
        check(orphansAfter.length === 3, 'nightly sync prunes orphan stats rows (deleted product)')

        // tehranDay — قرارداد روزِ تقویمی
        check(/^\d{4}-\d{2}-\d{2}$/.test(tehranDay()), 'tehranDay is YYYY-MM-DD')

        console.log(`\n══ Product stats: ${checks} پاس ══`)
} finally {
        if (service) {
                try {
                        await service.close()
                } catch {
                        /* shutdown تست */
                }
        }
        if (database) await database.close().catch(() => undefined)
        try {
                await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
        } catch {
                /* تمیزکاری بهترین‌تلاش */
        }
        await boot.close({ timeout: 5 })
}
