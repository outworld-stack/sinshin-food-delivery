/** Real PostgreSQL + order/payment services; Mellat SOAP, static payment
 * availability and notifications are stubbed. All writes use a new local DB. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { OrderService } from '../src/domain/order/order.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import { signState } from '../src/domain/payment/state'
import { categories, firstPurchaseReservations, mainCategories, orders, payments,
  products, reconcileFindings, users, walletTransactions } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_mellat_requests_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let created = false
const originalFetch = globalThis.fetch
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
const soap = (value: string) => new Response(`<Envelope><Body><return>${value}</return></Body></Envelope>`)
const field = (body: string, name: string) => new RegExp(`<${name}[^>]*>([^<]+)`).exec(body)?.[1] ?? ''
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }

try {
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(target.toString(), { max: 12 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(),
    GATEWAY_MODE: 'direct', JWT_SECRET: 'mellat-request-regression-'.repeat(3), SITE_URL: 'https://sinshin.example',
    MELLAT_TERMINAL_ID: '111222333', MELLAT_USERNAME: 'stub', MELLAT_PASSWORD: 'stub' })
  const notifications = { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never
  const orderService = new OrderService({ db, config, coupons: new CouponService({ db }),
    settings: { assertOrderPaymentsAllowed: async () => undefined, restaurantStatus: async () => ({ anyClosed: false }),
      enabledGateways: async () => ({ mellat: true, sep: false, zarinpal: false }),
      liveTrackingEnabled: async () => false, isBusy: async () => false } as never,
    zones: {} as never, notifications })
  const service = new PaymentService({ db, config, orders: orderService, hub: { publish: () => undefined } as never, notifications })
  const secondWorker = new PaymentService({ db, config, orders: orderService, hub: { publish: () => undefined } as never, notifications })
  // The fixture is always open. Avoid Bun's known parallel settings-read stall
  // on reserved transaction connections; financial locks and allocation remain real.
  for (const worker of [service, secondWorker]) {
    (worker as unknown as { settings: { assertOrderPaymentsAllowed: () => Promise<void> } }).settings
      .assertOrderPaymentsAllowed = async () => undefined
  }
  const [main] = await db.insert(mainCategories).values({ name: 'Mellat test', slug: 'mellat-test' }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Meals', slug: 'mellat-meals' }).returning()
  const [product] = await db.insert(products).values({ categoryId: category!.id, name: 'Meal', originalPrice: 100_000 }).returning()
  let serial = 0
  const make = async (userId?: string) => {
    if (!userId) {
      const [user] = await db.insert(users).values({ phone: `0935${String(++serial).padStart(7, '0')}` }).returning()
      userId = user!.id
      await db.insert(walletTransactions).values({ userId, type: 'DEPOSIT', amount: 20_000, description: 'Scratch wallet funding' })
    }
    const checkout = await orderService.checkout(userId, { items: [{ productId: product!.id, quantity: 1 }],
      deliveryType: 'DINE_IN', useWallet: true, gatewayId: 'MELLAT' })
    assert(checkout.paymentId)
    const [order] = await db.select().from(orders).where(eq(orders.displayId, checkout.displayId))
    return { userId, order: order!, paymentId: checkout.paymentId, checkout }
  }
  type Fixture = Awaited<ReturnType<typeof make>>
  const payment = async (id: Fixture['paymentId']) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!
  const order = async (id: Fixture['order']['id']) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
  const ledger = (id: Fixture['order']['id']) => db.select().from(walletTransactions).where(eq(walletTransactions.orderId, id))
  const findings = (id: Fixture['paymentId']) => db.select().from(reconcileFindings).where(and(
    eq(reconcileFindings.checkId, 'R12'), eq(reconcileFindings.entityId, id)))
  const init = (fixture: Fixture, worker = service) => worker.initiate(fixture.paymentId, 'MELLAT',
    { displayId: fixture.order.displayId, amount: fixture.checkout.amountPaidOnline })
  const inits: Array<{ orderId: string; paymentId: string; token: string }> = []
  const verifications: Array<{ orderId: string; receipt: string }> = []
  const replies = new Map<string, { orderId: string; verify: string; settle: string }>()
  let initBehavior: 'success' | 'timeout' | 'reject' = 'success'
  let useLongToken = false
  let initHook: () => Promise<void> = async () => undefined
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), 'https://bpm.shaparak.ir/pgwchannel/services/pgw')
    const body = String(options?.body)
    if (body.includes('<ns:bpPayRequest ')) {
      const orderId = field(body, 'orderId')
      const callbackUrl = field(body, 'callBackUrl').replaceAll('&amp;', '&')
      const paymentId = new URL(callbackUrl).searchParams.get('state')!.split('.')[0]!
      const [committed] = await db.select().from(payments).where(eq(payments.id, paymentId as Fixture['paymentId']))
      assert.equal(committed!.mellatOrderId?.toString(), orderId, 'numeric association committed before network dispatch')
      assert.equal(committed!.metadata?.mellatDispatched, true, 'dispatch marker is durable before bank request')
      assert.equal(committed!.callbackUrl, callbackUrl)
      const token = useLongToken ? 'M'.repeat(100) : `TOKEN${orderId}`
      inits.push({ orderId, paymentId, token })
      const behavior = initBehavior
      await initHook()
      if (behavior === 'timeout') throw new Error('Simulated response loss after bank receives bpPayRequest')
      if (behavior === 'reject') return soap('13')
      return soap(`0,${token}`)
    }
    const orderId = field(body, 'orderId'), receipt = field(body, 'saleReferenceId')
    assert.equal(field(body, 'saleOrderId'), orderId)
    const reply = replies.get(receipt)
    if (body.includes('<ns:bpVerifyRequest ')) {
      verifications.push({ orderId, receipt })
      return soap(reply?.orderId === orderId ? reply.verify : '41')
    }
    if (body.includes('<ns:bpSettleRequest ')) return soap(reply?.orderId === orderId ? reply.settle : '41')
    throw new Error('Unexpected SOAP operation')
  }) as typeof fetch
  let receiptSerial = 900_000_000_000_000n
  const queryFor = (request: { orderId: string; token?: string }, verify = '0', settle = '0') => {
    const receipt = String(++receiptSerial)
    replies.set(receipt, { orderId: request.orderId, verify, settle })
    return { ResCode: '0', SaleOrderId: request.orderId, SaleReferenceId: receipt,
      ...(request.token ? { RefId: request.token } : {}) }
  }
  const callback = (id: Fixture['paymentId'], query: Record<string, string>) => service.handleCallback('MELLAT',
    { state: signState(id, config.jwtSecret), ...query })

  // Fixture construction is sequential; the bank allocations/requests below
  // are concurrent. This avoids unrelated Bun Windows concurrent read failures.
  const concurrent: Fixture[] = []
  for (let index = 0; index < 16; index++) concurrent.push(await make())
  const beforeConcurrent = inits.length
  await Promise.all(concurrent.map((fixture, index) => init(fixture, index % 2 ? secondWorker : service)))
  const concurrentRequests = inits.slice(beforeConcurrent)
  assert.equal(concurrentRequests.length, 16)
  assert.equal(new Set(concurrentRequests.map(request => request.orderId)).size, 16)
  assert(concurrentRequests.every(request => BigInt(request.orderId) >= 281474976710656n))
  await Promise.all(concurrent.map(fixture => assert.rejects(() => init(fixture))))
  assert.equal(inits.length, beforeConcurrent + 16)
  passed('independent workers commit distinct IDs before 16 concurrent bank requests; repeat initiation cannot reuse one')

  const timedOut = await make()
  initBehavior = 'timeout'
  await assert.rejects(() => init(timedOut))
  initBehavior = 'success'
  const timedOutRequest = inits.at(-1)!
  const timedOutRow = await payment(timedOut.paymentId)
  assert.equal(timedOutRow.gatewayRef, null)
  assert.equal(timedOutRow.status, 'PENDING')
  assert.equal(timedOutRow.mellatOrderId?.toString(), timedOutRequest.orderId)
  await db.update(payments).set({ updatedAt: new Date(Date.now() - 2 * 60_000) }).where(eq(payments.id, timedOut.paymentId))
  const beforeTimeoutRetry = inits.length
  await assert.rejects(() => init(timedOut))
  await assert.rejects(() => service.retryInitiation(timedOut.userId, timedOut.order.displayId))
  assert.equal(inits.length, beforeTimeoutRetry, 'an unknown dispatch cannot be repeated or superseded on the same order')
  const oldLedger = await ledger(timedOut.order.id)
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, timedOut.order.id))
  await service.reconcileOwnedOrder(timedOut.userId, timedOut.order.displayId)
  assert.equal((await order(timedOut.order.id)).status, 'PENDING_PAYMENT')
  assert.deepEqual(await ledger(timedOut.order.id), oldLedger)
  const independent = await make(timedOut.userId)
  await init(independent)
  const independentRequest = inits.at(-1)!
  assert.notEqual(independentRequest.orderId, timedOutRequest.orderId)
  const independentQuery = queryFor(independentRequest)
  await callback(independent.paymentId, independentQuery)
  const independentlyPaid = await order(independent.order.id)
  assert.equal(independentlyPaid.status, 'PAID')
  assert.equal((await order(timedOut.order.id)).status, 'PENDING_PAYMENT')
  const mismatched = queryFor(independentRequest)
  const callsBeforeMismatch = verifications.length
  await callback(timedOut.paymentId, mismatched)
  assert.equal(verifications.length, callsBeforeMismatch, 'a newer order callback cannot retarget the older state')
  assert.equal((await payment(timedOut.paymentId)).gatewayRef, null)
  const lateQuery = queryFor(timedOutRequest)
  await Promise.all([callback(timedOut.paymentId, lateQuery), callback(timedOut.paymentId, lateQuery)])
  assert.equal((await order(timedOut.order.id)).status, 'PAID')
  assert.equal((await payment(timedOut.paymentId)).gatewayRef, `${timedOutRequest.orderId}:s:${lateQuery.SaleReferenceId}`)
  assert.equal((await payment(timedOut.paymentId)).mellatOrderId, timedOutRow.mellatOrderId)
  assert.deepEqual(await order(independent.order.id), independentlyPaid)
  assert.deepEqual(await ledger(timedOut.order.id), oldLedger)
  assert.equal((await db.select().from(firstPurchaseReservations).where(eq(firstPurchaseReservations.userId, timedOut.userId))).length, 0)
  passed('lost initialization response preserves original ID/holds; independent checkout pays and late original callbacks settle only their order')

  const rejected = await make()
  initBehavior = 'reject'
  await assert.rejects(() => init(rejected))
  initBehavior = 'success'
  const rejectedRequest = inits.at(-1)!
  const beforeRejectedRetry = inits.length
  const retryResults = await Promise.allSettled([
    service.retryInitiation(rejected.userId, rejected.order.displayId),
    secondWorker.retryInitiation(rejected.userId, rejected.order.displayId),
  ])
  assert(retryResults.some(result => result.status === 'fulfilled'))
  assert.equal(inits.length, beforeRejectedRetry + 1)
  const retriedRequest = inits.at(-1)!
  assert.notEqual(retriedRequest.orderId, rejectedRequest.orderId)
  assert.notEqual(retriedRequest.paymentId, rejectedRequest.paymentId)
  assert.equal((await payment(rejected.paymentId)).status, 'FAILED')
  assert.equal((await payment(rejected.paymentId)).mellatOrderId?.toString(), rejectedRequest.orderId)
  const lateRejected = queryFor(rejectedRequest)
  await callback(rejected.paymentId, lateRejected)
  assert.equal((await findings(rejected.paymentId))[0]!.status, 'open', 'unexpected success on superseded attempt requires its own review')
  const retriedId = retriedRequest.paymentId as Fixture['paymentId']
  assert.equal((await payment(retriedId)).status, 'PENDING')
  assert.equal((await order(rejected.order.id)).status, 'PENDING_PAYMENT')
  const retriedQuery = queryFor(retriedRequest)
  await callback(retriedId, retriedQuery)
  const paidRetry = await order(rejected.order.id)
  await callback(rejected.paymentId, lateRejected)
  assert.deepEqual(await order(rejected.order.id), paidRetry)
  assert.equal((await payment(retriedId)).status, 'SUCCESS')
  assert.equal((await ledger(rejected.order.id)).filter(row => row.type === 'WITHDRAW').length, 1)
  passed('definitively rejected initialization retries use a new payment and new ID; late older-attempt evidence never settles its replacement')

  for (const settlement of ['success', 'unknown'] as const) {
    const slow = await make()
    const entered = gate(), finish = gate()
    initHook = async () => { entered.release(); await finish.promise }
    const pendingInit = init(slow)
    const pendingResult = pendingInit.then(value => ({ value }), error => ({ error }))
    await entered.promise
    const request = inits.at(-1)!
    const query = queryFor(request, '0', settlement === 'success' ? '0' : '44')
    await callback(slow.paymentId, query)
    const evidence = await payment(slow.paymentId)
    assert.equal(evidence.gatewayRef, `${request.orderId}:s:${query.SaleReferenceId}`)
    assert.deepEqual(evidence.metadata?.callbackQuery, query)
    finish.release()
    const result = await pendingResult
    initHook = async () => undefined
    assert('error' in result, 'init must not hand out a token after callback receipt evidence changed its reference')
    const saved = await payment(slow.paymentId)
    assert.equal(saved.gatewayRef, evidence.gatewayRef)
    assert.equal(saved.mellatOrderId, evidence.mellatOrderId)
    assert.deepEqual(saved.metadata?.callbackQuery, query)
    assert.deepEqual(saved.metadata?.verification, evidence.metadata?.verification)
    if (settlement === 'unknown') {
      replies.get(query.SaleReferenceId!)!.settle = '0'
      await callback(slow.paymentId, query)
    }
    assert.equal((await order(slow.order.id)).status, 'PAID')
  }
  passed('callback success and indeterminate receipt during slow initialization preserve request association and financial evidence')

  const legacy = await make()
  const legacyId = String(Number.parseInt(new Bun.CryptoHasher('sha256').update(`mellat:${legacy.paymentId}`).digest('hex').slice(0, 12), 16))
  const legacyToken = 'LEGACYTOKEN'
  await db.update(payments).set({ gatewayRef: `${legacyId}:t:${legacyToken}`, metadata: { paymentUrl: `https://bpm.shaparak.ir/StartPay/${legacyToken}` } })
    .where(eq(payments.id, legacy.paymentId))
  const beforeLegacy = inits.length
  const resumed = await service.retryInitiation(legacy.userId, legacy.order.displayId)
  assert.equal(resumed.paymentUrl, `https://bpm.shaparak.ir/StartPay/${legacyToken}`)
  assert.equal(inits.length, beforeLegacy)
  const legacyQuery = queryFor({ orderId: legacyId, token: legacyToken })
  await callback(legacy.paymentId, legacyQuery)
  assert.equal((await order(legacy.order.id)).status, 'PAID')
  assert.equal((await payment(legacy.paymentId)).mellatOrderId, null)
  assert.equal((await payment(legacy.paymentId)).gatewayRef, `${legacyId}:s:${legacyQuery.SaleReferenceId}`)
  passed('legacy hash/token records resume and verify without allocation or rewriting their composite references')

  const legacyLost = await make()
  await db.update(payments).set({ metadata: { initToken: 'legacy-response-lost', initFailed: true },
    updatedAt: new Date(Date.now() - 2 * 60_000) }).where(eq(payments.id, legacyLost.paymentId))
  const beforeLegacyLost = inits.length
  const legacyLostLedger = await ledger(legacyLost.order.id)
  await assert.rejects(() => init(legacyLost))
  await assert.rejects(() => service.retryInitiation(legacyLost.userId, legacyLost.order.displayId))
  assert.equal(inits.length, beforeLegacyLost)
  assert.equal((await payment(legacyLost.paymentId)).mellatOrderId, null, 'cannot assign a new identity to an old lost request')
  await db.update(orders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(orders.id, legacyLost.order.id))
  await service.reconcileOwnedOrder(legacyLost.userId, legacyLost.order.displayId)
  assert.equal((await order(legacyLost.order.id)).status, 'PENDING_PAYMENT')
  assert.deepEqual(await ledger(legacyLost.order.id), legacyLostLedger)
  assert.equal((await payment(legacyLost.paymentId)).status, 'PENDING')
  const afterLegacyLost = await make(legacyLost.userId)
  await init(afterLegacyLost)
  await callback(afterLegacyLost.paymentId, queryFor(inits.at(-1)!))
  assert.equal((await order(afterLegacyLost.order.id)).status, 'PAID')
  assert.equal((await order(legacyLost.order.id)).status, 'PENDING_PAYMENT')
  passed('ambiguous legacy initialization keeps its original evidence and holds while an independent new order pays')

  await db.execute(sql`select setval('public.mellat_order_id_seq', 9223372036854775807, false)`)
  const last = await make()
  useLongToken = true
  await init(last)
  useLongToken = false
  const lastRequest = inits.at(-1)!
  assert.equal(lastRequest.orderId, '9223372036854775807')
  assert.equal((await payment(last.paymentId)).gatewayRef?.length, 122, 'full signed-long prefix preserves the supported 100-character token')
  const maximumResume = await service.retryInitiation(last.userId, last.order.displayId)
  assert.equal(maximumResume.paymentUrl, `https://bpm.shaparak.ir/StartPay/${lastRequest.token}`)
  const finalQuery = queryFor(lastRequest)
  await callback(last.paymentId, finalQuery)
  assert.equal((await payment(last.paymentId)).gatewayRef, `9223372036854775807:s:${finalQuery.SaleReferenceId}`)
  const exhausted = await make()
  const beforeExhaustion = inits.length
  await assert.rejects(() => init(exhausted), (error: unknown) =>
    error instanceof Error && (error as { code?: string }).code === 'CONFLICT' && error.message.includes('ظرفیت'))
  assert.equal(inits.length, beforeExhaustion)
  assert.equal((await payment(exhausted.paymentId)).mellatOrderId, null)
  assert.equal((await payment(exhausted.paymentId)).status, 'PENDING')
  passed('signed-long maximum travels without rounding; exhaustion rolls allocation back and sends no bank request')
  console.log(`Mellat request safety: ${checks} scenarios passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
