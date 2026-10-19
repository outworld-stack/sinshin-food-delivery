/** Payment security/conservation regressions. Local scratch PostgreSQL only;
 * every PSP request is stubbed and notification delivery is disabled. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { OrderService } from '../src/domain/order/order.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { SepAdapter } from '../src/domain/payment/sep.adapter'
import { ZarinpalAdapter } from '../src/domain/payment/zarinpal.adapter'
import { MellatAdapter } from '../src/domain/payment/mellat.adapter'
import { amountInRial } from '../src/domain/payment/http-util'
import { signState } from '../src/domain/payment/state'
import type { GatewayVerifyInput, GatewayVerifyResult, PaymentGateway } from '../src/domain/payment/gateway.types'
import { orders, payments, reconcileFindings, users, walletTransactions } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_paysafe_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const gate = () => { let release!: () => void; const promise = new Promise<void>((r) => { release = r }); return { release, promise } }
const originalFetch = globalThis.fetch
let fetchHandler = async (_url: string, _init?: RequestInit): Promise<Response> => { throw new Error('Unexpected PSP request') }
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => fetchHandler(String(url), init)) as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(target.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(),
    GATEWAY_MODE: 'direct', JWT_SECRET: 'safe-payment-regression'.repeat(3), SITE_URL: 'https://sinshin.example',
    SEP_TERMINAL_ID: '12345678', ZARINPAL_MERCHANT_ID: 'test-merchant',
    MELLAT_TERMINAL_ID: '111222333', MELLAT_USERNAME: 'stub', MELLAT_PASSWORD: 'stub',
  })
  const orderService = new OrderService({ db, config, coupons: new CouponService({ db }),
    settings: { restaurantStatus: async () => ({ anyClosed: false }) } as never,
    zones: {} as never, notifications: { notifyUser: async () => undefined } as never,
  })
  const service = new PaymentService({ db, config, orders: orderService,
    hub: { publish: () => undefined } as never,
    notifications: { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never,
  })
  let initCalls = 0, verifyCalls = 0
  let initHook = async () => undefined
  let verifyHook = async (input: GatewayVerifyInput): Promise<GatewayVerifyResult> => ({ success: true, gatewayRef: input.gatewayRef })
  const fake: PaymentGateway = {
    id: 'FAKE', mode: 'direct',
    init: async (input) => { initCalls++; await initHook(); return { gatewayRef: `receipt-${input.paymentId}`, paymentUrl: `https://example.test/pay/${input.paymentId}` } },
    verify: async (input) => { verifyCalls++; return verifyHook(input) },
  }
  ;(service as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('FAKE', fake)
  let sequence = 0
  const make = async (gateway = 'FAKE', ref: string | null = `receipt-${crypto.randomUUID()}`) => {
    const n = ++sequence
    const [user] = await db.insert(users).values({ phone: `0917${String(n).padStart(7, '0')}` }).returning()
    const [order] = await db.insert(orders).values({ userId: user!.id, displayId: `ord-paysafe${n}`,
      status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', deliveryType: 'DINE_IN', totalAmount: 100_000,
      breakdown: { foodTotal: 100_000, discount: 0, walletDeduction: 20_000, amountPaidOnline: 80_000,
        deliveryFee: 0, packagingFee: 0, totalAmount: 100_000 },
    }).returning()
    await db.insert(walletTransactions).values([
      { userId: user!.id, type: 'DEPOSIT', amount: 100_000, description: 'Fixture funding' },
      { userId: user!.id, type: 'WITHDRAW', amount: 20_000, description: 'Fixture hold', orderId: order!.id },
    ])
    const [payment] = await db.insert(payments).values({ userId: user!.id, orderId: order!.id,
      gateway, mode: 'direct', amount: 80_000, gatewayRef: ref,
    }).returning()
    return { user: user!, order: order!, payment: payment! }
  }
  const readOrder = async (id: typeof orders.$inferSelect.id) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
  const readPayment = async (id: typeof payments.$inferSelect.id) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!
  const callback = (fixture: Awaited<ReturnType<typeof make>>) => service.handleCallback(fixture.payment.gateway, { state: signState(fixture.payment.id, config.jwtSecret) })

  const initiating = await make('FAKE', null)
  const entered = gate(), resume = gate()
  initHook = async () => { entered.release(); await resume.promise }
  const firstInit = service.initiate(initiating.payment.id, 'FAKE', { displayId: initiating.order.displayId, amount: 1 })
  await entered.promise
  await assert.rejects(() => service.initiate(initiating.payment.id, 'FAKE', { displayId: initiating.order.displayId, amount: 1 }))
  resume.release(); await firstInit; initHook = async () => undefined
  assert.equal(initCalls, 1)
  passed('concurrent initiation sends exactly one PSP initialization request')

  const sepSession = await make('SEP', null)
  fetchHandler = async () => json({ IsSuccess: true, Token: 'live-sep-token' })
  const sepInit = await service.initiate(sepSession.payment.id, 'SEP', { displayId: sepSession.order.displayId, amount: 1 })
  await db.update(payments).set({ updatedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(payments.id, sepSession.payment.id))
  fetchHandler = async () => { throw new Error('Resuming SEP must not initialize a second session') }
  const sepRetries = await Promise.all([
    service.retryInitiation(sepSession.user.id, sepSession.order.displayId),
    service.retryInitiation(sepSession.user.id, sepSession.order.displayId),
  ])
  assert(sepRetries.every(result => result.paymentUrl === sepInit.paymentUrl && result.displayId === sepSession.order.displayId))
  assert.equal((await db.select().from(payments).where(eq(payments.orderId, sepSession.order.id))).length, 1)
  assert.equal((await readPayment(sepSession.payment.id)).status, 'PENDING')
  assert.equal(await orderService.walletBalance(db, sepSession.user.id), 80_000)
  await assert.rejects(() => service.retryInitiation(initiating.user.id, sepSession.order.displayId))
  await assert.rejects(() => service.retryInitiation(sepSession.user.id, sepSession.order.displayId, 'FAKE'))
  passed('concurrent owner retries reopen the same SEP session without a new charge or wallet movement; other users and gateway switches are rejected')

  const resumable = await make('FAKE', null)
  const resumableInit = await service.initiate(resumable.payment.id, 'FAKE', { displayId: resumable.order.displayId, amount: 80_000 })
  const beforeResumeInit = initCalls
  verifyHook = async input => ({ success: false, gatewayRef: input.gatewayRef, indeterminate: true })
  assert.equal((await service.retryInitiation(resumable.user.id, resumable.order.displayId)).paymentUrl, resumableInit.paymentUrl)
  verifyHook = async () => { throw new Error('PSP unavailable') }
  assert.equal((await service.retryInitiation(resumable.user.id, resumable.order.displayId)).paymentUrl, resumableInit.paymentUrl)
  assert.equal(initCalls, beforeResumeInit)
  assert.equal((await readPayment(resumable.payment.id)).status, 'PENDING')
  assert.equal(await orderService.walletBalance(db, resumable.user.id), 80_000)
  passed('inconclusive verification and a PSP outage still allow resuming an existing gateway URL')

  const unknownWithoutUrl = await make()
  await assert.rejects(() => service.retryInitiation(unknownWithoutUrl.user.id, unknownWithoutUrl.order.displayId))
  assert.equal(initCalls, beforeResumeInit)
  passed('an unresolved payment without a resumable URL cannot create a second charge')

  verifyHook = async input => ({ success: true, gatewayRef: input.gatewayRef })
  await assert.rejects(() => service.retryInitiation(resumable.user.id, resumable.order.displayId))
  assert.equal((await readOrder(resumable.order.id)).status, 'PAID')
  assert.equal(initCalls, beforeResumeInit)
  passed('retry settles an already successful bank payment without starting another')

  const replaceable = await make('FAKE', null)
  await service.initiate(replaceable.payment.id, 'FAKE', { displayId: replaceable.order.displayId, amount: 80_000 })
  const beforeReplaceInit = initCalls
  verifyHook = async input => ({ success: false, gatewayRef: input.gatewayRef, indeterminate: input.paymentId !== replaceable.payment.id })
  const replacements = await Promise.allSettled([
    service.retryInitiation(replaceable.user.id, replaceable.order.displayId),
    service.retryInitiation(replaceable.user.id, replaceable.order.displayId),
  ])
  assert(replacements.some(result => result.status === 'fulfilled'))
  assert.equal(initCalls, beforeReplaceInit + 1)
  assert.equal((await readPayment(replaceable.payment.id)).status, 'FAILED')
  assert.equal((await db.select().from(payments).where(eq(payments.orderId, replaceable.order.id))).length, 2)
  assert.equal(await orderService.walletBalance(db, replaceable.user.id), 80_000)
  passed('definitive bank failure permits one fresh gateway session even with concurrent retries')

  const racingResume = await make('FAKE', null)
  await service.initiate(racingResume.payment.id, 'FAKE', { displayId: racingResume.order.displayId, amount: 80_000 })
  const resumeEntered = gate(), resumeContinue = gate()
  verifyHook = async input => {
    resumeEntered.release(); await resumeContinue.promise
    return { success: false, gatewayRef: input.gatewayRef, indeterminate: true }
  }
  const racingRetry = service.retryInitiation(racingResume.user.id, racingResume.order.displayId)
  const racingRejected = assert.rejects(racingRetry)
  await resumeEntered.promise
  verifyHook = async input => ({ success: true, gatewayRef: input.gatewayRef })
  await callback(racingResume)
  resumeContinue.release()
  await racingRejected
  assert.equal((await readOrder(racingResume.order.id)).status, 'PAID')
  passed('a successful callback during retry prevents returning a stale gateway session')

  const withSibling = await make('FAKE', null)
  const siblingInit = await service.initiate(withSibling.payment.id, 'FAKE', { displayId: withSibling.order.displayId, amount: 80_000 })
  const [declinedSibling] = await db.insert(payments).values({
    userId: withSibling.user.id, orderId: withSibling.order.id, gateway: 'FAKE', mode: 'direct',
    amount: 80_000, gatewayRef: 'declined-sibling', createdAt: new Date(Date.now() - 60_000),
  }).returning()
  verifyHook = async input => ({ success: false, gatewayRef: input.gatewayRef, indeterminate: input.paymentId !== declinedSibling!.id })
  assert.equal((await service.retryInitiation(withSibling.user.id, withSibling.order.displayId)).paymentUrl, siblingInit.paymentUrl)
  assert.equal((await readPayment(declinedSibling!.id)).status, 'FAILED')
  await service.handleCallback('FAKE', { state: signState(declinedSibling!.id, config.jwtSecret) })
  assert.equal((await readOrder(withSibling.order.id)).status, 'PENDING_PAYMENT')
  assert.equal((await readPayment(withSibling.payment.id)).status, 'PENDING')
  assert.equal(await orderService.walletBalance(db, withSibling.user.id), 80_000)
  passed('resuming a session retires definitively failed sibling attempts so they cannot later cancel the order')

  await db.update(payments).set({ status: 'PENDING', metadata: { paymentUrl: 'https://example.test/pay/other-live-session' } })
    .where(eq(payments.id, declinedSibling!.id))
  verifyHook = async input => ({ success: false, gatewayRef: input.gatewayRef, indeterminate: true })
  await assert.rejects(() => service.retryInitiation(withSibling.user.id, withSibling.order.displayId))
  assert.equal((await readPayment(declinedSibling!.id)).status, 'PENDING')
  verifyHook = async input => ({ success: true, gatewayRef: input.gatewayRef })
  passed('multiple unresolved payable sessions require review instead of arbitrarily resuming either one')

  const noCapture = async () => { throw new Error('Callback must not contact PSP without its receipt') }
  fetchHandler = noCapture
  await service.handleCallback('SEP', { state: signState(sepSession.payment.id, config.jwtSecret), State: 'Canceled By User' })
  assert.equal((await readOrder(sepSession.order.id)).status, 'PENDING_PAYMENT')
  assert.equal(await orderService.walletBalance(db, sepSession.user.id), 80_000)
  passed('forged SEP cancellation cannot release the wallet hold')

  const wrongAmount = await make()
  await db.update(payments).set({ amount: 1 }).where(eq(payments.id, wrongAmount.payment.id))
  await callback(wrongAmount)
  assert.equal((await readOrder(wrongAmount.order.id)).status, 'PENDING_PAYMENT')
  assert.equal((await readPayment(wrongAmount.payment.id)).status, 'PENDING')
  assert.equal(await orderService.walletBalance(db, wrongAmount.user.id), 80_000)
  passed('PSP success for a mismatched amount cannot settle or refund an order')

  const wrongOwner = await make('FAKE', null)
  await db.update(payments).set({ userId: wrongAmount.user.id }).where(eq(payments.id, wrongOwner.payment.id))
  const beforeWrongInit = initCalls
  await assert.rejects(() => service.initiate(wrongOwner.payment.id, 'FAKE', { displayId: wrongOwner.order.displayId, amount: 80_000 }))
  assert.equal(initCalls, beforeWrongInit)
  passed('payment/order ownership mismatch is rejected before contacting the PSP')

  const single = new Database(target.toString(), { max: 1 })
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('One-connection payment operation stalled')), 2500)
      })])
    } finally { clearTimeout(timer) }
  }
  try {
    const singleService = new PaymentService({ db: single.db, config, orders: orderService, hub: {} as never, notifications: {} as never })
    ;(singleService as unknown as { gateways: Map<string, PaymentGateway> }).gateways.set('FAKE', fake)
    await assert.rejects(() => bounded(singleService.initiate(wrongOwner.payment.id, 'FAKE', { displayId: wrongOwner.order.displayId, amount: 80_000 })),
      (error: Error) => error.message !== 'One-connection payment operation stalled')
    const duringVerify = await make()
    verifyHook = async (input) => {
      await db.update(payments).set({ amount: 1 }).where(eq(payments.id, duringVerify.payment.id))
      return { success: true, gatewayRef: input.gatewayRef }
    }
    await bounded(singleService.handleCallback('FAKE', { state: signState(duringVerify.payment.id, config.jwtSecret) }))
    const [singleFinding] = await db.select().from(reconcileFindings).where(eq(reconcileFindings.entityId, duringVerify.payment.id))
    assert(singleFinding)
    verifyHook = async (input) => ({ success: true, gatewayRef: input.gatewayRef })
  } finally { await single.close() }
  passed('initiation and finalization diagnostics persist after rollback even with a one-connection pool')

  await db.update(reconcileFindings).set({ status: 'acknowledged', resolvedAt: new Date() }).where(eq(reconcileFindings.entityId, wrongOwner.payment.id))
  await assert.rejects(() => service.initiate(wrongOwner.payment.id, 'FAKE', { displayId: wrongOwner.order.displayId, amount: 80_000 }))
  const [reopened] = await db.select().from(reconcileFindings).where(eq(reconcileFindings.entityId, wrongOwner.payment.id))
  assert.equal(reopened!.status, 'open'); assert.equal(reopened!.resolvedAt, null)
  const missingGateway = await make('REMOVEDPSP', null)
  await assert.rejects(() => service.initiate(missingGateway.payment.id, 'REMOVEDPSP', { displayId: missingGateway.order.displayId, amount: 80_000 }))
  assert.equal((await readPayment(missingGateway.payment.id)).metadata?.initToken, undefined)
  passed('recurring payment anomalies reopen review and gateway configuration errors do not strand initiation claims')

  const duplicateA = await make('FAKE', 'shared-bank-receipt'), duplicateB = await make('FAKE', 'shared-bank-receipt')
  await Promise.all([callback(duplicateA), callback(duplicateB)])
  const duplicateOrders = await Promise.all([readOrder(duplicateA.order.id), readOrder(duplicateB.order.id)])
  assert.equal(duplicateOrders.filter((o) => o.status === 'PAID').length, 1)
  assert.equal(duplicateOrders.filter((o) => o.status === 'PENDING_PAYMENT').length, 1)
  const blockedId = duplicateOrders.find((o) => o.status === 'PENDING_PAYMENT')!.userId
  assert.equal(await orderService.walletBalance(db, blockedId), 80_000)
  passed('concurrent success callbacks cannot credit the same PSP receipt twice')

  const settled = duplicateOrders[0]!.status === 'PAID' ? duplicateA : duplicateB
  const oldVerifyCalls = verifyCalls
  await callback(settled)
  assert.equal(verifyCalls, oldVerifyCalls)
  passed('a completed payment callback is replayed without re-verifying or changing its receipt')

  const staleReference = await make()
  const staleEntered = gate(), staleResume = gate()
  verifyHook = async () => { staleEntered.release(); await staleResume.promise; return { success: false, indeterminate: true, gatewayRef: 'stale-reference' } }
  const slowCallback = callback(staleReference)
  await staleEntered.promise
  verifyHook = async (input) => ({ success: true, gatewayRef: input.gatewayRef })
  await callback(staleReference)
  staleResume.release()
  const staleRedirect = await slowCallback
  assert.equal((await readPayment(staleReference.payment.id)).gatewayRef, staleReference.payment.gatewayRef)
  assert(!staleRedirect.redirect.includes('payment=pending'))
  passed('late indeterminate callbacks cannot overwrite a settled PSP reference or reopen its pending redirect')

  const late = await make()
  verifyHook = async (input) => ({ success: false, gatewayRef: input.gatewayRef })
  await callback(late)
  assert.equal(await orderService.walletBalance(db, late.user.id), 100_000)
  verifyHook = async (input) => ({ success: true, gatewayRef: input.gatewayRef })
  await callback(late)
  assert.equal((await readPayment(late.payment.id)).status, 'FAILED')
  assert.equal((await readOrder(late.order.id)).status, 'CANCELED')
  assert.equal(await orderService.walletBalance(db, late.user.id), 100_000)
  const [lateFinding] = await db.select().from(reconcileFindings).where(eq(reconcileFindings.entityId, late.payment.id))
  assert(String(lateFinding?.detail.note).includes('late PSP success'))
  passed('late success after a failed attempt raises a reconciliation finding without a second wallet movement')

  const failedInit = await make('FAKE', null)
  initHook = async () => { throw new Error('PSP init rejected') }
  await assert.rejects(() => service.initiate(failedInit.payment.id, 'FAKE', { displayId: failedInit.order.displayId, amount: 80_000 }))
  initHook = async () => undefined
  await db.update(payments).set({ updatedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(payments.id, failedInit.payment.id))
  await service.reconcilePending()
  assert.equal((await readOrder(failedInit.order.id)).status, 'CANCELED')
  assert.equal(await orderService.walletBalance(db, failedInit.user.id), 100_000)
  passed('a verified initialization failure releases its abandoned hold exactly once')

  const unknown = await make('REMOVEDPSP')
  await db.update(payments).set({ updatedAt: new Date(0) }).where(eq(payments.id, unknown.payment.id))
  await service.reconcilePending()
  assert.equal((await readPayment(unknown.payment.id)).status, 'PENDING')
  assert.equal(await orderService.walletBalance(db, unknown.user.id), 80_000)
  passed('an unknown historical PSP is escalated instead of automatically refunding an unverified charge')

  const mockConfig = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(), GATEWAY_MODE: 'mock', JWT_SECRET: config.jwtSecret })
  const mockService = new PaymentService({ db, config: mockConfig, orders: orderService, hub: {} as never, notifications: {} as never })
  await assert.rejects(() => mockService.handleMockPay(signState(unknown.payment.id, config.jwtSecret), true))
  passed('mock mode cannot be used to settle a persisted real-PSP attempt')

  const sep = new SepAdapter(config), zarinpal = new ZarinpalAdapter(config), mellat = new MellatAdapter(config)
  for (const badAmount of [undefined, null, true, [], {}, '', '800000.0', '8e5', 799_999]) {
    fetchHandler = async () => json({ IsSuccess: true, Amount: badAmount })
    const result = await sep.verify({ paymentId: unknown.payment.id, gatewayRef: 'receipt', amount: 80_000, query: {} })
    assert.equal(result.success, false)
    assert.equal(result.indeterminate, true)
  }
  fetchHandler = async () => json({ IsSuccess: true, Amount: '800000' })
  assert.equal((await sep.verify({ paymentId: unknown.payment.id, gatewayRef: 'receipt', amount: 80_000, query: {} })).success, true)
  passed('SEP requires an explicit positive integer amount; numeric strings remain compatible')

  fetchHandler = async () => json({ IsSuccess: true, Amount: 800_000, ResNum: 'wrong-reservation' })
  assert.equal((await sep.verify({ paymentId: unknown.payment.id, gatewayRef: 'receipt', amount: 80_000, query: {} })).indeterminate, true)
  fetchHandler = async () => json({ IsSuccess: 'false', Amount: 800_000 })
  assert.equal((await sep.verify({ gatewayRef: 'receipt', amount: 80_000, query: {} })).indeterminate, true)
  passed('mismatched SEP reservation and malformed success flags cannot finalize money')

  fetchHandler = async () => json({ IsSuccess: true, Amount: 800_000, TerminalId: '99999999' })
  assert.equal((await sep.verify({ gatewayRef: 'receipt', amount: 80_000, query: {} })).indeterminate, true)
  passed('returned SEP terminal identity must match the configured merchant terminal')

  fetchHandler = async () => json({ IsSuccess: true, Amount: 800_000 }, 500)
  assert.equal((await sep.verify({ gatewayRef: 'receipt', amount: 80_000, query: {} })).indeterminate, true)
  fetchHandler = async () => json({ data: { code: 100 } }, 503)
  assert.equal((await zarinpal.verify({ gatewayRef: 'authority', amount: 80_000, query: {} })).indeterminate, true)
  passed('HTTP failure responses cannot become successful PSP verifications')

  fetchHandler = noCapture
  assert.equal((await zarinpal.verify({ gatewayRef: null, amount: 80_000, query: { Authority: 'another-receipt' } })).indeterminate, true)
  for (const badAmount of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => amountInRial(badAmount))
  assert.equal(amountInRial(80_000), 800_000)
  passed('an unbound Zarinpal reference and invalid toman amounts are rejected before network activity')

  fetchHandler = async () => json({ data: { code: -9, authority: 'stale-authority' } })
  await assert.rejects(() => zarinpal.init({ paymentId: unknown.payment.id, amount: 80_000, description: 'Test', displayId: 'ord-test', callbackUrl: 'https://example.test/callback' }))
  fetchHandler = async () => json({ data: { code: 100, authority: 'valid-authority' } })
  assert((await zarinpal.init({ paymentId: unknown.payment.id, amount: 80_000, description: 'Test', displayId: 'ord-test', callbackUrl: 'https://example.test/callback' })).paymentUrl.endsWith('/valid-authority'))
  passed('Zarinpal initialization requires an explicit success code as well as a usable authority')

  const mellatInput = { paymentId: unknown.payment.id, amount: 80_000, description: 'Test', displayId: unknown.order.displayId, callbackUrl: 'https://sinshin.example/callback' }
  fetchHandler = async () => new Response('<return>0,REF123</return>')
  const mellatInit = await mellat.init(mellatInput)
  fetchHandler = noCapture
  const cancellation = await mellat.verify({ paymentId: unknown.payment.id, amount: 80_000, gatewayRef: mellatInit.gatewayRef, query: { ResCode: '17' } })
  assert.equal(cancellation.indeterminate, true)
  const swapped = await mellat.verify({ paymentId: unknown.payment.id, amount: 80_000, gatewayRef: mellatInit.gatewayRef,
    query: { ResCode: '0', RefId: 'REF123', SaleOrderId: 'wrong-order', SaleReferenceId: '123456' } })
  assert.equal(swapped.indeterminate, true)
  passed('Mellat cancellation or mismatched sale order cannot release a hold')

  const settingsService = new SettingsService({ db })
  const gatewayMap = (service as unknown as { gateways: Map<string, PaymentGateway> }).gateways
  const realSep = gatewayMap.get('SEP')!
  gatewayMap.set('SEP', { ...fake, id: 'SEP' })
  verifyHook = async input => ({ success: true, gatewayRef: input.gatewayRef })
  await settingsService.setGateways({ mellat: true, zarinpal: true, sep: false })
  const disabledRetry = await make('SEP', null)
  await db.update(payments).set({ status: 'FAILED' }).where(eq(payments.id, disabledRetry.payment.id))
  const beforeDisabledInit = initCalls
  await assert.rejects(() => service.retryInitiation(disabledRetry.user.id, disabledRetry.order.displayId, 'SEP'), /غیرفعال/)
  assert.equal(initCalls, beforeDisabledInit)
  assert.equal((await db.select().from(payments).where(eq(payments.orderId, disabledRetry.order.id))).length, 1)
  assert.equal(await orderService.walletBalance(db, disabledRetry.user.id), 80_000)
  passed('disabled gateways reject new retries without creating an attempt or changing the wallet')

  const acceptedBeforeSwitch = await make('SEP', null)
  await service.initiate(acceptedBeforeSwitch.payment.id, 'SEP', { displayId: acceptedBeforeSwitch.order.displayId, amount: 80_000 })
  await callback(acceptedBeforeSwitch)
  assert.equal((await readPayment(acceptedBeforeSwitch.payment.id)).status, 'SUCCESS')
  assert.equal((await readOrder(acceptedBeforeSwitch.order.id)).paymentStatus, 'SUCCESS')
  passed('accepted payment attempts can initialize and settle while their gateway is disabled')

  await settingsService.setGateways({ mellat: true, zarinpal: true, sep: true })
  await service.retryInitiation(disabledRetry.user.id, disabledRetry.order.displayId, 'SEP')
  assert.equal((await db.select().from(payments).where(eq(payments.orderId, disabledRetry.order.id))).length, 2)
  gatewayMap.set('SEP', realSep)
  passed('re-enabling a gateway allows a fresh retry')

  const findings = await db.select().from(reconcileFindings)
  assert(findings.length >= 5)
  console.log(`Payment safety: ${checks} passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
