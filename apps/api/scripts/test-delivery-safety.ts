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
import { NeshanService, type NeshanMatrixElement } from '../src/infra/maps/neshan.service'
import { AppError } from '../src/domain/shared/errors'
import { AppConfig } from '../src/infra/config/env'
import { CouponService } from '../src/domain/coupon/coupon.service'
import { adminSettingsRoutes } from '../src/http/routes/admin-settings.routes'
import { addresses, categories, mainCategories, products, courierDeliveries, courierTrips, couriers, orders, users, walletTransactions } from '../src/infra/db/schema'

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
  let matrix: NeshanMatrixElement[][] | null = [[{ status: 'Ok', distanceMeters: 0, durationSeconds: 0 }]]
  let matrixCalls = 0
  let providerThrows = false
  const neshan: Pick<NeshanService, 'distanceMatrix'> = {
    distanceMatrix: async (origins, destinations, options) => {
      matrixCalls++
      assert.deepEqual(origins, [await settings.restaurantLocation()])
      assert.equal(destinations.length, 1)
      assert.deepEqual(options, { type: 'car', traffic: false })
      if (providerThrows) throw new Error('Neshan timed out')
      return matrix
    },
  }
  const zones = new DeliveryZoneService({ db, settings, neshan })
  assert.equal(await zones.fallbackFee(), null, 'empty installation does not assume free shipping')
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
  const getZones = async () => (await (await app.handle(new Request('http://localhost/admin/settings/delivery-zones', {
    headers: { authorization: 'Bearer test' },
  }))).json()) as { fallbackFee: number }
  assert.equal((await getZones()).fallbackFee, 60_000, 'unsaved fallback uses the outermost configured tier')
  for (const fee of [-1, 0.5, 2 ** 31]) {
    assert.equal((await post('delivery-zones/fallback-fee', { fee })).status, 422)
    assert.equal((await zones.setFallbackFee(fee)).success, false)
  }
  assert.equal(auditCalls, 1, 'invalid fallback fees are not audited as successful changes')
  assert.equal((await result(post('delivery-zones/fallback-fee', { fee: 35_000 }))).success, true)
  assert.equal(auditCalls, 2)
  assert.equal((await getZones()).fallbackFee, 35_000)
  const restartedZones = new DeliveryZoneService({ db, settings: new SettingsService({ db }), neshan })
  assert.equal(await restartedZones.fallbackFee(), 35_000, 'fallback survives service restarts')
  passed('main admin can persist a validated fallback fee; existing installations start with the outermost fee')
  assert.equal((await zones.quoteFor(null)).status, 'address_required')
  assert.equal(matrixCalls, 0)
  await assert.rejects(zones.feeFor(null), (error) => error instanceof AppError && error.status === 422)
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), remaining.fee)
  matrix = [[{ status: 'Ok', distanceMeters: remaining.radiusKm * 1000, durationSeconds: 60 }]]
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), remaining.fee, 'exact boundary is inclusive')
  matrix = [[{ status: 'Ok', distanceMeters: remaining.radiusKm * 1000 + 1, durationSeconds: 60 }]]
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), 60_000, 'road distance selects outer tier even for identical coordinates')
  matrix = [[{ status: 'Ok', distanceMeters: 100_000, durationSeconds: 60 }]]
  assert.equal(await zones.feeFor({ lat: -37, lng: -130 }), 60_000)
  assert(Number.isFinite(haversineKm({ lat: 45, lng: 10 }, { lat: -45, lng: -170 })))
  passed('road distance selects inclusive distance tiers without rounding; the outermost tier covers longer routes')

  const callsBeforeInvalid = matrixCalls
  assert.equal((await zones.quoteFor({ lat: NaN, lng: 0 })).status, 'no_route')
  assert.equal((await zones.quoteFor({ lat: 91, lng: 0 })).status, 'no_route')
  assert.equal(matrixCalls, callsBeforeInvalid)
  for (const failed of [null, [], [[{ status: 'UnknownError', distanceMeters: null, durationSeconds: null }]], [[{ status: 'Ok', distanceMeters: NaN, durationSeconds: 10 }]]] as Array<NeshanMatrixElement[][] | null>) {
    matrix = failed
    assert.deepEqual(await zones.quoteFor(await settings.restaurantLocation()), { status: 'fallback', fee: 35_000 })
    assert.equal(await zones.feeFor(await settings.restaurantLocation()), 35_000)
  }
  providerThrows = true
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), 35_000, 'unexpected provider exceptions use fallback too')
  providerThrows = false
  const noKeyZones = new DeliveryZoneService({ db, settings, neshan: new NeshanService({ neshan: { serviceApiKey: '', timeoutMs: 1000, cacheTtlSeconds: 300 } } as never) })
  assert.equal(await noKeyZones.feeFor(await settings.restaurantLocation()), 35_000, 'missing service key uses fallback without a network request')
  await restartedZones.setFallbackFee(0)
  matrix = null
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), 0, 'explicitly configured free shipping is respected across service instances')
  await restartedZones.setFallbackFee(35_000)
  assert.equal(await zones.feeFor(await settings.restaurantLocation()), 35_000)
  matrix = [[{ status: 'NoRoute', distanceMeters: null, durationSeconds: null }]]
  assert.equal((await zones.quoteFor(await settings.restaurantLocation())).status, 'no_route')
  await assert.rejects(zones.feeFor(await settings.restaurantLocation()), AppError)
  passed('Neshan outages use saved fallback without inventing a distance; invalid addresses and genuine no-route responses still reject delivery')

  for (const role of ['user', 'admin2']) {
    const deniedApp = new Elysia().use(adminSettingsRoutes({
      zones, settings, admin2: {} as never, permits: {} as never, audit: {} as never,
      sessions: { authenticate: async () => ({ user: { id: crypto.randomUUID(), role }, ctx: {} }) } as never,
    }))
    for (const [path, body] of [['delivery-zones', { radiusKm: 9, fee: 1 }], ['delivery-zones/update', { radiusKm: 6, newRadiusKm: 9, fee: 1 }], ['delivery-zones/remove', { radiusKm: 6 }], ['delivery-zones/fallback-fee', { fee: 1 }]] as const) {
      const response = await deniedApp.handle(new Request(`http://localhost/admin/settings/${path}`, {
        method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify(body),
      }))
      assert.equal(response.status, 403)
    }
  }
  passed('customers and secondary admins cannot add, edit or remove shipping prices')

  const [buyer, other] = await db.insert(users).values([{ phone: '09151111111' }, { phone: '09152222222' }]).returning()
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), JWT_SECRET: 'delivery-test-secret-'.repeat(3), GATEWAY_MODE: 'mock' })
  const checkoutService = new OrderService({ db, config, settings, zones, coupons: new CouponService({ db }), notifications: { notifyUser: async () => {} } as never })
  const [mainCategory] = await db.insert(mainCategories).values({ name: 'Delivery', slug: 'delivery-main' }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: mainCategory!.id, name: 'Meals', slug: 'delivery-meals' }).returning()
  const [product] = await db.insert(products).values({ categoryId: category!.id, name: 'Meal', originalPrice: 100_000, status: 'ACTIVE' }).returning()
  const [address] = await db.insert(addresses).values({ userId: buyer!.id, title: 'Home', address: 'Delivery test', ...await settings.restaurantLocation() }).returning()
  const input = { items: [{ productId: product!.id, quantity: 1 }], deliveryType: 'DELIVERY' as const, useWallet: false, gatewayId: 'MOCK', addressId: address!.id }
  const noAddress = await checkoutService.preview(buyer!.id, { ...input, addressId: null })
  assert.equal(noAddress.deliveryQuote?.status, 'address_required')
  matrix = [[{ status: 'Ok', distanceMeters: 5_001, durationSeconds: 300 }]]
  const preview = await checkoutService.preview(buyer!.id, input)
  assert.deepEqual(preview.deliveryQuote, { status: 'ready', fee: 60_000, radiusKm: 6, distanceKm: 5.001 })
  const checkout = await checkoutService.checkout(buyer!.id, input)
  assert.deepEqual(checkout.breakdown, preview.breakdown)
  assert.equal(checkout.breakdown.deliveryFee, 60_000)
  await assert.rejects(checkoutService.preview(other!.id, input), (error) => error instanceof AppError && error.status === 404)
  matrix = null
  const fallbackPreview = await checkoutService.preview(buyer!.id, input)
  assert.deepEqual(fallbackPreview.deliveryQuote, { status: 'fallback', fee: 35_000 })
  const fallbackCheckout = await checkoutService.checkout(buyer!.id, input)
  assert.deepEqual(fallbackCheckout.breakdown, fallbackPreview.breakdown)
  assert.equal(fallbackCheckout.breakdown.deliveryFee, 35_000)
  assert.equal(fallbackCheckout.amountPaidOnline, 135_000)
  const coldDb = new Database(scratchUrl.toString(), { max: 1 })
  try {
    const coldZones = new DeliveryZoneService({ db: coldDb.db, settings: new SettingsService({ db: coldDb.db }), neshan })
    assert.equal(await coldDb.db.transaction((tx) => coldZones.feeFor(address!, tx)), 35_000, 'fallback uses the transaction connection even with a cold single-connection pool')
  } finally { await coldDb.close() }
  matrix = [[{ status: 'NoRoute', distanceMeters: null, durationSeconds: null }]]
  const orderCount = (await db.select().from(orders)).length
  await assert.rejects(checkoutService.checkout(buyer!.id, input), (error) => error instanceof AppError && error.status === 422)
  assert.equal((await db.select().from(orders)).length, orderCount)
  const beforePickup = matrixCalls
  const pickup = await checkoutService.checkout(buyer!.id, { ...input, deliveryType: 'PICKUP' })
  assert.equal(pickup.breakdown.deliveryFee, 0)
  assert.equal(matrixCalls, beforePickup)
  // Keep the existing courier/refund assertions isolated from checkout fixtures.
  await db.delete(orders).where(eq(orders.userId, buyer!.id))
  passed('preview and checkout agree for road and fallback prices, no-route orders fail, and pickup bypasses Neshan')
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
