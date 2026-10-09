// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/web/public/sw.template.js
// تغییر: هندلرهای Web Push (notification + click) — سیستم پوش کاستوم
// stage-51: نمایشِ نوتیف مقاوم شد — اگر showNotification با آپشن‌های
//   کامل روی موتوری خطا بدهد، همان پیام با آپشن‌های حداقلی دوباره
//   نشان داده می‌شود (همان فیکس sw-push.js در stage-50؛ این نسخه‌ی
//   production است و جای آن خالی مانده بود — پوش می‌رسید ولی «بی‌صدا»
//   حذف می‌شد).
// ═══════════════════════════════════════════════════════════════

// sw.template.js — منبع؛ workbox-build با injectManifest پرش می‌کند
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'

// round-14 — v2: فیکس fallback آفلاین + retry ناوبری + پاک‌سازی کش‌های v1
const VERSION = 'v2'
const ASSET_CACHE = `assets-${VERSION}`

precacheAndRoute(self.__WB_MANIFEST)

// round-14 — پاسخ آفلاین واقعی:
// قبلاً caches.match('/offline.html') هرگز پیدا نمی‌شد چون ورک‌باکس کلید
// precache را با کوئری ریویژن (offline.html?__WB_REVISION__=…) ذخیره می‌کند؛
// نتیجه Response.error() و صفحهٔ خطای انگلیسی خود مرورگر («You're offline»)
// بود — حالا ignoreSearch کلید ریویژن را نادیده می‌گیرد و صفحهٔ فارسی
// «اتصال اینترنت قطع است» با دکمهٔ تلاش مجدد سرو می‌شود.
async function offlineResponse() {
  return (
    (await caches.match('/offline.html', { ignoreSearch: true })) ??
    Response.error()
  )
}

// navigation — network با یک retry؛ آفلاین → offline.html
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ event }) => {
    // تلاش اول
    try {
      return await fetch(event.request)
    } catch {
      // نادیده — پایین retry می‌کنیم
    }
    // round-14 — retry: قطعی‌های لحظه‌ای (تعویض آنتن/وای‌فای در گوشی‌ها،
    // فشار لحظه‌ای سرور) با یک تلاش دوم و مکث کوتاه رفع می‌شوند؛ تجربهٔ
    // «رفتم به صفحهٔ مقالات و سایت آفلاین شد و دیگر هر صفحهٔ همان را نشان
    // داد» دقیقاً همین‌جا بدون retry رخ می‌داد.
    await new Promise((r) => setTimeout(r, 600))
    try {
      return await fetch(event.request)
    } catch (err) {
      return offlineResponse()
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

// uploads — pwa-۱: کش جداگانه و عمیق‌تر برای عکس‌های منو.
// اسم فایل‌های uploads یکتاست (uuid) → کشِ تازه همیشه تازه می‌ماند؛
// سقف ۱۰۰تاییِ عمومی عکس‌های منو را بی‌رحمانه تخلیه می‌کرد (LRU) و
// در آفلاین عکس‌ها می‌پریدند.
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin && url.pathname.startsWith('/uploads/'),
  new CacheFirst({
    cacheName: `uploads-${VERSION}`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 30 * 86400,
        // پرشدن quota دیسک → کش را خودکار خالی کن، نه کرش
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

// asset های same-origin — cache-first (بدون uploads؛ روت بالا می‌گیرد)
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/uploads/') &&
    request.destination !== 'document',
  new CacheFirst({
    cacheName: ASSET_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 86400, purgeOnQuotaError: true })],
  }),
)

// round-14 — پاک‌سازی کش‌های نسخه‌های قبل (assets-v1 / uploads-v1)؛
// precache خودش را ورک‌باکس تمیز می‌کند، کش‌های سفارشیِ ما نه.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => (n.startsWith('assets-') || n.startsWith('uploads-')) && n !== ASSET_CACHE && n !== `uploads-${VERSION}`)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

// ── فاز-۲ — Web Push (سیستم پوش نوتیفیکیشن کاستوم) ──
// پیام از سرور ما: { title, body, url?, tag?, data? }
// payload رمزنگاری‌شده (aes128gcm) توسط خود مرورگر باز می‌شود.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'سین‌شین', body: 'اطلاعیه‌ی جدید دارید.' }
  }
  const title = payload.title || 'سین‌شین'
  const options = {
    body: payload.body || '',
    // tag = جایگزینی نوتیفیکیشن قبلی هم‌برچسب (مثل یادآورهای کوپن)
    tag: payload.tag || 'sinshin',
    // renotify با tag — نوتیف جدید هم‌برچسب دوباره با صدا می‌آید
    renotify: true,
    icon: '/icons/icon-192-v1.png',
    badge: '/icons/icon-192-v1.png',
    dir: 'rtl',
    lang: 'fa',
    data: { url: payload.url || '/products', ...(payload.data || {}) },
  }
  // stage-51 — مقاوم‌سازی: هر موتوری لزوماً همه‌ی آپشن‌ها را نمی‌پذیرد
  // (مثلاً renotify/badge روی بعضی نسخه‌ها TypeError می‌دهد)؛ در آن
  // صورت همان پیام با آپشن‌های حداقلی نشان داده می‌شود — پیام پوش
  // هرگز «بی‌صدا» نمی‌افتد. (همان فیکس sw-push.js در stage-50 — این
  // فایل نسخه‌ی production است و جای آن خالی مانده بود.)
  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, options)
      } catch {
        try {
          await self.registration.showNotification(title, {
            body: options.body,
            tag: options.tag,
            dir: options.dir,
            lang: options.lang,
            data: options.data,
          })
        } catch {
          // نمایش ممکن نیست — لاگ توسعه؛ کاری بیشتر از دست SW برنمی‌آید
          console.warn('[sw] showNotification ناموفق بود')
        }
      }
    })(),
  )
})

// کلیک روی نوتیف — باز/فوکوس تب سایت روی URL مقصد
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/products'
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // تب باز؟ فوکوس + ناوبری به مقصد
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          if ('focus' in client) await client.focus()
          if ('navigate' in client) {
            try { await client.navigate(url) } catch { /* تب در حال ناوبری است */ }
          }
          return
        }
      }
      // تب باز نیست؟ پنجره‌ی جدید
      await self.clients.openWindow(url)
    })(),
  )
})

// آپدیت — هرگز خودکار؛ فقط با پیام بنر
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})