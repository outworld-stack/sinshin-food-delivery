// sw.template.js — منبع؛ workbox-build با injectManifest پرش می‌کند
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'

const VERSION = 'v1'
const ASSET_CACHE = `assets-${VERSION}`

precacheAndRoute(self.__WB_MANIFEST)

// navigation — network؛ آفلاین → offline.html
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ event }) => {
    try {
      return await fetch(event.request)
    } catch (err) {
      return caches.match('/offline.html') || Response.error()
    }
  },
)

// API — network-only (بدون کش؛ مالی هرگز کش نمی‌شود)
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  async ({ event }) => {
    try {
      return await fetch(event.request)
    } catch (err) {
      return new Response(
        JSON.stringify({ error: { code: 'OFFLINE', message: 'اتصال اینترنت قطع است.' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    }
  },
)

// asset های same-origin — cache-first
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    request.destination !== 'document',
  new CacheFirst({
    cacheName: ASSET_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 86400 })],
  }),
)

// آپدیت — هرگز خودکار؛ فقط با پیام بنر
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})