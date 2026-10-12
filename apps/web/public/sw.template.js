// ═══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery
// مسیر مقصد: apps/web/public/sw.template.js
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (باگ 🔴 تولیدی — «نوتیفیکیشن در هیچ مرورگری نمی‌رسد»):
//   نسخه‌ی قبلی `import { registerRoute } from 'workbox-routing'` … داشت؛
//   build-sw.mjs از injectManifest استفاده می‌کند که «باندل نمی‌کند» —
//   importهای خام دست‌نخورده در sw.js می‌ماندند و یک سرویس‌ورکرِ classic
//   (register بدون {type:'module'}) هرگز نمی‌تواند‌شان resolve کند ⇒
//   «ServiceWorker script evaluation failed» ⇒ ثبت رد و بی‌صدا قورت
//   داده می‌شد ⇒ هیچ push handlerی در تولید وجود نداشت (تنها مسیرِ
//   کارکرده دکمه‌ی بنفش بود که sw-push.js را تنبل ثبت می‌کرد).
//   راستی‌آزمایی: ثبت همان اسکریپت در Chrome واقعی → rejected.
//
//   این نسخه «صفر وابستگی» است: بدون import، بدون workbox، بدون باندلر —
//   همان منطقِ قبل با Cache API خام. build-sw.mjs فقط self.__WB_MANIFEST
//   را تزریق می‌کند (string-replacement) و همان build:pwa جواب می‌دهد.
// ═══════════════════════════════════════════════════════════════
// sw.template.js — منبع؛ build-sw.mjs (injectManifest) پرش می‌کند

// round-14 — v2: فیکس fallback آفلاین + retry ناوبری + پاک‌سازی کش‌های v1
// stage-58 — v3: وابستگی‌زدایی کامل (باندل لازم ندارد)
const VERSION = 'v3'
const ASSET_CACHE = `assets-${VERSION}`
const UPLOADS_CACHE = `uploads-${VERSION}`
const PRECACHE = `precache-${VERSION}`

/** manifest تزریقی: [{url, revision}, …] — کلیدِ کش با کوئری ریویژن */
const PRECACHE_MANIFEST = self.__WB_MANIFEST || []
const precacheMap = new Map()
for (const entry of PRECACHE_MANIFEST) {
  if (!entry || !entry.url) continue
  const key = entry.revision ? `${entry.url}?__WB_REVISION__=${entry.revision}` : entry.url
  precacheMap.set(new URL(entry.url, self.location.origin).pathname, key)
}

// ── نصب: precache (به‌ترین تلاش — یک مدخلِ خطادار کل نصب را نکشد) ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      await Promise.allSettled(
        PRECACHE_MANIFEST.map(async (entry) => {
          if (!entry || !entry.url) return
          const key = entry.revision ? `${entry.url}?__WB_REVISION__=${entry.revision}` : entry.url
          const req = new Request(key, { cache: 'reload' }) // دور زدن کش HTTP
          try {
            await cache.put(req, await fetch(req))
          } catch {
            /* به‌ترین تلاش — آفلاینِ لحظه‌ی نصب یک فایل را نمی‌کشد */
          }
        }),
      )
    })(),
  )
})

// round-14 — پاک‌سازی کش‌های نسخه‌های قبل (assets-/uploads-/precache-)؛
// precache خودش را این نسخه تمیز می‌کند، کش‌های سفارشیِ ما نه.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(
            (n) =>
              (n.startsWith('assets-') ||
                n.startsWith('uploads-') ||
                n.startsWith('precache-') ||
                n.startsWith('workbox-')) &&
              n !== ASSET_CACHE &&
              n !== UPLOADS_CACHE &&
              n !== PRECACHE,
          )
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

// round-14 — پاسخ آفلاین واقعی:
// قبلاً caches.match('/offline.html') هرگز پیدا نمی‌شد چون کلید precache
// کوئری ریویژن دارد؛ ignoreSearch کلید ریویژن را نادیده می‌گیرد و صفحهٔ
// فارسی «اتصال اینترنت قطع است» با دکمهٔ تلاش مجدد سرو می‌شود.
async function offlineResponse() {
  return (
    (await caches.match('/offline.html', { ignoreSearch: true })) ??
    Response.error()
  )
}

/** ناوبری — شبکه با یک retry؛ آفلاین → offline.html */
async function handleNavigation(request) {
  // تلاش اول
  try {
    return await fetch(request)
  } catch {
    // نادیده — پایین retry می‌کنیم
  }
  // round-14 — retry: قطعی‌های لحظه‌ای (تعویض آنتن/وای‌فای در گوشی‌ها،
  // فشار لحظه‌ای سرور) با یک تلاش دوم و مکث کوتاه رفع می‌شوند.
  await new Promise((r) => setTimeout(r, 600))
  try {
    return await fetch(request)
  } catch {
    return offlineResponse()
  }
}

/** API — network-only (بدون کش؛ مالی هرگز کش نمی‌شود) */
async function handleApi(request) {
  try {
    return await fetch(request)
  } catch {
    return new Response(
      JSON.stringify({ error: { code: 'OFFLINE', message: 'اتصال اینترنت قطع است.' } }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )
  }
}

/**
 * uploads/assets — cache-first با سقف مدخل (FIFO) + تخلیه‌ی quota.
 * (جانشین ExpirationPlugin — بدون وابستگی؛ keys() ترتیب درج را نگه
 * می‌دارد؛ سقف‌ها همان قبلی: uploads ۳۰۰ / asset ۱۰۰)
 */
async function handleCacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  try {
    const res = await fetch(request)
    if (res && res.ok && res.type === 'basic') {
      try {
        await cache.put(request, res.clone())
        await trimCache(cacheName, maxEntries)
      } catch {
        // quota پر شد → کش‌های بزرگ را خالی کن، نه کرش (purgeOnQuotaError)
        await purgeLargeCaches().catch(() => {})
      }
    }
    return res
  } catch {
    return hit ?? Response.error()
  }
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= maxEntries) return
  for (const req of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(req).catch(() => {})
  }
}

async function purgeLargeCaches() {
  await caches.delete(UPLOADS_CACHE)
  await caches.delete(ASSET_CACHE)
}

// ── مسیریابی fetch — بدون workbox-routing ──
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // فقط GET کش می‌شود
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  // ① ناوبری — همیشه network-first (HTML تازه؛ SSR محتوای داینامیک دارد)
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  // ② precache — URLِ داخل manifest (کوئری ریویژن را نادیده بگیر)
  const precacheKey = precacheMap.get(url.pathname)
  if (precacheKey) {
    event.respondWith(
      (async () => (await caches.match(precacheKey)) ?? (await fetch(request)))(),
    )
    return
  }

  // ③ API — network-only (بدون کش؛ مالی هرگز کش نمی‌شود)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApi(request))
    return
  }

  // ④ uploads — pwa-۱: کش جداگانه و عمیق‌تر برای عکس‌های منو.
  // اسم فایل‌های uploads یکتاست (uuid) → کشِ تازه همیشه تازه می‌ماند.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(handleCacheFirst(request, UPLOADS_CACHE, 300))
    return
  }

  // ⑤ assetهای same-origin دیگر — cache-first
  event.respondWith(handleCacheFirst(request, ASSET_CACHE, 100))
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

// ── stage-58 — چرخش/انقضای اشتراک (pushsubscriptionchange) ──
// فایرفاکس ~۹۰ روزه و کروم پروفایل‌چرخشی، endpoint را عوض می‌کنند؛ بدون
// این هندلر پوش‌ها به endpointِ مرده می‌رفتند و سرور بعد از ۵ خطا
// اشتراک را غیرفعال می‌کرد — کاربر «بی‌صدا» بی‌خبر می‌شد. جریان:
//   ① دوباره subscribe با همان VAPID (کلید عمومی را خودِ SW از API
//      عمومی می‌گیرد — نیازی به صفحه‌ی باز نیست)
//   ② به همه‌ی تب‌های باز پیام بده؛ صفحه‌ی لاگین‌شده با توکنش در سرور
//      ثبتش می‌کند (نشان پیام: PUSH_SUBSCRIPTION_CHANGED)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        if (!self.registration.pushManager) return
        let sub = await self.registration.pushManager.getSubscription()
        if (!sub) {
          const key = await fetchVapidKey()
          if (!key) return
          sub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          })
        }
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clients) {
          try {
            client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', endpoint: sub.endpoint })
          } catch {
            /* تب مشغول/در حال بسته‌شدن */
          }
        }
      } catch {
        /* به‌ترین تلاش — پنجمین ثبتِ ناموفق همان مسیر پرامپت دوباره دارد */
      }
    })(),
  )
})

/** کلید عمومی VAPID از API عمومی خودمان — قابل استفاده داخل SW */
async function fetchVapidKey() {
  try {
    const res = await fetch('/api/notifications/vapid-public', { credentials: 'omit' })
    if (!res.ok) return null
    const body = (await res.json()) || {}
    if (typeof body.key !== 'string' || body.key.length < 40) return null
    return urlBase64ToUint8Array(body.key)
  } catch {
    return null
  }
}

/** base64url → Uint8Array (برای applicationServerKey) */
function urlBase64ToUint8Array(base64Url) {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// آپدیت — هرگز خودکار؛ فقط با پیام بنر
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})