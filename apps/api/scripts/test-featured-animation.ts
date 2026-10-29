/**
 * stage-101 — قرارداد «انیمیشن اختصاصی محصول ویژه» (featured_animation).
 * فقط PostgreSQL قابل‌دورریختِ محلی. مسیرهای درگیر:
 *   • POST   /admin/menu/products               (create + featuredAnimation)
 *   • PATCH  /admin/menu/products/:id           (undefined=حفظ | null=ارث | مقدار)
 *   • GET    /admin/menu/products/:id           (فرم ویرایش)
 *   • GET    /menu/products/:id                 (عمومی — صفحه‌ی محصول)
 * گاردها: ادمین۲ نمی‌تواند انیمیشن بگذارد (مثل خودِ پرچم ویژه)؛ اتحادیه‌ی
 * سفید shader|sonar|sparks خارجش ⇒ 422.
 */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { Elysia } from 'elysia'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppError } from '../src/domain/shared/errors'
import { MenuService } from '../src/domain/menu/menu.service'
import { PackagingService } from '../src/domain/menu/packaging.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { adminMenuRoutes } from '../src/http/routes/admin-menu.routes'
import { adminSettingsRoutes } from '../src/http/routes/admin-settings.routes'
import { menuRoutes } from '../src/http/routes/menu.routes'
import type { RedisService } from '../src/infra/redis/redis'
import { categories, mainCategories, SETTING_KEYS, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_fan_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let count = 0
/** شکلِ خوانده‌شده از اندپوینت‌های عمومی/ادمین — فیلدهای مورداستفاده */
type PubProduct = { name?: string; isFeatured?: boolean; featuredAnimation?: string | null }
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
globalThis.fetch = (() => { throw new Error('External requests forbidden in featured-animation test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const menu = new MenuService({
    db, redis,
    hub: { publish: () => undefined } as never,
  })
  const packaging = new PackagingService({ db })
  const settings = new SettingsService({ db })
  const [adminUser] = await db.insert(users).values({ phone: '09120000001', name: 'Main Admin' }).returning()
  const [main] = await db.insert(mainCategories).values({ name: 'Main', slug: 'main', isActive: true, isDefault: true }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Food', slug: 'food' }).returning()
  assert.ok(adminUser && main && category, 'seed rows')
  const sessions = { authenticate: async (token: string) => ({ user: { id: adminUser!.id, role: token === 'main' ? 'admin' : 'admin2' }, ctx: {} }) }
  const admin2 = { permissionsOf: async () => ({ productsRead: true, productsWrite: true }) }
  const auditEntries: { action: string; metadata: unknown }[] = []
  const audit = { log: async (entry: { action: string; metadata: unknown }) => { auditEntries.push(entry) } }

  const app = new Elysia()
    .onError(({ error, set }) => {
      if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
    })
    .use(adminMenuRoutes({
      menu, packaging,
      sessions: sessions as never,
      admin2: admin2 as never,
      audit: audit as never,
    }))
    .use(adminSettingsRoutes({
      settings,
      sessions: sessions as never,
      admin2: admin2 as never,
      audit: audit as never,
      zones: {} as never,
      permits: {} as never,
    }))
    .use(menuRoutes({
      menu,
      cart: { details: async () => ({ items: [] }) } as never,
      redis,
      settings,
    }))
    .compile()

  const adminReq = (method: string, path: string, body?: unknown) =>
    app.handle(new Request(`http://localhost/admin/menu${path}`, {
      method, headers: { authorization: 'Bearer main', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  const adminReqAs = (token: string, method: string, path: string, body?: unknown) =>
    app.handle(new Request(`http://localhost/admin/menu${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  const publicReq = (path: string) =>
    app.handle(new Request(`http://localhost/menu${path}`))
  const settingsReq = (token: string, method: string, body?: unknown) =>
    app.handle(new Request('http://localhost/admin/settings/featured-animation', {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))

  const initialAnimation = await publicReq('/featured-animation')
  assert.equal(initialAnimation.status, 200)
  assert.deepEqual(await initialAnimation.json(), { animation: 'shader' })
  assert.deepEqual(await (await settingsReq('main', 'GET')).json(), { animation: 'shader' })
  const initialEtag = initialAnimation.headers.get('etag')
  assert.ok(initialEtag)
  assert.match(initialAnimation.headers.get('cache-control') ?? '', /max-age=30/)
  const unchanged = await app.handle(new Request('http://localhost/menu/featured-animation', {
    headers: { 'if-none-match': initialEtag },
  }))
  assert.equal(unchanged.status, 304)
  assert.equal(await unchanged.text(), '')
  passed('missing global animation defaults to shader with ETag/304 caching')

  assert.equal((await settingsReq('main', 'POST', { animation: 'sonar' })).status, 200)
  assert.deepEqual(await (await settingsReq('main', 'GET')).json(), { animation: 'sonar' })
  assert.deepEqual(await new SettingsService({ db }).get(SETTING_KEYS.featuredAnimation, ''), 'sonar')
  const changed = await app.handle(new Request('http://localhost/menu/featured-animation', {
    headers: { 'if-none-match': initialEtag },
  }))
  assert.equal(changed.status, 200)
  assert.notEqual(changed.headers.get('etag'), initialEtag)
  assert.deepEqual(await changed.json(), { animation: 'sonar' })
  assert.deepEqual(auditEntries.at(-1), {
    actorId: adminUser.id,
    action: 'FEATURED_ANIMATION_SET',
    entity: 'settings',
    metadata: { animation: 'sonar' },
  })
  passed('global animation writes persist, refresh public ETag and create an audit entry')

  const auditCount = auditEntries.length
  assert.equal((await settingsReq('second', 'GET')).status, 403)
  assert.equal((await settingsReq('second', 'POST', { animation: 'sparks' })).status, 403)
  assert.equal((await settingsReq('main', 'POST', { animation: 'neon' })).status, 422)
  assert.equal(auditEntries.length, auditCount)
  assert.deepEqual(await (await publicReq('/featured-animation')).json(), { animation: 'sonar' })
  passed('admin2 and invalid global animation writes are rejected without changing settings')

  await settings.set(SETTING_KEYS.featuredAnimation, { invalid: true })
  assert.deepEqual(await (await publicReq('/featured-animation')).json(), { animation: 'shader' })
  assert.deepEqual(await (await settingsReq('main', 'GET')).json(), { animation: 'shader' })
  passed('invalid stored global animation safely defaults to shader')

  const base = (name: string) => ({
    name, description: '', originalPrice: 100_000, discountPercentage: 0,
    prepTime: 15, categoryIds: [category!.id],
    galleryImages: [], sizesEnabled: false, sizes: [], ingredients: ['a', 'b'],
  })

  // ── ۱) ساخت محصول ویژه با انیمیشن اختصاصی sonar ──
  let res = await adminReq('POST', '/products', { ...base('Featured Sonar'), isFeatured: true, featuredAnimation: 'sonar' })
  assert.equal(res.status, 200)
  let body = await res.json() as { success: boolean; id?: string }
  assert.ok(body.success && body.id, 'create featured+sonar')
  const sonarId = body.id!
  let pub = await (await publicReq(`/products/${sonarId}`)).json() as PubProduct
  assert.equal(pub.isFeatured, true)
  assert.equal(pub.featuredAnimation, 'sonar')
  passed('create featured product carries featuredAnimation=sonar in public DTO')

  // ── ۲) ساخت محصول ویژه بدون انتخاب ⇒ NULL = ارث از سراسری ──
  res = await adminReq('POST', '/products', { ...base('Featured Default'), isFeatured: true })
  body = await res.json() as { success: boolean; id?: string }
  const inheritId = body.id!
  pub = await (await publicReq(`/products/${inheritId}`)).json() as PubProduct
  assert.equal(pub.featuredAnimation, null)
  passed('featured product without explicit animation → null (inherit global)')

  // ── ۳) PATCH تغییر مقدار ⇒ همان لحظه در خواندنِ عمومی ──
  res = await adminReq('PATCH', `/products/${sonarId}`, { ...base('Featured Sonar'), isFeatured: true, featuredAnimation: 'sparks' })
  assert.equal(res.status, 200)
  assert.equal((await res.json() as { success: boolean }).success, true)
  pub = await (await publicReq(`/products/${sonarId}`)).json() as PubProduct
  assert.equal(pub.featuredAnimation, 'sparks')
  passed('PATCH featuredAnimation=sparks → public read-through')

  // ── ۴) PATCH با NULL ⇒ پاک‌سازی (بازگشت به ارث) ──
  res = await adminReq('PATCH', `/products/${sonarId}`, { ...base('Featured Sonar'), isFeatured: true, featuredAnimation: null })
  pub = await (await publicReq(`/products/${sonarId}`)).json() as PubProduct
  assert.equal(pub.featuredAnimation, null)
  passed('PATCH featuredAnimation=null → cleared (inherit)')

  // ── ۵) مقدار خارجِ اتحادیه ⇒ 422 (ذخیره نمی‌شود) ──
  res = await adminReq('POST', '/products', { ...base('Bad Anim'), isFeatured: true, featuredAnimation: 'neon' })
  assert.equal(res.status, 422)
  passed('invalid animation value → 422')
  res = await adminReq('PATCH', `/products/${sonarId}`, { ...base('Featured Sonar'), isFeatured: true, featuredAnimation: 'plasma' })
  assert.equal(res.status, 422)
  passed('invalid animation on PATCH → 422')

  // ── ۶) گارد ادمین۲: پرچم + انیمیشن هر دو از بدنه حذف می‌شوند ──
  //    (تغییر نام بی‌ربطِ ادمین۲ نباید انیمیشنِ ذخیره‌شده را بازنویسی کند)
  await adminReq('PATCH', `/products/${sonarId}`, { ...base('Featured Sonar'), isFeatured: true, featuredAnimation: 'sonar' })
  res = await adminReqAs('second', 'PATCH', `/products/${sonarId}`, { ...base('Renamed By Admin2'), isFeatured: false, featuredAnimation: 'sparks' })
  assert.equal(res.status, 200)
  assert.equal((await res.json() as { success: boolean }).success, true)
  pub = await (await publicReq(`/products/${sonarId}`)).json() as PubProduct
  assert.equal(pub.name, 'Renamed By Admin2', 'admin2 rename applied')
  assert.equal(pub.featuredAnimation, 'sonar', 'admin2 could NOT override animation')
  assert.equal(pub.isFeatured, true, 'admin2 could NOT unfreeze featured flag')
  passed('admin2 PATCH drops isFeatured + featuredAnimation (values untouched)')

  // ── ۷) ساختِ ادمین۲ ⇒ بدون انیمیشن (فیلد حذف می‌شود) ──
  res = await adminReqAs('second', 'POST', '/products', { ...base('Admin2 Product'), isFeatured: true, featuredAnimation: 'sparks' })
  body = await res.json() as { success: boolean; id?: string }
  assert.ok(body.success && body.id)
  pub = await (await publicReq(`/products/${body.id}`)).json() as PubProduct
  assert.equal(pub.isFeatured, false, 'admin2 create → not featured')
  assert.equal(pub.featuredAnimation, null, 'admin2 create → no animation')
  passed('admin2 create drops isFeatured + featuredAnimation')

  // ── ۸) فرم ویرایش: GET ادمین هم featuredAnimation را برمی‌گرداند ──
  const detail = await (await adminReq('GET', `/products/${sonarId}`)).json() as PubProduct
  assert.equal(detail.featuredAnimation, 'sonar')
  passed('admin edit-form details include featuredAnimation')

  // ── ۹) لیست عمومی منو هم ستون را می‌رساند (گرید/فرانت سبک) ──
  const list = await (await publicReq(`/mains/main/products`)).json() as { products: { id: string; featuredAnimation: string | null }[] }
  const inList = list.products.find((p) => p.id === sonarId)
  assert.ok(inList && inList.featuredAnimation === 'sonar')
  passed('public products list carries featuredAnimation')

  console.log(`\nfeatured-animation contract: ${count} passed, 0 failed`)
} catch (e) {
  if (validation(e)) {
    console.error('\nFAIL — unexpected VALIDATION_ERROR leaked as success path')
  }
  console.error('FAIL', e)
  process.exitCode = 1
} finally {
  globalThis.fetch = savedFetch
  try {
    await database?.close()
  } finally {
    try {
      await admin.unsafe(`drop database if exists "${scratch}"`)
    } finally {
      await admin.close()
    }
  }
}
