/** Real PostgreSQL; isolated database, no messages or payments. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { assertFutureCouponExpiry } from '../src/domain/coupon/coupon-validation'
import { evaluateCondition } from '../src/domain/coupon/coupon-evaluators'
import { AppError } from '../src/domain/shared/errors'
import { couponConditions, couponGrants, couponNudges, coupons, users } from '../src/infra/db/schema'
import { asCampaignId } from '../src/domain/shared/brand'

const source = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
const admin = new URL(source)
admin.pathname = '/postgres'
const scratch = `sinshin_e2e_coupon_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const boot = new SQL(admin.toString(), { max: 1 })
let database: Database | undefined
let created = false
let count = 0
const check = (name: string, condition: unknown) => {
  assert.ok(condition, name)
  count++
  console.log(`  ✓ ${name}`)
}
const validation = (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR'
try {
  await boot.unsafe(`create database "${scratch}"`)
  created = true
  source.pathname = `/${scratch}`
  database = new Database(source.toString(), { max: 4 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const service = new CouponService({ db })
  const base = { code: 'TEST20', discountPercentage: 20, maxUses: 0, maxPerUser: 0,
    isPublic: true, expiryDate: null, rules: [] }
  const rejected = async (name: string, input: Parameters<CouponService['create']>[0]) => {
    await assert.rejects(service.create(input), validation)
    check(name, true)
  }
  await rejected('fractional discount rejected before integer-column write', { ...base, discountPercentage: 20.5 })
  await rejected('fractional total capacity rejected', { ...base, maxUses: 1.5 })
  await rejected('nonfinite per-user capacity rejected', { ...base, maxPerUser: Infinity })
  await rejected('overlong code rejected instead of silently shortened', { ...base, code: 'A'.repeat(17) })
  await rejected('unknown rule rejected', { ...base, isPublic: false, rules: [{ type: 'UNKNOWN', params: {} }] })
  await rejected('negative threshold cannot grant everyone a coupon', { ...base, isPublic: false,
    rules: [{ type: 'MIN_ORDERS_COUNT', params: { count: -1 } }] })
  await rejected('NaN rule does not silently become threshold one', { ...base, isPublic: false,
    rules: [{ type: 'MIN_TOTAL_SPEND', params: { amount: NaN } }] })
  await rejected('invalid product ID rejected', { ...base, isPublic: false,
    rules: [{ type: 'MIN_PRODUCT_ORDERS', params: { productId: 'bad', count: 0 } }] })
  await rejected('fractional time window rejected', { ...base, isPublic: false,
    rules: [{ type: 'ORDERS_IN_LAST_DAYS', params: { days: 1.5, count: 1 } }] })
  await rejected('expiry earlier today rejected', { ...base, expiryDate: new Date(Date.now() - 1000).toISOString() })
  assertFutureCouponExpiry('2026-10-17T00:30:00+03:30', new Date('2026-10-17T00:15:00+03:30').getTime())
  check('future Tehran time remains valid across UTC date boundary', true)

  const made = await service.create({ ...base, code: '  Test۲۰  ' })
  const id = asCampaignId(made.id!)
  check('admin codes normalize Persian digits and case', (await service.get(id)).coupon.code === 'TEST20')
  const [user] = await db.insert(users).values({ phone: '09124440001', role: 'user' }).returning()
  assert.ok(user)
  check('Arabic and Persian keypad codes redeem the same campaign',
    (await service.findUsableCoupon(db, user.id, 'test٢٠')).ok &&
    (await service.findUsableCoupon(db, user.id, 'TEST۲۰')).ok)
  const [legacyCode] = await db.insert(coupons).values({ code: 'LEGACY۲۰', discountPercentage: 10, isPublic: true }).returning()
  check('historical Persian-digit codes remain redeemable', (await service.findUsableCoupon(db, user.id, 'legacy20')).ok)
  await assert.rejects(service.create({ ...base, code: 'LEGACY20' }),
    e => e instanceof AppError && e.code === 'CONFLICT')
  check('creating a normalized alias cannot shadow a legacy campaign', true)
  await assert.rejects(service.update(id, { ...base, code: 'LEGACY20' }),
    e => e instanceof AppError && e.code === 'CONFLICT')
  check('renaming cannot shadow a legacy campaign or mutate the original', (await service.get(id)).coupon.code === 'TEST20')
  await service.update(legacyCode!.id, { ...base, code: 'LEGACY20', discountPercentage: 10 })
  const normalizedLegacy = await service.findUsableCoupon(db, user.id, 'LEGACY۲۰')
  check('canonicalizing a legacy campaign preserves its identity', normalizedLegacy.ok && normalizedLegacy.coupon.id === legacyCode!.id)
  await db.insert(coupons).values([
    { code: 'AMBIG۲۰', discountPercentage: 10, isPublic: true },
    { code: 'AMBIG٢٠', discountPercentage: 10, isPublic: true },
  ])
  check('ambiguous historical aliases never choose an arbitrary campaign', !(await service.findUsableCoupon(db, user.id, 'AMBIG20')).ok)
  await db.insert(coupons).values({ code: 'AMBIG20', discountPercentage: 30, isPublic: true })
  check('an exact normalized match does not bypass legacy ambiguity',
    !(await service.findUsableCoupon(db, user.id, 'AMBIG20')).ok &&
    !(await service.findUsableCoupon(db, user.id, 'AMBIG۲۰')).ok)
  const racingCodes = await Promise.allSettled([
    service.create({ ...base, code: 'RACE۲۰' }),
    service.create({ ...base, code: 'RACE20' }),
  ])
  check('concurrent equivalent creations admit exactly one campaign and report a conflict',
    racingCodes.filter(result => result.status === 'fulfilled').length === 1 &&
    racingCodes.filter(result => result.status === 'rejected' && result.reason instanceof AppError && result.reason.code === 'CONFLICT').length === 1)

  await assert.rejects(service.update(id, { ...base, discountPercentage: 12.5 }), validation)
  check('rejected update preserves original discount', (await service.get(id)).coupon.discountPercentage === 20)
  const privateUpdate = { ...base, isPublic: false, discountPercentage: 30,
    rules: [{ type: 'MIN_ORDERS_COUNT', params: { count: 1 } }] }
  await db.update(coupons).set({ usedCount: 1 }).where(eq(coupons.id, id))
  await assert.rejects(service.update(id, privateUpdate),
    e => e instanceof AppError && e.code === 'CONFLICT')
  const guarded = (await service.get(id)).coupon
  check('reserved coupon cannot switch visibility or partially mutate configuration',
    guarded.isPublic && guarded.discountPercentage === 20)
  await db.update(coupons).set({ usedCount: 0 }).where(eq(coupons.id, id))
  await service.update(id, privateUpdate)
  check('unused coupon can switch to private once reservations are released',
    !(await service.get(id)).coupon.isPublic)
  await db.update(coupons).set({ usedCount: 1 }).where(eq(coupons.id, id))
  await assert.rejects(service.update(id, base),
    e => e instanceof AppError && e.code === 'CONFLICT')
  check('private redeemed coupon cannot switch to public', !(await service.get(id)).coupon.isPublic)
  await db.update(coupons).set({ usedCount: 0 }).where(eq(coupons.id, id))
  await service.update(id, base)
  let waiting: Promise<unknown> | undefined
  await db.transaction(async tx => {
    await tx.select().from(coupons).where(eq(coupons.id, id)).for('update')
    waiting = db.transaction(inner => service.findUsableCoupon(inner, user.id, 'TEST20', { forUpdate: true }))
    await tx.execute(sql`select pg_sleep(0.05)`)
    await tx.update(coupons).set({ isActive: false }).where(eq(coupons.id, id))
  })
  check('checkout sees a deactivation committed while waiting for the coupon lock',
    (await waiting as { ok: boolean }).ok === false)
  await service.setActive(id, true)
  check('unexpired campaign can be reactivated', (await service.get(id)).coupon.isActive)

  const zero = await service.create({ ...base, code: 'ZERO', isPublic: false,
    rules: [{ type: 'MIN_PRODUCT_ORDERS', params: { productId: crypto.randomUUID(), count: 0 } }] })
  await service.grantIfEligibleAfterCommit(user.id)
  check('explicit zero-purchase rule still grants without prior purchases',
    Boolean(await db.query.couponGrants.findFirst({ where: eq(couponGrants.couponId, asCampaignId(zero.id!)) })))
  const [legacyBad] = await db.insert(coupons).values({ code: 'BADLEGACY', discountPercentage: 10, isPublic: false }).returning()
  await db.insert(couponConditions).values({ couponId: legacyBad!.id, type: 'MIN_ORDERS_COUNT', params: { count: -1 } })
  await service.grantIfEligibleAfterCommit(user.id)
  check('invalid legacy threshold is ineligible instead of granting everyone',
    !(await db.query.couponGrants.findFirst({ where: eq(couponGrants.couponId, legacyBad!.id) })))

  await db.update(users).set({ createdAt: new Date(Date.now() - 1.8 * 86_400_000) }).where(eq(users.id, user.id))
  const age = evaluateCondition({ db, userId: user.id, now: new Date() }, 'REGISTERED_DAYS_AGO', { days: 3 })
  const [progress] = await db.select({ days: age.current }).from(sql`users u`).where(sql`u.id = ${user.id}::uuid`)
  check('registration age counts completed days without rounding up', Number(progress?.days) === 1)

  const big = await service.create({ ...base, code: 'BIGSPEND', isPublic: false,
    rules: [{ type: 'MIN_TOTAL_SPEND', params: { amount: 5_000_000_000 } }] })
  const candidates = await service.findNudgeCandidates(asCampaignId(big.id!))
  const candidate = candidates.find(row => row.userId === user.id)
  assert.ok(candidate)
  await db.insert(couponNudges).values({ userId: user.id, couponId: asCampaignId(big.id!),
    missingConditionId: candidate.missingConditionId as never,
    remainingCount: candidate.remainingCount, scanDate: '2026-10-17' })
  const [nudge] = await db.select().from(couponNudges).where(eq(couponNudges.couponId, asCampaignId(big.id!)))
  check('large spending remainder survives database round-trip without integer overflow', nudge?.remainingCount === 5_000_000_000)
  console.log(`\nCoupon policy: ${count} checks passed`)
} finally {
  await database?.close()
  if (created) await boot.unsafe(`drop database "${scratch}" with (force)`)
  await boot.close({ timeout: 5 })
}
