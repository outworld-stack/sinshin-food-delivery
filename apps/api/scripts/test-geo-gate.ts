/** Public crawler access and private country restrictions, without network/DB. */
import assert from 'node:assert/strict'
import { Elysia } from 'elysia'
import { createGeoGate } from '../src/http/hooks/geo-gate'

const checkedIps: string[] = []
type GeoDenial = { error: { policy: string } }
let policy: 'iran-only' | 'iran-iraq' = 'iran-only'
const gate = createGeoGate({
  async shouldBlock(ip) {
    checkedIps.push(ip)
    return ip !== '5.160.1.1'
  },
  async accessMode() { return policy },
})
const app = new Elysia()
  .onRequest(({ request }) => gate(request))
  .all('*', () => ({ content: 'normal route response' }))
  .compile()
const request = (path: string, ua: string | null, method = 'GET', ip = '8.8.8.8') =>
  app.handle(new Request(`https://sinshin-foodpark.ir${path}`, {
    method,
    headers: {
      'x-forwarded-for': `5.160.1.1, ${ip}`,
      ...(ua === null ? {} : { 'user-agent': ua }),
    },
  }))

const article = '/api/articles/12345678-1234-4234-8234-123456789abc'
const crawlerAgents = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)',
  'Googlebot-Image/1.0',
  'bingbot/2.0',
  'TelegramBot (like TwitterBot)',
]
const publicReads = [
  '/api/articles', '/api/articles/?lang=ar', '/api/articles/categories', article,
  '/api/menu/mains', '/api/menu/categories', '/api/menu/restaurant-hours',
  '/api/menu/featured-animation', '/api/menu/mains/pizza/products',
  '/api/menu/mains/pizza/categories', '/api/menu/products/pizza',
  '/api/menu/products/pizza/similar', '/api/gallery', '/api/about',
  '/api/terms', '/api/terms/1', '/api/products/123/reviews',
  '/api/orders/restaurant-status', '/uploads/cover.webp', '/uploads/cover.png',
]

for (const ua of crawlerAgents) {
  for (const path of publicReads) {
    for (const method of ['GET', 'HEAD']) {
      const before = checkedIps.length
      assert.equal((await request(path, ua, method)).status, 200, `${ua}: ${method} ${path}`)
      assert.equal(checkedIps.length, before, 'public crawlers never depend on geo network/cache state')
    }
  }
  for (const path of [
    '/api/admin/articles', '/api/auth/me', '/api/orders', '/api/orders/checkout/preview',
    '/api/profile', '/api/reviews/order/123', '/api/geo/status', '/api/realtime',
    '/api/realtime/events', '/api/uploads', '/api/notifications', '/swagger',
    '/api/articles/123/private', '/api/menu/products/123/private',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      assert.equal((await request(path, ua, method)).status, 403, `crawler UA cannot exempt ${method} ${path}`)
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await request(article, ua, method)).status, 403, 'crawler UA cannot exempt mutations')
  }
}

for (const ua of [null, '', 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36']) {
  const denied = await request(article, ua)
  assert.equal(denied.status, 403, 'ordinary visitors retain the selected country restriction')
  assert.equal(checkedIps.at(-1), '8.8.8.8', 'the trusted proxy appended address wins over a forged first IP')
  assert.equal(denied.headers.get('cache-control'), 'private, no-store')
  assert.equal(denied.headers.get('x-robots-tag'), 'noindex')
  assert.equal((await denied.json() as GeoDenial).error.policy, 'iran-only')
  assert.equal((await request(article, ua, 'GET', '5.160.1.1')).status, 200)
}
policy = 'iran-iraq'
assert.equal((await (await request(article, null)).json() as GeoDenial).error.policy, 'iran-iraq')
for (const method of ['GET', 'POST']) {
  assert.equal((await request('/api/payments/sep/callback', null, method)).status, 200,
    'returning from the bank keeps the existing signed-callback exception')
}
assert.equal((await request('/api/payments/sep/callback/extra', null)).status, 403)
console.log('PASS geo API: crawler rendering and media, private reads, mutations, country policies, denial caching, payment callbacks')
