/** Real PostgreSQL transactions in a new local scratch database. No gateways,
 * notifications, production database writes, or external requests are used. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { OrderService } from '../src/domain/order/order.service'
import { CheckoutIdempotency, checkoutRequestHash } from '../src/domain/order/checkout-idempotency.service'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import { signState } from '../src/domain/payment/state'
import { asPaymentId } from '../src/domain/shared/brand'
import type { PaymentGateway } from '../src/domain/payment/gateway.types'
import type { CheckoutInput } from '@sinshin/shared'
import {
  categories, checkoutIdempotency, coupons, mainCategories, orderItems, orders,
  payments, products, users, walletTransactions,
} from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_order_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let count = 0
function passed(name: string) { count++; console.log(`PASS ${name}`) }
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const savedFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in order safety test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'order-safety-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
  })
  const couponService = new CouponService({ db })
  let trackingHook = async () => false
  const orderService = new OrderService({
    db, config, coupons: couponService,
    // ترمیم استیج-۸۶ (میراثِ ۸۴): isBusy/enabledGateways از stage-84 به
    // order.service آمده بود ولی استابِ این تست به‌روز نشده بود (تست از
    // آن موقع در دروازه‌ها اجرا نمی‌شد) — حالا دوباره سبز و بخشِ دروازه.
    settings: {
      liveTrackingEnabled: () => trackingHook(),
      restaurantStatus: async () => ({ anyClosed: false }),
      isBusy: async () => false,
      enabledGateways: async () => ({ mellat: false, zarinpal: true, sep: false }),
    } as never,
    zones: { feeFor: async () => 10_000 } as never,
    notifications: { notifyUser: async () => undefined } as never,
  })
  const idem = new CheckoutIdempotency({ db })
  const paymentService = new PaymentService({
    db, config, orders: orderService, hub: { publish: () => undefined } as never,
    notifications: { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never,
  })
  let initCalls = 0
  let initHook: () => Promise<void> = async () => undefined
  let verdict: 'failed' | 'indeterminate' | 'success' = 'failed'
  let verifyHook: () => Promise<void> = async () => undefined
  const gateway: PaymentGateway = {
    resumeUrl: input => typeof input.paymentUrl === 'string' ? input.paymentUrl : null,
    id: 'ZARINPAL', mode: 'direct',
    init: async (input) => {
      initCalls++
      await initHook()
      return { gatewayRef: `test-${input.paymentId}`, paymentUrl: `https://example.test/pay/${input.paymentId}` }
    },
    verify: async (input) => {
      await verifyHook()
      return { success: verdict === 'success', indeterminate: verdict === 'indeterminate', gatewayRef: input.gatewayRef }
    },
  }
  ;(paymentService as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('ZARINPAL', gateway)
  let userNumber = 0
  const makeUser = async () => (await db.insert(users).values({ phone: `0915${String(++userNumber).padStart(7, '0')}` }).returning())[0]!
  const [main] = await db.insert(mainCategories).values({ name: 'Main', slug: 'main', isActive: true }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Food', slug: 'food' }).returning()
  const [product] = await db.insert(products).values({ categoryId: category!.id, name: 'Meal', originalPrice: 100_000, status: 'ACTIVE' }).returning()
  const input: CheckoutInput = { items: [{ productId: product!.id, quantity: 1 }], deliveryType: 'DINE_IN', useWallet: true, gatewayId: 'ZARINPAL' }
  const makeCoupon = async (code: string, maxUses = 0, maxPerUser = 0) => (await db.insert(coupons)
    .values({ code, discountPercentage: 10, isPublic: true, maxUses, maxPerUser, startsAt: new Date(Date.now() - 1000) }).returning())[0]!
  const getOrder = async (displayId: string) => (await db.select().from(orders).where(eq(orders.displayId, displayId)))[0]!
  const paymentRows = async (orderId: typeof orders.$inferSelect.id) => db.select().from(payments).where(eq(payments.orderId, orderId))
  const claimFor = async (uid: string, key: string, body = input) => {
    const result = await idem.claim(uid, key, checkoutRequestHash(body))
    assert.equal(result.kind, 'claimed')
    if (result.kind !== 'claimed') throw new Error('Claim expected')
    return { key, token: result.token }
  }

  const buyer = await makeUser()
  await db.insert(walletTransactions).values({ userId: buyer.id, type: 'DEPOSIT', amount: 500_000, description: 'Test funding' })
  const owned = await claimFor(buyer.id, 'durable-claim')
  const paid = await orderService.checkout(buyer.id, input, owned)
  assert.equal(paid.requiresPayment, false)
  await db.update(checkoutIdempotency).set({ claimedAt: new Date(0) }).where(eq(checkoutIdempotency.key, owned.key))
  const replay = await idem.claim(buyer.id, owned.key, checkoutRequestHash(input))
  assert.equal(replay.kind, 'replay')
  assert.equal(replay.kind === 'replay' && replay.response.orderId, paid.displayId)
  await idem.release(buyer.id, owned)
  assert.equal((await idem.claim(buyer.id, owned.key, checkoutRequestHash(input))).kind, 'replay')
  await assert.rejects(() => orderService.checkout(buyer.id, input, owned))
  assert.equal(await orderService.walletBalance(db, buyer.id), 400_000)
  passed('committed wallet order survives lost completion and repeated release/checkout without double debit')
  assert.equal((await idem.claim(buyer.id, owned.key, checkoutRequestHash({ ...input, useWallet: false }))).kind, 'mismatch')
  passed('idempotency key rejects a different checkout payload')

  const stale = await claimFor(buyer.id, 'stale-owner')
  await db.update(checkoutIdempotency).set({ claimedAt: new Date(0) }).where(eq(checkoutIdempotency.key, stale.key))
  const reclaimed = await claimFor(buyer.id, stale.key)
  await idem.release(buyer.id, stale)
  await idem.complete(buyer.id, stale, { orderId: 'incorrect-order' })
  await assert.rejects(() => orderService.checkout(buyer.id, input, stale))
  await orderService.checkout(buyer.id, input, reclaimed)
  passed('expired claim owner cannot release, complete, or execute a reclaimed intent')

  const slowClaim = await claimFor(buyer.id, 'slow-checkout')
  await db.update(checkoutIdempotency).set({ claimedAt: new Date(0) }).where(eq(checkoutIdempotency.key, slowClaim.key))
  const entered = gate(), resume = gate()
  trackingHook = async () => { entered.release(); await resume.promise; return false }
  const slowOrder = orderService.checkout(buyer.id, input, slowClaim)
  await entered.promise
  const concurrentClaim = idem.claim(buyer.id, slowClaim.key, checkoutRequestHash(input))
  resume.release()
  const slow = await slowOrder
  const contender = await concurrentClaim
  assert.notEqual(contender.kind, 'claimed')
  const finalReplay = await idem.claim(buyer.id, slowClaim.key, checkoutRequestHash(input))
  assert.equal(finalReplay.kind === 'replay' && finalReplay.response.orderId, slow.displayId)
  trackingHook = async () => false
  passed('checkout row lock prevents aged live claims from being stolen')

  const indebted = await makeUser()
  await db.insert(walletTransactions).values({ userId: indebted.id, type: 'WITHDRAW', amount: 20_000, description: 'Referral reversal' })
  const preview = await orderService.preview(indebted.id, input)
  const negativeOrder = await orderService.checkout(indebted.id, input)
  assert.equal(preview.breakdown.walletDeduction, 0)
  assert.equal(negativeOrder.breakdown.walletDeduction, 0)
  assert.equal(negativeOrder.amountPaidOnline, negativeOrder.breakdown.totalAmount)
  passed('negative wallet never increases gateway charge above the order total')

  await assert.rejects(() => orderService.checkout(buyer.id, { ...input, items: [...input.items, { productId: crypto.randomUUID(), quantity: 1 }] }))
  await assert.rejects(() => orderService.preview(buyer.id, { ...input, items: [{ ...input.items[0]!, sizeId: crypto.randomUUID() }] }))
  await db.update(products).set({ sizesEnabled: true }).where(eq(products.id, product!.id))
  await assert.rejects(() => orderService.checkout(buyer.id, input))
  await db.update(products).set({ sizesEnabled: false, originalPrice: 2_000_000_000 }).where(eq(products.id, product!.id))
  await assert.rejects(() => orderService.checkout(buyer.id, { ...input, items: [{ ...input.items[0]!, quantity: 2 }] }))
  await db.update(products).set({ originalPrice: 100_000 }).where(eq(products.id, product!.id))
  passed('deleted products, removed sizes, empty size sets and overflowing totals are rejected')

  const limited = await makeCoupon('LIMITED', 1)
  const another = await makeUser()
  const competing = await Promise.allSettled([indebted.id, another.id].map((uid) => orderService.checkout(uid, { ...input, couponCode: limited.code })))
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await db.select().from(coupons).where(eq(coupons.id, limited.id)))[0]!.usedCount, 1)
  const personal = await makeCoupon('PERSONAL', 0, 1)
  const personalAttempts = await Promise.allSettled([1, 2].map(() => orderService.checkout(another.id, { ...input, couponCode: personal.code })))
  assert.equal(personalAttempts.filter((r) => r.status === 'fulfilled').length, 1)
  passed('concurrent checkouts enforce global and per-user coupon reservation limits')

  const disappearing = await makeCoupon('DELETING')
  const couponEntered = gate(), couponResume = gate()
  trackingHook = async () => { couponEntered.release(); await couponResume.promise; return false }
  const duringDelete = orderService.checkout(another.id, { ...input, couponCode: disappearing.code })
  await couponEntered.promise
  const deletion = couponService.remove(disappearing.id)
  couponResume.release()
  const deletedCouponOrder = await duringDelete
  await deletion
  const afterDelete = await getOrder(deletedCouponOrder.displayId)
  assert.equal(afterDelete.couponId, null)
  assert.equal(afterDelete.breakdown.discount, 10_000)
  trackingHook = async () => false
  passed('coupon deletion clears a concurrently inserted order reference without changing its price')

  const pending = await getOrder(negativeOrder.displayId)
  const originalPayment = (await paymentRows(pending.id))[0]!
  await db.update(payments).set({ gatewayRef: 'old-session', updatedAt: new Date(0) }).where(eq(payments.id, originalPayment.id))
  verdict = 'indeterminate'
  const beforeUnknown = initCalls
  await assert.rejects(() => paymentService.retryInitiation(indebted.id, pending.displayId, 'ZARINPAL'))
  assert.equal(initCalls, beforeUnknown)
  assert.equal((await paymentRows(pending.id)).length, 1)
  assert.equal((await paymentRows(pending.id))[0]!.status, 'PENDING')
  passed('even old indeterminate PSP attempts cannot be superseded or charged again')

  verdict = 'failed'
  const verifyBoth = gate()
  let verifying = 0
  verifyHook = async () => { if (++verifying === 2) verifyBoth.release(); await verifyBoth.promise }
  const race = await Promise.allSettled([1, 2].map(() => paymentService.retryInitiation(indebted.id, pending.displayId, 'ZARINPAL')))
  verifyHook = async () => undefined
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1)
  const attempts = await paymentRows(pending.id)
  assert.equal(attempts.filter((p) => p.status === 'PENDING').length, 1)
  assert.equal(attempts.length, 2)
  passed('concurrent payment retries produce exactly one new payable attempt')
  const currentPayment = attempts.find((p) => p.status === 'PENDING')!
  assert.equal(await paymentService.paymentReplayState(indebted.id, pending.displayId, 'https://example.test/old'), 'stale')
  assert.equal(await paymentService.paymentReplayState(indebted.id, pending.displayId, String(currentPayment.metadata!.paymentUrl)), 'fresh')
  passed('checkout replay never returns the payment URL of a replaced attempt')

  verdict = 'success'
  const callbackState = signState(currentPayment.id, config.jwtSecret)
  await Promise.all([1, 2].map(() => paymentService.handleCallback('ZARINPAL', { state: callbackState })))
  assert.equal((await getOrder(pending.displayId)).status, 'PAID')
  await assert.rejects(() => paymentService.retryInitiation(indebted.id, pending.displayId, 'ZARINPAL'))
  const refunds = await Promise.allSettled([1, 2].map(() => orderService.refund(pending.displayId, 'Regression refund')))
  assert.equal(refunds.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(await orderService.walletBalance(db, indebted.id), 80_000)
  assert.equal(await paymentService.paymentReplayState(indebted.id, pending.displayId), 'failed')
  passed('duplicate callbacks settle once; refund is single-credit and refunded orders cannot be replayed as paid')

  const initBuyer = await makeUser()
  const initOrder = await orderService.checkout(initBuyer.id, input)
  initHook = async () => { throw new Error('Stub initialization failure') }
  await assert.rejects(() => paymentService.initiate(initOrder.paymentId!, 'ZARINPAL', { displayId: initOrder.displayId, amount: 1 }))
  initHook = async () => undefined
  await paymentService.retryInitiation(initBuyer.id, initOrder.displayId, 'ZARINPAL')
  const initRetryRows = await paymentRows((await getOrder(initOrder.displayId)).id)
  assert.equal(initRetryRows.length, 2)
  assert.equal(initRetryRows.find((p) => p.status === 'PENDING')!.amount, 100_000)
  passed('failed initialization permits immediate safe retry at persisted amount')

  const slowInitBuyer = await makeUser()
  const slowInitOrder = await orderService.checkout(slowInitBuyer.id, input)
  const initEntered = gate(), initResume = gate()
  initHook = async () => { initEntered.release(); await initResume.promise }
  const lateInit = paymentService.initiate(slowInitOrder.paymentId!, 'ZARINPAL', { displayId: slowInitOrder.displayId, amount: 1 })
  const lateInitRejected = assert.rejects(() => lateInit)
  await initEntered.promise
  await assert.rejects(() => paymentService.retryInitiation(slowInitBuyer.id, slowInitOrder.displayId, 'ZARINPAL'))
  await db.update(payments).set({ updatedAt: new Date(0) }).where(eq(payments.id, slowInitOrder.paymentId!))
  initHook = async () => undefined
  await paymentService.retryInitiation(slowInitBuyer.id, slowInitOrder.displayId, 'ZARINPAL')
  initResume.release()
  await lateInitRejected
  const slowInitRows = await paymentRows((await getOrder(slowInitOrder.displayId)).id)
  assert.equal(slowInitRows.filter((p) => p.status === 'PENDING').length, 1)
  assert.equal(slowInitRows.find((p) => p.id === slowInitOrder.paymentId)!.gatewayRef, null)
  passed('active initialization blocks retry and a superseded slow initializer cannot return its bank URL')

  const settleBuyer = await makeUser()
  const settleCoupon = await makeCoupon('SETTLEDELETE')
  const settleOrder = await orderService.checkout(settleBuyer.id, { ...input, couponCode: settleCoupon.code })
  await paymentService.initiate(settleOrder.paymentId!, 'ZARINPAL', { displayId: settleOrder.displayId, amount: settleOrder.amountPaidOnline })
  const deleteLocked = gate(), deleteNow = gate()
  const deleteWhileSettling = db.transaction(async (tx) => {
    await tx.select().from(coupons).where(eq(coupons.id, settleCoupon.id)).for('update')
    deleteLocked.release()
    await deleteNow.promise
    await tx.delete(coupons).where(eq(coupons.id, settleCoupon.id))
  })
  await deleteLocked.promise
  verdict = 'success'
  const settleWhileDeleting = paymentService.handleCallback('ZARINPAL', { state: signState(settleOrder.paymentId!, config.jwtSecret) })
  let waitedOnCoupon = false
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%"coupons"%'`)
      if (Number((waiting[0] as { n: number }).n) > 0) { waitedOnCoupon = true; break }
      await Bun.sleep(10)
    }
  } finally {
    deleteNow.release()
  }
  await Promise.all([settleWhileDeleting, deleteWhileSettling])
  assert.equal(waitedOnCoupon, true)
  const settledAfterDelete = await getOrder(settleOrder.displayId)
  assert.equal(settledAfterDelete.status, 'PAID')
  assert.equal(settledAfterDelete.couponId, null)
  passed('gateway settlement and coupon deletion share lock order and finish without deadlock')

  const cursorOrders = await db.insert(orders).values(Array.from({ length: 102 }, (_, index) => ({
    userId: settleBuyer.id, displayId: `ord-cursor${String(index).padStart(3, '0')}`,
    status: 'PENDING_PAYMENT' as const, deliveryType: 'DINE_IN' as const,
    paymentStatus: 'PENDING', totalAmount: 100_000, breakdown: negativeOrder.breakdown,
  }))).returning({ id: orders.id, displayId: orders.displayId })
  await db.insert(payments).values(cursorOrders.map((order, index) => ({
    id: asPaymentId(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    orderId: order.id, userId: settleBuyer.id, amount: 100_000, gateway: 'CURSORTEST', mode: 'direct',
    gatewayRef: `cursor-${index}`, updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
  })))
  const checked: string[] = []
  ;(paymentService as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('CURSORTEST', {
    id: 'CURSORTEST', mode: 'direct', init: async () => { throw new Error('Unused init') },
    resumeUrl: () => null,
    verify: async ({ gatewayRef }) => {
      checked.push(gatewayRef!)
      return { gatewayRef, success: gatewayRef === 'cursor-101', indeterminate: gatewayRef !== 'cursor-101' }
    },
  })
  const batchOne = await paymentService.reconcilePending()
  assert.equal(checked.length, 100)
  assert.deepEqual(batchOne, { reverified: 0, failed: 0 })
  const batchTwo = await paymentService.reconcilePending()
  assert.equal(checked.length, 102)
  assert.deepEqual(batchTwo, { reverified: 1, failed: 0 })
  assert.equal((await getOrder(cursorOrders[101]!.displayId)).status, 'PAID')
  await paymentService.reconcilePending()
  assert.equal(checked.length, 202)
  assert.equal(checked.filter((ref) => ref === 'cursor-0').length, 2)
  passed('reconciliation reaches paid attempts beyond 100 unresolved rows and wraps to revisit pending attempts')

  const totals = await db.select({ count: sql<number>`count(*)::int` }).from(orderItems)
  assert(totals[0]!.count > 0)
  const invalidRefs = await db.select().from(orders).where(and(eq(orders.couponId, disappearing.id), eq(orders.userId, another.id)))
  assert.equal(invalidRefs.length, 0)

  // stage-91 — فاکتور چاپی کارکنه باید شمارهٔ «کاملِ» مشتری را داشته باشد:
  // آشپزخانه/پیک برای تماس با مشتری به شمارهٔ واقعی نیاز دارند. ماسکِ
  // stage-55 از invoiceForStaff حذف شد (لیست‌های ادمین۲ ماسک می‌مانند).
  const staffInvoice = await orderService.invoiceForStaff(paid.displayId)
  assert.equal(staffInvoice.userPhone, buyer.phone)
  assert.ok(!staffInvoice.userPhone!.includes('*'))
  passed('printed staff invoice carries the full customer phone number (stage-91)')
  console.log(`Order safety: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
