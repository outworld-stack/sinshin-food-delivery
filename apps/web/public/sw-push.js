// ═══════════════════════════════════════════════════════════════
// stage-50 — sinshin-food-delivery
// مسیر مقصد: apps/web/public/sw-push.js
// وضعیت: جایگزینی کامل فایل موجود (stage-49)
// تغییر (اسکن عمیق): نمایشِ نوتیف مقاوم شد — اگر showNotification با
//   آپشن‌های کامل (renotify/badge/icon/…) روی موتوری خطا بدهد،
//   همان پیام با آپشن‌های حداقلی دوباره نشان داده می‌شود؛ قبلاً هر
//   خطا یعنی «پوش رسید ولی هیچی نمایش داده نشد» (افتِ بی‌صدا).
// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery — فایل جدید
//
// sw-push.js — سرویس‌ورکرِ سبکِ مخصوص Web Push.
//
// چرا این فایل؟
//  • sw.js کاملِ پروژه (workbox + precache) فقط با «build:pwa» ساخته
//    می‌شود و در محیط توسعه وجود ندارد؛ در نتیجه
//    navigator.serviceWorker.ready در dev هیچ‌وقت resolve نمی‌شد و
//    جریان فعال‌سازی پوش برای همیشه در «در حال فعال‌سازی…» گیر
//    می‌کرد و هیچ اشتراکی ثبت نمی‌شد.
//  • این فایل استاتیک است: بدون import، بدون workbox، بدون fetch
//    handler — فقط هندلرهای پوش (همان رفتار sw.template.js فاز-۲).
//    Vite آن را از public/ سرو می‌کند، پس در dev هم در دسترس است.
//  • در production همین فایل بی‌ضرر کنار sw.js می‌ماند؛ PwaRegister
//    در prod فقط sw.js را ثبت می‌کند (scope یکسان ⇒ جایگزین می‌شود)
//    و push-subscription.ts هم اگر SW موجود بود همان را استفاده
//    می‌کند — این فایل فقط fallback/dev است.
//
// پیام از سرور ما: { title, body, url?, tag?, data? }
// payload رمزنگاری‌شده (aes128gcm) توسط خود مرورگر باز می‌شود.

/* eslint-disable no-restricted-globals */

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
  // stage-50 — مقاوم‌سازی: هر موتوری لزوماً همه‌ی آپشن‌ها را نمی‌پذیرد
  // (مثلاً renotify/badge روی بعضی نسخه‌ها TypeError می‌دهد)؛ در آن
  // صورت همان پیام با آپشن‌های حداقلی نشان داده می‌شود — پیام پوش
  // هرگز «بی‌صدا» نمی‌افتد.
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
          console.warn('[sw-push] showNotification ناموفق بود')
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

// آپدیت SW را رها کن — این فایل هیچ کشی مدیریت نمی‌کند
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})