/** Actual gateway adapters and financial transactions, with only PSP HTTP and
 * notifications stubbed. Every database write stays in a fresh local scratch DB. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import type { CheckoutInput } from '@sinshin/shared'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { OrderService } from '../src/domain/order/order.service'
import { PaymentService } from '../src/domain/payment/payment.service'
import { CheckoutIdempotency, checkoutRequestHash } from '../src/domain/order/checkout-idempotency.service'
import { signState } from '../src/domain/payment/state'
import { asCampaignId } from '../src/domain/shared/brand'
import { lockWalletAccounts } from '../src/domain/shared/wallet-sql'
import {
  categories, couponGrants, couponRedemptions, coupons, firstPurchaseReservations,
  mainCategories, orders, payments, products, reconcileFindings, users, walletTransactions,
} from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_recovery_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const soap = (value: string) => new Response(`<Envelope><Body><return>${value}</return></Body></Envelope>`,
  { headers: { 'content-type': 'text/xml' } })
const originalFetch = globalThis.fetch
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
let initCalls = 0, verifyCalls = 0
const initRequests: Array<{ gateway: string; paymentId: string; reference: string; amount: number; orderId?: string }> = []
const zarinpal = new Map<string, { code: number; inquiry?: string }>()
const verifiedAuthorities: string[] = []
const verifyHooks = new Map<string, () => Promise<void>>()
let sepReply: unknown = { IsSuccess: false, ResultCode: -6 }
const sepReplies = new Map<string, unknown>()
let mellatVerify: string = 'outage'
let mellatSettle = '0'
const mellatReplies = new Map<string, { verify: string; settle: string }>()
globalThis.fetch = (async (url: string | URL | Request, input?: RequestInit) => {
  const address = String(url)
  if (address.includes('/pg/v4/payment/')) {
    const body = JSON.parse(String(input?.body)) as { authority?: string; callback_url?: string; amount?: number }
    if (address.endsWith('/request.json')) {
      const paymentId = new URL(body.callback_url!).searchParams.get('state')!.split('.')[0]!
      const authority = `A${paymentId.replaceAll('-', '')}`
      initCalls++; initRequests.push({ gateway: 'ZARINPAL', paymentId, reference: authority, amount: body.amount! })
      return json({ data: { code: 100, authority } })
    }
    const state = zarinpal.get(body.authority ?? '') ?? { code: -51, inquiry: 'FAILED' }
    if (address.endsWith('/verify.json')) {
      verifyCalls++; verifiedAuthorities.push(body.authority ?? '')
      await verifyHooks.get(body.authority ?? '')?.()
      return json({ data: { code: state.code } })
    }
    if (address.endsWith('/inquiry.json')) return json({ data: { code: 100, status: state.inquiry ?? 'FAILED' }, errors: [] })
  }
  if (address.includes('sep.ir') || address.includes('sep.shaparak.ir')) {
    const body = JSON.parse(String(input?.body)) as { RefNum?: string; ResNum?: string; Amount?: number }
    if (address.includes('Verify')) { verifyCalls++; return json(sepReplies.get(body.RefNum ?? '') ?? sepReply) }
    const token = `T${body.ResNum!.replaceAll('-', '')}`
    initCalls++; initRequests.push({ gateway: 'SEP', paymentId: body.ResNum!, reference: token, amount: body.Amount! })
    return json({ IsSuccess: true, Token: token })
  }
  if (address === 'https://bpm.shaparak.ir/pgwchannel/services/pgw') {
    const envelope = String(input?.body)
    if (envelope.includes('<ns:bpPayRequest ')) {
      const orderId = /<orderId[^>]*>([^<]+)/.exec(envelope)![1]!
      const callbackUrl = /<callBackUrl[^>]*>([^<]+)/.exec(envelope)![1]!.replaceAll('&amp;', '&')
      const paymentId = new URL(callbackUrl).searchParams.get('state')!.split('.')[0]!
      const token = `M${orderId}`
      initCalls++; initRequests.push({ gateway: 'MELLAT', paymentId, reference: token, orderId,
        amount: Number(/<amount[^>]*>([^<]+)/.exec(envelope)![1]) })
      return soap(`0,${token}`)
    }
    const receipt = /<saleReferenceId[^>]*>([^<]+)/.exec(envelope)?.[1] ?? ''
    const reply = mellatReplies.get(receipt)
    if (envelope.includes('<ns:bpVerifyRequest ')) {
      verifyCalls++
      const result = reply?.verify ?? mellatVerify
      if (result === 'outage') throw new Error('Stubbed Mellat verification outage')
      return soap(result)
    }
    if (envelope.includes('<ns:bpSettleRequest ')) return soap(reply?.settle ?? mellatSettle)
  }
  throw new Error(`Unexpected external request: ${address}`)
}) as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(target.toString(), { max: 12 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: target.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'payment-recovery-regression-'.repeat(3), SITE_URL: 'https://sinshin.example',
    ZARINPAL_MERCHANT_ID: 'test-merchant', SEP_TERMINAL_ID: '12345678',
    MELLAT_TERMINAL_ID: '111222333', MELLAT_USERNAME: 'stub', MELLAT_PASSWORD: 'stub',
  })
  const couponService = new CouponService({ db })
  const orderService = new OrderService({ db, config, coupons: couponService,
    settings: {
      assertOrderPaymentsAllowed: async () => undefined, restaurantStatus: async () => ({ anyClosed: false }),
      liveTrackingEnabled: async () => false, isBusy: async () => false,
      enabledGateways: async () => ({ zarinpal: true, sep: true, mellat: true }),
    } as never, zones: {} as never, notifications: { notifyUser: async () => undefined } as never,
  })
  const service = new PaymentService({ db, config, orders: orderService,
    hub: { publish: () => undefined } as never,
    notifications: { notifyUser: async () => undefined, notifyAdminsNewOrder: async () => undefined } as never,
  })
  const [main] = await db.insert(mainCategories).values({ name: 'Recovery menu', slug: 'recovery-menu' }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: main!.id, name: 'Recovery meals', slug: 'recovery-meals' }).returning()
  const [product] = await db.insert(products).values({ categoryId: category!.id, name: 'Recovery meal', originalPrice: 100_000 }).returning()
  const firstCoupon = await couponService.create({ code: 'RECFIRST', discountPercentage: 20,
    maxUses: 0, maxPerUser: 0, isPublic: false, expiryDate: null, rules: [{ type: 'FIRST_PURCHASE', params: {} }] })
  assert(firstCoupon.id)
  const input: CheckoutInput = { items: [{ productId: product!.id, quantity: 1 }], deliveryType: 'DINE_IN',
    useWallet: true, gatewayId: 'ZARINPAL' }
  const readOrder = async (id: typeof orders.$inferSelect.id) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
  const readPayment = async (id: typeof payments.$inferSelect.id) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!
  const findings = (id: typeof payments.$inferSelect.id) => db.select().from(reconcileFindings).where(and(
    eq(reconcileFindings.checkId, 'R12'), eq(reconcileFindings.entityId, id),
  ))
  const ownerOrders = (id: string) => db.select().from(orders).where(eq(orders.userId, id))
  const reservation = (id: string) => db.select().from(firstPurchaseReservations).where(eq(firstPurchaseReservations.userId, id))
  const ledger = (id: typeof orders.$inferSelect.id) => db.select().from(walletTransactions).where(eq(walletTransactions.orderId, id))
  const grant = async (id: string) => (await db.select().from(couponGrants).where(eq(couponGrants.userId, id)))[0]
  const redemption = (id: typeof orders.$inferSelect.id) => db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, id))
  const balance = (id: string) => orderService.walletBalance(db, id)
  const due = async (id: typeof payments.$inferSelect.id) => {
    const row = await readPayment(id)
    if (row.metadata?.verification) await db.update(payments).set({ metadata: { ...row.metadata,
      verification: { ...(row.metadata.verification as Record<string, unknown>), nextAt: new Date(0).toISOString(), leaseUntil: new Date(0).toISOString() },
    } }).where(eq(payments.id, id))
  }
  let serial = 0
  const make = async (gateway: 'ZARINPAL' | 'SEP' | 'MELLAT' = 'ZARINPAL', returning = false) => {
    const n = ++serial
    const [user] = await db.insert(users).values({ phone: `0938${String(n).padStart(7, '0')}` }).returning()
    if (returning) await db.insert(orders).values({ userId: user!.id, displayId: `ord-rec-history-${n}`,
      status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 0,
      breakdown: { foodTotal: 0, discount: 0, walletDeduction: 0, amountPaidOnline: 0,
        deliveryFee: 0, packagingFee: 0, totalAmount: 0 },
    })
    await db.insert(walletTransactions).values({ userId: user!.id, type: 'DEPOSIT', amount: 20_000, description: 'Scratch recovery funding' })
    const checkoutInput = { ...input, gatewayId: gateway, ...(returning ? {} : { couponCode: 'RECFIRST' }) }
    const checkout = await orderService.checkout(user!.id, checkoutInput)
    assert(checkout.paymentId)
    const [order] = await db.select().from(orders).where(eq(orders.displayId, checkout.displayId))
    await service.initiate(checkout.paymentId, gateway, { displayId: checkout.displayId, amount: checkout.amountPaidOnline })
    await db.update(orders).set({ createdAt: new Date(Date.now() - 20 * 60_000) }).where(eq(orders.id, order!.id))
    return { user: user!, order: (await readOrder(order!.id)), payment: await readPayment(checkout.paymentId), input: checkoutInput }
  }
  const callback = (fixture: Pick<Awaited<ReturnType<typeof make>>, 'payment'>, query: Record<string, string> = {}) =>
    service.handleCallback(fixture.payment.gateway, { state: signState(fixture.payment.id, config.jwtSecret), ...query })

  const idempotency = new CheckoutIdempotency({ db })
  let receiptSequence = 800_000_000_000_000
  const gatewayResult = (payment: typeof payments.$inferSelect, outcome: 'success' | 'unknown' | 'failure'): Record<string, string> => {
    if (payment.gateway === 'ZARINPAL') {
      zarinpal.set(payment.gatewayRef!, outcome === 'success' ? { code: 100 }
        : { code: -51, inquiry: outcome === 'failure' ? 'REVERSED' : 'FAILED' })
      return { Status: outcome === 'success' ? 'OK' : 'NOK' }
    }
    if (payment.gateway === 'SEP') {
      const receipt = `S${payment.id.replaceAll('-', '')}`
      sepReplies.set(receipt, outcome === 'success' ? { IsSuccess: true, RefNum: receipt,
        ResNum: payment.id, TerminalId: '12345678', Amount: payment.amount * 10 }
        : { IsSuccess: false, ResultCode: -6 })
      return { State: outcome === 'success' ? 'OK' : 'Canceled', RefNum: receipt,
        ResNum: payment.id, TerminalId: '12345678' }
    }
    const [orderId, , token] = payment.gatewayRef!.split(':')
    const receipt = String(++receiptSequence)
    mellatReplies.set(receipt, { verify: outcome === 'success' ? '0' : outcome === 'failure' ? '48' : '41', settle: '0' })
    return { ResCode: outcome === 'success' ? '0' : '17', SaleOrderId: orderId!, RefId: token!, SaleReferenceId: receipt }
  }

  for (const gateway of ['ZARINPAL', 'SEP', 'MELLAT'] as const) {
    const original = await make(gateway)
    const ordinary: CheckoutInput = { ...input, gatewayId: gateway, customerNote: 'Independent purchase' }
    const beforeNewPreviewVerify = verifyCalls
    const normalPreview = await orderService.preview(original.user.id, ordinary)
    assert.equal(verifyCalls, beforeNewPreviewVerify, 'new-order preview never depends on the old PSP verification/outage')
    assert.equal(normalPreview.paymentRecovery?.blocksPayment, false)
    assert.equal(normalPreview.breakdown.totalAmount, 100_000)
    assert.equal(normalPreview.breakdown.amountPaidOnline, 100_000)
    assert.equal(normalPreview.breakdown.walletDeduction, 0)
    assert.equal(normalPreview.coupon, null)
    const heldLedger = await ledger(original.order.id)
    const heldGrant = await grant(original.user.id)
    const heldReservation = await reservation(original.user.id)
    assert.equal(heldReservation[0]!.orderId, original.order.id)
    assert.equal((await readPayment(original.payment.id)).gatewayRef, original.payment.gatewayRef)
    assert.equal((await readOrder(original.order.id)).status, 'PENDING_PAYMENT')

    const firstKey = `independent-${gateway}-one`, secondKey = `independent-${gateway}-two`
    const hash = checkoutRequestHash(ordinary)
    const [claimOne, claimTwo] = await Promise.all([
      idempotency.claim(original.user.id, firstKey, hash), idempotency.claim(original.user.id, secondKey, hash),
    ])
    assert.equal(claimOne.kind, 'claimed'); assert.equal(claimTwo.kind, 'claimed')
    if (claimOne.kind !== 'claimed' || claimTwo.kind !== 'claimed') throw new Error('Independent claims expected')
    assert.equal((await idempotency.claim(original.user.id, firstKey, hash)).kind, 'in-flight')
    const [one, two] = await Promise.all([
      orderService.checkout(original.user.id, ordinary, { key: firstKey, token: claimOne.token }),
      orderService.checkout(original.user.id, ordinary, { key: secondKey, token: claimTwo.token }),
    ])
    assert.equal(verifyCalls, beforeNewPreviewVerify, 'independent checkout never verifies or waits for the old PSP')
    assert(one.paymentId && two.paymentId)
    assert.notEqual(one.displayId, two.displayId); assert.notEqual(one.paymentId, two.paymentId)
    assert.equal(one.breakdown.discount, 0); assert.equal(two.breakdown.discount, 0)
    assert.equal(one.breakdown.walletDeduction + two.breakdown.walletDeduction, 0)
    assert.equal((await ownerOrders(original.user.id)).length, 3)
    const sameKeyReplay = await idempotency.claim(original.user.id, firstKey, hash)
    assert.equal(sameKeyReplay.kind, 'replay')
    assert.equal(sameKeyReplay.kind === 'replay' && sameKeyReplay.response.orderId, one.displayId)
    await assert.rejects(() => orderService.checkout(original.user.id, ordinary, { key: firstKey, token: claimOne.token }))
    assert.equal((await ownerOrders(original.user.id)).length, 3)
    const [oneUrl, twoUrl] = await Promise.all([
      service.initiate(one.paymentId, gateway, { displayId: one.displayId, amount: one.amountPaidOnline }),
      service.initiate(two.paymentId, gateway, { displayId: two.displayId, amount: two.amountPaidOnline }),
    ])
    assert.notEqual(oneUrl.paymentUrl, twoUrl.paymentUrl)
    assert.notEqual(oneUrl.paymentUrl, original.payment.metadata!.paymentUrl)
    const providerInits = initRequests.filter(request => [original.payment.id, one.paymentId, two.paymentId].includes(request.paymentId as never))
    assert.equal(providerInits.length, 3)
    assert.equal(new Set(providerInits.map(request => request.reference)).size, 3)
    assert.equal(new Set(providerInits.map(request => request.paymentId)).size, 3)
    if (gateway === 'MELLAT') assert.equal(new Set(providerInits.map(request => request.orderId)).size, 3)
    assert.equal(providerInits.find(request => request.paymentId === original.payment.id)!.amount, original.payment.amount * 10)
    assert.equal(providerInits.find(request => request.paymentId === one.paymentId)!.amount, 1_000_000)
    const newOrder = (await db.select().from(orders).where(eq(orders.displayId, one.displayId)))[0]!
    const secondOrder = (await db.select().from(orders).where(eq(orders.displayId, two.displayId)))[0]!
    const newPayment = await readPayment(one.paymentId)
    const secondPayment = await readPayment(two.paymentId)
    assert.equal(newOrder.couponId, null); assert.equal(secondOrder.couponId, null)
    await callback({ payment: newPayment }, gatewayResult(newPayment, 'success'))
    assert.equal((await readOrder(newOrder.id)).status, 'PAID')
    assert.equal((await readOrder(original.order.id)).status, 'PENDING_PAYMENT')
    assert.equal((await readPayment(original.payment.id)).status, 'PENDING')
    assert.equal((await readOrder(secondOrder.id)).status, 'PENDING_PAYMENT')
    assert.deepEqual(await ledger(original.order.id), heldLedger)
    assert.deepEqual(await grant(original.user.id), heldGrant)
    assert.deepEqual(await reservation(original.user.id), heldReservation)
    assert.equal(await balance(original.user.id), 0)
    assert.equal((await redemption(newOrder.id)).length, 0)
    assert.equal((await orderService.preview(original.user.id, original.input)).coupon?.valid, false)
    const paidSnapshot = await readOrder(newOrder.id), paidPaymentSnapshot = await readPayment(newPayment.id)
    const secondSnapshot = await readOrder(secondOrder.id)

    const oldUnknownQuery = gatewayResult(original.payment, 'unknown')
    await Promise.all([callback(original, oldUnknownQuery), callback(original, oldUnknownQuery)])
    assert.equal((await readOrder(original.order.id)).status, 'PENDING_PAYMENT')
    assert.deepEqual(await ledger(original.order.id), heldLedger)
    assert.deepEqual(await readOrder(newOrder.id), paidSnapshot)
    assert.deepEqual(await readPayment(newPayment.id), paidPaymentSnapshot)
    assert.deepEqual(await readOrder(secondOrder.id), secondSnapshot)
    const oldSuccessQuery = gatewayResult(original.payment, 'success')
    await Promise.all([callback(original, oldSuccessQuery), callback(original, oldSuccessQuery)])
    assert.equal((await readOrder(original.order.id)).status, 'PAID')
    assert.equal((await readPayment(original.payment.id)).status, 'SUCCESS')
    assert.equal((await redemption(original.order.id)).length, 1)
    assert.equal((await reservation(original.user.id)).length, 0)
    assert.deepEqual(await ledger(original.order.id), heldLedger)
    assert.deepEqual(await readOrder(newOrder.id), paidSnapshot)
    assert.deepEqual(await readPayment(newPayment.id), paidPaymentSnapshot)
    assert.equal((await redemption(newOrder.id)).length, 0)
    const callsAfterPaid = verifyCalls
    await callback(original, oldUnknownQuery)
    assert.equal(verifyCalls, callsAfterPaid)
    await callback({ payment: secondPayment }, gatewayResult(secondPayment, 'success'))
    assert.equal((await readOrder(secondOrder.id)).status, 'PAID')
    assert.equal((await ownerOrders(original.user.id)).length, 3)
    assert.equal((await ledger(newOrder.id)).length, 0)
    assert.equal((await ledger(secondOrder.id)).length, 0)
    passed(`${gateway}: new previews, distinct concurrent intents, distinct PSP sessions and new success remain independent of unknown/late-success old callbacks`)

    const failedOriginal = await make(gateway)
    const independent = await orderService.checkout(failedOriginal.user.id, ordinary)
    assert(independent.paymentId)
    await service.initiate(independent.paymentId, gateway, { displayId: independent.displayId, amount: independent.amountPaidOnline })
    const independentOrder = (await db.select().from(orders).where(eq(orders.displayId, independent.displayId)))[0]!
    const independentPayment = await readPayment(independent.paymentId)
    await callback({ payment: independentPayment }, gatewayResult(independentPayment, 'success'))
    const independentSnapshot = await readOrder(independentOrder.id)
    const independentPaymentSnapshot = await readPayment(independentPayment.id)
    const failureQuery = gatewayResult(failedOriginal.payment, 'failure')
    await callback(failedOriginal, failureQuery)
    await callback(failedOriginal, failureQuery)
    assert.deepEqual(await readOrder(independentOrder.id), independentSnapshot)
    assert.deepEqual(await readPayment(independentPayment.id), independentPaymentSnapshot)
    assert.equal((await ledger(independentOrder.id)).length, 0)
    assert.equal((await ownerOrders(failedOriginal.user.id)).length, 2)
    if (gateway === 'SEP') {
      // IsSuccess=false is not documented terminal nonpayment; never fabricate
      // a refund merely to free this original order's reservations.
      assert.equal((await readOrder(failedOriginal.order.id)).status, 'PENDING_PAYMENT')
      assert.equal((await reservation(failedOriginal.user.id))[0]!.orderId, failedOriginal.order.id)
      assert.equal(await balance(failedOriginal.user.id), 0)
    } else {
      assert.equal((await readOrder(failedOriginal.order.id)).status, 'CANCELED')
      assert.equal((await readPayment(failedOriginal.payment.id)).status, 'FAILED')
      assert.equal((await reservation(failedOriginal.user.id)).length, 0)
      assert.equal((await ledger(failedOriginal.order.id)).filter(row => row.type === 'DEPOSIT').length, 1)
      assert.equal(await balance(failedOriginal.user.id), 20_000)
    }
    assert.equal((await orderService.preview(failedOriginal.user.id, failedOriginal.input)).coupon?.valid, false,
      'the independently paid purchase consumes first-purchase eligibility even when the original hold is later released')
    passed(`${gateway}: old failure/unknown duplicates change only the original while the independently paid order and eligibility remain consistent`)
  }

  const unpaidNow = await make()
  const beforeVerify = verifyCalls, beforeInit = initCalls
  await service.reconcileOwnedOrder(unpaidNow.user.id, unpaidNow.order.displayId)
  const draft = await orderService.preview(unpaidNow.user.id, unpaidNow.input)
  assert.equal(draft.paymentRecovery?.orderId, unpaidNow.order.displayId)
  assert.equal(draft.coupon?.valid, false)
  assert.equal((await readOrder(unpaidNow.order.id)).status, 'PENDING_PAYMENT')
  assert.equal((await readPayment(unpaidNow.payment.id)).status, 'PENDING')
  assert.equal((await reservation(unpaidNow.user.id)).length, 1)
  assert((await grant(unpaidNow.user.id))?.consumedAt)
  assert.equal(await balance(unpaidNow.user.id), 0)
  assert.equal(verifyCalls, beforeVerify + 1)
  const [opened] = await findings(unpaidNow.payment.id)
  assert.equal(opened!.status, 'open')
  await Promise.all([orderService.preview(unpaidNow.user.id, unpaidNow.input), orderService.preview(unpaidNow.user.id, unpaidNow.input)])
  const blockedCoupon = await Promise.allSettled([orderService.checkout(unpaidNow.user.id, unpaidNow.input), orderService.checkout(unpaidNow.user.id, unpaidNow.input)])
  assert(blockedCoupon.every(result => result.status === 'rejected'), 'the held first-purchase coupon cannot be reserved twice')
  await assert.rejects(() => service.retryInitiation(unpaidNow.user.id, unpaidNow.order.displayId))
  assert.equal(verifyCalls, beforeVerify + 1)
  assert.equal(initCalls, beforeInit)
  assert.equal((await ownerOrders(unpaidNow.user.id)).length, 1)
  assert.equal((await findings(unpaidNow.payment.id))[0]!.occurrences, opened!.occurrences)
  const pendingState = await service.reconcileOwnedOrder(unpaidNow.user.id, unpaidNow.order.displayId)
  assert.equal(pendingState.orderId, unpaidNow.order.displayId); assert.equal(pendingState.status, 'PENDING_PAYMENT')
  await assert.rejects(() => service.reconcileOwnedOrder(crypto.randomUUID(), unpaidNow.order.displayId))
  passed('Zarinpal -51/FAILED preserves holds and first purchase, previews new prices, rejects duplicate first coupons, and backs off verification')

  zarinpal.set(unpaidNow.payment.gatewayRef!, { code: -51, inquiry: 'REVERSED' })
  await due(unpaidNow.payment.id)
  await Promise.all([service.reconcileOwnedOrder(unpaidNow.user.id, unpaidNow.order.displayId), service.reconcileOwnedOrder(unpaidNow.user.id, unpaidNow.order.displayId)])
  assert.equal((await readOrder(unpaidNow.order.id)).status, 'CANCELED')
  assert.equal((await readPayment(unpaidNow.payment.id)).status, 'FAILED')
  assert.equal(await balance(unpaidNow.user.id), 20_000)
  assert.equal((await reservation(unpaidNow.user.id)).length, 0)
  assert.equal((await grant(unpaidNow.user.id))?.consumedAt, null)
  assert.equal((await ledger(unpaidNow.order.id)).filter(row => row.type === 'DEPOSIT').length, 1)
  assert.equal((await findings(unpaidNow.payment.id))[0]!.status, 'auto_fixed')
  const freed = await orderService.preview(unpaidNow.user.id, unpaidNow.input)
  assert.equal(freed.paymentRecovery, null); assert.equal(freed.coupon?.valid, true)
  await service.reconcileOwnedOrder(unpaidNow.user.id, unpaidNow.order.displayId)
  assert.equal((await ledger(unpaidNow.order.id)).length, 2)
  const replacement = await orderService.checkout(unpaidNow.user.id, unpaidNow.input)
  assert.notEqual(replacement.displayId, unpaidNow.order.displayId)
  assert.equal((await reservation(unpaidNow.user.id)).length, 1)
  passed('authenticated reversal cancels exactly once and releases wallet, coupon and first purchase before a replacement order')

  const late = await make()
  await orderService.preview(late.user.id, late.input)
  await service.reconcileOwnedOrder(late.user.id, late.order.displayId)
  zarinpal.set(late.payment.gatewayRef!, { code: 100 })
  await Promise.all([callback(late, { Status: 'NOK' }), callback(late, { Status: 'OK' })])
  assert.equal((await readOrder(late.order.id)).status, 'PAID')
  assert.equal((await readPayment(late.payment.id)).status, 'SUCCESS')
  assert.equal((await ownerOrders(late.user.id)).length, 1)
  assert.equal((await ledger(late.order.id)).length, 1)
  assert.equal((await redemption(late.order.id)).length, 1)
  assert.equal((await reservation(late.user.id)).length, 0)
  assert.equal((await findings(late.payment.id))[0]!.status, 'auto_fixed')
  const afterSuccess = verifyCalls
  zarinpal.set(late.payment.gatewayRef!, { code: 101 })
  await callback(late)
  assert.equal(verifyCalls, afterSuccess)
  const firstDiscountAfterPaid = await orderService.preview(late.user.id, late.input)
  assert.equal(firstDiscountAfterPaid.coupon?.valid, false)
  passed('late real verification beats browser NOK and expiry, finalizes the original once, and consumes first-purchase eligibility once')

  for (const outcome of ['success', 'failure'] as const) {
    const raced = await make()
    await service.reconcileOwnedOrder(raced.user.id, raced.order.displayId)
    const [originalFinding] = await findings(raced.payment.id)
    assert.equal(originalFinding!.status, 'open')
    await due(raced.payment.id)
    const entered = gate(), resume = gate()
    verifyHooks.set(raced.payment.gatewayRef!, async () => {
      verifyHooks.delete(raced.payment.gatewayRef!)
      entered.release()
      await resume.promise
    })
    const inFlight = service.reconcileOwnedOrder(raced.user.id, raced.order.displayId)
    await entered.promise
    try {
      zarinpal.set(raced.payment.gatewayRef!, outcome === 'success'
        ? { code: 100 } : { code: -51, inquiry: 'REVERSED' })
      await callback(raced)
      assert.equal((await findings(raced.payment.id))[0]!.status, 'auto_fixed')
      // The old worker's response must remain unknown even though the callback
      // already settled the real payment and resolved its diagnostic.
      zarinpal.set(raced.payment.gatewayRef!, { code: -51, inquiry: 'FAILED' })
    } finally { resume.release() }
    await inFlight
    assert.equal((await readOrder(raced.order.id)).status, outcome === 'success' ? 'PAID' : 'CANCELED')
    assert.equal((await readPayment(raced.payment.id)).status, outcome === 'success' ? 'SUCCESS' : 'FAILED')
    assert.equal((await findings(raced.payment.id))[0]!.status, 'auto_fixed',
      'a stale unknown worker result cannot reopen R12 after concurrent terminal settlement')
    assert.equal((await findings(raced.payment.id))[0]!.occurrences, originalFinding!.occurrences)
    assert.equal((await ledger(raced.order.id)).length, outcome === 'success' ? 1 : 2)
    assert.equal((await reservation(raced.user.id)).length, 0)
  }
  passed('stale unknown worker results cannot reopen resolved R12 findings after concurrent success or definitive failure')

  const previouslyVerified = await make()
  zarinpal.set(previouslyVerified.payment.gatewayRef!, { code: 101 })
  await callback(previouslyVerified)
  assert.equal((await readOrder(previouslyVerified.order.id)).status, 'PAID')
  assert.equal((await readPayment(previouslyVerified.payment.id)).status, 'SUCCESS')
  assert.equal((await ownerOrders(previouslyVerified.user.id)).length, 1)
  assert.equal((await redemption(previouslyVerified.order.id)).length, 1)
  assert.equal((await reservation(previouslyVerified.user.id)).length, 0)
  passed('Zarinpal already-verified code 101 recovers and settles the original pending order')

  const persisted = await make()
  await db.update(payments).set({ status: 'SUCCESS', verifiedAt: new Date() }).where(eq(payments.id, persisted.payment.id))
  const [persistedSibling] = await db.insert(payments).values({ userId: persisted.user.id, orderId: persisted.order.id,
    gateway: 'ZARINPAL', mode: 'direct', amount: persisted.payment.amount, gatewayRef: `PERSISTEDSIB${serial}`,
  }).returning()
  const persistedCalls = verifiedAuthorities.filter(authority => authority === persisted.payment.gatewayRef).length
  await Promise.all([orderService.preview(persisted.user.id, persisted.input),
    service.reconcileOwnedOrder(persisted.user.id, persisted.order.displayId)])
  assert.equal((await readOrder(persisted.order.id)).status, 'PAID')
  assert.equal((await readPayment(persisted.payment.id)).status, 'SUCCESS')
  assert.equal((await readPayment(persistedSibling!.id)).status, 'PENDING')
  assert.equal((await ledger(persisted.order.id)).length, 1)
  assert.equal((await redemption(persisted.order.id)).length, 1)
  assert.equal((await reservation(persisted.user.id)).length, 0)
  assert.equal(await balance(persisted.user.id), 0)
  assert.equal((await ownerOrders(persisted.user.id)).length, 1)
  assert.equal((await findings(persisted.payment.id)).length, 0,
    'concurrent recovery of the already-settled original is not an additional successful payment finding')
  assert.equal(verifiedAuthorities.filter(authority => authority === persisted.payment.gatewayRef).length, persistedCalls,
    'persisted verified success is recovered without another PSP verification of that original attempt')
  assert((await orderService.preview(persisted.user.id, persisted.input)).paymentRecovery)
  const independentAfterRecovery = await orderService.checkout(persisted.user.id, input)
  assert.notEqual(independentAfterRecovery.displayId, persisted.order.displayId)
  assert.equal((await readPayment(persistedSibling!.id)).status, 'PENDING')
  await service.reconcileOwnedOrder(persisted.user.id, persisted.order.displayId)
  assert.equal((await ledger(persisted.order.id)).length, 1)
  assert.equal((await redemption(persisted.order.id)).length, 1)
  assert.equal((await findings(persisted.payment.id)).length, 0)
  passed('persisted verified success settles the original once without PSP calls; its unverified sibling preserves review while another independent order is allowed')

  const returning = await make('ZARINPAL', true)
  const oldCount = (await ownerOrders(returning.user.id)).length
  const returningPreview = await orderService.preview(returning.user.id, returning.input)
  assert.equal(returningPreview.paymentRecovery?.orderId, returning.order.displayId)
  const returningNewOrder = await orderService.checkout(returning.user.id, { ...returning.input, useWallet: false })
  assert.notEqual(returningNewOrder.displayId, returning.order.displayId)
  assert.equal((await ownerOrders(returning.user.id)).length, oldCount + 1)
  assert.equal((await readPayment(returning.payment.id)).status, 'PENDING')
  passed('stale unknown payment preserves its financial record while returning customers create an independent order')

  const [legacySecondOrder] = await db.insert(orders).values({ userId: returning.user.id, displayId: 'ord-rec-legacy',
    status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', deliveryType: 'DINE_IN', totalAmount: 100_000,
    breakdown: { foodTotal: 100_000, discount: 0, walletDeduction: 0, amountPaidOnline: 100_000,
      deliveryFee: 0, packagingFee: 0, totalAmount: 100_000 },
  }).returning()
  const [legacySecondAttempt] = await db.insert(payments).values({ userId: returning.user.id,
    orderId: legacySecondOrder!.id, gateway: 'ZARINPAL', mode: 'direct', amount: 100_000,
  }).returning()
  const beforeLegacyInit = initCalls
  await service.initiate(legacySecondAttempt!.id, 'ZARINPAL', { displayId: legacySecondOrder!.displayId, amount: 100_000 })
  assert.equal(initCalls, beforeLegacyInit + 1)
  assert.notEqual((await readPayment(legacySecondAttempt!.id)).gatewayRef, returning.payment.gatewayRef)
  assert.equal((await readPayment(returning.payment.id)).status, 'PENDING')
  passed('distinct pending orders initialize distinct PSP sessions without changing an earlier unresolved attempt')

  const siblingFixture = await make()
  const [paidAttempt] = await db.insert(payments).values({ userId: siblingFixture.user.id, orderId: siblingFixture.order.id,
    gateway: 'ZARINPAL', mode: 'direct', amount: siblingFixture.payment.amount, gatewayRef: `SIB${serial}`,
  }).returning()
  zarinpal.set(paidAttempt!.gatewayRef!, { code: 100 })
  await service.handleCallback('ZARINPAL', { state: signState(paidAttempt!.id, config.jwtSecret) })
  assert.equal((await readOrder(siblingFixture.order.id)).status, 'PAID')
  assert.equal((await readPayment(siblingFixture.payment.id)).status, 'PENDING')
  const blockedBySibling = await orderService.preview(siblingFixture.user.id, input)
  assert.equal(blockedBySibling.paymentRecovery?.orderId, siblingFixture.order.displayId)
  await service.reconcileOwnedOrder(siblingFixture.user.id, siblingFixture.order.displayId)
  const siblingIndependent = await orderService.checkout(siblingFixture.user.id, input)
  assert.notEqual(siblingIndependent.displayId, siblingFixture.order.displayId)
  const siblingLedger = await ledger(siblingFixture.order.id)
  const siblingRedemptions = await redemption(siblingFixture.order.id)
  zarinpal.set(siblingFixture.payment.gatewayRef!, { code: -51, inquiry: 'REVERSED' })
  await callback(siblingFixture, { Status: 'NOK' })
  assert.equal((await readPayment(siblingFixture.payment.id)).status, 'FAILED')
  assert.equal((await readOrder(siblingFixture.order.id)).status, 'PAID')
  assert.deepEqual(await ledger(siblingFixture.order.id), siblingLedger)
  assert.deepEqual(await redemption(siblingFixture.order.id), siblingRedemptions)
  assert.equal((await findings(siblingFixture.payment.id))[0]!.status, 'auto_fixed')
  const remainingIndependent = await orderService.preview(siblingFixture.user.id, input)
  assert.equal(remainingIndependent.paymentRecovery?.orderId, siblingIndependent.displayId)
  assert.equal(remainingIndependent.paymentRecovery?.blocksPayment, false)
  passed('an outstanding sibling preserves review while new orders are allowed; its terminal failure closes only that sibling')

  const extraSuccess = await make()
  zarinpal.set(extraSuccess.payment.gatewayRef!, { code: 100 })
  await callback(extraSuccess)
  const [extraAttempt] = await db.insert(payments).values({ userId: extraSuccess.user.id, orderId: extraSuccess.order.id,
    gateway: 'ZARINPAL', mode: 'direct', amount: extraSuccess.payment.amount, gatewayRef: `EXTRA${serial}`,
  }).returning()
  zarinpal.set(extraAttempt!.gatewayRef!, { code: 100 })
  await service.handleCallback('ZARINPAL', { state: signState(extraAttempt!.id, config.jwtSecret) })
  assert.equal((await readPayment(extraAttempt!.id)).status, 'PENDING')
  assert.equal((await readOrder(extraSuccess.order.id)).status, 'PAID')
  assert.equal((await findings(extraAttempt!.id))[0]!.status, 'open')
  assert.equal((await ledger(extraSuccess.order.id)).length, 1)
  assert.equal((await redemption(extraSuccess.order.id)).length, 1)
  assert((await orderService.preview(extraSuccess.user.id, input)).paymentRecovery)
  const extraIndependent = await orderService.checkout(extraSuccess.user.id, input)
  assert.notEqual(extraIndependent.displayId, extraSuccess.order.displayId)
  assert.equal((await findings(extraAttempt!.id))[0]!.status, 'open')
  passed('additional paid sibling stays under R12 review without re-settlement or blocking a new independent order')

  const sepFixture = await make('SEP')
  await orderService.preview(sepFixture.user.id, sepFixture.input)
  await service.reconcileOwnedOrder(sepFixture.user.id, sepFixture.order.displayId)
  sepReply = { IsSuccess: true, Amount: sepFixture.payment.amount * 10, ResNum: 'wrong-reservation', TerminalId: '12345678' }
  await callback(sepFixture, { State: 'OK', RefNum: 'SEP-REC-RECEIPT', ResNum: sepFixture.payment.id, TerminalId: '12345678' })
  assert.equal((await readPayment(sepFixture.payment.id)).gatewayRef, null)
  assert.equal((await readOrder(sepFixture.order.id)).status, 'PENDING_PAYMENT')
  assert.equal(await balance(sepFixture.user.id), 0)
  assert.equal((await reservation(sepFixture.user.id)).length, 1)
  assert.equal(((await readPayment(sepFixture.payment.id)).metadata!.callbackQuery as Record<string, string>).RefNum, 'SEP-REC-RECEIPT')
  sepReply = { IsSuccess: true, Amount: sepFixture.payment.amount * 10, ResNum: sepFixture.payment.id,
    TerminalId: '12345678', RefNum: 'SEP-REC-RECEIPT' }
  await due(sepFixture.payment.id)
  const sepRecovered = await service.reconcileOwnedOrder(sepFixture.user.id, sepFixture.order.displayId)
  assert.equal(sepRecovered.status, 'PAID')
  assert.equal((await readPayment(sepFixture.payment.id)).gatewayRef, 'SEP-REC-RECEIPT')
  assert.equal((await redemption(sepFixture.order.id)).length, 1)
  assert.equal((await findings(sepFixture.payment.id))[0]!.status, 'auto_fixed')
  passed('SEP mismatch cannot poison a receipt or release holds; saved candidate later settles only with PSP amount/reservation/terminal identity')

  const mellat = await make('MELLAT')
  await orderService.preview(mellat.user.id, mellat.input)
  await service.reconcileOwnedOrder(mellat.user.id, mellat.order.displayId)
  const [saleOrderId, , token] = mellat.payment.gatewayRef!.split(':')
  const mellatQuery = { ResCode: '0', SaleOrderId: saleOrderId!, RefId: token!, SaleReferenceId: '123456789012345' }
  mellatVerify = 'outage'
  await callback(mellat, mellatQuery)
  assert.equal((await readPayment(mellat.payment.id)).gatewayRef, mellat.payment.gatewayRef)
  assert.equal((await readOrder(mellat.order.id)).status, 'PENDING_PAYMENT')
  mellatVerify = '41'
  await due(mellat.payment.id)
  await service.reconcileOwnedOrder(mellat.user.id, mellat.order.displayId)
  assert.equal((await readPayment(mellat.payment.id)).gatewayRef, mellat.payment.gatewayRef)
  assert.equal(await balance(mellat.user.id), 0)
  assert.equal((await findings(mellat.payment.id))[0]!.status, 'open')
  mellatVerify = '0'; mellatSettle = '0'
  await due(mellat.payment.id)
  const mellatRecovered = await service.reconcileOwnedOrder(mellat.user.id, mellat.order.displayId)
  assert.equal(mellatRecovered.status, 'PAID')
  assert.equal((await readPayment(mellat.payment.id)).gatewayRef, `${saleOrderId}:s:${mellatQuery.SaleReferenceId}`)
  assert.equal((await ownerOrders(mellat.user.id)).length, 1)
  assert.equal((await ledger(mellat.order.id)).length, 1)
  assert.equal((await redemption(mellat.order.id)).length, 1)
  assert.equal((await findings(mellat.payment.id))[0]!.status, 'auto_fixed')
  passed('Mellat outage/mismatch retains token and holds, then background verifies and settles saved candidate on the original order')

  // Verification metadata deliberately does not bump the business updatedAt.
  // A callback can therefore persist success while a prior negative verdict is
  // queued for the money lock. Every retirement path must inspect that evidence
  // under the lock before canceling, releasing reservations or issuing a retry.
  for (const path of ['expiry', 'expiry-sibling', 'retry', 'failure-callback'] as const) {
    const fixture = await make()
    if (path === 'retry') await db.update(orders).set({ createdAt: new Date() }).where(eq(orders.id, fixture.order.id))
    zarinpal.set(fixture.payment.gatewayRef!, { code: -51, inquiry: 'REVERSED' })
    let sibling: typeof payments.$inferSelect | undefined
    if (path === 'expiry-sibling') {
      ;[sibling] = await db.insert(payments).values({ userId: fixture.user.id, orderId: fixture.order.id,
        gateway: 'ZARINPAL', mode: 'direct', amount: fixture.payment.amount, gatewayRef: `RACESIB${serial}`,
      }).returning()
      zarinpal.set(sibling!.gatewayRef!, { code: -51, inquiry: 'REVERSED' })
    }
    const locked = gate(), unlock = gate()
    const holder = db.transaction(async tx => {
      await lockWalletAccounts(tx, [fixture.user.id])
      locked.release()
      await unlock.promise
    })
    await locked.promise
    const beforeRaceInit = initCalls
    const negative = Promise.allSettled([path === 'retry'
      ? service.retryInitiation(fixture.user.id, fixture.order.displayId, 'ZARINPAL')
      : path === 'failure-callback'
        ? callback(fixture, { Status: 'NOK' })
        : service.reconcileOwnedOrder(fixture.user.id, fixture.order.displayId)])
    const waitForEvidence = async (success: boolean) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const row = await readPayment(fixture.payment.id)
        const result = (row.metadata?.verification as { result?: { success?: boolean; indeterminate?: boolean } })?.result
        const siblingResult = sibling
          ? ((await readPayment(sibling.id)).metadata?.verification as { result?: { success?: boolean; indeterminate?: boolean } })?.result
          : undefined
        if (result?.success === success && !result.indeterminate &&
          (success || !sibling || siblingResult?.success === false && !siblingResult.indeterminate)) return
        await Bun.sleep(10)
      }
      assert.fail(`Missing durable ${success ? 'success' : 'negative'} evidence in ${path} race`)
    }
    const waitForMoneyContenders = async (expected: number) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await db.execute(sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`)
        if (Number((rows[0] as { n: number }).n) >= expected) return
        await Bun.sleep(10)
      }
      assert.fail(`Missing ${expected} queued money-lock contenders in ${path} race`)
    }
    let positive: ReturnType<typeof callback> | undefined
    try {
      await waitForEvidence(false)
      await waitForMoneyContenders(1)
      zarinpal.set(fixture.payment.gatewayRef!, { code: 100 })
      positive = callback(fixture, { Status: 'OK' })
      await waitForEvidence(true)
      await waitForMoneyContenders(2)
      assert.equal((await readPayment(fixture.payment.id)).updatedAt.getTime(), fixture.payment.updatedAt.getTime(),
        'durable PSP evidence does not change the revision used by the old financial snapshot')
    } finally { unlock.release() }
    await holder
    const negativeResult = await negative
    await positive
    if (path === 'retry') assert.equal(negativeResult[0]!.status, 'rejected')
    assert.equal(initCalls, beforeRaceInit, 'durable success must prevent another PSP initialization')
    assert.equal((await readPayment(fixture.payment.id)).status, 'SUCCESS')
    assert.equal((await readOrder(fixture.order.id)).status, 'PAID')
    assert.equal(await balance(fixture.user.id), 0, 'the paid order keeps the original wallet withdrawal')
    assert.equal((await ledger(fixture.order.id)).length, 1, 'the stale negative verdict cannot return a wallet hold')
    assert.equal((await redemption(fixture.order.id)).length, 1)
    assert.equal((await reservation(fixture.user.id)).length, 0)
    assert.equal((await ownerOrders(fixture.user.id)).length, 1)
    const attempts = await db.select().from(payments).where(eq(payments.orderId, fixture.order.id))
    assert.equal(attempts.length, sibling ? 2 : 1, 'no stale retry creates another payable attempt')
    assert.equal(attempts.filter(row => row.status === 'SUCCESS').length, 1)
    if (sibling) assert.equal((await readPayment(sibling.id)).status, 'PENDING',
      'an aborted expiry cannot retire another attempt from an invalidated financial snapshot')
    await callback(fixture)
    assert.equal((await ledger(fixture.order.id)).length, 1)
    assert.equal((await redemption(fixture.order.id)).length, 1)
    passed(`durable callback success defeats an earlier ${path} verdict waiting for the money lock without release or another charge`)
  }

  const missing = await make()
  const missingLedger = await ledger(missing.order.id)
  const missingGrant = await grant(missing.user.id)
  const missingCoupon = (await db.select().from(coupons).where(eq(coupons.id, asCampaignId(firstCoupon.id))))[0]!
  await db.delete(payments).where(eq(payments.id, missing.payment.id)) // deliberate scratch-only corruption
  const missingInit = initCalls, missingVerify = verifyCalls
  const missingPreview = await orderService.preview(missing.user.id, missing.input)
  assert.equal(missingPreview.paymentRecovery?.orderId, missing.order.displayId)
  await service.reconcileOwnedOrder(missing.user.id, missing.order.displayId)
  const missingFindings = () => db.select().from(reconcileFindings).where(and(
    eq(reconcileFindings.checkId, 'R12'), eq(reconcileFindings.entityId, missing.order.id),
  ))
  const [missingFinding] = await missingFindings()
  assert.equal(missingFinding!.entityType, 'order')
  assert.equal(missingFinding!.status, 'open')
  assert.equal(missingFinding!.detail.orderId, missing.order.displayId)
  assert.match(String(missingFinding!.detail.note), /review.*PSP.*releasing reservations/)
  await Promise.all([orderService.preview(missing.user.id, missing.input),
    service.reconcileOwnedOrder(missing.user.id, missing.order.displayId)])
  await assert.rejects(() => orderService.checkout(missing.user.id, missing.input))
  await assert.rejects(() => service.retryInitiation(missing.user.id, missing.order.displayId))
  const missingRows = await missingFindings()
  assert.equal(missingRows.length, 1)
  assert.equal(missingRows[0]!.occurrences, missingFinding!.occurrences)
  assert.equal((await readOrder(missing.order.id)).status, 'PENDING_PAYMENT')
  assert.equal((await ownerOrders(missing.user.id)).length, 1)
  assert.deepEqual(await ledger(missing.order.id), missingLedger)
  assert.deepEqual(await grant(missing.user.id), missingGrant)
  assert.equal((await reservation(missing.user.id)).length, 1)
  assert.equal((await redemption(missing.order.id)).length, 0)
  assert.equal(await balance(missing.user.id), 0)
  assert.equal((await db.select().from(coupons).where(eq(coupons.id, asCampaignId(firstCoupon.id))))[0]!.usedCount, missingCoupon.usedCount)
  assert.equal(initCalls, missingInit)
  assert.equal(verifyCalls, missingVerify)
  passed('missing original payment records preserve wallet/coupon/first-purchase reservations and create one throttled actionable order finding')

  const missingIndependent = await orderService.checkout(missing.user.id, input)
  assert(missingIndependent.paymentId)
  await service.initiate(missingIndependent.paymentId, 'ZARINPAL', {
    displayId: missingIndependent.displayId, amount: missingIndependent.amountPaidOnline,
  })
  const missingNewPayment = await readPayment(missingIndependent.paymentId)
  await callback({ payment: missingNewPayment }, gatewayResult(missingNewPayment, 'success'))
  const [missingNewOrder] = await db.select().from(orders).where(eq(orders.displayId, missingIndependent.displayId))
  assert.equal(missingNewOrder!.status, 'PAID')
  assert.equal((await readOrder(missing.order.id)).status, 'PENDING_PAYMENT')
  assert.equal((await ownerOrders(missing.user.id)).length, 2)
  assert.deepEqual(await ledger(missing.order.id), missingLedger)
  assert.deepEqual(await grant(missing.user.id), missingGrant)
  assert.equal((await reservation(missing.user.id))[0]!.orderId, missing.order.id)
  assert.equal((await missingFindings())[0]!.status, 'open')
  assert.equal(initCalls, missingInit + 1)
  assert.equal(verifyCalls, missingVerify + 1, 'only the new payment is verified; missing original evidence never gates it')
  passed('missing original financial evidence remains reviewable while a new independent order initiates and pays successfully')

  for (const change of [{ gateway: 'SEP' }, { mode: 'indirect' }]) {
    const changed = await make()
    zarinpal.set(changed.payment.gatewayRef!, { code: 100 })
    const entered = gate(), resume = gate()
    verifyHooks.set(changed.payment.gatewayRef!, async () => { entered.release(); await resume.promise })
    const inFlight = service.reconcileOwnedOrder(changed.user.id, changed.order.displayId)
    await entered.promise
    try { await db.update(payments).set(change).where(eq(payments.id, changed.payment.id)) }
    finally { resume.release() }
    await inFlight
    verifyHooks.delete(changed.payment.gatewayRef!)
    assert.equal((await readOrder(changed.order.id)).status, 'PENDING_PAYMENT')
    assert.equal((await readPayment(changed.payment.id)).status, 'PENDING')
    assert.equal((await ledger(changed.order.id)).length, 1)
    assert.equal((await redemption(changed.order.id)).length, 0)
    assert.equal((await reservation(changed.user.id)).length, 1)
    assert.equal(await balance(changed.user.id), 0)
    assert.equal((await findings(changed.payment.id))[0]!.status, 'open')
    // Restore only the deliberately changed scratch identity, then obtain a
    // new verification for that original attempt before any settlement.
    await db.update(payments).set({ gateway: changed.payment.gateway, mode: changed.payment.mode })
      .where(eq(payments.id, changed.payment.id))
    await callback(changed)
    assert.equal((await readOrder(changed.order.id)).status, 'PAID')
    assert.equal((await ledger(changed.order.id)).length, 1)
    assert.equal((await redemption(changed.order.id)).length, 1)
  }
  passed('gateway or mode changes during PSP verification cannot settle or release money from stale payment identity evidence')

  assert(firstCoupon.id)
  assert((await db.select().from(coupons)).every(row => row.usedCount >= 0))
  console.log(`\n${checks} payment recovery checks passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
