import assert from 'node:assert/strict'
import { Elysia } from 'elysia'
import { AdminService } from '../src/domain/admin/admin.service'
import { ALL_ADMIN2_PERMISSIONS } from '../src/domain/admin2/admin2.service'
import { LiveService } from '../src/domain/live/live.service'
import { AppError, Err } from '../src/domain/shared/errors'
import { adminRoutes } from '../src/http/routes/admin.routes'
import { adminTranslateRoutes } from '../src/http/routes/admin-translate.routes'
import { liveRoutes } from '../src/http/routes/live.routes'
import { realtimeRoutes } from '../src/http/routes/realtime.routes'
import type { SsePayload } from '../src/infra/realtime/sse-hub'

const viewerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
let role = 'admin2'
let active = true
let permissions = { ...ALL_ADMIN2_PERMISSIONS, takeaway: false }
let row = { userId: otherId, confirmedBy: null as string | null, status: 'PAID', deliveryType: 'DINE_IN' }
const sessions = { authenticate: async () => ({ user: { id: viewerId, role }, ctx: {} }) }
const admin2 = {
  permissionsOf: async () => {
    if (!active) throw Err.forbidden('Disabled')
    return permissions
  },
  scopeOf: async () => ({ hall: permissions.hall, takeaway: permissions.takeaway }),
  profile: async () => ({ firstName: 'Admin', lastName: 'Two' }),
  queueCountFor: async () => 1,
}
const query = {
  where: () => query,
  limit: () => query,
  then: <T>(resolve: (rows: typeof row[]) => T) => Promise.resolve(resolve([row])),
}
const db = { select: () => ({ from: () => query }) }
const subscribers = new Map<string, (payload: SsePayload) => void>()
const hub = {
  subscribe: (channel: string, callback: (payload: SsePayload) => void) => {
    subscribers.set(channel, callback)
    return () => { subscribers.delete(channel) }
  },
}
const live = new LiveService({ db: db as never, admin2: admin2 as never, hub: hub as never, config: {} as never })
function appWithErrors() {
  return new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  })
}
let invoiceCalls = 0
const liveApp = appWithErrors().use(liveRoutes({
  sessions: sessions as never, admin2: admin2 as never, live,
  orders: { invoiceForStaff: async () => { invoiceCalls++; return { invoice: true } } } as never,
}))
const request = (path: string, method = 'GET', body?: unknown) => new Request(`http://localhost${path}`, {
  method, headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const invoicePath = '/live/orders/ord-00000001/invoice'
assert.equal((await liveApp.handle(request(invoicePath))).status, 200, 'in-scope queue invoice is allowed')
row.deliveryType = 'DELIVERY'
assert.equal((await liveApp.handle(request(invoicePath))).status, 403, 'out-of-scope invoice is denied')
assert.equal(invoiceCalls, 1, 'unauthorized requests never generate invoice data')
row.confirmedBy = otherId
row.deliveryType = 'DINE_IN'
assert.equal((await liveApp.handle(request(invoicePath))).status, 403, 'claimed PAID orders are not in the queue')
row.confirmedBy = viewerId
row.status = 'DELIVERED'
assert.equal((await liveApp.handle(request(invoicePath))).status, 200, 'own historical invoice stays available')
permissions.orderDetailsRead = false
assert.equal((await liveApp.handle(request(invoicePath))).status, 403, 'invoice requires orderDetailsRead')
const restrictedSession = await liveApp.handle(request('/live/session'))
assert.equal(restrictedSession.status, 200, 'permission discovery remains accessible')
assert.equal((await restrictedSession.json() as { queueCount: number }).queueCount, 0, 'permission discovery does not expose restricted queue counts')
active = false
assert.equal((await liveApp.handle(request('/live/session'))).status, 403, 'disabled profiles cannot access live session')
active = true
role = 'admin'
row.confirmedBy = otherId
assert.equal((await liveApp.handle(request(invoicePath))).status, 200, 'main administrator retains full invoice access')
role = 'admin2'
permissions.orderDetailsRead = true

const realtimeApp = appWithErrors().use(realtimeRoutes({
  sessions: sessions as never, admin2: admin2 as never, db: db as never, hub: hub as never,
}))
const streamPath = '/realtime/stream?channel=orders:ord-00000001'
assert.equal((await realtimeApp.handle(request(streamPath))).status, 403, 'SSE cannot bypass order ownership')
permissions.orderDetailsRead = false
assert.equal((await realtimeApp.handle(request('/realtime/stream?channel=orders:new'))).status, 403)
permissions.orderDetailsRead = true
active = false
assert.equal((await realtimeApp.handle(request('/realtime/stream?channel=orders:new'))).status, 403)
active = true
row.status = 'PAID'
row.confirmedBy = null
row.deliveryType = 'DELIVERY'
assert.equal((await realtimeApp.handle(request(streamPath))).status, 403, 'SSE rejects an out-of-scope queue order')
row.deliveryType = 'DINE_IN'
const scopedResponse = await realtimeApp.handle(request(streamPath))
assert.equal(scopedResponse.status, 200)
const scopedReader = scopedResponse.body!.getReader()
await scopedReader.read()
row.confirmedBy = otherId
subscribers.get('orders:ord-00000001')!({ event: 'order-updated', data: { private: true } })
assert.equal((await scopedReader.read()).done, true, 'SSE closes when another administrator claims the order')
assert(!subscribers.has('orders:ord-00000001'))
const panelResponse = await realtimeApp.handle(request('/realtime/stream?channel=orders:new'))
const panelReader = panelResponse.body!.getReader()
await panelReader.read()
subscribers.get('orders:new')!({ event: 'order-confirmed', data: { id: 'ord-00000002', by: otherId } })
const panelEvent = new TextDecoder().decode((await panelReader.read()).value)
assert(panelEvent.includes('event: order-confirmed'))
assert(panelEvent.includes('data: {}'), 'global invalidation events do not leak unrelated order identifiers')
permissions.orderDetailsRead = false
subscribers.get('orders:new')!({ event: 'order-created', data: {} })
assert.equal((await panelReader.read()).done, true, 'an existing stream closes on permission revocation')
assert.equal(subscribers.size, 0, 'closed streams release subscriptions')

role = 'admin'
const roleChangeResponse = await realtimeApp.handle(request('/realtime/stream?channel=orders:new'))
const roleChangeReader = roleChangeResponse.body!.getReader()
await roleChangeReader.read()
role = 'admin2'
permissions.orderDetailsRead = true
subscribers.get('orders:new')!({ event: 'order-confirmed', data: { id: 'ord-00000002', by: otherId } })
const roleChangeEvent = new TextDecoder().decode((await roleChangeReader.read()).value)
assert(roleChangeEvent.includes('data: {}'), 'role demotion immediately applies content-free panel delivery')
role = 'user'
subscribers.get('orders:new')!({ event: 'order-created', data: {} })
assert.equal((await roleChangeReader.read()).done, true, 'role removal closes an existing staff stream')
assert.equal(subscribers.size, 0)
role = 'admin2'

let targetRole = 'admin'
let deviceRevocations = 0
let addressDeletions = 0
const admin = new AdminService({ db: {
  query: { users: { findFirst: async () => ({ phone: '09151111111', role: targetRole }) } },
  delete: () => ({ where: () => ({ returning: async () => { addressDeletions++; return [{ id: deviceId }] } }) }),
} as never })
const usersApp = appWithErrors().use(adminRoutes({
  sessions: sessions as never, admin2: admin2 as never, admin,
  devices: { revokeIdentity: async () => { deviceRevocations++; return true } } as never,
  audit: {} as never,
} as never))
const devicePath = `/admin/users/${otherId}/devices/${deviceId}`
const addressPath = `/admin/users/${otherId}/addresses/${deviceId}`
assert.equal((await usersApp.handle(request(devicePath, 'DELETE'))).status, 403)
assert.equal((await usersApp.handle(request(addressPath, 'DELETE'))).status, 403)
targetRole = 'admin2'
assert.equal((await usersApp.handle(request(devicePath, 'DELETE'))).status, 403)
assert.equal((await usersApp.handle(request(addressPath, 'DELETE'))).status, 403)
assert.equal(deviceRevocations + addressDeletions, 0, 'protected staff accounts remain untouched')
targetRole = 'user'
assert.equal((await usersApp.handle(request(devicePath, 'DELETE'))).status, 200)
assert.equal((await usersApp.handle(request(addressPath, 'DELETE'))).status, 200)
permissions.usersWrite = false
assert.equal((await usersApp.handle(request(devicePath, 'DELETE'))).status, 403)
assert.equal((await usersApp.handle(request(addressPath, 'DELETE'))).status, 403)
assert.equal(deviceRevocations, 1)
assert.equal(addressDeletions, 1)
role = 'admin'
targetRole = 'admin'
assert.equal((await usersApp.handle(request(devicePath, 'DELETE'))).status, 200)
assert.equal((await usersApp.handle(request(addressPath, 'DELETE'))).status, 200)

let enqueued = 0
const translateApp = appWithErrors().use(adminTranslateRoutes({
  sessions: sessions as never, admin2: admin2 as never,
  translation: {
    enqueue: async () => { enqueued++; return { queued: true } },
    enqueueBulkMissing: async () => { enqueued++; return { queued: 1 } },
    preview: async () => ['Translated'],
    status: async () => ({ queued: 0 }),
    jobs: async () => [],
  } as never,
}))
const contentPermissions = [
  ['product', 'productsWrite'],
  ['mainCategory', 'mainCategoriesWrite'],
  ['category', 'mainCategoriesWrite'],
  ['article', 'articlesWrite'],
  ['articleCategory', 'articlesWrite'],
  ['articleSubCategory', 'articlesWrite'],
] as const
role = 'admin2'
for (const granted of ['productsWrite', 'mainCategoriesWrite', 'articlesWrite'] as const) {
  permissions = { ...ALL_ADMIN2_PERMISSIONS, productsWrite: false, mainCategoriesWrite: false, articlesWrite: false }
  permissions[granted] = true
  for (const [entityType, required] of contentPermissions) {
    const before = enqueued
    const expected = required === granted ? 200 : 403
    assert.equal((await translateApp.handle(request('/admin/translate/', 'POST', { entityType, entityId: otherId }))).status,
      expected, `${granted} only permits matching single-entity translation writes`)
    assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', { entityType }))).status,
      expected, `${granted} only permits matching bulk translation writes`)
    assert.equal(enqueued - before, expected === 200 ? 2 : 0, 'rejected requests never enqueue worker writes')
  }
}
permissions = { ...ALL_ADMIN2_PERMISSIONS }
for (const entityType of ['gallery', 'terms', 'about'] as const) {
  const before = enqueued
  assert.equal((await translateApp.handle(request('/admin/translate/', 'POST', { entityType, entityId: otherId }))).status, 403)
  assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', { entityType }))).status, 403)
  assert.equal(enqueued, before, `${entityType} remains main-admin-only even with all level-2 permissions`)
}
const beforeGlobal = enqueued
assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', {}))).status, 403)
assert.equal(enqueued, beforeGlobal, 'untyped bulk cannot bypass entity permissions')
permissions.productsWrite = false
assert.equal((await translateApp.handle(request('/admin/translate/', 'POST', { entityType: 'product', entityId: otherId }))).status, 403)
assert.equal((await translateApp.handle(request('/admin/translate/preview', 'POST', { texts: ['Source'] }))).status, 200)
assert.equal((await translateApp.handle(request('/admin/translate/status'))).status, 200)
assert.equal((await translateApp.handle(request('/admin/translate/jobs'))).status, 200)
active = false
assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', { entityType: 'article' }))).status, 403)
assert.equal((await translateApp.handle(request('/admin/translate/preview', 'POST', { texts: ['Source'] }))).status, 403)
active = true
role = 'user'
assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', {}))).status, 403)
role = 'admin'
for (const entityType of [...contentPermissions.map(([entity]) => entity), 'gallery', 'terms', 'about']) {
  assert.equal((await translateApp.handle(request('/admin/translate/', 'POST', { entityType, entityId: otherId }))).status, 200)
  assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', { entityType }))).status, 200)
}
assert.equal((await translateApp.handle(request('/admin/translate/bulk', 'POST', {}))).status, 200)
console.log('Admin2 access passed: scoped invoices, permission gates, live sessions, stream revocation, content-free events, staff-account protection, and translation write permissions.')
