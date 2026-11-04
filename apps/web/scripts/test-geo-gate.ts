/** SSR country gates must exempt crawlable pages without caching a UA bypass. */
import assert from 'node:assert/strict'
import { mock } from 'bun:test'

let currentRequest: Request
mock.module('@tanstack/react-start/server', () => ({ getRequest: () => currentRequest }))
mock.module('#/lib/api', () => ({ apiBase: () => 'http://api.internal/api' }))
const originalFetch = globalThis.fetch
let lookups = 0
globalThis.fetch = (async (input: string | URL | Request) => {
  lookups++
  const url = new URL(String(input))
  assert.equal(url.origin, 'http://api.internal')
  assert.equal(url.searchParams.get('ip'), '8.8.8.8')
  return Response.json({ blocked: true, mode: 'iran-only' })
}) as typeof fetch

try {
  const { getGeoGate } = await import('../src/server/geoGate')
  const setRequest = (path: string, ua: string | null, method = 'GET') => {
    currentRequest = new Request(`https://sinshin-foodpark.ir${path}`, {
      method,
      headers: {
        'x-forwarded-for': '5.160.1.1, 8.8.8.8',
        ...(ua === null ? {} : { 'user-agent': ua }),
      },
    })
  }
  for (const ua of ['Googlebot/2.1', 'Google-InspectionTool/1.0', 'bingbot/2.0', 'TelegramBot']) {
    for (const path of ['/', '/articles', '/articles/123?lang=ar', '/products/', '/products/pizza', '/about', '/gallery']) {
      for (const method of ['GET', 'HEAD']) {
        setRequest(path, ua, method)
        assert.equal((await getGeoGate()).blocked, false, `${method} ${path} stays crawlable`)
      }
    }
  }
  assert.equal(lookups, 0)
  setRequest('/articles/123', 'Mozilla/5.0')
  assert.equal((await getGeoGate()).blocked, true, 'a preceding crawler cannot cache an allow for ordinary users')
  assert.equal(lookups, 1)
  for (const path of ['/admin', '/dashboard', '/cart', '/checkout', '/login', '/courier', '/articles/123/private']) {
    setRequest(path, 'Googlebot/2.1')
    assert.equal((await getGeoGate()).blocked, true, `crawler UA does not exempt ${path}`)
  }
  setRequest('/articles/123', 'Google-InspectionTool/1.0')
  assert.equal((await getGeoGate()).blocked, false, 'a previous blocked IP cache cannot block public crawler content')
  setRequest('/articles', 'Googlebot/2.1', 'POST')
  assert.equal((await getGeoGate()).blocked, true, 'only reads can use the crawler exception')
  assert.equal(lookups, 1, 'ordinary country verdicts retain their cache')
  console.log('PASS geo SSR: public crawler pages, private pages, mutations, trusted IP, per-user cache isolation')
} finally {
  globalThis.fetch = originalFetch
}
