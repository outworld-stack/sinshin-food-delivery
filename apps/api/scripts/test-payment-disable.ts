/** Local scratch PostgreSQL; real order/payment services and stubbed PSP only. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import type { CheckoutInput } from '@sinshin/shared'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { SettingsService } from '../src/domain/settings/settings.service'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { OrderService } from '../src/domain/order/order.service'
import { CheckoutIdempotency } from '../src/domain/order/checkout-idempotency.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import type { PaymentGateway } from '../src/domain/payment/gateway.types'
import { signState } from '../src/domain/payment/state'
import { AppError, OrderPaymentsDisabledError } from '../src/domain/shared/errors'
import { orderRoutes } from '../src/http/routes/order.routes'
import {
  categories, checkoutIdempotency, coupons, mainCategories, orders, payments,
  products, SETTING_KEYS, users, walletTransactions,
} from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_paydisable_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let created = false
const originalFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External payment requests are forbidden') }) as unknown as typeof fetch
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const disabledError = (error: unknown) => error instanceof OrderPaymentsDisabledError
  && error.code === 'CONFLICT' && error.status === 409
let checks = 0
const passed = (message: string) => { checks++; console.log(`PASS ${message}`) }

try {
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(target.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(),
    GATEWAY_MODE: 'direct', JWT_SECRET: 'payment-disable-regression'.repeat(3), SITE_URL: 'https://sinshin.example' })
  const settings = new SettingsService({ db })
  const writer = new SettingsService({ db })
  // Bun 1.3.14 can stall parallel reads on one reserved transaction connection.
  // Keep the real status calculation outside money locks and refresh its test
  // snapshot after every closure toggle; fresh payment guards remain untouched.
  const readRestaurantStatus = settings.restaurantStatus.bind(settings)
  let transactionStatus = await readRestaurantStatus('fa', db)
  settings.restaurantStatus = (lang = 'fa', readDb) => readDb
    ? Promise.resolve(transactionStatus) : readRestaurantStatus(lang)
  const notifications = { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never
  const hub = { publish: () => undefined } as never
  const orderService = new OrderService({ db, config, settings, coupons: new CouponService({ db }),
    zones: {} as never, notifications })
  const service = new PaymentService({ db, config, orders: orderService, hub, notifications })
  let initCalls = 0
  let initHook = async () => undefined
  let verifyHook = async () => undefined
  let verdict: 'pending' | 'failed' | 'success' = 'pending'
  const gateway: PaymentGateway = {
    id: 'ZARINPAL', mode: 'direct',
    resumeUrl: (input) => typeof input.paymentUrl === 'string' ? input.paymentUrl : null,
    init: async (input) => {
      initCalls++
      await initHook()
      return { gatewayRef: `receipt-${input.paymentId}`, paymentUrl: `https://example.test/pay/${input.paymentId}` }
    },
    verify: async (input) => {
      await verifyHook()
      return { success: verdict === 'success', indeterminate: verdict === 'pending', gatewayRef: input.gatewayRef }
    },
  }
  ;(service as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('ZARINPAL', gateway)
  const [buyer] = await db.insert(users).values({ phone: '09150000001' }).returning()
  // Each recovery scenario below gets its own returning buyer; pending payments
  // now correctly block another checkout even after a previous successful order.
  await db.insert(orders).values({
    userId: buyer!.id, displayId: 'ord-disable-history', status: 'PAID', paymentStatus: 'SUCCESS',
    deliveryType: 'DINE_IN', totalAmount: 0,
    breakdown: { foodTotal: 0, discount: 0, walletDeduction: 0, deliveryFee: 0,
      packagingFee: 0, totalAmount: 0, amountPaidOnline: 0 },
  })
  const [main] = await db.insert(mainCategories).values({ name: 'Main', slug: 'main' }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Food', slug: 'food' }).returning()
  const [product] = await db.insert(products).values({ categoryId: category!.id, name: 'Meal', originalPrice: 100_000, status: 'ACTIVE' }).returning()
  const [coupon] = await db.insert(coupons).values({ code: 'DISABLE', discountPercentage: 10, isPublic: true,
    maxUses: 0, maxPerUser: 0, startsAt: new Date(Date.now() - 1000) }).returning()
  await db.insert(walletTransactions).values({ userId: buyer!.id, type: 'DEPOSIT', amount: 1_000_000, description: 'Test funding' })
  const input: CheckoutInput = { items: [{ productId: product!.id, quantity: 1 }], deliveryType: 'DINE_IN', useWallet: false, gatewayId: 'ZARINPAL' }
  const setDisabled = async (disabled: boolean, closed = true) => {
    await writer.set(SETTING_KEYS.temporarilyClosed, closed)
    await writer.set(SETTING_KEYS.temporaryPaymentsDisabled, disabled)
    transactionStatus = await readRestaurantStatus('fa', db)
  }
  const orderBy = async (displayId: string) => (await db.select().from(orders).where(eq(orders.displayId, displayId)))[0]!
  const paymentBy = async (id: typeof payments.$inferSelect.id) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!
  const snapshot = async () => ({
    orders: (await db.select().from(orders)).length,
    payments: (await db.select().from(payments)).length,
    balance: await orderService.walletBalance(db, buyer!.id),
    couponUses: (await db.select().from(coupons).where(eq(coupons.id, coupon!.id)))[0]!.usedCount,
  })
  let scenarioUser = 1
  const pending = async () => {
    const [owner] = await db.insert(users).values({ phone: `0915${String(++scenarioUser).padStart(7, '0')}` }).returning()
    await db.insert(orders).values({ userId: owner!.id, displayId: `ord-dis-hist-${scenarioUser}`,
      status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 0,
      breakdown: { foodTotal: 0, discount: 0, walletDeduction: 0, deliveryFee: 0,
        packagingFee: 0, totalAmount: 0, amountPaidOnline: 0 },
    })
    const result = await orderService.checkout(owner!.id, input)
    assert(result.paymentId)
    return { order: await orderBy(result.displayId), payment: await paymentBy(result.paymentId) }
  }
  const initiate = (fixture: Awaited<ReturnType<typeof pending>>) => service.initiate(fixture.payment.id, 'ZARINPAL', {
    displayId: fixture.order.displayId, amount: fixture.payment.amount,
  })
  const callback = (fixture: Awaited<ReturnType<typeof pending>>) => service.handleCallback('ZARINPAL', {
    state: signState(fixture.payment.id, config.jwtSecret),
  })
  const makeVerificationDue = async (paymentId: typeof payments.$inferSelect.id) => {
    const row = await paymentBy(paymentId)
    if (row.metadata?.verification) await db.update(payments).set({ metadata: { ...row.metadata,
      verification: { ...(row.metadata.verification as Record<string, unknown>), nextAt: new Date(0).toISOString() },
    } }).where(eq(payments.id, paymentId))
  }
  const settleRouted = async (displayId: string) => {
    const order = await orderBy(displayId)
    const payment = (await db.select().from(payments).where(eq(payments.orderId, order.id)))
      .find(row => row.status === 'PENDING')
    assert(payment)
    verdict = 'success'
    await service.handleCallback('ZARINPAL', { state: signState(payment.id, config.jwtSecret) })
  }

  // Public status may still be cached as open, but money enforcement must not be.
  await settings.restaurantStatus()
  await setDisabled(true)
  const beforeBlocked = await snapshot()
  for (const useWallet of [true, false]) {
    await assert.rejects(orderService.checkout(buyer!.id, { ...input, useWallet, couponCode: coupon!.code }), disabledError)
  }
  assert.deepEqual(await snapshot(), beforeBlocked)
  passed('fresh enforcement blocks wallet and gateway checkout before orders, debits, or coupon reservations')

  // Catch a toggle made after checkout started and after it reserved a coupon.
  await setDisabled(false)
  const pricingEntered = gate(), pricingContinue = gate()
  const originalTracking = settings.liveTrackingEnabled.bind(settings)
  settings.liveTrackingEnabled = async () => { pricingEntered.release(); await pricingContinue.promise; return false }
  const lateCheckout = orderService.checkout(buyer!.id, { ...input, useWallet: true, couponCode: coupon!.code })
  const lateRejected = assert.rejects(lateCheckout, disabledError)
  await pricingEntered.promise
  await setDisabled(true)
  pricingContinue.release()
  await lateRejected
  settings.liveTrackingEnabled = originalTracking
  assert.deepEqual(await snapshot(), beforeBlocked)
  passed('a closure during checkout rolls back coupon reservations and prevents wallet settlement')

  await setDisabled(false)
  const uninitialized = await pending()
  await setDisabled(true)
  await assert.rejects(initiate(uninitialized), disabledError)
  assert.equal(initCalls, 0)
  const skippedInit = await paymentBy(uninitialized.payment.id)
  assert.equal(skippedInit.status, 'PENDING')
  assert.equal(skippedInit.gatewayRef, null)
  assert.equal(skippedInit.metadata?.initToken, undefined)
  assert.equal(skippedInit.metadata?.paymentUrl, undefined)
  assert.equal(skippedInit.metadata?.initFailed, true, 'record that this attempt never reached the PSP')
  passed('disabled initiation does not reserve an init token or contact the PSP')

  await setDisabled(false)
  const slow = await pending()
  const initEntered = gate(), initContinue = gate()
  initHook = async () => { initEntered.release(); await initContinue.promise }
  const slowInit = initiate(slow)
  const slowRejected = assert.rejects(slowInit, disabledError)
  await initEntered.promise
  await setDisabled(true)
  initContinue.release()
  await slowRejected
  initHook = async () => undefined
  assert((await paymentBy(slow.payment.id)).gatewayRef, 'retain PSP reference for callback/reconciliation')
  assert.equal(await service.paymentReplayState(slow.order.userId, slow.order.displayId), 'stale')
  passed('a closure during slow PSP initialization withholds the URL without losing its payment reference')

  await setDisabled(false)
  const resumable = await pending()
  const resumedUrl = (await initiate(resumable)).paymentUrl
  await setDisabled(true)
  const beforeRetry = await snapshot()
  const beforeRetryInit = initCalls
  for (const nextVerdict of ['pending', 'failed'] as const) {
    verdict = nextVerdict
    await assert.rejects(service.retryInitiation(resumable.order.userId, resumable.order.displayId), disabledError)
    assert.deepEqual(await snapshot(), beforeRetry)
    assert.equal((await paymentBy(resumable.payment.id)).status, 'PENDING')
  }
  assert.equal(initCalls, beforeRetryInit)
  assert.equal(await service.paymentReplayState(resumable.order.userId, resumable.order.displayId, resumedUrl), 'stale')
  passed('disabled retries neither resume a pending session nor supersede it with a fresh charge')

  await setDisabled(false)
  // The prior scenario intentionally received an unknown result. Advance only
  // its scratch retry schedule so this test exercises an in-flight verification.
  await makeVerificationDue(resumable.payment.id)
  verdict = 'pending'
  const verifyEntered = gate(), verifyContinue = gate()
  verifyHook = async () => { verifyEntered.release(); await verifyContinue.promise }
  const racingRetry = service.retryInitiation(resumable.order.userId, resumable.order.displayId)
  const racingRejected = assert.rejects(racingRetry, disabledError)
  await verifyEntered.promise
  await setDisabled(true)
  verifyContinue.release()
  await racingRejected
  verifyHook = async () => undefined
  assert.deepEqual(await snapshot(), beforeRetry)
  passed('a closure during retry verification is rechecked before returning a resumed payment URL')

  verdict = 'success'
  await callback(slow)
  assert.equal((await orderBy(slow.order.displayId)).paymentStatus, 'SUCCESS')
  await makeVerificationDue(resumable.payment.id)
  await assert.rejects(service.retryInitiation(resumable.order.userId, resumable.order.displayId), /هم‌اکنون پرداخت شد/)
  assert.equal((await orderBy(resumable.order.displayId)).paymentStatus, 'SUCCESS')
  assert.equal(await service.paymentReplayState(resumable.order.userId, resumable.order.displayId, resumedUrl), 'success')
  passed('already-charged callbacks and retry verification settle safely while new payments are disabled')

  await setDisabled(false)
  const reconcilable = await pending()
  await initiate(reconcilable)
  await db.update(payments).set({ updatedAt: new Date(Date.now() - 120_000) }).where(eq(payments.id, reconcilable.payment.id))
  await setDisabled(true)
  await service.reconcilePending(1)
  assert.equal((await orderBy(reconcilable.order.displayId)).paymentStatus, 'SUCCESS')
  passed('background reconciliation still settles authorized payments during a temporary payment stop')

  // Exercise the real checkout route's durable idempotent response, not only
  // the replay-state helper. Paid responses remain safe to replay after closing.
  const app = new Elysia()
    .onError(({ error, set }) => { if (error instanceof AppError) { set.status = error.status; return error.toJSON() } })
    .use(orderRoutes({ orders: orderService, payments: service, settings,
      idempotency: new CheckoutIdempotency({ db }), notifications, hub,
      sessions: { authenticate: async () => ({ user: buyer!, ctx: {} }) } as never,
      profile: {} as never, redis: { incr: async () => 1, expire: async () => undefined } as never,
    })).compile()
  const request = (key: string, body = input) => app.handle(new Request('http://localhost/orders/checkout', {
    method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
  }))
  assert.equal((await request('blocked-order')).status, 409)
  assert.equal((await db.select().from(checkoutIdempotency).where(eq(checkoutIdempotency.key, 'blocked-order'))).length, 0)
  await setDisabled(false)
  const routed = await request('blocked-order')
  assert.equal(routed.status, 200)
  const original = await routed.json() as { orderId: string; paymentUrl: string }
  assert(original.paymentUrl)
  await setDisabled(true)
  const replay = await (await request('blocked-order')).json() as { orderId: string; paymentUrl?: string }
  assert.equal(replay.orderId, original.orderId)
  assert.equal(replay.paymentUrl, undefined)
  await setDisabled(false)
  await settleRouted(original.orderId)
  const walletBody = { ...input, useWallet: true }
  const wallet = await (await request('paid-wallet-order', walletBody)).json() as { orderId: string; orderCompleted: boolean }
  assert.equal(wallet.orderCompleted, true)
  await setDisabled(true)
  assert.deepEqual(await (await request('paid-wallet-order', walletBody)).json(), wallet)
  passed('checkout route releases blocked claims, strips cached pending URLs, and preserves paid wallet replays')

  await setDisabled(false)
  const originalInitiate = service.initiate.bind(service)
  const callsBeforePostCommitPause = initCalls
  service.initiate = async (...args) => {
    await setDisabled(true) // The order has committed when the route calls initiate.
    return originalInitiate(...args)
  }
  const interrupted = await request('post-commit-pause')
  service.initiate = originalInitiate
  assert.equal(interrupted.status, 200, 'an intentional post-commit pause returns order recovery, not a gateway-outage error')
  const recovery = await interrupted.json() as { orderId: string; orderCompleted: boolean; requiresPayment: boolean; paymentUrl?: string }
  assert.equal(recovery.orderCompleted, false)
  assert.equal(recovery.requiresPayment, true)
  assert.equal(recovery.paymentUrl, undefined)
  assert(recovery.orderId)
  assert.equal(initCalls, callsBeforePostCommitPause)
  const afterPause = await snapshot()
  assert.deepEqual(await (await request('post-commit-pause')).json(), recovery)
  assert.deepEqual(await snapshot(), afterPause, 'same-key retries after a pause cannot create or reserve twice')
  await setDisabled(false)
  const recovered = await service.retryInitiation(buyer!.id, recovery.orderId)
  assert(recovered.paymentUrl, 'the proven-unstarted attempt can resume immediately after reopening')
  assert.equal(initCalls, callsBeforePostCommitPause + 1)
  assert.equal((await snapshot()).orders, afterPause.orders)
  assert.equal((await snapshot()).balance, afterPause.balance)
  passed('post-commit pauses return durable order recovery and immediately resume safely after reopening')
  await settleRouted(recovery.orderId)

  const mockConfig = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(), GATEWAY_MODE: 'mock',
    JWT_SECRET: config.jwtSecret, SITE_URL: config.siteUrl })
  const mockOrders = new OrderService({ db, config: mockConfig, settings, coupons: new CouponService({ db }), zones: {} as never, notifications })
  const mockPayments = new PaymentService({ db, config: mockConfig, orders: mockOrders, hub, notifications })
  await setDisabled(false)
  const mocked = await mockOrders.checkout(buyer!.id, input)
  assert(mocked.paymentId)
  await mockPayments.initiate(mocked.paymentId, 'MOCK', { displayId: mocked.displayId, amount: mocked.amountPaidOnline })
  await setDisabled(true)
  await assert.rejects(mockPayments.handleMockPay(signState(mocked.paymentId, config.jwtSecret), true), disabledError)
  assert.equal((await orderBy(mocked.displayId)).paymentStatus, 'PENDING')
  // Reopening makes a leftover disabled flag ineffective, as does allowing
  // payments while the restaurant remains temporarily closed.
  await setDisabled(true, false)
  assert.equal((await mockPayments.handleMockPay(signState(mocked.paymentId, config.jwtSecret), true)).paymentStatus, 'SUCCESS')
  await setDisabled(false, true)
  assert.equal((await orderService.checkout(buyer!.id, { ...input, useWallet: true })).requiresPayment, false)
  passed('new mock successes are blocked; reopening or allowing payments restores checkout')
  console.log(`Payment disable: ${checks} passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
