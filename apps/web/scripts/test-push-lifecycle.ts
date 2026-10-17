import assert from 'node:assert/strict'
import { mock } from 'bun:test'

let fetcher: (url: string, init: RequestInit) => Promise<Response> = async () => Response.json({})
mock.module('#/lib/api', () => ({ apiBase: () => '/api' }))
mock.module('#/lib/auth-session', () => ({ ensureSession: async () => {}, getAccessToken: () => 'current-user', tryRefresh: async () => false }))
mock.module('#/lib/api-fetch', () => ({ fetchWithTimeout: (url: string, init: RequestInit) => fetcher(url, init) }))

const { enablePush, reconcileSubscription, disablePush, resumePushSynchronization, readJsonWithTimeout } = await import('../src/lib/push-subscription')
const calls: string[] = []
let local: any = null
const makeSub = (endpoint: string) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'key', auth: 'auth' } }),
  unsubscribe: async () => { calls.push('unsubscribe:' + endpoint); if (local?.endpoint === endpoint) local = null; return true },
})
let subscribe: () => Promise<any> = async () => { local = makeSub('new'); return local }
const reg = { pushManager: { getSubscription: async () => local, subscribe: () => subscribe() } }
const sw = { getRegistration: async () => reg, ready: Promise.resolve(reg) }
const notification = { permission: 'granted', requestPermission: async () => 'granted' }
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw, userAgent: 'desktop', platform: 'Linux', maxTouchPoints: 0 }, configurable: true })
Object.defineProperty(globalThis, 'window', { value: { PushManager: {}, Notification: notification, navigator, matchMedia: () => ({ matches: false }) }, configurable: true })
Object.defineProperty(globalThis, 'Notification', { value: notification, configurable: true })

// Missing Notification must be a supported failure, not a ReferenceError.
delete (window as any).Notification
assert.equal((await reconcileSubscription()).state, 'unsupported')
;(window as any).Notification = notification

// A locally existing subscription is only enabled after server reconciliation;
// concurrent checks must make one request and one registration.
local = makeSub('local')
let resolveStatus!: (res: Response) => void
fetcher = async (url, init) => {
  calls.push(init.method + ':' + url)
  return url.endsWith('push-status') ? await new Promise((r) => { resolveStatus = r }) : Response.json({ ok: true })
}
const first = reconcileSubscription()
const second = reconcileSubscription()
assert.equal(first, second)
while (!resolveStatus) await new Promise((r) => setTimeout(r, 0))
resolveStatus(Response.json({ endpoints: [] }))
assert.deepEqual(await first, { state: 'granted', subscribed: true })
assert.equal(calls.filter((x) => x.startsWith('POST:')).length, 1)

// Logout cuts browser delivery even when backend cleanup rejects, and a
// status response arriving afterwards cannot register the old endpoint.
calls.length = 0
resolveStatus = undefined as any
const pending = reconcileSubscription()
while (!resolveStatus) await new Promise((r) => setTimeout(r, 0))
fetcher = async (_url, init) => { calls.push(init.method!); throw new Error('offline') }
await disablePush()
resolveStatus(Response.json({ endpoints: [] }))
assert.equal((await pending as any).subscribed, false)
assert.equal(local, null)
assert(calls.includes('DELETE'))
assert(calls.includes('unsubscribe:local'))
assert(!calls.some((x) => x.startsWith('POST')))
resumePushSynchronization()

// Native subscribe cannot be aborted: if it resolves after logout, detach it.
let finishSubscribe!: (sub: any) => void
subscribe = () => new Promise((r) => { finishSubscribe = r })
fetcher = async () => Response.json({ key: 'BA'.repeat(44) })
const enabling = enablePush()
while (!finishSubscribe) await new Promise((r) => setTimeout(r, 0))
await disablePush()
local = makeSub('late')
finishSubscribe(local)
assert.equal((await enabling as any).subscribed, false)
assert.equal(local, null)
assert(calls.includes('unsubscribe:late'))
resumePushSynchronization()

// Body deadlines must cancel the stream, not leave a live background reader.
let cancelled = false
const res = new Response(new ReadableStream({ cancel: () => { cancelled = true } }))
assert.equal(await readJsonWithTimeout(res, 5, 'fallback'), 'fallback')
assert(cancelled)
console.log('Push lifecycle regressions passed: server reconciliation, concurrency, logout races, failed detach, late subscribe and stream cancellation.')
