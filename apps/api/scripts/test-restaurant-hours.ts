import assert from 'node:assert/strict'
import { Elysia } from 'elysia'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DEFAULT_RESTAURANT_HOURS, type RestaurantHoursDto } from '@sinshin/shared'
import { SettingsService } from '../src/domain/settings/settings.service'
import { AppError } from '../src/domain/shared/errors'
import { adminSettingsRoutes } from '../src/http/routes/admin-settings.routes'
import { menuRoutes } from '../src/http/routes/menu.routes'
import { SETTING_KEYS } from '../src/infra/db/schema'

// Exercise the real service and route guards with an isolated KV adapter.
// A second service instance verifies reads from persistence rather than write-through cache.
const stored = new Map<string, unknown>([
  [SETTING_KEYS.restaurantOpen, false],
  [SETTING_KEYS.temporarilyClosed, true],
  [SETTING_KEYS.nextOpenTime, 'Tomorrow morning'],
])
const writes: string[] = []
let failWrite = false
const dialect = new PgDialect()
const db = {
  query: {
    settings: {
      findFirst: async ({ where }: { where: Parameters<PgDialect['sqlToQuery']>[0] }) => {
        const key = dialect.sqlToQuery(where).params[0] as string
        return stored.has(key) ? { value: structuredClone(stored.get(key)) } : undefined
      },
    },
  },
  insert: () => ({
    values: ({ key, value }: { key: string; value: unknown }) => ({
      onConflictDoUpdate: async () => {
        if (failWrite) throw new Error('Database unavailable')
        writes.push(key)
        stored.set(key, structuredClone(value))
      },
    }),
  }),
} as never
const settings = new SettingsService({ db })
const auditEntries: { actorId: string; action: string; metadata: unknown }[] = []
const sessions = {
  authenticate: async (role: string) => ({ user: { id: 'main-admin-id', role }, ctx: {} }),
}
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  })
  .use(adminSettingsRoutes({
    settings,
    sessions: sessions as never,
    admin2: {} as never,
    audit: { log: async (entry: typeof auditEntries[number]) => { auditEntries.push(entry) } } as never,
    zones: {} as never,
    permits: {} as never,
  }))
  .use(menuRoutes({ settings, menu: {} as never, cart: {} as never, redis: {} as never }))
  .compile()

const adminRequest = (role: string | null, method = 'GET', body?: unknown) =>
  app.handle(new Request('http://localhost/admin/settings/restaurant-hours', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(role ? { authorization: `Bearer ${role}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
const publicRequest = (etag?: string) =>
  app.handle(new Request('http://localhost/menu/restaurant-hours', {
    headers: etag ? { 'if-none-match': etag } : {},
  }))

const initial = await publicRequest()
assert.equal(initial.status, 200)
assert.deepEqual(await initial.json(), DEFAULT_RESTAURANT_HOURS)
assert.deepEqual(await (await adminRequest('admin')).json(), DEFAULT_RESTAURANT_HOURS)
assert.match(initial.headers.get('cache-control') ?? '', /no-cache/)
const initialEtag = initial.headers.get('etag')
assert.ok(initialEtag)
const unchanged = await publicRequest(initialEtag)
assert.equal(unchanged.status, 304)
assert.equal(await unchanged.text(), '')

const overnight: RestaurantHoursDto = { openingTime: '18:30', closingTime: '02:15' }
for (const role of [null, 'user', 'admin2', 'courier']) {
  const expected = role === null ? 401 : 403
  assert.equal((await adminRequest(role)).status, expected, `${role}: owner read guard`)
  assert.equal((await adminRequest(role, 'POST', overnight)).status, expected, `${role}: owner write guard`)
}
assert.equal(writes.length, 0, 'unauthorized requests never write settings')
assert.equal(auditEntries.length, 0)

const invalidBodies: unknown[] = [
  {}, null, { openingTime: '10:00' }, { closingTime: '20:00' },
  { openingTime: 10, closingTime: '20:00' },
  { openingTime: '09:00', closingTime: '09:00' },
  ...['', '9:00', '24:00', '12:60', '-1:00', '۰۹:۰۰', '09:00:00', '09:00\n', ' 09:00', 'noon'].flatMap((time) => [
    { openingTime: time, closingTime: '20:00' },
    { openingTime: '09:00', closingTime: time },
  ]),
]
for (const body of invalidBodies) {
  assert.equal((await adminRequest('admin', 'POST', body)).status, 422, `invalid hours: ${JSON.stringify(body)}`)
}
assert.equal(writes.length, 0, 'invalid requests never write settings')
assert.equal(auditEntries.length, 0)
await assert.rejects(
  settings.setRestaurantHours({ openingTime: '10:00', closingTime: '10:00' }),
  (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR',
  'service protects non-HTTP callers too',
)

const saved = await adminRequest('admin', 'POST', overnight)
assert.equal(saved.status, 200)
assert.deepEqual(await saved.json(), overnight)
assert.deepEqual(writes, [SETTING_KEYS.restaurantHours], 'opening and closing are saved in one KV write')
assert.deepEqual(auditEntries, [{
  actorId: 'main-admin-id', action: 'RESTAURANT_HOURS_SET', entity: 'settings', metadata: overnight,
}])
assert.deepEqual(await (await adminRequest('admin')).json(), overnight)
const updated = await publicRequest(initialEtag)
assert.equal(updated.status, 200, 'an old ETag cannot hide newly saved hours')
assert.notEqual(updated.headers.get('etag'), initialEtag)
assert.deepEqual(await updated.json(), overnight)
assert.deepEqual(await new SettingsService({ db }).restaurantHours(), overnight, 'a fresh service reads saved hours')

for (const hours of [
  { openingTime: '00:00', closingTime: '23:59' },
  { openingTime: '11:00', closingTime: '00:00' },
]) {
  assert.deepEqual(await (await adminRequest('admin', 'POST', hours)).json(), hours, 'midnight endpoints are valid')
  assert.deepEqual(await (await publicRequest()).json(), hours)
}
assert.equal(stored.get(SETTING_KEYS.restaurantOpen), false)
assert.equal(stored.get(SETTING_KEYS.temporarilyClosed), true)
assert.equal(stored.get(SETTING_KEYS.nextOpenTime), 'Tomorrow morning')

const beforeFailure = await settings.restaurantHours()
const auditCount = auditEntries.length
failWrite = true
assert.equal((await adminRequest('admin', 'POST', overnight)).status, 500)
assert.deepEqual(await settings.restaurantHours(), beforeFailure, 'failed persistence does not update the cache')
assert.equal(auditEntries.length, auditCount, 'failed saves do not produce a success audit entry')
failWrite = false

for (const corrupt of [null, '11:00', {}, { openingTime: '24:00', closingTime: '00:00' }]) {
  stored.set(SETTING_KEYS.restaurantHours, corrupt)
  assert.deepEqual(await new SettingsService({ db }).restaurantHours(), DEFAULT_RESTAURANT_HOURS)
}

console.log('PASS restaurant hours: defaults, main-admin authorization, validation, atomic persistence, overnight times, public cache refresh, failed writes, and unchanged manual status')
