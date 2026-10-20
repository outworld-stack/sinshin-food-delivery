/** Real transactions in an isolated local scratch database; no external services. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, isNull } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import { Database } from '../src/infra/db/client'
import { DeliveryZoneService, haversineKm } from '../src/domain/delivery/delivery-zone.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { OrderService } from '../src/domain/order/order.service'
import { CourierService } from '../src/domain/courier/courier.service'
import { isUniqueViolation } from '../src/domain/shared/pg'
import { adminSettingsRoutes } from '../src/http/routes/admin-settings.routes'
import { courierDeliveries, courierTrips, couriers, orders, users, walletTransactions } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_delivery_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const scratchUrl = new URL(source); scratchUrl.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let count = 0
function passed(name: string) { count++; console.log(`PASS ${name}`) }
try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const settings = new SettingsService({ db })
  const zones = new DeliveryZoneService({ db, settings })
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => zones.add(2, 20_000)))
  assert.equal(duplicates.filter((r) => r.success).length, 1)
  assert.equal((await zones.list()).length, 1)
  passed('concurrent duplicate zone creation returns a single success without database errors')
  for (const [radius, fee] of [[NaN, 0], [501, 0], [1, 0.5], [1, 2 ** 31], [1, -1], [Infinity, 0]]) {
    assert.equal((await zones.add(radius!, fee!)).success, false)
  }
  assert.equal((await zones.update(2, 3, 21_000)).success, true)
  assert.equal((await zones.update(2, 4, 10_000)).success, false)
  assert.deepEqual(await zones.list(), [{ radiusKm: 3, fee: 21_000 }])
  assert.equal((await zones.add(4, 40_000)).success, true)
  assert.equal((await zones.update(3, 4, 10_000)).success, false)
  passed('zone edits validate money and reject missing or duplicate radii while invalidating cached fees')
  const removals = await Promise.all([zones.remove(3), zones.remove(4)])
  assert.equal(removals.filter((r) => r.success).length, 1)
  assert.equal((await zones.list()).length, 1)
  passed('concurrent removal of the last two zones preserves one zone')

  let auditCalls = 0
  const app = new Elysia().use(adminSettingsRoutes({
    zones, settings, admin2: {} as never, permits: {} as never,
    audit: { log: async () => { auditCalls++ } } as never,
    sessions: { authenticate: async () => ({ user: { id: crypto.randomUUID(), role: 'admin' }, ctx: {} }) } as never,
  }))
  const post = (path: string, body: object) => app.handle(new Request(`http://localhost/admin/settings/${path}`, {
    method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const remaining = (await zones.list())[0]!
  const result = async (response: Promise<Response>) => (await (await response).json()) as { success: boolean }
  assert.equal((await result(post('delivery-zones', { ...remaining }))).success, false)
  assert.equal((await result(post('delivery-zones/remove', { radiusKm: remaining.radiusKm }))).success, false)
  assert.equal(auditCalls, 0, 'rejected changes must not produce a successful audit event')
  assert.equal((await post('delivery-zones', { radiusKm: 6, fee: 0.5 })).status, 422)
  assert.equal((await result(post('delivery-zones', { radiusKm: 6, fee: 60_000 }))).success, true)
  assert.equal(auditCalls, 1)
  passed('HTTP zone mutations surface rejected operations and audit only successful changes')
  assert.equal(await zones.feeFor(null), remaining.fee)
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), remaining.fee)
  assert.equal(await zones.feeFor({ lat: -37, lng: -130 }), 60_000)
  assert(Number.isFinite(haversineKm({ lat: 45, lng: 10 }, { lat: -45, lng: -170 })))
  passed('delivery fee uses the correct inner/outer zone and antipodal distance remains finite')

  const [buyer, other] = await db.insert(users).values([{ phone: '09151111111' }, { phone: '09152222222' }]).returning()
  const [courier] = await db.insert(couriers).values({ name: 'Courier', phone: '09153333333' }).returning()
  const service = new OrderService({ db } as ConstructorParameters<typeof OrderService>[0])
  const scan = new CourierService({ db, config: {} as never, redis: {} as never, sms: {} as never })
  let nextId = 0
  const makeOrder = async (extra: Partial<typeof orders.$inferInsert> = {}) => (await db.insert(orders).values({
    displayId: `ord-${String(++nextId).padStart(8, '0')}`, userId: buyer!.id, deliveryType: 'DELIVERY', status: 'CONFIRMED',
    courierId: courier!.id, addressSnapshot: 'Customer address', customerLocation: { lat: 37, lng: 49 },
    totalAmount: 120_000, paymentStatus: 'SUCCESS',
    breakdown: { foodTotal: 100_000, discount: 0, walletDeduction: 0, deliveryFee: 20_000, packagingFee: 0, totalAmount: 120_000, amountPaidOnline: 120_000 },
    ...extra,
  }).returning())[0]!
  const a = await makeOrder(), b = await makeOrder()
  const scans = await Promise.all([scan.scanArrival(a.displayId, null), scan.scanArrival(a.displayId, null), scan.scanArrival(b.displayId, null)])
  assert(scans.every((r) => r.success))
  assert.equal((await db.select().from(courierTrips)).length, 1)
  assert.equal(scans.filter((r) => r.alreadyScanned).length, 1)
  passed('concurrent scans of the same and different orders create one active courier trip')
  await assert.rejects(service.confirmDelivery(other!.id, a.displayId))
  await Promise.all([service.confirmDelivery(buyer!.id, a.displayId), service.confirmDelivery(buyer!.id, a.displayId)])
  assert.equal((await db.select().from(courierDeliveries)).length, 1)
  assert.equal((await db.select().from(courierTrips))[0]!.completedAt, null)
  await service.confirmDelivery(buyer!.id, b.displayId)
  const history = await db.select().from(courierDeliveries)
  assert.equal(history.length, 2)
  assert.equal(history.reduce((sum, row) => sum + row.amount, 0), 240_000)
  assert(history.every((row) => row.addressSnapshot === 'Customer address'))
  assert((await db.select().from(courierTrips))[0]!.completedAt instanceof Date)
  passed('delivery confirmation enforces ownership, records history once, and closes the trip after its last delivery')
  const c = await makeOrder()
  assert.equal((await scan.scanArrival(c.displayId, null)).success, true)
  assert.equal((await db.select().from(courierTrips)).length, 2)
  await service.confirmDelivery(buyer!.id, c.displayId)
  const dine = await makeOrder({ deliveryType: 'DINE_IN', courierId: null })
  await service.confirmDelivery(buyer!.id, dine.displayId)
  const unpaid = await makeOrder({ status: 'PAID' })
  await assert.rejects(service.confirmDelivery(buyer!.id, unpaid.displayId))
  assert.equal((await db.select().from(courierDeliveries)).length, 3)
  assert.equal((await db.select().from(orders).where(eq(orders.id, dine.id)))[0]!.status, 'DELIVERED')
  passed('next dispatch starts a new trip; dining confirmation does not fabricate a courier delivery')
  const legacy = await makeOrder({ status: 'ON_THE_WAY', courierArrivedAt: new Date(Date.now() - 60_000) })
  await service.confirmDelivery(buyer!.id, legacy.displayId)
  assert.equal((await db.select().from(courierDeliveries)).length, 4)
  passed('orders dispatched before this fix can still complete with a durable delivery record')

  const activeTrips = () => db.select().from(courierTrips)
    .where(and(eq(courierTrips.courierId, courier!.id), isNull(courierTrips.completedAt)))
  const canceled = await makeOrder()
  assert.equal((await scan.scanArrival(canceled.displayId, null)).success, true)
  const [canceledTrip] = await activeTrips()
  assert(canceledTrip)
  const deliveryCountBeforeRefund = (await db.select().from(courierDeliveries)).length
  assert.equal((await service.refund(canceled.displayId, 'Canceled during delivery')).refundedAmount, 120_000)
  assert.equal((await activeTrips()).length, 0)
  assert.equal((await db.select().from(courierDeliveries)).length, deliveryCountBeforeRefund, 'refund must not fabricate a completed delivery')
  const afterRefund = await makeOrder()
  assert.equal((await scan.scanArrival(afterRefund.displayId, null)).success, true)
  const [afterRefundTrip] = await activeTrips()
  assert(afterRefundTrip)
  assert.notEqual(afterRefundTrip.id, canceledTrip.id, 'the next dispatch cannot reuse the refunded trip')
  await service.confirmDelivery(buyer!.id, afterRefund.displayId)
  const [afterRefundDelivery] = await db.select().from(courierDeliveries).where(eq(courierDeliveries.orderId, afterRefund.id))
  assert.equal(afterRefundDelivery!.tripId, afterRefundTrip.id)
  passed('refund of the last outgoing order closes its trip and keeps the next dispatch/history separate')

  for (let attempt = 0; attempt < 4; attempt++) {
    const confirming = await makeOrder()
    const refunding = await makeOrder({ userId: other!.id })
    assert((await Promise.all([scan.scanArrival(confirming.displayId, null), scan.scanArrival(refunding.displayId, null)])).every((r) => r.success))
    const [trip] = await activeTrips()
    assert(trip)
    const operations = [
      () => service.confirmDelivery(buyer!.id, confirming.displayId),
      () => service.refund(refunding.displayId, 'Concurrent cancellation'),
    ]
    if (attempt % 2) operations.reverse()
    await Promise.all(operations.map((run) => run()))
    assert.equal((await activeTrips()).length, 0, 'concurrent completion/cancellation closes the last active trip')
    const deliveries = await db.select().from(courierDeliveries).where(eq(courierDeliveries.tripId, trip.id))
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0]!.orderId, confirming.id)
    assert.equal((await db.select().from(orders).where(eq(orders.id, refunding.id)))[0]!.status, 'CANCELED')
  }
  passed('concurrent refund and delivery confirmation serialize per courier and close the shared trip exactly once')

  const rollback = await makeOrder()
  assert.equal((await scan.scanArrival(rollback.displayId, null)).success, true)
  const beforeOrder = (await db.select().from(orders).where(eq(orders.id, rollback.id)))[0]!
  const beforeTrip = (await activeTrips())[0]!
  const beforeHistory = await db.select().from(courierDeliveries)
  const [conflictingCredit] = await db.insert(walletTransactions).values({
    userId: buyer!.id, orderId: rollback.id, type: 'DEPOSIT', amount: 120_000, description: 'Force refund ledger conflict',
  }).returning()
  await assert.rejects(service.refund(rollback.displayId, 'Must roll back'), isUniqueViolation)
  assert.deepEqual((await db.select().from(orders).where(eq(orders.id, rollback.id)))[0], beforeOrder)
  assert.deepEqual((await db.select().from(courierTrips).where(eq(courierTrips.id, beforeTrip.id)))[0], beforeTrip, 'trip closure rolls back with a failed refund ledger write')
  assert.deepEqual(await db.select().from(courierDeliveries), beforeHistory)
  assert.equal((await db.select().from(walletTransactions).where(eq(walletTransactions.orderId, rollback.id))).length, 1)
  await db.delete(walletTransactions).where(eq(walletTransactions.id, conflictingCredit!.id))
  await service.refund(rollback.displayId, 'Retry after correcting ledger conflict')
  assert.equal((await activeTrips()).length, 0)
  passed('refund ledger failure rolls back order state, trip closure and delivery history; retry closes the trip')

  console.log(`Delivery safety: ${count} passed`)
} finally {
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close()
}
