/** stage-98 — تستِ «آخرین تغییر، اولِ صف» در لیستِ محصولاتِ پنل ادمین — روی PostgreSQL واقعی.
 *
 * پوشش (خواستهٔ صاحبِ کسب‌وکار):
 *  ۱) ویرایشِ محصولِ قدیمی (updateProduct) → فوراً صدرِ صفحه‌ی ۱ در adminProducts
 *  ۲) تغییرِ وضعیت (toggle) هم مثل ویرایش صدر می‌آورد (updated_at تازه می‌شود)
 *  ۳) گریدِ عمومیِ سایت (productsByMain) عمداً created_at DESC می‌ماند —
 *     لیستِ فروشگاه با هر ویرایشِ ادمین بالا-پایین نمی‌شود
 *  ۴) تای‌بریکرِ created_at: ردیف‌های updated_at هم‌ارزش → ترتیبِ پایدار
 *
 * فقط دیتابیس موقتیِ local — بدون درگاه/نوتیف/شبکه:
 *   DATABASE_URL=postgres://... bun scripts/test-admin-products-order.ts
 *   (یا: bun run db:test:products-order)
 */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { eq } from 'drizzle-orm'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { MenuService } from '../src/domain/menu/menu.service'
import type { RedisService } from '../src/infra/redis/redis'
import { categories, mainCategories, products } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_prodorder_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`

function fakeRedis(): RedisService {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    getJson: async <T>(k: string) => {
      const raw = store.get(k)
      return raw ? (JSON.parse(raw) as T) : null
    },
    setJson: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v))
    },
    incr: async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1
      store.set(k, String(n))
      return n
    },
  } as unknown as RedisService
}

let database: Database | undefined
let count = 0
function passed(name: string) {
  count++
  console.log(`PASS ${name}`)
}

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  new AppConfig({ NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(),
    JWT_SECRET: 'products-order-test'.repeat(3), SITE_URL: 'https://sinshin.example' })
  const menu = new MenuService({ db, redis: fakeRedis() })

  // ── دیتای پایه: والد + دسته + سه محصول با created_at متمایز (شبیهِ دادهٔ واقعی) ──
  const [main] = await db.insert(mainCategories).values({
    name: 'رستوران', slug: 'restaurant', isActive: true, isDefault: true,
  }).returning()
  const [cat] = await db.insert(categories).values({
    mainCategoryId: main!.id, name: 'کباب‌ها', slug: 'kebab',
  }).returning()
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000)
  const [pOld] = await db.insert(products).values({
    categoryId: cat!.id, name: 'چلوکباب قدیمی', originalPrice: 200_000, status: 'ACTIVE', createdAt: daysAgo(30),
  }).returning()
  const [pMid] = await db.insert(products).values({
    categoryId: cat!.id, name: 'جوجه کباب', originalPrice: 180_000, status: 'ACTIVE', createdAt: daysAgo(20),
  }).returning()
  const [pNew] = await db.insert(products).values({
    categoryId: cat!.id, name: 'کباب جدید', originalPrice: 250_000, status: 'ACTIVE', createdAt: daysAgo(10),
  }).returning()
  // updated_at را هم‌ارزشِ created_at می‌کنیم (مثل seed واقعی)
  for (const [row, created] of [[pOld, daysAgo(30)], [pMid, daysAgo(20)], [pNew, daysAgo(10)]] as const) {
    await db.update(products).set({ updatedAt: created }).where(eq(products.id, row!.id))
  }

  // ── ۱) پایه: created_at DESC (بدونِ ویرایش، جدیدترین اول) ──
  const initial = await menu.adminProducts({ page: 1, limit: 10 })
  assert.deepEqual(initial.products.map((p) => p.id), [pNew!.id, pMid!.id, pOld!.id],
    'بدون ویرایش: ترتیبِ created_at DESC با تای‌بریکرِ پایدار')
  passed('پایه: جدیدترین اول — ترتیبِ پایدار روی ردیف‌های هم‌تاریخ')

  // ── ۲) ویرایشِ قدیمی‌ترین → فوراً صدرِ صفحه‌ی ۱ ──
  await menu.updateProduct({
    id: pOld!.id, name: 'چلوکباب ویرایش‌شده', description: '', originalPrice: 210_000,
    discountPercentage: 0, prepTime: 15,
  })
  const afterEdit = await menu.adminProducts({ page: 1, limit: 10 })
  assert.equal(afterEdit.products[0]!.id, pOld!.id,
    'محصولِ تازه‌ویرایش‌شده باید اولِ ردیفِ اول باشد — نه صفحه‌ی آخر')
  assert.equal(afterEdit.products[0]!.name, 'چلوکباب ویرایش‌شده')
  assert.deepEqual(afterEdit.products.map((p) => p.id).slice(1), [pNew!.id, pMid!.id])
  passed('ویرایش = پرشِ فوری به صدرِ صفحه‌ی ۱ (updated_at DESC)')

  // ── ۳) toggle وضعیت هم مثل ویرایش صدر می‌آورد ──
  await menu.toggleProductStatus(pMid!.id)
  const afterToggle = await menu.adminProducts({ page: 1, limit: 10 })
  assert.equal(afterToggle.products[0]!.id, pMid!.id, 'تغییرِ وضعیت هم updatedAt را تازه می‌کند → صدر')
  assert.equal(afterToggle.products.find((p) => p.id === pMid!.id)!.status, 'INACTIVE')
  await menu.toggleProductStatus(pMid!.id)
  passed('تغییرِ وضعیت هم مثل ویرایش صدر می‌آورد (رفتارِ یکسانِ آدمین)')

  // ── ۴) گریدِ عمومیِ سایت عمداً created_at DESC ماند ──
  const publicGrid = await menu.productsByMain('restaurant')
  const publicIds = publicGrid.products.map((p) => p.id)
  assert.deepEqual(publicIds.filter((id) => [pOld!.id, pMid!.id, pNew!.id].includes(id)),
    [pNew!.id, pMid!.id, pOld!.id],
    'لیستِ فروشگاه با ویرایش‌های ادمین بالا-پایین نمی‌شود — قراردادِ حفظ‌شده')
  passed('گریدِ عمومی: همچنان created_at DESC (مصون از ویرایش‌های ادمین)')

  // ── ۵) تای‌بریکر: updated_at هم‌ارزش ⇒ created_at DESC ──
  const tied = new Date(Date.now() - 5 * 60_000)
  await db.update(products).set({ updatedAt: tied }).where(eq(products.id, pOld!.id))
  await db.update(products).set({ updatedAt: tied }).where(eq(products.id, pNew!.id))
  const tieList = await menu.adminProducts({ page: 1, limit: 10 })
  const tieOrder = tieList.products.map((p) => p.id).filter((id) => id === pOld!.id || id === pNew!.id)
  assert.deepEqual(tieOrder, [pNew!.id, pOld!.id],
    'تساویِ updated_at با تای‌بریکرِ created_at DESC شکسته می‌شود (نه با ترتیبِ heap)')
  passed('تای‌بریکرِ created_at: تساوی‌ها پایدار مرتب می‌شوند')

  console.log(`\n══ نتیجه: ${count} پاس / 0 خطا ══`)
} catch (err) {
  console.error('FAIL', err)
  process.exitCode = 1
} finally {
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close()
}
