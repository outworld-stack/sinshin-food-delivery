/** Wallet/referral integration and 0012 upgrade regression in local scratch PostgreSQL.
 * Settings, delivery zones, coupons, checkout and settlement use their real services.
 * No payment gateway, notification transport or existing database is modified. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database, type Db, type DbOrTx } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { OrderService } from '../src/domain/order/order.service'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { DeliveryZoneService } from '../src/domain/delivery/delivery-zone.service'
import { lockWalletAccounts } from '../src/domain/shared/wallet-sql'
import { isUniqueViolation } from '../src/domain/shared/pg'
import {
  addresses, categories, coupons, deliveryZones, mainCategories, orders, payments, products,
  referralProfits, settings, SETTING_KEYS, users, walletTransactions,
} from '../src/infra/db/schema'
import type { CheckoutInput } from '@sinshin/shared'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_wallet_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let singleDatabase: Database | undefined
let count = 0
function passed(name: string) { count++; console.log(`PASS ${name}`) }
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
async function deadline<T>(promise: Promise<T>, label: string, milliseconds = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
const savedFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in wallet safety test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'wallet-safety-test-'.repeat(3), SITE_URL: 'https://sinshin.example', REFERRAL_PERCENT: '10',
  })
  const services = (database: Db) => {
    const settingService = new SettingsService({ db: database, config })
    const zones = new DeliveryZoneService({ db: database, settings: settingService, neshan: {
      distanceMatrix: async () => [[{ status: 'Ok', distanceMeters: 1000, durationSeconds: 60 }]],
    } })
    const orderService = new OrderService({
      db: database, config, settings: settingService, zones, coupons: new CouponService({ db: database }),
      notifications: { notifyUser: async () => undefined } as never,
    })
    return { settings: settingService, zones, orders: orderService }
  }
  const main = services(db)
  let userNumber = 0
  const makeUser = async (referredBy?: string) => (await db.insert(users)
    .values({ phone: `0914${String(++userNumber).padStart(7, '0')}`, referredBy }).returning())[0]!
  const fund = async (userId: string, amount: number) => db.insert(walletTransactions)
    .values({ userId, amount, type: 'DEPOSIT', description: 'Regression funding' })
  const balance = (userId: string) => main.orders.walletBalance(db, userId)
  const getOrder = async (displayId: string, connection: DbOrTx = db) =>
    (await connection.select().from(orders).where(eq(orders.displayId, displayId)))[0]!
  const getProfit = async (orderId: typeof orders.$inferSelect.id) =>
    (await db.select().from(referralProfits).where(eq(referralProfits.orderId, orderId)))[0]
  const settle = async (displayId: string, service = main.orders, connection: Db = db) => connection.transaction(async (tx) => {
    const row = await getOrder(displayId, tx)
    await service.settlePayment(tx, row)
    await tx.update(payments).set({ status: 'SUCCESS', verifiedAt: new Date(), updatedAt: new Date() }).where(eq(payments.orderId, row.id))
  })
  const buyerCredits = (orderId: typeof orders.$inferSelect.id) => db.select().from(walletTransactions).where(and(
    eq(walletTransactions.orderId, orderId), eq(walletTransactions.type, 'DEPOSIT'), isNull(walletTransactions.referralProfitId),
  ))
  const [mainCategory] = await db.insert(mainCategories).values({ name: 'Main', slug: 'wallet-main', isActive: true }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: mainCategory!.id, name: 'Meals', slug: 'wallet-meals' }).returning()
  const [product] = await db.insert(products).values({
    categoryId: category!.id, name: 'Wallet meal', originalPrice: 100_000, packagingCost: 5_000, status: 'ACTIVE',
  }).returning()
  const dineIn: CheckoutInput = { items: [{ productId: product!.id, quantity: 1 }], deliveryType: 'DINE_IN', useWallet: true, gatewayId: 'ZARINPAL' }
  await db.insert(settings).values([
    { key: SETTING_KEYS.liveTrackingEnabled, value: true },
    { key: SETTING_KEYS.restaurantOpen, value: false },
    { key: SETTING_KEYS.restaurantLocation, value: { lat: 35.7, lng: 51.4 } },
  ])
  await db.insert(deliveryZones).values([{ radiusKm: 2, fee: 20_000 }, { radiusKm: 10, fee: 40_000 }])
  const deliveryInput = async (userId: string): Promise<CheckoutInput> => {
    const [address] = await db.insert(addresses).values({ userId, title: 'Home', address: 'Local regression address', lat: 35.7, lng: 51.4 }).returning()
    return { ...dineIn, deliveryType: 'DELIVERY', addressId: address!.id }
  }

  // Recreate the exact old index layout before 0012. The paid and already-refunded
  // rows reproduce the old collision without applying automatic monetary repair.
  await db.execute(sql`drop index wallet_tx_referral_credit_once_key`)
  await db.execute(sql`drop index wallet_tx_refund_once_key`)
  await db.execute(sql`create unique index wallet_tx_refund_once_key on wallet_transactions(order_id) where type = 'DEPOSIT' and order_id is not null`)
  const legacyReferrer = await makeUser(), legacyBuyer = await makeUser(legacyReferrer.id)
  const legacyOrder = await main.orders.checkout(legacyBuyer.id, dineIn)
  await settle(legacyOrder.displayId)
  const legacyRow = await getOrder(legacyOrder.displayId)
  const legacyProfit = (await getProfit(legacyRow.id))!
  await assert.rejects(() => db.insert(walletTransactions).values({
    userId: legacyBuyer.id, type: 'DEPOSIT', amount: 100_000, description: 'Old refund collision', orderId: legacyRow.id,
  }), isUniqueViolation)
  await db.update(orders).set({ status: 'CANCELED', paymentStatus: 'REFUNDED' }).where(eq(orders.id, legacyRow.id))
  await db.insert(walletTransactions).values({
    userId: legacyReferrer.id, type: 'WITHDRAW', amount: legacyProfit.amount, description: 'Legacy reward reversal', referralProfitId: legacyProfit.id,
  })
  const beforeUpgrade = await db.select().from(walletTransactions)
  const migration = await Bun.file(import.meta.dir + '/../drizzle/0012_open_mandrill.sql').text()
  await db.transaction(async (tx) => {
    for (const statement of migration.split('--> statement-breakpoint').filter((part) => part.trim())) await tx.execute(sql.raw(statement))
  })
  assert.deepEqual(await db.select().from(walletTransactions), beforeUpgrade)
  assert.equal(await balance(legacyBuyer.id), 0)
  assert.equal((await buyerCredits(legacyRow.id)).length, 0)
  await assert.rejects(() => db.insert(walletTransactions).values({
    userId: legacyReferrer.id, type: 'DEPOSIT', amount: legacyProfit.amount, description: 'Duplicate reward with no order', referralProfitId: legacyProfit.id,
  }), isUniqueViolation)
  await db.insert(walletTransactions).values({ userId: legacyBuyer.id, type: 'DEPOSIT', amount: 100_000, description: 'Explicit reviewed repair fixture', orderId: legacyRow.id })
  assert.equal((await buyerCredits(legacyRow.id)).length, 1)
  passed('0012 upgrades legacy reward/refund indexes without rewriting history or silently crediting users')

  for (const funding of [0, 40_000]) {
    const referrer = await makeUser(), buyer = await makeUser(referrer.id)
    if (funding) await fund(buyer.id, funding)
    const input = await deliveryInput(buyer.id)
    const checkout = await main.orders.checkout(buyer.id, input)
    assert.equal(checkout.breakdown.totalAmount, 125_000)
    assert.equal(checkout.breakdown.walletDeduction, funding)
    assert.equal(checkout.amountPaidOnline, 125_000 - funding)
    await Promise.all([settle(checkout.displayId), settle(checkout.displayId)])
    const row = await getOrder(checkout.displayId)
    const profit = (await getProfit(row.id))!
    assert.equal(profit.baseAmount, 100_000 - funding)
    assert.equal(profit.amount, (100_000 - funding) / 10)
    assert.equal(await balance(referrer.id), profit.amount)
    await assert.rejects(() => db.insert(walletTransactions).values({
      userId: referrer.id, type: 'DEPOSIT', amount: profit.amount, description: 'Duplicate referral', referralProfitId: profit.id,
    }), isUniqueViolation)
    const refunds = await Promise.allSettled([1, 2].map(() => main.orders.refund(checkout.displayId, 'Wallet regression refund')))
    assert.equal(refunds.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await buyerCredits(row.id))[0]!.amount, 125_000)
    assert.equal(await balance(buyer.id), 125_000)
    assert.equal(await balance(referrer.id), 0)
    assert.equal((await db.select().from(walletTransactions).where(eq(walletTransactions.referralProfitId, profit.id))).length, 2)
    passed(`${funding ? 'mixed-wallet' : 'online'} referred delivery refunds full buyer amount and reverses the reward exactly once`)
  }

  const discountReferrer = await makeUser(), discountBuyer = await makeUser(discountReferrer.id)
  await fund(discountBuyer.id, 30_000)
  const [coupon] = await db.insert(coupons).values({ code: 'WALLET25', discountPercentage: 25, isPublic: true, startsAt: new Date(Date.now() - 1000) }).returning()
  const discounted = await main.orders.checkout(discountBuyer.id, { ...await deliveryInput(discountBuyer.id), couponCode: coupon!.code })
  await settle(discounted.displayId)
  const discountedProfit = (await getProfit((await getOrder(discounted.displayId)).id))!
  assert.equal(discounted.breakdown.totalAmount, 100_000)
  assert.equal(discounted.amountPaidOnline, 70_000)
  assert.equal(discountedProfit.baseAmount, 45_000)
  assert.equal(discountedProfit.amount, 4_500)
  passed('reward base excludes coupon savings, wallet funding, delivery and packaging')

  const conflictReferrer = await makeUser(), conflictBuyer = await makeUser(conflictReferrer.id)
  const conflictOrder = await main.orders.checkout(conflictBuyer.id, dineIn)
  await settle(conflictOrder.displayId)
  const conflictRow = await getOrder(conflictOrder.displayId)
  await db.insert(walletTransactions).values({ userId: conflictBuyer.id, type: 'DEPOSIT', amount: 1, description: 'Inconsistent historical buyer credit', orderId: conflictRow.id })
  await assert.rejects(() => main.orders.refund(conflictOrder.displayId, 'Must roll back on ledger conflict'), isUniqueViolation)
  assert.equal((await getOrder(conflictOrder.displayId)).paymentStatus, 'SUCCESS')
  assert.equal(await balance(conflictBuyer.id), 1)
  assert.equal(await balance(conflictReferrer.id), 10_000)
  passed('unexpected buyer-credit conflict rolls refund back instead of committing an unpaid refund')

  const waitForAdvisoryWaiters = async (minimum: number) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock%'`)
      if (Number((rows[0] as { n: number }).n) >= minimum) return
      await Bun.sleep(10)
    }
    assert.fail(`Expected ${minimum} money transactions waiting on advisory locks`)
  }
  const spendingReferrer = await makeUser(), spendingBuyer = await makeUser(spendingReferrer.id)
  const sourceOrder = await main.orders.checkout(spendingBuyer.id, dineIn)
  await settle(sourceOrder.displayId)
  const checkoutEntered = gate(), resumeCheckout = gate()
  const originalTracking = main.settings.liveTrackingEnabled.bind(main.settings)
  main.settings.liveTrackingEnabled = async (tx) => {
    const enabled = await originalTracking(tx)
    checkoutEntered.release()
    await resumeCheckout.promise
    return enabled
  }
  const spending = main.orders.checkout(spendingReferrer.id, dineIn)
  await deadline(checkoutEntered.promise, 'Checkout barrier')
  const reversing = main.orders.refund(sourceOrder.displayId, 'Reward already being spent')
  try {
    await waitForAdvisoryWaiters(1)
    assert.equal(await balance(spendingReferrer.id), 10_000)
  } finally {
    resumeCheckout.release()
    main.settings.liveTrackingEnabled = originalTracking
  }
  const [spent] = await deadline(Promise.all([spending, reversing]), 'Concurrent spending and refund')
  assert.equal(spent.breakdown.walletDeduction, 10_000)
  assert.equal(await balance(spendingReferrer.id), -10_000)
  assert.equal(await balance(spendingBuyer.id), 100_000)
  const indebted = await main.orders.checkout(spendingReferrer.id, dineIn)
  assert.equal(indebted.breakdown.walletDeduction, 0)
  assert.equal(indebted.amountPaidOnline, 100_000)
  passed('reward reversal waits for active spending; spent rewards become debt and cannot inflate the next bank charge')

  // Legacy reciprocal links are possible in existing data. Both buyers hold a
  // user row lock before settlement, forcing concurrent cross-user FK checks.
  const reciprocalA = await makeUser(), reciprocalB = await makeUser(reciprocalA.id)
  await db.update(users).set({ referredBy: reciprocalB.id }).where(eq(users.id, reciprocalA.id))
  const orderA = await main.orders.checkout(reciprocalA.id, dineIn), orderB = await main.orders.checkout(reciprocalB.id, dineIn)
  const bothLocked = gate()
  let locked = 0
  const settleReciprocal = (displayId: string) => db.transaction(async (tx) => {
    const row = await getOrder(displayId, tx)
    await lockWalletAccounts(tx, [row.userId])
    await tx.select().from(users).where(eq(users.id, row.userId)).for('no key update')
    if (++locked === 2) bothLocked.release()
    await bothLocked.promise
    await main.orders.settlePayment(tx, row)
    await tx.update(payments).set({ status: 'SUCCESS', verifiedAt: new Date() }).where(eq(payments.orderId, row.id))
  })
  await deadline(Promise.all([settleReciprocal(orderA.displayId), settleReciprocal(orderB.displayId)]), 'Reciprocal reward settlement')
  assert.equal(await balance(reciprocalA.id), 10_000)
  assert.equal(await balance(reciprocalB.id), 10_000)
  passed('reciprocal historical referrals settle concurrently without foreign-key lock deadlocks')

  const refundBlockerReady = gate(), releaseRefundBlocker = gate()
  const blocker = db.transaction(async (tx) => {
    await lockWalletAccounts(tx, [reciprocalB.id, reciprocalA.id])
    refundBlockerReady.release()
    await releaseRefundBlocker.promise
  })
  await refundBlockerReady.promise
  const refundPair = Promise.all([
    main.orders.refund(orderA.displayId, 'Concurrent reciprocal refund A'),
    main.orders.refund(orderB.displayId, 'Concurrent reciprocal refund B'),
  ])
  try { await waitForAdvisoryWaiters(2) } finally { releaseRefundBlocker.release() }
  await deadline(Promise.all([blocker, refundPair]), 'Reciprocal refunds')
  assert.equal(await balance(reciprocalA.id), 100_000)
  assert.equal(await balance(reciprocalB.id), 100_000)
  passed('refunds with opposite buyer/referrer directions acquire wallet accounts in a shared order')

  const self = await makeUser()
  await db.update(users).set({ referredBy: self.id }).where(eq(users.id, self.id))
  const selfOrder = await main.orders.checkout(self.id, dineIn)
  await settle(selfOrder.displayId)
  assert.equal(await getProfit((await getOrder(selfOrder.displayId)).id), undefined)
  assert.equal(await balance(self.id), 0)
  passed('legacy self-referral data never issues a reward to the buyer')

  singleDatabase = new Database(scratchUrl.toString(), { max: 1 })
  const singleDb = singleDatabase.db
  const allWalletReferrer = await makeUser(), allWalletBuyer = await makeUser(allWalletReferrer.id)
  await fund(allWalletBuyer.id, 100_000)
  const coldWallet = services(singleDb)
  const instant = await deadline(coldWallet.orders.checkout(allWalletBuyer.id, dineIn), 'Cold single-connection wallet checkout')
  assert.equal(instant.requiresPayment, false)
  const instantRow = await getOrder(instant.displayId)
  assert.equal(instantRow.paymentStatus, 'SUCCESS')
  assert(instantRow.queuedAt)
  assert.equal(await getProfit(instantRow.id), undefined)
  const coldDelivery = services(singleDb), deliveryBuyer = await makeUser()
  const delivery = await deadline(coldDelivery.orders.checkout(deliveryBuyer.id, await deliveryInput(deliveryBuyer.id)), 'Cold single-connection delivery checkout')
  assert.equal(delivery.breakdown.deliveryFee, 20_000)
  assert.equal(delivery.breakdown.packagingFee, 5_000)
  assert.equal(delivery.amountPaidOnline, 125_000)
  assert.equal((await getOrder(delivery.displayId)).trackingEnabled, true)
  await deadline(settle(delivery.displayId, coldDelivery.orders, singleDb), 'Cold single-connection settlement')
  assert((await getOrder(delivery.displayId)).queuedAt)
  passed('cold single-connection checkout and settlement use real settings, delivery zones and coupon services')

  console.log(`Wallet safety: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await singleDatabase?.close()
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
