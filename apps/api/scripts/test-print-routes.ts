import assert from 'node:assert/strict'
import { Elysia } from 'elysia'

import { Admin2Service, ALL_ADMIN2_PERMISSIONS } from '../src/domain/admin2/admin2.service'
import { asUserId } from '../src/domain/shared/brand'
import { AppError, Err } from '../src/domain/shared/errors'
import { printRoutes, type PrintRoutesDeps } from '../src/http/routes/print.routes'

const printerId = '10000000-0000-4000-8000-000000000001'
const printer = {
  id: printerId,
  name: 'Kitchen printer',
  host: '192.168.1.20',
  port: 9100,
  widthDots: 576,
  autoCut: true,
  status: 'online' as const,
  statusDetail: null,
  lastStatusAt: null,
}
const registration = {
  name: printer.name, host: printer.host, port: printer.port,
  widthDots: printer.widthDots, autoCut: printer.autoCut,
}
const receipt = {
  printerId, widthPx: 576, heightPx: 1, rows: Buffer.alloc(72).toString('base64'),
}

const principals = {
  owner: { id: '20000000-0000-4000-8000-000000000001', role: 'admin' },
  manager: { id: '20000000-0000-4000-8000-000000000002', role: 'admin2' },
  reader: { id: '20000000-0000-4000-8000-000000000003', role: 'admin2' },
  disabled: { id: '20000000-0000-4000-8000-000000000004', role: 'admin2' },
  missing: { id: '20000000-0000-4000-8000-000000000005', role: 'admin2' },
  customer: { id: '20000000-0000-4000-8000-000000000006', role: 'user' },
} as const
type Principal = keyof typeof principals
type AdminProfile = NonNullable<Awaited<ReturnType<Admin2Service['profile']>>>
const profiles = new Map<string, AdminProfile>()
for (const token of ['manager', 'reader', 'disabled'] as const) {
  profiles.set(principals[token].id, {
    ...ALL_ADMIN2_PERMISSIONS,
    userId: asUserId(principals[token].id),
    firstName: null,
    lastName: null,
    isActive: token !== 'disabled',
    printingManage: token !== 'reader',
    ordersConfirmed: 0,
    scopeHall: true,
    scopeTakeaway: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
}

// Keep the real permission conversion, profile cache and disabled-profile check.
// Only the profile lookup and external services are replaced; no DB or LAN is used.
const admin2 = new Admin2Service({} as ConstructorParameters<typeof Admin2Service>[0])
const profileReads: string[] = []
admin2.profile = async (userId) => {
  profileReads.push(userId)
  return profiles.get(userId)
}

const calls: Array<{ action: string; input?: unknown }> = []
const auditEntries: Array<Parameters<PrintRoutesDeps['audit']['log']>[0]> = []
const record = (action: string, input?: unknown) => { calls.push({ action, input }) }
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status
      return error.toJSON()
    }
  })
  .use(printRoutes({
    sessions: {
      authenticate: async (token: string) => {
        if (!Object.hasOwn(principals, token)) throw Err.unauthorized()
        return { user: principals[token as Principal], ctx: {} }
      },
    } as unknown as PrintRoutesDeps['sessions'],
    admin2,
    print: {
      list: async () => { record('list'); return [printer] },
      assignment: async () => { record('assignment'); return { sales: null, kitchen: null } },
      discover: async (input: unknown) => {
        record('discover', input)
        return { scanned: ['192.168.1.0/24'], found: [{ host: printer.host, port: printer.port }] }
      },
      add: async (input: unknown) => { record('add', input); return printer },
      setAssignment: async (input: unknown) => { record('setAssignment', input) },
      dispatch: async (input: unknown) => { record('dispatch', input); return { bytes: 128 } },
      networkReport: async () => {
        record('networkReport')
        return { serverSubnets: [], envScanCidrs: [], deploymentMode: 'empty', guidance: [], printers: [] }
      },
      update: async (id: string, patch: unknown) => { record('update', { id, patch }); return printer },
      remove: async (id: string) => { record('remove', id) },
      test: async (id: string) => { record('test', id); return { bytes: 128 } },
    } as unknown as PrintRoutesDeps['print'],
    audit: {
      log: async (input: Parameters<PrintRoutesDeps['audit']['log']>[0]) => { auditEntries.push(input) },
    } as unknown as PrintRoutesDeps['audit'],
  }))
  .compile()

function request(method: string, path: string, body?: unknown, token: string | null = 'manager') {
  calls.length = 0
  auditEntries.length = 0
  return app.handle(new Request(`http://localhost/admin/print${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

interface RouteCase {
  method: string
  path: string
  access: 'shared' | 'manage' | 'owner'
  action: string
  body?: unknown
  input?: unknown
  audit?: string
}
const routes: RouteCase[] = [
  { method: 'GET', path: '/printers', access: 'shared', action: 'list' },
  { method: 'GET', path: '/assignment', access: 'shared', action: 'assignment' },
  {
    method: 'POST', path: '/discover', access: 'manage', action: 'discover',
    body: { cidr: '192.168.1.0/24' }, input: { cidr: '192.168.1.0/24' }, audit: 'PRINTER_DISCOVER',
  },
  {
    method: 'POST', path: '/printers', access: 'manage', action: 'add',
    body: registration, input: registration, audit: 'PRINTER_ADD',
  },
  {
    method: 'POST', path: '/assignment', access: 'manage', action: 'setAssignment',
    body: { sales: printerId, kitchen: null }, input: { sales: printerId, kitchen: null },
  },
  { method: 'POST', path: '/receipt', access: 'manage', action: 'dispatch', body: receipt, input: receipt },
  { method: 'GET', path: '/network', access: 'owner', action: 'networkReport' },
  {
    method: 'PATCH', path: `/printers/${printerId}`, access: 'owner', action: 'update',
    body: registration, input: { id: printerId, patch: registration }, audit: 'PRINTER_UPDATE',
  },
  {
    method: 'DELETE', path: `/printers/${printerId}`, access: 'owner', action: 'remove',
    input: printerId, audit: 'PRINTER_REMOVE',
  },
  {
    method: 'POST', path: `/printers/${printerId}/test`, access: 'owner', action: 'test',
    input: printerId, audit: 'PRINTER_TEST',
  },
]

let checks = 0
for (const token of [...Object.keys(principals), null, 'invalid-session'] as Array<Principal | null | 'invalid-session'>) {
  for (const route of routes) {
    const allowed = token === 'owner'
      || (token === 'manager' && route.access !== 'owner')
      || (token === 'reader' && route.access === 'shared')
    const expectedStatus = allowed ? 200 : token === null || token === 'invalid-session' ? 401 : 403
    const response = await request(route.method, route.path, route.body, token)
    const label = `${token ?? 'anonymous'} ${route.method} ${route.path}`
    assert.equal(response.status, expectedStatus, `${label}: ${await response.text()}`)
    assert.deepEqual(calls, allowed ? [{ action: route.action, input: route.input }] : [], label)
    assert.equal(auditEntries.length, allowed && route.audit ? 1 : 0, `${label}: audit count`)
    if (allowed && route.audit) {
      assert.equal(auditEntries[0]?.actorId, principals[token as Principal].id, `${label}: audit actor`)
      assert.equal(auditEntries[0]?.action, route.audit, `${label}: audit action`)
    }
    checks++
  }
}
assert.ok(!profileReads.includes(principals.owner.id), 'main admins do not need a level-2 profile')
assert.ok(!profileReads.includes(principals.customer.id), 'ordinary users cannot invoke the admin profile lookup')
console.log(`PASS ${checks} print-route permission cases, side-effect prevention and audit attribution`)

const invalid: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'POST', path: '/discover', body: { cidr: 'x' } },
  { method: 'POST', path: '/discover', body: { cidr: '192.168.1.0/24extra-long' } },
  { method: 'POST', path: '/printers', body: { host: printer.host } },
  { method: 'POST', path: '/printers', body: { ...registration, name: '' } },
  { method: 'POST', path: '/printers', body: { ...registration, host: '' } },
  { method: 'POST', path: '/printers', body: { ...registration, port: 0 } },
  { method: 'POST', path: '/printers', body: { ...registration, port: 65536 } },
  { method: 'POST', path: '/printers', body: { ...registration, port: 9100.5 } },
  { method: 'POST', path: '/printers', body: { ...registration, widthDots: 512 } },
  { method: 'POST', path: '/assignment', body: { sales: 'not-a-uuid' } },
  { method: 'POST', path: '/assignment', body: { kitchen: 10 } },
  { method: 'POST', path: '/receipt', body: { ...receipt, printerId: 'not-a-uuid' } },
  { method: 'POST', path: '/receipt', body: { ...receipt, widthPx: 512 } },
  { method: 'POST', path: '/receipt', body: { ...receipt, heightPx: 0 } },
  { method: 'POST', path: '/receipt', body: { ...receipt, heightPx: 4001 } },
  { method: 'POST', path: '/receipt', body: { ...receipt, heightPx: 1.5 } },
  { method: 'POST', path: '/receipt', body: { ...receipt, rows: 'short' } },
  { method: 'PATCH', path: '/printers/not-a-uuid', body: { name: 'New name' } },
  { method: 'PATCH', path: `/printers/${printerId}`, body: { widthDots: 512 } },
  { method: 'DELETE', path: '/printers/not-a-uuid' },
  { method: 'POST', path: '/printers/not-a-uuid/test' },
]
for (const route of invalid) {
  const token = route.method === 'PATCH' || route.method === 'DELETE' || route.path.endsWith('/test')
    ? 'owner' : 'manager'
  const response = await request(route.method, route.path, route.body, token)
  assert.equal(response.status, 422, `${route.method} ${route.path}: ${await response.text()}`)
  assert.deepEqual(calls, [], 'invalid input must never reach printer services')
  assert.deepEqual(auditEntries, [], 'invalid input must not be audited as successful')
}
console.log(`PASS ${invalid.length} malformed printer/discovery/assignment/receipt requests rejected before side effects`)

assert.equal((await request('POST', '/discover', {})).status, 200)
assert.deepEqual(calls, [{ action: 'discover', input: { cidr: undefined } }])
assert.equal((await request('POST', '/assignment', { sales: null, kitchen: null })).status, 200)
assert.deepEqual(calls, [{ action: 'setAssignment', input: { sales: null, kitchen: null } }])
console.log('PASS automatic discovery and clearing printer defaults accept their supported request bodies')
console.log('OK print route regressions')
