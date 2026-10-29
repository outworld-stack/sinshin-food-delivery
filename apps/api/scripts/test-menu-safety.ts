/** Product/packaging/checkout regression tests. Only disposable local PostgreSQL. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { AppError } from '../src/domain/shared/errors'
import { MenuService } from '../src/domain/menu/menu.service'
import { PackagingService } from '../src/domain/menu/packaging.service'
import { OrderService } from '../src/domain/order/order.service'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { adminMenuRoutes } from '../src/http/routes/admin-menu.routes'
import type { RedisService } from '../src/infra/redis/redis'
import type { CheckoutInput } from '@sinshin/shared'
import { categories, mainCategories, orders, products, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_menu_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let count = 0
const passed = (name: string) => { count++; console.log(`PASS ${name}`) }
const validation = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'
const cache = new Map<string, unknown>()
const redis = {
  get: async (key: string) => cache.get(key) ?? null,
  getJson: async (key: string) => cache.get(key) ?? null,
  setJson: async (key: string, value: unknown) => { cache.set(key, value) },
  incr: async (key: string) => { const value = Number(cache.get(key) ?? 0) + 1; cache.set(key, value); return value },
} as unknown as RedisService

const savedFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in menu safety test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const events: Array<{ productId: string | null; reason: string }> = []
  const menu = new MenuService({
    db, redis,
    hub: { publish: (_topic: string, event: { data: { productId: string | null; reason: string } }) => events.push(event.data) } as never,
  })
  const packaging = new PackagingService({ db })
  const [main] = await db.insert(mainCategories).values({ name: 'Main', slug: 'main', isActive: true }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Food', slug: 'food' }).returning()
  const box = await packaging.add({ title: 'Box', price: 5_000 })
  const bag = await packaging.add({ title: 'Bag', price: 2_000 })
  const base = { name: 'Meal', description: '', originalPrice: 100_000, discountPercentage: 0,
    prepTime: 15, categoryIds: [category!.id], packagingCost: 777, packagingItemIds: [box.id] }
  const created = await menu.createProduct(base)
  assert.equal(created.success, true)
  const pid = created.id!
  const read = () => db.query.products.findFirst({ where: eq(products.id, pid as typeof products.$inferSelect.id) })
  const selected = () => packaging.productItemIds(pid as typeof products.$inferSelect.id)
  const sizeDupes = [{ name: 'Same', price: 10_000 }, { name: 'Same', price: 20_000 }]

  await assert.rejects(menu.createProduct({ ...base, name: 'Failed create', sizesEnabled: true, sizes: sizeDupes }), validation)
  assert.equal((await db.select().from(products)).length, 1, 'failed variant insertion must roll back product creation')
  await assert.rejects(menu.createProduct({ ...base, packagingItemIds: [crypto.randomUUID()] }), validation)
  assert.equal((await db.select().from(products)).length, 1)
  passed('failed sizes and deleted packaging selections never leave partially created products')

  await assert.rejects(menu.updateProduct({ ...base, id: pid, name: 'Failed update', originalPrice: 900_000,
    packagingItemIds: [bag.id], sizesEnabled: true, sizes: sizeDupes }), validation)
  assert.equal((await read())!.name, 'Meal')
  assert.equal((await read())!.originalPrice, 100_000)
  assert.equal((await read())!.sizesEnabled, false)
  assert.deepEqual(await selected(), [box.id], 'link deletion/insertion must roll back with a later size failure')
  await assert.rejects(menu.updateProduct({ ...base, id: pid, packagingItemIds: [crypto.randomUUID()] }), validation)
  assert.deepEqual(await selected(), [box.id])
  assert.equal((await menu.updateProduct({ ...base, id: crypto.randomUUID() })).success, false)
  passed('failed updates preserve base pricing, packaging selections and size configuration')

  await menu.updateProduct({ ...base, id: pid, sizesEnabled: true, sizes: [{ name: 'Same', price: 100_000 }] })
  await assert.rejects(menu.updateProduct({ ...base, id: pid, name: 'Duplicate existing size',
    sizesEnabled: true, sizes: sizeDupes }), validation)
  assert.equal((await read())!.name, 'Meal')
  await menu.updateProduct({ ...base, id: pid, sizesEnabled: false })
  passed('duplicate names reject both existing and new variants without partial updates')

  await Promise.all([
    menu.updateProduct({ ...base, id: pid, name: 'Box meal', packagingItemIds: [box.id] }),
    menu.updateProduct({ ...base, id: pid, name: 'Bag meal', packagingItemIds: [bag.id] }),
  ])
  assert.deepEqual(await selected(), [(await read())!.name === 'Box meal' ? box.id : bag.id])
  assert.equal((await menu.updateProduct({ ...base, id: pid, packagingItemIds: [box.id, bag.id, box.id] })).success, true)
  assert.equal((await selected()).length, 2, 'duplicate IDs are deduplicated')
  await menu.updateProduct({ id: pid, name: 'Meal', description: '', originalPrice: 100_000, discountPercentage: 0, prepTime: 15 })
  assert.equal((await selected()).length, 2, 'omitted selections preserve old clients')
  passed('concurrent saves keep product and packaging in one version; omitted selections remain intact')

  const [buyer] = await db.insert(users).values({ phone: '09150000087' }).returning()
  let busy = false
  let enabled = true
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'menu-safety-test-'.repeat(3), SITE_URL: 'https://sinshin.example' })
  const orderService = new OrderService({
    db, config, coupons: new CouponService({ db }),
    settings: {
      liveTrackingEnabled: async () => false,
      restaurantStatus: async () => ({ anyClosed: false }),
      isBusy: async () => busy,
      enabledGateways: async () => ({ mellat: false, zarinpal: enabled, sep: false }),
    } as never,
    zones: {
      feeFor: async () => 10_000,
      quoteFor: async () => ({ status: 'ready', fee: 10_000, radiusKm: 2, distanceKm: 1 }),
    } as never,
    notifications: { notifyUser: async () => undefined } as never,
  })
  const checkout: CheckoutInput = { items: [{ productId: pid, quantity: 2 }], deliveryType: 'PICKUP', useWallet: false, gatewayId: 'ZARINPAL' }
  await packaging.update(bag.id, { isActive: false })
  assert.equal((await orderService.preview(buyer!.id, checkout)).breakdown.packagingFee, 10_000)
  const paid = await orderService.checkout(buyer!.id, checkout)
  assert.equal(paid.breakdown.packagingFee, 10_000)
  const persisted = (await db.select().from(orders).where(eq(orders.displayId, paid.displayId)))[0]!
  assert.equal(persisted.breakdown.packagingFee, 10_000)
  await packaging.update(box.id, { price: 6_000 })
  assert.equal((await orderService.preview(buyer!.id, checkout)).breakdown.packagingFee, 12_000)
  assert.equal((await db.select().from(orders).where(eq(orders.id, persisted.id)))[0]!.breakdown.packagingFee, 10_000)
  await packaging.update(box.id, { isActive: false })
  assert.equal((await orderService.preview(buyer!.id, checkout)).breakdown.packagingFee, 0)
  await menu.updateProduct({ ...base, id: pid, packagingItemIds: [] })
  assert.equal((await orderService.preview(buyer!.id, checkout)).breakdown.packagingFee, 1_554)
  assert.equal((await orderService.preview(buyer!.id, { ...checkout, deliveryType: 'DINE_IN' })).breakdown.packagingFee, 0)
  passed('active packaging prices stay live; saved orders retain snapshots; empty selections use legacy fallback')

  busy = true
  enabled = false
  const status = await orderService.preview(buyer!.id, checkout)
  assert.equal(status.restaurantBusy, true)
  assert.deepEqual(status.gateways, [])
  const orderCount = (await db.select().from(orders)).length
  await assert.rejects(orderService.checkout(buyer!.id, checkout), validation)
  assert.equal((await db.select().from(orders)).length, orderCount, 'disabled gateway must not reserve an order')
  enabled = true
  await assert.rejects(orderService.checkout(buyer!.id, { ...checkout, deliveryType: 'DINE_IN', customerNote: '  ' }), validation)
  assert.equal((await db.select().from(orders)).length, orderCount)
  assert.ok((await orderService.checkout(buyer!.id, { ...checkout, deliveryType: 'DINE_IN', customerNote: 'Ali - 22' })).displayId)
  busy = false
  passed('disabled gateways and missing busy dine-in notes reject checkout before persisting orders')

  let feePermission = false
  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(adminMenuRoutes({
    menu, packaging,
    sessions: { authenticate: async (token: string) => ({ user: { id: buyer!.id, role: token === 'admin' ? 'admin' : 'admin2' }, ctx: {} }) } as never,
    admin2: { permissionsOf: async () => ({ productsRead: true, productsWrite: true, canEditPackagingFee: feePermission }) } as never,
    audit: { log: async () => undefined } as never,
  })).compile()
  const request = (method: string, path: string, body?: unknown, token = 'editor') => app.handle(new Request(`http://localhost/admin/menu${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  let response = await request('POST', '/products', { ...base, name: 'Restricted create', packagingCost: 999, packagingItemIds: [bag.id] })
  assert.equal(response.status, 200)
  const restricted = await response.json() as { id: typeof products.$inferSelect.id }
  assert.equal((await db.query.products.findFirst({ where: eq(products.id, restricted.id) }))!.packagingCost, 0)
  assert.deepEqual(await packaging.productItemIds(restricted.id), [])
  response = await request('PATCH', `/products/${pid}`, { ...base, packagingCost: 999, packagingItemIds: [bag.id] })
  assert.equal(response.status, 200)
  assert.equal((await read())!.packagingCost, 777)
  assert.deepEqual(await selected(), [])
  assert.equal((await request('POST', '/packaging-items', { title: 'Forbidden', price: 100 })).status, 403)
  passed('product editors without fee permission cannot write either packaging selections or the legacy fee')

  feePermission = true
  assert.equal((await request('PATCH', `/products/${pid}`, { ...base, packagingCost: 888, packagingItemIds: [bag.id] })).status, 200)
  assert.equal((await read())!.packagingCost, 888)
  assert.deepEqual(await selected(), [bag.id])
  assert.equal((await request('PATCH', `/products/${pid}`, { ...base, packagingCost: 999, packagingItemIds: [box.id] }, 'admin')).status, 200)
  assert.equal((await read())!.packagingCost, 999)
  assert.deepEqual(await selected(), [box.id])
  passed('fee permission and main-admin access still authorize product packaging writes')

  const beforeEvents = events.length
  const version = Number(cache.get('menu:ver') ?? 0)
  response = await request('POST', '/packaging-items', { title: 'New item', price: 3_000 })
  assert.equal(response.status, 200)
  const added = await response.json() as { id: string }
  assert.equal((await request('PATCH', `/packaging-items/${added.id}`, { price: 4_000 })).status, 200)
  assert.equal((await request('DELETE', `/packaging-items/${added.id}`)).status, 200)
  assert.equal(events.length - beforeEvents, 3)
  assert(events.slice(beforeEvents).every((event) => event.reason === 'packaging' && event.productId === null))
  assert.equal(Number(cache.get('menu:ver')), version + 3)
  assert(events.some((event) => event.reason === 'packaging' && event.productId === pid))
  passed('packaging CRUD and product selection updates publish live checkout refreshes and invalidate menu caches')

  console.log(`Menu safety: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
