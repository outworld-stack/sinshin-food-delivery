import assert from 'node:assert/strict'
import { Elysia } from 'elysia'
import { PgDialect } from 'drizzle-orm/pg-core'
import { contentTranslationFields, TEMPORARY_CLOSE_REASON_MIN_LENGTH } from '@sinshin/shared'
import { Admin2Service, ALL_ADMIN2_PERMISSIONS } from '../src/domain/admin2/admin2.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { AppError } from '../src/domain/shared/errors'
import { adminSettingsRoutes } from '../src/http/routes/admin-settings.routes'
import { SETTING_KEYS } from '../src/infra/db/schema'

const actorId = '11111111-1111-4111-8111-111111111111'
const profile = { ...ALL_ADMIN2_PERMISSIONS, isActive: true }
const stored = new Map<string, unknown>()
const provenance = new Map<string, unknown>()
const writes: Array<{ key: string; value: unknown }> = []
const activity: string[] = []
const audit: unknown[] = []
const dialect = new PgDialect()
const fakeDb = {
  execute: async () => [],
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const before = new Map(stored), beforeProvenance = new Map(provenance), beforeWrites = writes.length
    try { return await fn(fakeDb) } catch (error) {
      stored.clear(); for (const [key, value] of before) stored.set(key, value)
      provenance.clear(); for (const [key, value] of beforeProvenance) provenance.set(key, value)
      writes.splice(beforeWrites); throw error
    }
  },
  select: () => ({ from: () => ({ where: (where: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const keys = dialect.sqlToQuery(where).params as string[]
    const rows = keys.filter(key => stored.has(key)).map(key => ({ key, value: structuredClone(stored.get(key)), translationState: provenance.get(key) ?? null }))
    return { for: async () => rows, then: (resolve: (value: typeof rows) => unknown) => Promise.resolve(rows).then(resolve) }
  } }) }),
  query: { settings: { findFirst: async ({ where }: { where: Parameters<PgDialect['sqlToQuery']>[0] }) => {
    const key = dialect.sqlToQuery(where).params[0] as string
    return stored.has(key) ? { value: structuredClone(stored.get(key)), translationState: provenance.get(key) ?? null } : undefined
  } } },
  insert: () => ({ values: ({ key, value, translationState }: { key: string; value: unknown; translationState?: unknown }) => ({
    onConflictDoNothing: async () => { if (!stored.has(key)) stored.set(key, value) },
    onConflictDoUpdate: async () => {
      writes.push({ key, value })
      stored.set(key, value)
      if (translationState !== undefined) provenance.set(key, translationState)
    },
  }) }),
}
const settings = new SettingsService({ db: fakeDb as never })
const service = new Admin2Service({
  db: {
    query: { admin2Profiles: { findFirst: async ({ where }: { where: Parameters<PgDialect['sqlToQuery']>[0] }) => {
      assert.equal(dialect.sqlToQuery(where).params[0], actorId)
      return profile
    } } },
  } as never,
  settings,
  config: {} as never,
  hub: {} as never,
})
service.log = async (_id, action) => { activity.push(action) }
service.touchActivity = async () => { activity.push('TOUCH') }

const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  })
  .use(adminSettingsRoutes({
    admin2: service,
    sessions: { authenticate: async (role: string) => ({ user: { id: actorId, role }, ctx: {} }) } as never,
    audit: { log: async (entry: unknown) => { audit.push(entry) } } as never,
    settings,
    zones: {} as never,
    permits: {} as never,
  }))
  .compile()

const request = async (body: unknown, role: string | null = 'admin') => {
  let payload = body
  const input = body as { closed?: boolean; reason?: string; reasonAr?: string | null }
  if (input.closed && input.reasonAr !== undefined) {
    const current = await settings.readTemporaryCloseContent()
    const field = contentTranslationFields('temporaryClose', current)[0]!
    payload = { ...input, translationEdits: [{ fieldId: 'reason', fieldPath: ['reason'], sourceText: typeof input.reason === 'string' ? input.reason.trim() : '',
      revision: field.revision, value: typeof input.reasonAr === 'string' ? input.reasonAr.trim() : '', origin: 'manual' }] }
  }
  return app.handle(new Request(
  'http://localhost/admin/settings/temporary-close',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${role}` } : {}) },
    body: JSON.stringify(payload),
  },
)) }
const adminStatus = (role = 'admin') => app.handle(new Request('http://localhost/admin/settings/restaurant/status', {
  headers: { authorization: `Bearer ${role}` },
}))
const effects = () => ({ writes: writes.length, activity: activity.length, audit: audit.length })
const isValidation = (error: unknown) => error instanceof AppError && error.status === 422
const boundary = 'ر'.repeat(TEMPORARY_CLOSE_REASON_MIN_LENGTH)
const arabicBoundary = 'ص'.repeat(TEMPORARY_CLOSE_REASON_MIN_LENGTH)
assert.equal(TEMPORARY_CLOSE_REASON_MIN_LENGTH, 20)

for (const reason of [undefined, null, '', ' '.repeat(20), boundary.slice(1), ` ${boundary.slice(1)} `, 'ر'.repeat(121)]) {
  const before = effects()
  await assert.rejects(service.setTemporaryClose(actorId, 'admin', true, reason), isValidation)
  assert.equal((await request({ closed: true, reason })).status, 422)
  assert.deepEqual(effects(), before, 'invalid closing reasons never write settings or success audit entries')
}
for (const reasonAr of [boundary.slice(1), ` ${boundary.slice(1)} `, 'ص'.repeat(121)]) {
  const before = effects()
  await assert.rejects(service.setTemporaryClose(actorId, 'admin', true, boundary, null, reasonAr), isValidation)
  assert.equal((await request({ closed: true, reason: boundary, reasonAr })).status, 422)
  assert.deepEqual(effects(), before, 'invalid translations cannot partially close the restaurant')
}
for (const disablePayments of [null, 'true', 1]) {
  const before = effects()
  await assert.rejects(service.setTemporaryClose(actorId, 'admin', true, boundary, null, null, disablePayments as never), isValidation)
  assert.equal((await request({ closed: true, reason: boundary, disablePayments })).status, 422)
  assert.deepEqual(effects(), before, 'payment policy must be an explicit boolean')
}

assert.equal((await request({ closed: true, reason: ` ${boundary} `, reasonAr: ` ${boundary} `, reopenTime: ' 21:30 ' })).status, 200)
assert.equal(stored.get(SETTING_KEYS.temporarilyClosed), true)
assert.equal(stored.get(SETTING_KEYS.temporaryPaymentsDisabled), false, 'closing keeps payments enabled by default')
assert.equal(stored.get(SETTING_KEYS.temporaryCloseReason), boundary, 'exactly 20 trimmed characters are accepted and normalized')
assert.equal(stored.get(SETTING_KEYS.temporaryCloseReasonAr), boundary)
assert.equal(stored.get(SETTING_KEYS.temporaryReopenTime), '21:30', 'legacy reopening metadata is still saved')
assert.equal(audit.length, 1)
assert.deepEqual(activity, [], 'main-admin changes do not create admin2 activity')

for (const reasonAr of [undefined, null, '', '   ']) {
  assert.equal((await request({ closed: true, reason: boundary, reasonAr })).status, 200)
  assert.equal(stored.get(SETTING_KEYS.temporaryCloseReasonAr), reasonAr === undefined ? boundary : '',
    'omitted Arabic preserves existing manual content; explicitly reviewed blanks allow fallback')
}
assert.equal((await request({ closed: true, reason: 'ر'.repeat(120), reasonAr: 'ص'.repeat(120) })).status, 200)
const beforeBlockedClose = writes.length
assert.equal((await request({ closed: true, reason: boundary, disablePayments: true })).status, 200)
assert.equal(stored.get(SETTING_KEYS.temporaryPaymentsDisabled), true)
const blockedCloseWrites = writes.slice(beforeBlockedClose)
assert(blockedCloseWrites.findIndex(({ key }) => key === SETTING_KEYS.temporaryPaymentsDisabled)
  < blockedCloseWrites.findIndex(({ key }) => key === SETTING_KEYS.temporarilyClosed),
  'payment policy is saved before publishing the closed state')
assert.equal((audit.at(-1) as { metadata: { disablePayments: boolean } }).metadata.disablePayments, true)
await service.setTemporaryClose(actorId, 'admin', true, boundary)
assert.equal(stored.get(SETTING_KEYS.temporaryPaymentsDisabled), false, 'direct callers retain the default-enabled payment behavior')

for (const role of [null, 'user', 'courier']) {
  const before = effects()
  assert.equal((await request({ closed: true, reason: boundary, disablePayments: true }, role)).status, role === null ? 401 : 403)
  assert.deepEqual(effects(), before)
}
for (const permissions of [
  { isActive: true, canToggleTemporaryClose: false },
  { isActive: false, canToggleTemporaryClose: true },
]) {
  Object.assign(profile, permissions)
  const before = effects()
  await assert.rejects(service.setTemporaryClose(actorId, 'admin2', true, boundary, null, null, true),
    (error: unknown) => error instanceof AppError && error.status === 403)
  assert.equal((await request({ closed: true, reason: boundary, disablePayments: true }, 'admin2')).status, 403)
  assert.deepEqual(effects(), before, 'inactive or unauthorized administrators cannot mutate settings')
}
Object.assign(profile, { isActive: true, canToggleTemporaryClose: true })
assert.equal((await request({ closed: true, reason: boundary, reasonAr: arabicBoundary, reopenTime: '21:30', disablePayments: true }, 'admin2')).status, 200)
assert.equal(stored.get(SETTING_KEYS.temporaryPaymentsDisabled), true, 'authorized admin2 can disable order payments')
assert.deepEqual(activity, ['TEMP_CLOSE', 'TOUCH'])
const editStatus = await adminStatus('admin2')
assert.equal(editStatus.status, 200)
assert.equal((await editStatus.json() as { temporaryCloseReasonAr: string | null }).temporaryCloseReasonAr, arabicBoundary,
  'the admin editing context retains the raw Arabic reason')
assert(!('temporaryCloseReasonAr' in await settings.restaurantStatus()), 'public status does not expose the admin translation field')
assert.equal((await adminStatus('user')).status, 403)

for (const reason of [undefined, null, '', '  ', 'ok', ' ok ', 'ر'.repeat(121)]) {
  const before = effects()
  await assert.rejects(service.setTemporaryClose(actorId, 'admin', false, reason), isValidation)
  assert.equal((await request({ closed: false, reason })).status, 422)
  assert.deepEqual(effects(), before, 'reopening still requires its three-character audit reason')
}
assert.equal((await request({ closed: false, reason: ' تمت ', reasonAr: 'قديم', reopenTime: '22:00', disablePayments: true }, 'admin2')).status, 200)
assert.equal(stored.get(SETTING_KEYS.temporarilyClosed), false)
assert.equal(stored.get(SETTING_KEYS.temporaryPaymentsDisabled), false, 'reopening always clears the payment block')
assert.equal((audit.at(-1) as { metadata: { disablePayments: boolean } }).metadata.disablePayments, false)
for (const key of [SETTING_KEYS.temporaryCloseReason, SETTING_KEYS.temporaryCloseReasonAr, SETTING_KEYS.temporaryReopenTime]) {
  assert.equal(stored.get(key), '', 'reopening clears customer-visible closure metadata')
}
assert.deepEqual(activity, ['TEMP_CLOSE', 'TOUCH', 'TEMP_OPEN', 'TOUCH'])
assert.equal((await (await adminStatus()).json() as { temporaryCloseReasonAr: string | null }).temporaryCloseReasonAr, null,
  'the admin translation field is cleared when the restaurant reopens')
await settings.set(SETTING_KEYS.temporaryCloseReasonAr, arabicBoundary)
assert.equal((await (await adminStatus()).json() as { temporaryCloseReasonAr: string | null }).temporaryCloseReasonAr, null,
  'an old translation cannot leak into the editing context while the restaurant is open')

console.log('PASS temporary closures: reason boundaries, translations, validation before writes, authorization, optional payment blocking, reopening audit reasons, and metadata clearing')
