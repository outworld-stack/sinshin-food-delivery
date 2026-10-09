// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/push-subscription.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (بازخورد ۴ + ۶ — ریشه‌ی «گیر کردن در حال فعال‌سازی»):
//   • در محیط توسعه، سرویس‌ورکرِ کامل (workbox/sw.js) اصلاً ثبت نمی‌شود
//     (فقط با build:pwa ساخته می‌شود) ⇒ navigator.serviceWorker.ready
//     هیچ‌وقت resolve نمی‌شد ⇒ enablePush برای همیشه معلق می‌ماند و
//     دکمه در «در حال فعال‌سازی…» گیر می‌کرد و هیچ اشتراکی ثبت
//     نمی‌شد (گیرنده: ۰).
//   • حالا: ۱) همه‌ی انتظارها مهلت‌دارند (withTimeout) — هیچ تابعی
//     هرگز معلق نمی‌ماند؛ ۲) ensurePushRegistration در نبودِ هر SW،
//     فایل استاتیکِ سبکِ «/sw-push.js» (بدون workbox، فقط هندلرهای
//     پوش) را ثبت می‌کند ⇒ Web Push در dev با دسکتاپ هم قابل آزمایش
//     است؛ در prod همان sw.js ورک‌باکس (با هندلرهای پوش فاز-۲) می‌نشیند.
// ═══════════════════════════════════════════════════════════════
// phase-2 — اشتراک Web Push سمت کلاینت

// src/lib/push-subscription.ts
/**
 * فاز-۲ — اشتراک Web Push سمت کلاینت.
 *
 * جریان (همه‌ی گاردها داخلی — هرگز throw به UI):
 *  ۱) SW آماده؟ — stage-49: اگر هیچ SWی ثبت نشده باشد، sw-push.js
 *     (فایل استاتیکِ سبک) ثبت می‌شود تا در dev هم پوش کار کند؛
 *     همه‌ی «ready»ها مهلت‌دارند (۸s) و بعد از مهلت با نتیجه‌ی
 *     «ناموفق» برمی‌گردند، نه معلق‌ماندن.
 *  ۲) permission — اگر default بود درخواست بگیر؛ denied = تهی
 *  ۳) کلید عمومی VAPID از API (GET /notifications/vapid-public)
 *  ۴) pushManager.subscribe({ userVisibleOnly, applicationServerKey })
 *  ۵) ثبت endpoint در بک‌اند (POST /notifications/subscriptions)
 *
 * نکته‌ی iOS: پوش فقط وقتی PWA روی هوم‌اسکرین نصب شده باشد کار می‌کند
 * (محدودیت اپل — 16.4+)؛ در مرورگر عادیِ iOS subscribe خطا می‌دهد که
 * همین‌جا به 'unsupported-in-ios-browser' ترجمه می‌شود.
 * دسکتاپ: Chrome/Edge/Firefox (و Safari 16.4+ مک) کاملاً پشتیبانی
 * می‌کنند — localhost هم Secure Context است، پس dev هم کار می‌کند.
 */

import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export type PushState =
  | { state: 'granted'; subscribed: boolean }
  | { state: 'denied' }
  | { state: 'default' }
  | { state: 'unsupported'; reason?: string }

/** SW مخصوص پوش — فایل استاتیک بدون workbox؛ در dev سرو می‌شود */
const SW_PUSH_URL = '/sw-push.js'

/** مهلت‌های انتظار — هیچ await معلق نمی‌ماند (بازخورد ۴) */
const READY_TIMEOUT_MS = 8_000
const GETSTATE_TIMEOUT_MS = 4_000
const FETCH_TIMEOUT_MS = 10_000

/** رقابتِ promise با تایمر — برنده‌ی اول؛ هیچ‌وقت معلق نمی‌ماند */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * stage-49 — اطمینان از وجود سرویس‌ورکر برای پوش:
 *  • SW موجود (prod: sw.js ورک‌باکس) → همان
 *  • هیچ SW نیست → ثبت sw-push.js (استاتیک، فقط هندلر پوش)
 * فایل در public است و vite هم در dev سرو می‌کند.
 */
async function ensurePushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration()
    if (existing) return existing
    return await navigator.serviceWorker.register(SW_PUSH_URL)
  } catch {
    return null
  }
}

/** navigator.serviceWorker.ready با مهلت — معلق نمی‌ماند (ریشه‌ی بازخورد ۴) */
async function readyWithTimeout(ms: number): Promise<ServiceWorkerRegistration | null> {
  try {
    return await withTimeout(navigator.serviceWorker.ready, ms, null)
  } catch {
    return null
  }
}

/** fetch با مهلت + Bearer (اگر توکن بود) — سرورِ خاموش/کند دکمه را قفل نمی‌کند */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  try {
    return await withTimeout(
      fetch(url, { ...init, headers, credentials: 'include' }),
      FETCH_TIMEOUT_MS,
      null,
    )
  } catch {
    return null
  }
}

/** وضعیت فعلی — سبک، بدون عارضه */
export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { state: 'unsupported', reason: 'no-push-api' }
  }
  if (!('Notification' in window)) {
    return { state: 'unsupported', reason: 'no-notification-api' }
  }
  const permission = Notification.permission
  if (permission === 'denied') return { state: 'denied' }
  if (permission === 'default') return { state: 'default' }
  // granted — subscribed هست؟
  const reg = await readyWithTimeout(GETSTATE_TIMEOUT_MS)
  if (!reg) return { state: 'granted', subscribed: false }
  try {
    const existing = await reg.pushManager.getSubscription()
    return { state: 'granted', subscribed: existing !== null }
  } catch {
    return { state: 'granted', subscribed: false }
  }
}

/** درخواست permission + subscribe + ثبت در بک‌اند */
export async function enablePush(): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { state: 'unsupported', reason: 'no-sw' }
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'unsupported', reason: 'no-push-api' }
  }
  // iOS غیرنصب‌شده — پیام روشن بده نه خطای خام
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  if (isIos && !isStandalone) {
    return { state: 'unsupported', reason: 'ios-installed-only' }
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return permission === 'denied' ? { state: 'denied' } : { state: 'default' }
    }

    // stage-49 — اول مطمئن شو SWی هست (dev: sw-push.js؛ prod: sw.js)؛
    // readyِ بدون SW قبلاً برای همیشه معلق می‌ماند — اینجا همان باگ بود.
    let reg = await readyWithTimeout(READY_TIMEOUT_MS)
    if (!reg) {
      reg = await ensurePushRegistration()
      if (reg) reg = (await readyWithTimeout(READY_TIMEOUT_MS)) ?? reg
    }
    if (!reg) return { state: 'granted', subscribed: false }

    let sub = await reg.pushManager.getSubscription()

    if (!sub) {
      // کلید عمومی VAPID از سرور (base64url ۶۵ بایت)
      const keyRes = await fetchWithTimeout(`${apiBase()}/notifications/vapid-public`, { method: 'GET' })
      if (!keyRes || !keyRes.ok) {
        return { state: 'granted', subscribed: false }
      }
      const { key } = (await keyRes.json()) as { key?: string }
      if (!key) return { state: 'granted', subscribed: false }

      const applicationServerKey = urlBase64ToUint8Array(key)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    // ثبت در بک‌اند
    const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
      return { state: 'granted', subscribed: false }
    }
    const regRes = await fetchWithTimeout(`${apiBase()}/notifications/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: raw.endpoint,
        keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
      }),
    })
    return { state: 'granted', subscribed: regRes !== null && regRes.ok }
  } catch (err) {
    console.error('[push] enablePush ناموفق:', err)
    return { state: 'granted', subscribed: false }
  }
}

/** لغو اشتراک — هم مرورگر هم بک‌اند */
export async function disablePush(): Promise<PushState> {
  try {
    const reg = await readyWithTimeout(READY_TIMEOUT_MS)
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      const raw = sub.toJSON() as { endpoint?: string }
      if (raw.endpoint) {
        await fetchWithTimeout(`${apiBase()}/notifications/subscriptions`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: raw.endpoint }),
        })
      }
      await sub.unsubscribe()
    }
  } catch (err) {
    console.error('[push] disablePush ناموفق:', err)
  }
  return { state: 'granted', subscribed: false }
}

// ── helpers ──

/** base64url → Uint8Array<ArrayBuffer> برای applicationServerKey (BufferSource) */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}