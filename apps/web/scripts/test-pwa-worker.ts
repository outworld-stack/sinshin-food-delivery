import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const origin = 'https://food.example'
type Handler = (event: any) => void
function worker(source: string, manifest: Array<{ url: string; revision: string }> = []) {
  const listeners = new Map<string, Handler>()
  const stores = new Map<string, Map<string, Response>>()
  const notices: Array<{ title: string; options: any }> = []
  const opened: string[] = []
  let clients: any[] = []
  let failPut = false
  let network: (request: Request) => Promise<Response> = async (req) => new Response(new URL(req.url).pathname)
  const keyOf = (key: string | Request) => new URL(typeof key === 'string' ? key : key.url, origin).href
  const cache = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (key: string | Request) => store.get(keyOf(key))?.clone(),
      put: async (key: string | Request, value: Response) => {
        if (failPut) throw new Error('quota')
        store.set(keyOf(key), value.clone())
      },
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (key: string | Request) => store.delete(keyOf(key)),
    }
  }
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, origin).href : input, init)
    }
  }
  runInNewContext(source, {
    self: {
      __WB_MANIFEST: manifest, location: { origin },
      addEventListener: (name: string, fn: Handler) => listeners.set(name, fn),
      registration: { showNotification: async (title: string, options: any) => { notices.push({ title, options }) } },
      clients: { matchAll: async () => clients, claim: async () => {}, openWindow: async (url: string) => { opened.push(url) } },
      skipWaiting: async () => {},
    },
    caches: { open: cache, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) },
    fetch: (input: string | Request) => network(new WorkerRequest(input)),
    Request: WorkerRequest, Response, URL, AbortController, Uint8Array, atob, console,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 2)), clearTimeout,
  })
  return {
    stores, notices, opened, cache,
    failCachePut: () => { failPut = true },
    setNetwork: (fn: typeof network) => { network = fn },
    setClients: (value: any[]) => { clients = value },
    async emit(name: string, fields: Record<string, unknown> = {}) {
      let work: Promise<any> | undefined
      listeners.get(name)?.({ ...fields, waitUntil: (p: Promise<any>) => { work = p }, respondWith: (p: Promise<any>) => { work = p } })
      return work ? await work : undefined
    },
  }
}

const template = await readFile(new URL('../public/sw.template.js', import.meta.url), 'utf8')
const manifest = [{ url: 'offline.html', revision: 'new' }, { url: 'manifest.webmanifest', revision: '1' }]
const sw = worker(template, manifest)
await sw.emit('install')
const cache = await sw.cache('precache-v4')
await cache.put('/offline.html?__WB_REVISION__=old', new Response('stale'))
await sw.cache('assets-v3')
await sw.cache('unrelated-app')
await sw.emit('activate')
assert(!sw.stores.has('assets-v3'))
assert(sw.stores.has('unrelated-app'))
assert.equal(await cache.match('/offline.html?__WB_REVISION__=old'), undefined)

// Authenticated fetches and server functions bypass the shared static cache.
for (const url of ['/_serverFn/private?user=1', '/dashboard/orders?data=1', '/sw.js']) {
  assert.equal(await sw.emit('fetch', { request: new Request(origin + url) }), undefined)
}
const offlineRequest = { method: 'GET', url: origin + '/checkout', mode: 'navigate' }
sw.setNetwork(async () => { throw new Error('offline') })
assert.equal(await (await sw.emit('fetch', { request: offlineRequest })).text(), '/offline.html')
assert.equal((await sw.emit('fetch', { request: new Request(origin + '/api/orders') })).status, 503)
const fullCache = worker(template, manifest)
fullCache.failCachePut()
await assert.rejects(fullCache.emit('install'), /offline.html not precached/)
await assert.rejects(worker(template).emit('install'), /offline.html not precached/)

for (const file of ['sw.template.js', 'sw-push.js']) {
  const source = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8')
  const push = worker(source, manifest)
  for (const payload of [null, false, 4, [], { title: 'Order', body: 'Ready', url: '/orders/1#status', data: { url: '/wrong' } }]) {
    await push.emit('push', { data: { json: () => payload } })
  }
  assert.equal(push.notices.length, 5)
  assert.equal(push.notices[4]!.options.data.url, '/orders/1#status')
  // A stale/dead client cannot swallow the click, and external links are blocked.
  push.setClients([{ url: origin + '/old', navigate: async () => null, focus: async () => {} }])
  await push.emit('notificationclick', { notification: { close() {}, data: { url: '/orders/1#status' } } })
  assert.deepEqual(push.opened, ['/orders/1#status'])
  push.setClients([{ url: 'https://other.example/?' + origin, navigate: async () => { throw new Error('must not navigate') }, focus: async () => {} }])
  await push.emit('notificationclick', { notification: { close() {}, data: { url: 'https://other.example/phish' } } })
  assert.equal(push.opened[1], '/products')
}

if (process.argv.includes('--built')) {
  const published = await readFile(new URL('../.output/public/sw.js', import.meta.url), 'utf8')
  assert.equal(published, await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'))
  assert(!/^import\s/m.test(published), 'classic worker must not contain module imports')
  assert(!published.includes('self.__WB_MANIFEST'), 'manifest must be injected')
  const entries = JSON.parse(published.match(/const PRECACHE_MANIFEST = (\[.*\]) \|\| \[\]/)![1]!)
  assert(entries.some((e: any) => e.url === 'offline.html'))
  assert(entries.some((e: any) => e.url === 'manifest.webmanifest'))
  assert(!entries.some((e: any) => /^sw(?:[.-]|$)/.test(e.url)))
  worker(published)
}
console.log('PWA worker regressions passed: cache isolation, revision cleanup, offline install, push payloads/clicks, deployment artifact.')
