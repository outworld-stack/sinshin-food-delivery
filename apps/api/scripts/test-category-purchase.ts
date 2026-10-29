/** stage-86 — تست یکپارچه‌ی «غیرفعال‌سازی خرید دسته‌بندی‌ها» روی PostgreSQL واقعی.
 *
 * پوشش (درخواست کارفرما — کامیت eighty-six):
 *  ۱) زنجیره‌ی مایگریشن + ستون‌های purchase_enabled (والد + زیردسته)
 *  ۲) MenuService: setMainPurchase/setCategoryPurchase + purchasable در
 *     productById/productsByMain/adminProducts + adminPurchaseState
 *  ۳) CartService: آیتمِ دسته‌ی غیرفعال → available=false + blockedReason='category'
 *  ۴) OrderService: preview (blockedReason) + گارد ثبت سفارش (خطای «خرید غیرفعال»)
 *
 * فقط دیتابیس موقتیِ local — بدون درگاه/نوتیف/درخواست خارجی.
 *   DATABASE_URL=postgres://... bun scripts/test-category-purchase.ts
 *   (یا: bun run db:test:purchase)
 */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { MenuService } from '../src/domain/menu/menu.service'
import { CartService } from '../src/domain/cart/cart.service'
import { OrderService } from '../src/domain/order/order.service'
import { CouponService } from '../src/domain/coupon/coupon.service'
import type { RedisService } from '../src/infra/redis/redis'
import type { CheckoutInput } from '@sinshin/shared'
import { categories, mainCategories, products, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_purchase_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`

// ── ردیسِ درون‌حافظه‌ای — VersionedCache فقط get/getJson/setJson/incr می‌خواهد ──
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
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'purchase-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
  })

  const menu = new MenuService({ db, redis: fakeRedis() })
  const cart = new CartService({ db })
  const coupons = new CouponService({ db })
  const orderService = new OrderService({
    db, config, coupons,
    settings: {
      liveTrackingEnabled: async () => false,
      restaurantStatus: async () => ({ anyClosed: false }),
      // stage-84 — preview/checkout درگاه‌های فعال + شلوغی را می‌خواند
      // (زarinpal روشن تا checkout مستقیم با درگاهِ pending رد شود)
      enabledGateways: async () => ({ mellat: false, zarinpal: true, sep: false }),
      isBusy: async () => false,
    } as never,
    zones: {
      feeFor: async () => 10_000,
      quoteFor: async () => ({ status: 'ready', fee: 10_000, radiusKm: 2, distanceKm: 1 }),
    } as never,
    notifications: { notifyUser: async () => undefined } as never,
  })

  // ── دیتای پایه: والد + دو زیردسته + سه محصول ──
  const [main] = await db.insert(mainCategories).values({
    name: 'رستوران', slug: 'restaurant', isActive: true, isDefault: true,
  }).returning()
  const [kebab] = await db.insert(categories).values({
    mainCategoryId: main!.id, name: 'کباب‌ها', slug: 'kebab',
  }).returning()
  const [drink] = await db.insert(categories).values({
    mainCategoryId: main!.id, name: 'نوشیدنی‌ها', slug: 'drinks',
  }).returning()
  const [chelo] = await db.insert(products).values({
    categoryId: kebab!.id, name: 'چلوکباب', originalPrice: 200_000, status: 'ACTIVE',
  }).returning()
  const [doogh] = await db.insert(products).values({
    categoryId: drink!.id, name: 'دوغ', originalPrice: 20_000, status: 'ACTIVE',
  }).returning()

  // ── ۱) پیش‌فرض‌ها: همه purchasable و بدون blockedReason ──
  const cheloBefore = await menu.productById(chelo!.id)
  assert.equal(cheloBefore?.purchasable, true)
  const cartBefore = await cart.details([{ productId: chelo!.id, quantity: 1 }])
  assert.equal(cartBefore.items[0]?.available, true)
  assert.equal(cartBefore.items[0]?.blockedReason, undefined)
  passed('پیش‌فرض stage-86: خرید روشن — purchasable=true و سبد بدون قفل')

  // ── ۲) غیرفعال‌سازی زیردسته: purchasable=false در همه‌ی پاسخ‌ها ──
  const offCat = await menu.setCategoryPurchase(kebab!.id, false)
  assert.equal(offCat.success, true)
  const cheloLocked = await menu.productById(chelo!.id)
  assert.equal(cheloLocked?.purchasable, false)
  assert.equal(cheloLocked?.isAvailable, true, 'موجودی محصول دست‌نخورده می‌ماند')
  const byMain = await menu.productsByMain('restaurant')
  const cheloInList = byMain.products.find((p) => p.id === chelo!.id)
  const dooghInList = byMain.products.find((p) => p.id === doogh!.id)
  assert.equal(cheloInList?.purchasable, false, 'کارت محصول لیست: خرید قفل')
  assert.equal(dooghInList?.purchasable, true, 'دسته‌ی دیگر آزاد می‌ماند')
  const adminList = await menu.adminProducts({ page: 1, limit: 10 })
  assert.equal(adminList.products.find((p) => p.id === chelo!.id)?.purchasable, false)
  passed('زیردسته‌ی غیرفعال: purchasable=false در جزئیات/لیست عمومی/لیست ادمین')

  // ایدمپوتنت: دوباره همان مقدار → پیام، بدون خطا
  const again = await menu.setCategoryPurchase(kebab!.id, false)
  assert.equal(again.success, true)
  assert.match(again.message ?? '', /از قبل/)
  passed('سوئیچ ایدمپوتنت است (پیام «از قبل» بدون خطا)')

  // ── ۳) سبد: آیتمِ دسته‌ی غیرفعال → available=false + reason='category' ──
  const cartLocked = await cart.details([{ productId: chelo!.id, quantity: 2 }])
  const lockedRow = cartLocked.items[0]!
  assert.equal(lockedRow.available, false)
  assert.equal(lockedRow.blockedReason, 'category')
  assert.equal(lockedRow.lineTotal, 0, 'آیتمِ قفل‌شده از جمع بیرون می‌ماند')
  assert.equal(cartLocked.total, 0)
  const cartMixed = await cart.details([
    { productId: chelo!.id, quantity: 2 },
    { productId: doogh!.id, quantity: 1 },
  ])
  assert.equal(cartMixed.total, 20_000, 'فقط آیتمِ آزاد حساب می‌شود')
  passed('سبد: دسته‌ی غیرفعال = هشدار + خارج از جمع (blockedReason=category)')

  // ── ۴) چک‌اوت: preview هشدار می‌دهد؛ ثبت سفارش خطای صریح ──
  const [buyer] = await db.insert(users).values({ phone: '09150000086' }).returning()
  const input: CheckoutInput = {
    items: [{ productId: chelo!.id, quantity: 1 }],
    deliveryType: 'DINE_IN', useWallet: false, gatewayId: 'ZARINPAL',
  }
  const preview = await orderService.preview(buyer!.id, input)
  const previewItem = preview.items.find((i) => i.name === 'چلوکباب')
  assert.equal(previewItem?.available, false)
  assert.equal(previewItem?.blockedReason, 'category')
  await assert.rejects(
    () => orderService.checkout(buyer!.id, input),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /خرید «کباب‌ها» فعلاً غیرفعال شده است/)
      return true
    },
  )
  passed('چک‌اوت: پیش‌نمایش هشدار + ثبت سفارش با نامِ دسته رد می‌شود')

  // ── ۵) غیرفعال‌سازی والد: قفلِ کلِ زنجیره (حتی با دسته‌ی روشن) ──
  await menu.setCategoryPurchase(kebab!.id, true)
  await menu.setMainPurchase(main!.id, false)
  const cheloMainLocked = await menu.productById(chelo!.id)
  assert.equal(cheloMainLocked?.purchasable, false, 'والدِ خاموش = قفلِ زنجیره')
  const dooghMainLocked = await menu.productById(doogh!.id)
  assert.equal(dooghMainLocked?.purchasable, false)
  const cartMainLocked = await cart.details([{ productId: doogh!.id, quantity: 1 }])
  assert.equal(cartMainLocked.items[0]?.available, false)
  assert.equal(cartMainLocked.items[0]?.blockedReason, 'category')
  await assert.rejects(
    () => orderService.checkout(buyer!.id, { ...input, items: [{ productId: doogh!.id, quantity: 1 }] }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /«رستوران»/) // نامِ والد در پیام
      return true
    },
  )
  passed('والدِ غیرفعال: کلِ زنجیره قفل + پیام با نامِ والد')

  // ── ۶) برگشت به حالت عادی: سفارش موفق (رفع قفل لحظه‌ای) ──
  await menu.setMainPurchase(main!.id, true)
  const restored = await menu.productById(chelo!.id)
  assert.equal(restored?.purchasable, true)
  const state = await menu.adminPurchaseState()
  assert.equal(state.mains.find((m) => m.id === main!.id)?.purchaseEnabled, true)
  assert.equal(state.categories.find((c) => c.id === kebab!.id)?.purchaseEnabled, true)
  assert.equal(state.categories.find((c) => c.id === kebab!.id)?.mainName, 'رستوران')
  const order = await orderService.checkout(buyer!.id, input)
  assert.ok(order.displayId, 'سفارش بعد از فعال‌سازی ثبت شد')
  passed('فعال‌سازی مجدد: خرید فوری برمی‌گردد و سفارش ثبت می‌شود')

  console.log(`\n══ نتیجه: ${count} پاس / 0 خطا ══`)
} catch (err) {
  console.error('FAIL', err)
  process.exitCode = 1
} finally {
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close()
}
