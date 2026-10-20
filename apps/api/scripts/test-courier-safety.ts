import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { CourierService } from '../src/domain/courier/courier.service'
import { LiveService } from '../src/domain/live/live.service'
import { courierDeliveries, courierTrips, couriers, orders, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:55432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_courier_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source); scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const [owner, other] = await db.insert(users).values([{ phone: '09151111111' }, { phone: '09152222222' }]).returning()
  const [assigned, replacement] = await db.insert(couriers).values([{ name: 'Courier A', phone: '09153333333' }, { name: 'Courier B', phone: '09154444444' }]).returning()
  let tokenHook = async () => {}
  let throttleHook = async (): Promise<boolean | null> => true
  const service = new CourierService({
    db, config: {} as never, sms: {} as never,
    redis: {
      getJson: async (key: string) => { await tokenHook(); return { courierId: key.endsWith('other') ? replacement!.id : assigned!.id } },
      setNx: () => throttleHook(),
    } as never,
  })
  const live = new LiveService({
    db, config: {} as never, hub: { publish: () => {} } as never,
    admin2: { log: async () => {}, touchActivity: async () => {} } as never,
  })
  let number = 0
  const makeOrder = async (extra: Partial<typeof orders.$inferInsert> = {}) => (await db.insert(orders).values({
    displayId: `ord-${String(++number).padStart(8, '0')}`, userId: owner!.id,
    deliveryType: 'DELIVERY', status: 'CONFIRMED', courierId: assigned!.id,
    courierSecurityEnabled: true, trackingEnabled: true, confirmedBy: owner!.id,
    totalAmount: 1000, breakdown: {} as never, addressSnapshot: 'Test destination', ...extra,
  }).returning())[0]!
  const first = await makeOrder()
  const scans = await Promise.all([service.scanArrival(first.displayId, 'assigned'), service.scanArrival(first.displayId, 'assigned')])
  assert(scans.every((result) => result.success))
  assert.equal(scans.filter((result) => result.alreadyScanned).length, 1)
  assert.equal((await db.select().from(courierTrips)).length, 1, 'one trip despite concurrent scans')
  assert.equal((await service.updateLocation('other', first.displayId, 37, 49)).stopTracking, true)
  await db.update(orders).set({ courierSecurityEnabled: false }).where(eq(orders.id, first.id))
  assert.equal((await service.updateLocation('other', first.displayId, 37, 49)).success, false, 'open QR does not permit another courier to upload GPS')
  assert.equal((await service.updateLocation('assigned', first.displayId, 37, 49)).accepted, true)
  throttleHook = async () => false
  assert.equal((await service.updateLocation('assigned', first.displayId, 38, 50)).accepted, false)
  throttleHook = async () => null
  await assert.rejects(service.updateLocation('assigned', first.displayId, 38, 50), { code: 'SERVICE_UNAVAILABLE' })
  await assert.rejects(service.updateLocation('assigned', first.displayId, NaN, 49), { code: 'VALIDATION_ERROR' })

  const locationEntered = gate(); const locationRelease = gate()
  throttleHook = async () => { locationEntered.release(); await locationRelease.promise; return true }
  const locationPending = service.updateLocation('assigned', first.displayId, 38, 50)
  await locationEntered.promise
  await db.update(orders).set({ status: 'DELIVERED' }).where(eq(orders.id, first.id))
  locationRelease.release()
  assert.equal((await locationPending).stopTracking, true, 'completion wins against in-flight location')
  assert.deepEqual((await db.select().from(orders).where(eq(orders.id, first.id)))[0]!.courierLocation, { lat: 37, lng: 49 })
  throttleHook = async () => true

  const second = await makeOrder()
  const tokenEntered = gate(); const tokenRelease = gate()
  tokenHook = async () => { tokenEntered.release(); await tokenRelease.promise }
  const pendingScan = service.scanArrival(second.displayId, 'assigned')
  await tokenEntered.promise
  assert.equal((await live.reassignCourier(owner!.id, 'admin', second.displayId, replacement!.id)).success, true)
  tokenRelease.release()
  assert.equal((await pendingScan).success, false, 'old courier cannot dispatch after reassignment')
  tokenHook = async () => {}
  const unassigned = await makeOrder({ courierId: null })
  assert.equal((await service.scanArrival(unassigned.displayId, 'assigned')).success, false)
  await db.update(orders).set({ courierSecurityEnabled: false }).where(eq(orders.id, unassigned.id))
  assert.equal((await service.scanArrival(unassigned.displayId, null)).success, false, 'tracking requires assignment before dispatch')
  await db.update(orders).set({ trackingEnabled: false }).where(eq(orders.id, unassigned.id))
  assert.equal((await service.scanArrival(unassigned.displayId, null)).success, true, 'untracked anonymous scans remain supported')
  assert.equal((await live.reassignCourier(owner!.id, 'admin', second.displayId, null)).success, false)
  assert.equal((await live.confirmOrder(owner!.id, 'admin', (await makeOrder({ status: 'PAID', courierId: null })).displayId, { securityEnabled: true })).success, false)

  const reassignEntered = gate(); const reassignRelease = gate()
  const query = { ...db.query, couriers: { ...db.query.couriers, findFirst: async (...args: Parameters<typeof db.query.couriers.findFirst>) => {
    reassignEntered.release(); await reassignRelease.promise
    return db.query.couriers.findFirst(...args)
  } } }
  const racingLive = new LiveService({
    db: new Proxy(db, { get: (target, key) => key === 'query' ? query : Reflect.get(target, key) }),
    config: {} as never, hub: { publish: () => {} } as never,
    admin2: { log: async () => {}, touchActivity: async () => {} } as never,
  })
  const racingOrder = await makeOrder()
  const reassignPending = racingLive.reassignCourier(owner!.id, 'admin', racingOrder.displayId, replacement!.id)
  await reassignEntered.promise
  assert.equal((await service.scanArrival(racingOrder.displayId, 'assigned')).success, true)
  reassignRelease.release()
  assert.equal((await reassignPending).success, false, 'stale reassignment cannot replace a dispatched courier')

  const historical = new Date('2020-01-01T00:00:00Z')
  const [trip] = await db.insert(courierTrips).values({ courierId: replacement!.id, startedAt: historical, completedAt: historical }).returning()
  for (let index = 0; index < 3; index++) {
    const order = await makeOrder({ status: 'DELIVERED', courierId: replacement!.id, confirmedBy: index === 2 ? other!.id : owner!.id })
    await db.insert(courierDeliveries).values({ tripId: trip!.id, orderId: order.id, addressSnapshot: 'Historical', deliveredAt: new Date(historical.getTime() + index * 1000), amount: 100 + index })
  }
  const history = await service.listCouriersPage({ page: 1, limit: 100, dateTo: '2020-01-02' })
  assert.equal(history.total, 1)
  assert.equal(history.couriers[0]!.totalDeliveries, 3)
  assert.equal(history.couriers[0]!.totalAmount, 303)
  assert.equal(history.couriers[0]!.trips.flatMap((trip) => trip.deliveries).length, 2, 'bounded previews preserve exact historical totals')
  const scoped = await service.listCouriersPage({ page: 1, limit: 100, admin2Id: owner!.id })
  assert.equal(scoped.couriers.find((courier) => courier.id === replacement!.id)!.totalDeliveries, 2)
  const detail = await service.courierDetail(replacement!.id, owner!.id)
  assert.equal(detail.totalDeliveries, 2)
  assert(detail.trips.flatMap((trip) => trip.deliveries).every((delivery) => /^ord-/.test(delivery.orderId)), 'detail links use public order IDs')
  const additions = await Promise.all([service.addCourier({ name: 'Concurrent', phone: '09155555555' }), service.addCourier({ name: 'Concurrent', phone: '09155555555' })])
  assert.equal(additions.filter((value) => value.success).length, 1)
  await db.insert(couriers).values(Array.from({ length: 55 }, (_, index) => ({ name: `Courier ${index}`, phone: `0916${String(index).padStart(7, '0')}` })))
  const fullPage = await service.listCouriersPage({ page: 1, limit: 100 })
  assert.equal(fullPage.couriers.length, fullPage.total, 'requested page size does not silently clamp to 50')
  const failedSession = new CourierService({
    db, config: {} as never, sms: {} as never,
    redis: { consumeOtp: async () => ['ok', 0, 0], set: async () => null } as never,
  })
  await assert.rejects(failedSession.verifyOtp(assigned!.phone, '123456'), { code: 'SERVICE_UNAVAILABLE' }, 'failed token storage cannot report login success')
  await db.update(couriers).set({ isActive: false }).where(eq(couriers.id, assigned!.id))
  await assert.rejects(failedSession.verifyOtp(assigned!.phone, '123456'), { code: 'NOT_FOUND' }, 'inactive couriers cannot log in')
  console.log('Courier safety passed: concurrent dispatch/trips, GPS ownership and completion, reassignment race, historical totals, scoped reports, public links and duplicate registration.')
} finally {
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close()
}
