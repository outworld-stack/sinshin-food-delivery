import assert from 'node:assert/strict'
import { CourierService } from '../src/domain/courier/courier.service'
import type { OrderRow } from '../src/infra/db/schema'

const timestamp = Date.now()
let row = {
  id: 'order-id', deliveryType: 'DELIVERY', status: 'CONFIRMED',
  courierSecurityEnabled: false, courierId: 'assigned', courierArrivedAt: null,
  customerLocation: { lat: 37, lng: 49 }, addressSnapshot: 'Destination',
} as unknown as OrderRow
let updateCount = 0
let loseUpdate = false
let cancelUpdate = false
let neverUpdate = false
let authorizedCourier: string | null = 'assigned'
const service = new CourierService({
  db: {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
    update: () => ({ set: (change: Partial<OrderRow>) => ({ where: () => ({ returning: async () => {
      updateCount++
      if (neverUpdate) return []
      row = { ...row, ...change, ...(cancelUpdate ? { status: 'CANCELED' as const } : {}) }
      return loseUpdate || cancelUpdate ? [] : [row]
    } }) }) }),
  } as never,
  redis: { getJson: async () => authorizedCourier ? { courierId: authorizedCourier } : null } as never,
  config: {} as never, sms: {} as never,
  settings: { restaurantLocation: async () => { throw new Error('Map config unavailable') } } as never,
  neshan: { routeNoTraffic: async () => { throw new Error('Map service unavailable') } } as never,
})

const first = await service.scanArrival('ord-scantest', null)
assert.equal(first.success, true)
assert.equal(first.alreadyScanned, false)
assert.equal(first.route?.polyline, null)
assert.equal(first.route?.address, 'Destination')
const scannedAt = row.courierArrivedAt
const rescan = await service.scanArrival('ord-scantest', null)
assert.equal(rescan.success, true)
assert.equal(rescan.alreadyScanned, true)
assert.equal(row.courierArrivedAt, scannedAt)
assert.equal(updateCount, 1)

row.courierArrivedAt = new Date(timestamp - 3 * 60 * 60_000)
assert.equal((await service.scanArrival('ord-scantest', null)).success, false)
row.courierArrivedAt = null
assert.equal((await service.scanArrival('ord-scantest', null)).success, false)
row.courierArrivedAt = new Date()
row.courierSecurityEnabled = true
assert.equal((await service.scanArrival('ord-scantest', null)).success, false)
authorizedCourier = 'other'
assert.equal((await service.scanArrival('ord-scantest', 'token')).success, false)
authorizedCourier = 'assigned'
assert.equal((await service.scanArrival('ord-scantest', 'token')).success, true)

row.status = 'CONFIRMED'; loseUpdate = true
const raced = await service.scanArrival('ord-scantest', 'token')
assert.equal(raced.success, true)
assert.equal(raced.alreadyScanned, true)
row.status = 'CONFIRMED'; cancelUpdate = true
assert.equal((await service.scanArrival('ord-scantest', 'token')).success, false)
row.status = 'CONFIRMED'; cancelUpdate = false; neverUpdate = true
const beforeRetries = updateCount
assert.equal((await service.scanArrival('ord-scantest', 'token')).success, false)
assert.equal(updateCount - beforeRetries, 2, 'conditional update retries are bounded')
assert.equal((await service.scanArrival('invalid-display-id', 'token')).success, false)
console.log('Courier scan regressions passed: idempotency, expiry, authorization, concurrent scans, cancellation, bounded retry and map fallback.')
