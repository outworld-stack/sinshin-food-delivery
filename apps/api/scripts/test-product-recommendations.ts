/** Recommendation read-path regressions; all writes use a unique local scratch database. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { SimilarProductsDto } from '@sinshin/shared'

import { MenuService, SIMILAR_EXCLUDE_LIMIT } from '../src/domain/menu/menu.service'
import { Database } from '../src/infra/db/client'
import { categories, mainCategories, products, productSimilarity } from '../src/infra/db/schema'
import { menuRoutes } from '../src/http/routes/menu.routes'
import type { RedisService } from '../src/infra/redis/redis'

const source = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_recommendations_test_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const testUrl = new URL(source)
testUrl.pathname = `/${scratch}`
const boot = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
let database: Database | undefined
let checks = 0
function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message)
  checks++
  console.log(`  ✓ ${message}`)
}

try {
  await boot.unsafe(`create database "${scratch}"`)
  const migration = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(migration.stdout).text(), new Response(migration.stderr).text(), migration.exited,
  ])
  assert.equal(exit, 0, `Scratch migrations failed:\n${stdout}\n${stderr}`)
  database = new Database(testUrl.toString(), { max: 4 })
  const db = database.db
  const cache = new Map<string, string>()
  const redis = {
    get: async (key: string) => cache.get(key) ?? null,
    getJson: async (key: string) => cache.has(key) ? JSON.parse(cache.get(key)!) : null,
    setJson: async (key: string, value: unknown) => { cache.set(key, JSON.stringify(value)) },
    incr: async (key: string) => {
      const next = Number(cache.get(key) ?? 0) + 1
      cache.set(key, String(next))
      return next
    },
  } as unknown as RedisService
  const menu = new MenuService({ db, redis })

  const [main, lockedMain] = await db.insert(mainCategories).values([
    { name: 'Main', slug: 'recommendation-main', isActive: true },
    { name: 'Locked main', slug: 'recommendation-locked-main', purchaseEnabled: false },
  ]).returning()
  const [anchorCat, candidateCat, lockedCat, lockedMainCat] = await db.insert(categories).values([
    { mainCategoryId: main!.id, name: 'Anchor', slug: 'recommendation-anchor' },
    { mainCategoryId: main!.id, name: 'Candidates', slug: 'recommendation-candidates' },
    { mainCategoryId: main!.id, name: 'Locked category', slug: 'recommendation-locked', purchaseEnabled: false },
    { mainCategoryId: lockedMain!.id, name: 'Locked parent', slug: 'recommendation-locked-parent' },
  ]).returning()
  const [anchor, viewOnly, excluded, soldOut, categoryLocked, mainLocked, inactive, a, b, c] = await db.insert(products).values([
    { categoryId: anchorCat!.id, name: 'Anchor', slug: 'recommendation-anchor-product' },
    { categoryId: candidateCat!.id, name: 'View only' },
    { categoryId: candidateCat!.id, name: 'Already in cart' },
    { categoryId: candidateCat!.id, name: 'Sold out', isAvailable: false },
    { categoryId: lockedCat!.id, name: 'Category locked' },
    { categoryId: lockedMainCat!.id, name: 'Parent locked' },
    { categoryId: candidateCat!.id, name: 'Inactive', status: 'INACTIVE' },
    { categoryId: candidateCat!.id, name: 'Complement A' },
    { categoryId: candidateCat!.id, name: 'Complement B' },
    { categoryId: candidateCat!.id, name: 'Complement C' },
  ]).returning()
  assert.ok(anchor && viewOnly && excluded && soldOut && categoryLocked && mainLocked && inactive && a && b && c)
  await db.insert(productSimilarity).values([
    [viewOnly, 0.99, 0], [excluded, 0.98, 0.95], [soldOut, 0.9, 0.94],
    [categoryLocked, 0.85, 0.93], [mainLocked, 0.8, 0.92], [inactive, 0.79, 0.91],
    [a, 0.1, 0.8], [b, 0.2, 0.7], [c, 0.3, 0.6],
  ].map(([product, score, purchaseScore]) => ({
    productId: anchor.id,
    similarId: (product as typeof a).id,
    score: score as number,
    purchaseScore: purchaseScore as number,
  })))

  const detail = await menu.similarProducts(anchor.id)
  check(detail?.strict === false && detail.products[0]?.id === viewOnly.id,
    'detail uses mixed scores and retains view-only recommendations')
  check(detail.products.length === 8 && !detail.products.some((p) => p.id === inactive.id),
    'detail applies active-product filtering before the eight-card limit')
  check(detail.products.some((p) => p.id === soldOut.id),
    'buyable detail anchor preserves the existing unavailable-card behavior')

  const cartOptions = { context: 'cart' as const, exclude: [excluded.id, anchor.id, excluded.id] }
  const cart = await menu.similarProducts(anchor.id, 'fa', undefined, cartOptions)
  check(cart?.strict === true && cart.products.map((p) => p.id).join() === [a.id, b.id, c.id].join(),
    'cart uses purchase scores and removes basket items, view-only, unavailable, locked and inactive candidates')
  check(cart.products.every((p) => p.isAvailable && p.purchasable), 'every cart recommendation is buyable')
  check((await menu.similarProducts(anchor.id, 'fa', 1, cartOptions))?.products[0]?.id === a.id,
    'all cart eligibility filters run before LIMIT, including existing cart products')

  const cacheSize = cache.size
  await db.update(productSimilarity).set({ purchaseScore: 0.01 }).where(and(
    eq(productSimilarity.productId, anchor.id), eq(productSimilarity.similarId, a.id),
  ))
  const reordered = await menu.similarProducts(anchor.id, 'fa', undefined, {
    context: 'cart', exclude: [anchor.id, excluded.id],
  })
  check(cache.size === cacheSize && reordered?.products[0]?.id === a.id,
    'reordered and duplicate exclusions share the same cached response')
  check((await menu.similarProducts(anchor.id, 'fa', 1, { context: 'cart' }))?.products[0]?.id === excluded.id,
    'different cart exclusions have independent cache entries')
  await menu.bustCache()
  check((await menu.similarProducts(anchor.id, 'fa', 1, cartOptions))?.products[0]?.id === b.id,
    'menu invalidation refreshes contextual recommendation scores')

  await db.update(categories).set({ purchaseEnabled: false }).where(eq(categories.id, anchorCat!.id))
  await menu.bustCache()
  const lockedDetail = await menu.similarProducts(anchor.id)
  check(lockedDetail?.strict === true && lockedDetail.products.length > 0 &&
    lockedDetail.products.every((p) => p.isAvailable && p.purchasable),
    'purchase-locked anchor category activates strict buyable alternatives')
  await db.update(categories).set({ purchaseEnabled: true }).where(eq(categories.id, anchorCat!.id))
  await db.update(categories).set({ mainCategoryId: lockedMain!.id }).where(eq(categories.id, anchorCat!.id))
  await menu.bustCache()
  check((await menu.similarProducts(anchor.id))?.strict === true,
    'purchase-locked anchor main category also activates strict alternatives')

  const app = new Elysia().use(menuRoutes({ menu, redis, cart: {} as never,
    settings: {} as never, stats: {} as never })).compile()
  const get = (query = '', headers: Record<string, string> = {}) => app.handle(new Request(
    `http://localhost/menu/products/recommendation-anchor-product/similar${query}`, { headers },
  ))
  const query = `?context=cart&exclude=${excluded.id},${anchor.id}`
  const response = await get(query)
  const body = await response.json() as SimilarProductsDto
  check(response.status === 200 && body.strict && body.products[0]?.id === b.id,
    'HTTP cart context and exclusions reach the service for slug anchors')
  check(response.headers.get('cache-control') === 'public, no-cache', 'cart responses require HTTP revalidation')
  const etag = response.headers.get('etag')!
  check((await get(query, { 'if-none-match': etag })).status === 304,
    'cart recommendations retain ETag conditional responses')
  check((await get('?context=invalid')).status === 422, 'unknown recommendation context is rejected')
  check((await get('?context=cart&exclude=not-a-uuid')).status === 422, 'invalid exclusions are rejected before SQL')
  check((await get(`?context=cart&exclude=${Array(SIMILAR_EXCLUDE_LIMIT + 1).fill(a.id).join(',')}`)).status === 422,
    'exclusion count is bounded even for duplicate UUIDs')
  check((await get(`?context=cart&exclude=${Array(SIMILAR_EXCLUDE_LIMIT).fill(a.id).join(',')}`)).status === 200,
    'maximum supported exclusion count is accepted')
  await assert.rejects(menu.similarProducts(anchor.id, 'fa', 8, { exclude: ['invalid'] }),
    (error: any) => error.code === 'VALIDATION_ERROR')
  checks++
  check((await menu.similarProducts(crypto.randomUUID(), 'fa', 8, cartOptions)) === null,
    'missing cart anchor returns null without invented fallback candidates')

  console.log(`\nProduct recommendations: ${checks} passed`)
} finally {
  if (database) await database.close().catch(() => undefined)
  try { await boot.unsafe(`drop database if exists "${scratch}" with (force)`) } catch { /* best-effort scratch cleanup */ }
  await boot.close({ timeout: 5 })
}
