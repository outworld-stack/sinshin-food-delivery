/** Real PostgreSQL reconciliation and report regressions in a disposable database. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database, type DbOrTx } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { ReconcileService, type CheckResult, type ReconcileReport } from '../src/domain/reconcile/reconcile.service'
import { ReportQueryService } from '../src/domain/report/report-query.service'
import { ReportService } from '../src/domain/report/report.service'
import { faNum } from '../src/domain/report/format'
import { orders, payments, reconcileFindings, referralProfits, users, walletTransactions } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_financial_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
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
globalThis.fetch = (() => { throw new Error('External requests forbidden in financial reconciliation test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 6 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const configSource = {
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(),
    JWT_SECRET: 'financial-reconcile-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
  }
  const config = new AppConfig(configSource)
  const noMoneyWrites = {
    settlePayment: async () => { throw new Error('Report-only reconciliation must not settle') },
    grantCouponsAfterCommit: async () => { throw new Error('Report-only reconciliation must not grant') },
  } as never
  const reconcile = new ReconcileService({ db, config, orders: noMoneyWrites })
  let userNumber = 0, orderNumber = 0
  const makeUser = async () => (await db.insert(users).values({ phone: `0913${String(++userNumber).padStart(7, '0')}` }).returning())[0]!
  const oldDate = new Date('2000-01-01T12:00:00Z')
  const makeOrder = async (userId: string, options: {
    total?: number; wallet?: number; discount?: number; online?: number;
    status?: typeof orders.$inferSelect.status; paymentStatus?: string; createdAt?: Date;
  } = {}) => {
    const total = options.total ?? 100_000, wallet = options.wallet ?? 0, discount = options.discount ?? 0
    return (await db.insert(orders).values({
      userId, displayId: `ord-finance${++orderNumber}`, status: options.status ?? 'PAID', deliveryType: 'DINE_IN',
      paymentStatus: options.paymentStatus ?? 'SUCCESS', totalAmount: total, createdAt: options.createdAt ?? oldDate,
      breakdown: {
        foodTotal: total + discount, discount, walletDeduction: wallet, deliveryFee: 0, packagingFee: 0,
        totalAmount: total, amountPaidOnline: options.online ?? total - wallet,
      },
    }).returning())[0]!
  }
  const makeProfit = async (order: typeof orders.$inferSelect, referrerId: string, amount = 10_000) =>
    (await db.insert(referralProfits).values({ referrerId, buyerId: order.userId, orderId: order.id, baseAmount: amount * 10, percent: 10, amount }).returning())[0]!
  const refundCredit = (order: typeof orders.$inferSelect, amount: number, userId = order.userId) => db.insert(walletTransactions)
    .values({ userId, type: 'DEPOSIT', orderId: order.id, amount, description: 'Buyer refund fixture', createdAt: oldDate })
  const rewardEntry = async (profit: typeof referralProfits.$inferSelect, type: 'DEPOSIT' | 'WITHDRAW', amount = profit.amount, userId = profit.referrerId) =>
    (await db.insert(walletTransactions).values({
      userId, type, amount, description: 'Referral ledger fixture', referralProfitId: profit.id,
      orderId: type === 'DEPOSIT' ? profit.orderId : null, createdAt: oldDate,
    }).returning())[0]!

  const [day] = await db.execute(sql`select date_trunc('day', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' as start`)
  const todayStart = new Date((day as { start: Date }).start)
  const afterMidnight = new Date(todayStart.getTime() + 1)
  const reportBuyer = await makeUser()
  const paidAtMidnight = await makeOrder(reportBuyer.id, { total: 1_500_000_000, wallet: 500_000_000, discount: 100_000_000, createdAt: todayStart })
  await makeOrder(reportBuyer.id, { total: 1_500_000_000, wallet: 300_000_000, discount: 50_000_000, status: 'DELIVERED', createdAt: afterMidnight })
  await makeOrder(reportBuyer.id, { total: 999_000_000, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', createdAt: afterMidnight })
  await makeOrder(reportBuyer.id, { total: 2_000_000, status: 'CANCELED', paymentStatus: 'FAILED', createdAt: afterMidnight })
  await makeOrder(reportBuyer.id, { total: 3_000_000, status: 'CANCELED', paymentStatus: 'REFUNDED', createdAt: afterMidnight })
  await makeOrder(reportBuyer.id, { total: 4_000_000, status: 'CANCELED', paymentStatus: 'SUCCESS', createdAt: afterMidnight })
  const reportQuery = new ReportQueryService({ db, audit: {} as never })
  const reportInput = { type: 'orders' as const, from: todayStart.toISOString(), to: new Date(todayStart.getTime() + 86_400_000).toISOString() }
  const report = await reportQuery.query(reportInput)
  assert.deepEqual(report.stats.map((stat) => stat.value), [faNum(6), faNum(3_000_000_000), faNum(2_200_000_000), faNum(150_000_000)])
  assert.equal(report.tables[0]!.rows.length, 6)
  const pendingReport = await reportQuery.query({ ...reportInput, status: 'PENDING_PAYMENT' })
  assert.deepEqual(pendingReport.stats.map((stat) => stat.value), [faNum(1), faNum(0), faNum(0), faNum(0)])
  passed('admin report counts all matching orders but money totals include only successful noncanceled orders above int32')

  const yesterdayOrder = await makeOrder(reportBuyer.id, { total: 42_000, createdAt: new Date(todayStart.getTime() - 1) })
  await db.insert(walletTransactions).values({ userId: reportBuyer.id, type: 'DEPOSIT', amount: 123, description: 'Midnight deposit', createdAt: todayStart })
  const reportService = new ReportService({
    db, config, sms: {} as never, dockerLogs: {} as never,
    links: { reportToken: () => 'regression-report-token' } as never,
    reconcile: { summary: async () => ({ open: 0, critical: 0, byCheck: {} }) } as never,
  })
  const today = await reportService.dailyViewModel('today')
  assert.deepEqual(today.stats.map((stat) => stat.value), [faNum(2), faNum(3_000_000_000), faNum(1_500_000_000)])
  // stage-98 — ردیفِ PENDING_PAYMENT از CSV/نمای گزارش حذف شد (سفارشِ هرگز-تسویه‌نشده)
  assert.equal(today.orders.rows.length, 5)
  assert.equal(today.wallet.rows.length, 1)
  const yesterday = await reportService.dailyViewModel('yesterday')
  assert.deepEqual(yesterday.stats.map((stat) => stat.value), [faNum(1), faNum(42_000), faNum(42_000)])
  assert.equal(yesterday.orders.rows.length, 1)
  assert.equal(yesterday.wallet.rows.length, 0)
  const yesterdayCsv = await reportService.csvBody('yesterday')
  assert(yesterdayCsv.includes(yesterdayOrder.displayId))
  assert(!yesterdayCsv.includes(paidAtMidnight.displayId))
  passed('daily paid summaries and order/wallet/CSV windows exclude the following midnight')

  const buyer = await makeUser(), referrer = await makeUser(), wrongRecipient = await makeUser()
  const missingRefund = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'REFUNDED', wallet: 20_000 })
  const missingReversal = await makeProfit(missingRefund, referrer.id)
  await rewardEntry(missingReversal, 'DEPOSIT')
  const missingRelease = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'FAILED', wallet: 30_000 })
  const partialRefund = await makeOrder(buyer.id, { total: 200_000, status: 'CANCELED', paymentStatus: 'REFUNDED' })
  await refundCredit(partialRefund, 50_000)
  const correctRefund = await makeOrder(buyer.id, { total: 70_000, status: 'CANCELED', paymentStatus: 'REFUNDED' })
  await refundCredit(correctRefund, 70_000)
  const noReleaseNeeded = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'FAILED' })
  const wrongRefundOwner = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'REFUNDED' })
  await refundCredit(wrongRefundOwner, 100_000, wrongRecipient.id)
  const correctRelease = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'FAILED', wallet: 40_000 })
  await refundCredit(correctRelease, 40_000)
  const excessRelease = await makeOrder(buyer.id, { status: 'CANCELED', paymentStatus: 'FAILED', wallet: 40_000 })
  await refundCredit(excessRelease, 45_000)

  const missingReward = await makeProfit(await makeOrder(buyer.id), referrer.id)
  const wrongRewardAmount = await makeProfit(await makeOrder(buyer.id), referrer.id)
  await rewardEntry(wrongRewardAmount, 'DEPOSIT', 9_999)
  const correctReversedReward = await makeProfit(correctRefund, referrer.id, 7_000)
  await rewardEntry(correctReversedReward, 'DEPOSIT')
  const validReversal = await rewardEntry(correctReversedReward, 'WITHDRAW')
  const prematureReversal = await makeProfit(await makeOrder(buyer.id), referrer.id)
  await rewardEntry(prematureReversal, 'DEPOSIT')
  await rewardEntry(prematureReversal, 'WITHDRAW')
  const wrongRewardOwner = await makeProfit(await makeOrder(buyer.id), referrer.id)
  await rewardEntry(wrongRewardOwner, 'DEPOSIT', 10_000, wrongRecipient.id)
  const [orphan] = await db.insert(walletTransactions).values({ userId: buyer.id, type: 'WITHDRAW', amount: 123, description: 'Unlinked withdrawal' }).returning()
  const indebted = await makeUser()
  await db.insert(walletTransactions).values([1, 2].map(() => ({ userId: indebted.id, type: 'WITHDRAW' as const, amount: 1_500_000_000, description: 'Historical debt' })))
  const matchingWallet = await makeOrder(buyer.id, { total: 300_000, wallet: 300_000, createdAt: new Date() })
  await db.insert(walletTransactions).values({ userId: buyer.id, type: 'WITHDRAW', amount: 300_000, orderId: matchingWallet.id, description: 'Exact wallet payment' })
  const mismatchingWallet = await makeOrder(buyer.id, { wallet: 2_000, createdAt: new Date() })
  await db.insert(walletTransactions).values({ userId: buyer.id, type: 'WITHDRAW', amount: 1_000, orderId: mismatchingWallet.id, description: 'Incorrect wallet deduction' })
  const freeOrder = await makeOrder(buyer.id, { total: 0 })
  const unpaidOnlineEvidence = await makeOrder(buyer.id)
  const walletBefore = await db.select().from(walletTransactions)
  const diagnostics = await reconcile.run()
  const check = (id: string) => diagnostics.checks.find((entry) => entry.checkId === id)!
  const finding = (id: string, entityId: string) => check(id).findings.find((entry) => entry.entityId === entityId)
  const r13Expected = [
    [missingRefund, 100_000, 0], [missingRelease, 30_000, 0], [partialRefund, 200_000, 50_000],
    [wrongRefundOwner, 100_000, 0], [excessRelease, 40_000, 45_000],
  ] as const
  for (const [order, expected, actual] of r13Expected) {
    assert.equal(finding('R13', order.id)?.detail.expectedCredit, expected)
    assert.equal(finding('R13', order.id)?.detail.actualCredit, actual)
  }
  for (const order of [correctRefund, correctRelease, noReleaseNeeded]) assert.equal(finding('R13', order.id), undefined)
  assert.equal(check('R13').wouldFix, 0)
  passed('R13 diagnoses missing, wrong-recipient and mismatched buyer credits without counting referral deposits')

  for (const profit of [missingReward, wrongRewardAmount, missingReversal, prematureReversal, wrongRewardOwner]) assert(finding('R14', profit.id))
  assert.equal(finding('R14', missingReward.id)!.detail.actualCredit, 0)
  assert.equal(finding('R14', wrongRewardAmount.id)!.detail.actualCredit, 9_999)
  assert.equal(finding('R14', missingReversal.id)!.detail.expectedReversal, 10_000)
  assert.equal(finding('R14', prematureReversal.id)!.detail.expectedReversal, 0)
  assert.equal(finding('R14', wrongRewardOwner.id)!.detail.actualCredit, 0)
  assert.equal(finding('R14', correctReversedReward.id), undefined)
  assert.equal(check('R14').wouldFix, 0)
  assert.deepEqual(await db.select().from(walletTransactions), walletBefore)
  passed('R14 diagnoses missing/wrong rewards and reversals without automatic ledger changes')

  assert(finding('R7', orphan!.id))
  assert.equal(finding('R7', validReversal.id), undefined)
  assert.equal(finding('R8', indebted.id)!.detail.balance, -3_000_000_000)
  assert.equal(typeof finding('R8', indebted.id)!.detail.balance, 'number')
  assert.equal(finding('R3', matchingWallet.id), undefined)
  assert.equal(finding('R3', mismatchingWallet.id)!.detail.actualWithdrawTotal, 1_000)
  for (const id of ['R2', 'R4']) {
    assert.equal(finding(id, matchingWallet.id), undefined)
    assert.equal(finding(id, freeOrder.id), undefined)
    assert(finding(id, unpaidOnlineEvidence.id))
  }
  passed('R2/R4 exclude wallet-only orders; R3 compares bigint values; R7 accepts reversals; R8 keeps large negative amounts')

  const staleAt = new Date('2001-01-01T00:00:00Z')
  const recurringIds = ['auto_fixed', 'acknowledged', 'resolved_external'] as const
  await db.insert(reconcileFindings).values(recurringIds.map((status) => ({
    checkId: 'R13', entityId: `repeat-${status}`, entityType: 'order', severity: 'warning', status,
    detail: { previous: true }, occurrences: 3, firstSeenAt: oldDate, lastSeenAt: oldDate, resolvedAt: staleAt,
  })))
  await db.insert(reconcileFindings).values({
    checkId: 'R13', entityId: 'not-repeated', entityType: 'order', severity: 'warning', status: 'auto_fixed',
    detail: { untouched: true }, firstSeenAt: oldDate, lastSeenAt: oldDate, resolvedAt: staleAt,
  })
  const recurrence: ReconcileReport = {
    ranAt: new Date(), totalOpen: 3, checks: [{ checkId: 'R13', severity: 'critical', wouldFix: 0,
      findings: recurringIds.map((status) => ({ entityType: 'order', entityId: `repeat-${status}`, detail: { expectedCredit: 100_000, actualCredit: 50_000 } })),
    }],
  }
  await reconcile.persistFindings(recurrence)
  for (const status of recurringIds) {
    const [row] = await db.select().from(reconcileFindings).where(eq(reconcileFindings.entityId, `repeat-${status}`))
    assert.equal(row!.status, 'open')
    assert.equal(row!.severity, 'critical')
    assert.equal(row!.resolvedAt, null)
    assert.equal(row!.occurrences, 4)
    assert.equal(row!.firstSeenAt.getTime(), oldDate.getTime())
    assert.deepEqual(row!.detail, { expectedCredit: 100_000, actualCredit: 50_000 })
  }
  assert.equal((await db.select().from(reconcileFindings).where(eq(reconcileFindings.entityId, 'not-repeated')))[0]!.status, 'auto_fixed')
  await reconcile.persistFindings(recurrence)
  assert.equal((await reconcile.listFindings({ status: 'open', checkId: 'R13' })).length, 3)
  assert.equal((await reconcile.summary()).critical, 3)
  passed('persisted findings refresh evidence/severity and reopen recurring resolved findings without duplicating rows')

  let settlementCalls = 0, grantCalls = 0
  const settlementSpy = {
    settlePayment: async (tx: DbOrTx, order: typeof orders.$inferSelect) => {
      settlementCalls++
      await tx.update(orders).set({ status: 'PAID', paymentStatus: 'SUCCESS' }).where(eq(orders.id, order.id))
      return { displayId: order.displayId }
    },
    grantCouponsAfterCommit: async () => { grantCalls++ },
  } as never
  const auto = new ReconcileService({ db, config: new AppConfig({ ...configSource, RECONCILE_AUTO_R1: 'true' }), orders: settlementSpy })
  const waitForUserLock = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%"users"%' and query like '%no key update%'`)
      if (Number((row as { n: number }).n) > 0) return
      await Bun.sleep(10)
    }
    assert.fail('R1 did not wait on the buyer lock')
  }
  for (const change of ['amount', 'owner', 'duplicate'] as const) {
    const raceBuyer = await makeUser()
    const order = await makeOrder(raceBuyer.id, { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })
    const payment = (await db.insert(payments).values({ orderId: order.id, userId: raceBuyer.id, amount: 100_000, status: 'SUCCESS', gateway: 'ZARINPAL', mode: 'direct' }).returning())[0]!
    const locked = gate(), release = gate()
    const blocker = db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, raceBuyer.id)).for('no key update')
      locked.release()
      await release.promise
    })
    await locked.promise
    const running = auto.run()
    try {
      await waitForUserLock()
      if (change === 'amount') await db.update(payments).set({ amount: 99_999 }).where(eq(payments.id, payment.id))
      if (change === 'owner') await db.update(payments).set({ userId: wrongRecipient.id }).where(eq(payments.id, payment.id))
      if (change === 'duplicate') await db.insert(payments).values({ orderId: order.id, userId: raceBuyer.id, amount: 100_000, status: 'SUCCESS', gateway: 'SEP', mode: 'direct' })
    } finally { release.release() }
    await Promise.all([blocker, running])
    assert.equal(settlementCalls, 0)
    assert.equal(grantCalls, 0)
    assert.equal((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status, 'PENDING_PAYMENT')
  }
  passed('R1 rechecks amount, ownership and unique successful payment after its buyer lock is acquired')

  const trustedBuyer = await makeUser(), trustedOrder = await makeOrder(trustedBuyer.id, { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })
  await db.insert(payments).values({ orderId: trustedOrder.id, userId: trustedBuyer.id, amount: 100_000, status: 'SUCCESS', gateway: 'ZARINPAL', mode: 'direct', gatewayRef: 'trusted-r1-receipt' })
  const trustedReport = await auto.run()
  assert.equal(settlementCalls, 1)
  assert.equal(grantCalls, 1)
  assert.equal((await db.select().from(orders).where(eq(orders.id, trustedOrder.id)))[0]!.status, 'PAID')
  assert.equal(trustedReport.checks.find((entry: CheckResult) => entry.checkId === 'R1')!.wouldFix, 1)
  await auto.run()
  assert.equal(settlementCalls, 1)
  passed('R1 settles one trusted pending order once and grants only after successful settlement')

  const recordedPayment = async (gateway: string, mode: string, gatewayRef: string | null, pendingOrder = true) => {
    const customer = await makeUser()
    const order = await makeOrder(customer.id, { status: pendingOrder ? 'PENDING_PAYMENT' : 'PAID', paymentStatus: pendingOrder ? 'PENDING' : 'SUCCESS' })
    await db.insert(payments).values({ orderId: order.id, userId: customer.id, amount: 100_000, status: 'SUCCESS', gateway, mode, gatewayRef })
    return order
  }
  const reusedReceiptOrders: typeof orders.$inferSelect[] = []
  for (const [gateway, firstReference, secondReference] of [
    ['ZARINPAL', 'same-zarinpal-receipt', 'same-zarinpal-receipt'],
    ['SEP', 'same-sep-receipt', 'same-sep-receipt'],
    ['MELLAT', '100:s:777', '200:s:777'],
  ]) {
    await recordedPayment(gateway!, 'direct', firstReference!, false)
    reusedReceiptOrders.push(await recordedPayment(gateway!, 'direct', secondReference!))
  }
  await auto.run()
  assert.equal(settlementCalls, 1)
  for (const order of reusedReceiptOrders) {
    assert.equal((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status, 'PENDING_PAYMENT')
  }
  passed('R1 never settles another order using an already successful Zarinpal, SEP or Mellat sale receipt')

  const invalidPayments = [
    ['ZARINPAL', 'direct', null], ['SEP', 'indirect', '   '], ['MELLAT', 'direct', '123'],
    ['MELLAT', 'direct', '123:s:not-a-receipt'], ['ZARINPAL', 'mock', 'bad-mode'],
    ['ZARINPAL', 'unknown-mode', 'unknown-mode'], ['MOCK', 'direct', null], ['PAYIR', 'direct', 'unsupported-gateway'],
  ] as const
  for (const [gateway, mode, reference] of invalidPayments) await recordedPayment(gateway, mode, reference)
  await auto.run()
  assert.equal(settlementCalls, 1)
  assert.equal(grantCalls, 1)
  const validMock = await recordedPayment('MOCK', 'mock', null)
  await auto.run()
  assert.equal(settlementCalls, 2)
  assert.equal((await db.select().from(orders).where(eq(orders.id, validMock.id)))[0]!.status, 'PAID')
  const blockedMock = await recordedPayment('MOCK', 'mock', null)
  const realModeAuto = new ReconcileService({ db, config: new AppConfig({ ...configSource, GATEWAY_MODE: 'direct', RECONCILE_AUTO_R1: 'true' }), orders: settlementSpy })
  await realModeAuto.run()
  assert.equal(settlementCalls, 2)
  assert.equal((await db.select().from(orders).where(eq(orders.id, blockedMock.id)))[0]!.status, 'PENDING_PAYMENT')
  await recordedPayment('MELLAT', 'direct', '999:s:888')
  await recordedPayment('SEP', 'indirect', 'unique-sep-r1-receipt')
  await realModeAuto.run()
  assert.equal(settlementCalls, 4)
  assert.equal(grantCalls, 4)
  passed('R1 rejects incomplete receipt/mode evidence while preserving valid mock and unique real receipts')

  const lockedReceipt = 'r1-receipt-lock-race'
  const receiptRaceOrder = await recordedPayment('ZARINPAL', 'direct', lockedReceipt)
  const receiptLocked = gate(), releaseReceipt = gate()
  const receiptBlocker = db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment-receipt:ZARINPAL:${lockedReceipt}`}, 0))`)
    receiptLocked.release()
    await releaseReceipt.promise
  })
  await receiptLocked.promise
  const receiptReconciliation = realModeAuto.run()
  let waitedOnReceipt = false
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock%'`)
      if (Number((row as { n: number }).n) > 0) { waitedOnReceipt = true; break }
      await Bun.sleep(10)
    }
    assert(waitedOnReceipt, 'R1 must share the callback receipt lock')
    await recordedPayment('ZARINPAL', 'direct', lockedReceipt, false)
  } finally { releaseReceipt.release() }
  await Promise.all([receiptBlocker, receiptReconciliation])
  assert.equal(settlementCalls, 4)
  assert.equal((await db.select().from(orders).where(eq(orders.id, receiptRaceOrder.id)))[0]!.status, 'PENDING_PAYMENT')
  passed('R1 shares the callback receipt lock and checks for duplicates after acquiring it')
  console.log(`Financial reconciliation: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
