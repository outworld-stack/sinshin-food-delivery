/** Durable PSP scheduling regressions. Only a fresh local scratch database and
 * stubbed gateways are used; no provider or notification requests are sent. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { PaymentVerification } from '../src/domain/payment/payment-verification'
import type { GatewayVerifyResult, PaymentGateway } from '../src/domain/payment/gateway.types'
import { orders, payments, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_verify_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r }); return { release, promise } }

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(target.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const [user] = await db.insert(users).values({ phone: '09177777777' }).returning()
  const [order] = await db.insert(orders).values({
    userId: user!.id, displayId: 'ord-verify-test', status: 'PENDING_PAYMENT', paymentStatus: 'PENDING',
    deliveryType: 'DINE_IN', totalAmount: 10_000,
    breakdown: { foodTotal: 10_000, discount: 0, walletDeduction: 2_000, amountPaidOnline: 8_000,
      deliveryFee: 0, packagingFee: 0, totalAmount: 10_000 },
  }).returning()
  const make = async () => (await db.insert(payments).values({
    userId: user!.id, orderId: order!.id, gateway: 'FAKE', mode: 'direct', amount: 8_000,
    gatewayRef: `receipt-${crypto.randomUUID()}`, metadata: { paymentUrl: 'https://example.test/pay', initToken: 'preserved' },
  }).returning())[0]!
  const read = async (id: typeof payments.$inferSelect.id) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!
  const one = new PaymentVerification(db, 2_000), two = new PaymentVerification(db, 2_000)
  let calls = 0
  let hook = async (): Promise<GatewayVerifyResult> => ({ success: false, gatewayRef: null, indeterminate: true })
  const gateway: PaymentGateway = {
    id: 'FAKE', mode: 'direct', resumeUrl: () => null,
    init: async () => { throw new Error('Unexpected initialization') },
    verify: async () => { calls++; return hook() },
  }

  const initial = await make(), entered = gate(), release = gate()
  hook = async () => { entered.release(); await release.promise; return { success: false, gatewayRef: initial.gatewayRef, indeterminate: true } }
  const first = one.verify(initial, gateway)
  await entered.promise
  const concurrent = await two.verify(initial, gateway)
  assert.equal(concurrent.indeterminate, true); assert.equal(calls, 1)
  release.release(); await first
  const scheduled = await read(initial.id)
  assert.equal(scheduled.updatedAt.getTime(), initial.updatedAt.getTime())
  assert.equal(scheduled.metadata!.paymentUrl, initial.metadata!.paymentUrl)
  assert.equal(scheduled.metadata!.initToken, initial.metadata!.initToken)
  await two.verify(initial, gateway)
  assert.equal(calls, 1)
  assert.equal((scheduled.metadata!.verification as { failures: number }).failures, 1)
  passed('independent instances share one PSP lease and persistent backoff without changing business metadata/revision')

  const beforeCallback = calls
  hook = async () => ({ success: true, gatewayRef: initial.gatewayRef })
  assert.equal((await two.verify(initial, gateway, { Status: 'OK' }, true)).success, true)
  assert.equal(calls, beforeCallback + 1)
  assert.equal((await one.verify(initial, gateway)).success, true)
  assert.equal(calls, beforeCallback + 1)
  passed('late callback bypasses backoff and conclusive success is reused without another verification')

  const changedRef = 'changed-reference'
  await db.update(payments).set({ gatewayRef: changedRef }).where(eq(payments.id, initial.id))
  assert.equal((await one.verify(initial, gateway)).indeterminate, true)
  const changed = await read(initial.id)
  hook = async () => ({ success: false, gatewayRef: changedRef })
  const beforeNewRef = calls
  assert.equal((await one.verify(changed, gateway)).indeterminate, undefined)
  await two.verify(changed, gateway)
  assert.equal(calls, beforeNewRef + 1)
  passed('cached evidence cannot apply to a changed receipt; a terminal verdict is reused only for the matching reference')

  await db.update(payments).set({ mode: 'indirect' }).where(eq(payments.id, changed.id))
  const beforeMode = calls
  assert.equal((await one.verify(changed, gateway)).indeterminate, true)
  assert.equal(calls, beforeMode)
  await one.verify(await read(changed.id), gateway)
  assert.equal(calls, beforeMode + 1)
  passed('gateway mode changes invalidate old evidence and stale caller snapshots cannot claim verification')

  const late = await make(), lateEntered = gate(), lateRelease = gate()
  hook = async () => { lateEntered.release(); await lateRelease.promise; return { success: false, gatewayRef: late.gatewayRef, indeterminate: true } }
  const lateUnknown = one.verify(late, gateway, {}, true)
  await lateEntered.promise
  hook = async () => ({ success: true, gatewayRef: late.gatewayRef })
  await two.verify(late, gateway, {}, true)
  lateRelease.release(); await lateUnknown
  assert.equal((await read(late.id)).metadata!.verification &&
    ((await read(late.id)).metadata!.verification as { result: GatewayVerifyResult }).result.success, true)
  passed('a late unknown callback cannot overwrite a conclusive success cached by another callback')

  const reclaimed = await make(), oldEntered = gate(), oldRelease = gate()
  hook = async () => { oldEntered.release(); await oldRelease.promise; return { success: false, gatewayRef: reclaimed.gatewayRef, indeterminate: true } }
  const old = one.verify(reclaimed, gateway)
  await oldEntered.promise
  const leased = await read(reclaimed.id)
  await db.update(payments).set({ metadata: { ...leased.metadata, verification: {
    ...(leased.metadata!.verification as Record<string, unknown>), leaseUntil: new Date(0).toISOString(),
  } } }).where(eq(payments.id, reclaimed.id))
  hook = async () => ({ success: true, gatewayRef: reclaimed.gatewayRef })
  await two.verify(reclaimed, gateway)
  oldRelease.release(); await old
  assert.equal(((await read(reclaimed.id)).metadata!.verification as { result: GatewayVerifyResult }).result.success, true)
  passed('an expired worker lease is reclaimable and its late response cannot replace the new owner evidence')

  const exponential = await make()
  hook = async () => { throw new Error('PSP unavailable') }
  for (let attempt = 1; attempt <= 9; attempt++) {
    await one.verify(await read(exponential.id), gateway)
    const state = await read(exponential.id)
    const v = state.metadata!.verification as { checkedAt: string; nextAt: string; failures: number }
    const delay = Date.parse(v.nextAt) - Date.parse(v.checkedAt)
    assert(delay >= Math.min(60_000 * 2 ** (attempt - 1), 3_600_000) - 100)
    assert(delay <= 3_600_100)
    assert.equal(v.failures, Math.min(attempt, 7))
    await db.update(payments).set({ metadata: { ...state.metadata, verification: { ...v, nextAt: new Date(0).toISOString() } } })
      .where(eq(payments.id, exponential.id))
  }
  passed('provider outages use exponential retries capped at one hour and never manufacture failure')

  const finalized = await make(), finalizeEntered = gate(), finalizeRelease = gate()
  hook = async () => { finalizeEntered.release(); await finalizeRelease.promise; return { success: false, gatewayRef: finalized.gatewayRef, indeterminate: true } }
  const inFlight = one.verify(finalized, gateway)
  await finalizeEntered.promise
  await db.update(payments).set({ status: 'SUCCESS', metadata: { preservedSettlement: true } }).where(eq(payments.id, finalized.id))
  finalizeRelease.release(); await inFlight
  assert.deepEqual((await read(finalized.id)).metadata, { preservedSettlement: true })
  passed('background response cannot overwrite a payment settled while verification was in flight')

  hook = async () => ({ success: false, gatewayRef: late.gatewayRef })
  assert.equal((await two.verify(late, gateway, {}, true)).indeterminate, true)
  assert.equal(((await read(late.id)).metadata!.verification as { result: GatewayVerifyResult }).result.success, true)
  passed('a later negative callback cannot discard previously verified success awaiting settlement')

  const receiptFixture = await make()
  await db.update(payments).set({ gateway: 'MELLAT', metadata: {
    ...receiptFixture.metadata, callbackQuery: { rescode: '0', SaleOrderId: '123', SaleReferenceId: '456',
      RefId: 'token', state: 'untrusted-extra', extra: 'discarded' },
  } }).where(eq(payments.id, receiptFixture.id))
  let receivedQuery: Record<string, string> = {}
  let receiptHook = async (): Promise<GatewayVerifyResult> => ({ success: false, gatewayRef: receiptFixture.gatewayRef, indeterminate: true })
  const receiptGateway: PaymentGateway = { ...gateway, id: 'MELLAT', verify: async input => {
    receivedQuery = input.query; return receiptHook()
  } }
  await one.verify(await read(receiptFixture.id), receiptGateway)
  assert.deepEqual(receivedQuery, { ResCode: '0', SaleOrderId: '123', SaleReferenceId: '456', RefId: 'token' })
  passed('background retries recover bounded gateway-specific callback candidates without trusting extra fields')

  const candidateEntered = gate(), candidateRelease = gate()
  const receiptState = await read(receiptFixture.id)
  await db.update(payments).set({ metadata: { ...receiptState.metadata, callbackQuery: {
    ResCode: '0', SaleOrderId: '123', SaleReferenceId: '789', RefId: 'token',
  } } }).where(eq(payments.id, receiptFixture.id))
  receiptHook = async () => { candidateEntered.release(); await candidateRelease.promise
    return { success: false, gatewayRef: receiptFixture.gatewayRef } }
  const staleCandidate = one.verify(await read(receiptFixture.id), receiptGateway)
  await candidateEntered.promise
  const candidateState = await read(receiptFixture.id)
  await db.update(payments).set({ metadata: { ...candidateState.metadata, callbackQuery: {
    ResCode: '0', SaleOrderId: '123', SaleReferenceId: '999', RefId: 'token',
  } } }).where(eq(payments.id, receiptFixture.id))
  candidateRelease.release()
  assert.equal((await staleCandidate).indeterminate, true)
  receiptHook = async () => ({ success: true, gatewayRef: receiptFixture.gatewayRef })
  assert.equal((await two.verify(await read(receiptFixture.id), receiptGateway)).success, true)
  assert.equal(receivedQuery.SaleReferenceId, '999')
  passed('new callback candidates invalidate backoff/evidence and an in-flight stale negative cannot cancel')
  console.log(`\n${checks} payment verification checks passed`)
} finally {
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
