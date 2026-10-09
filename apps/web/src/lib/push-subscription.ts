// ═══════════════════════════════════════════════════════════════
// stage-51 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/push-subscription.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (ریشه‌ی «هیچ نوتیفی در هیچ مرورگری نمی‌رسد» — باگ احراز هویت):
//   • باگ 🔴 قطعی: GET /notifications/vapid-public با fetch خام و «بدون
//     Bearer» صدا زده می‌شد، در حالی که مسیر در بک‌اند داخل requireAuth
//     بود ⇒ همیشه ۴۰۱ ⇒ enablePush قبل از pushManager.subscribe خارج
//     می‌شد ⇒ اشتراک هیچ‌وقت نه در مرورگر ساخته و نه در سرور ثبت می‌شد
//     ⇒ هیچ پوشی هرگز نمی‌رسید (ریشه‌ی «گیرنده: ۱ ولی در Edge هیچی»).
//   • فیکس دولایه: (۱) مسیر در stage-51 عمومی شد (بک‌اند)؛ (۲) فرانت هم
//     همان GET را با authedPushFetch می‌زند — با بک‌اند قدیمی (محافظت‌شده)
//     هم کار می‌کند و با نشستِ منقضی هم ریتری ۴۰۱ دارد.
//   • گزارش خطا (خواسته‌ی صریح): هر شکست حالا وضعیت HTTP / متن خطا را در
//     کنسول ثبت می‌کند (بدون توکن) و PushState با failureReason برمی‌گردد
//     تا UI پیام «دقیق» نشان بدهد نه یک متن کلی — علت واقعی دیگر بی‌صدا
//     نمی‌ماند.
// stage-50: مهلت subscribe (۳۰s)، ریتری ۴۰۱ ثبت اشتراک، ثبت سریع SW،
//           fast-path getPushState — همه محفوظ.
// ═══════════════════════════════════════════════════════════════
// phase-2 — اشتراک Web Push سمت کلاینت

// src/lib/push-subscription.ts
/**
 * فاز-۲ — اشتراک Web Push سمت کلاینت.
 *
 * جریان (همه‌ی گاردها داخلی — هرگز throw به UI):
 *  ۱) SW آماده؟ — getRegistration سریع؛ اگر هیچ SWی نیست، sw-push.js
 *     (فایل استاتیکِ سبک) ثبت می‌شود — در dev و prodِ بدون build:pwa.
 *  ۲) permission — اگر default بود درخواست بگیر؛ denied = تهی
 *  ۳) کلید عمومی VAPID از API (GET /notifications/vapid-public)
 *     — stage-51: با authedPushFetch (بک‌اند قدیمی هم جواب می‌دهد)
 *  ۴) pushManager.subscribe({ userVisibleOnly, applicationServerKey })
 *     — با مهلت؛ هیچ‌وقت معلق نمی‌ماند
 *  ۵) ثبت endpoint در بک‌اند (POST /notifications/subscriptions)
 *     — با نشستِ تازه و ریتری روی ۴۰۱
 *
 * نکته‌ی iOS: پوش فقط وقتی PWA روی هوم‌اسکرین نصب شده باشد کار می‌کند
 * (محدودیت اپل — 16.4+)؛ در مرورگر عادیِ iOS subscribe خطا می‌دهد که
 * همین‌جا به 'unsupported-in-ios-browser' ترجمه می‌شود.
 * دسکتاپ: Chrome/Edge/Firefox (و Safari 16.4+ مک) کاملاً پشتیبانی
 * می‌کنند — localhost هم Secure Context است، پس dev هم کار می‌کند.
 */

import { apiBase } from '#/lib/api'
import { ensureSession, getAccessToken, tryRefresh } from '#/lib/auth-session'

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** stage-51 — علتِ شکست برای پیامِ دقیق در UI (گزارش خطای شفاف) */
export type PushFailureReason =
  | 'vapid' /** GET vapid-public ناموفق (شبکه/401/کلید نامعتبر) */
  | 'subscribe' /** pushManager.subscribe رد شد یا مهلت پر شد */
  | 'register' /** POST subscriptions ناموفق (شبکه/401/اعتبارسنجی) */
  | 'invalid' /** ساختار اشتراک ناقص (endpoint/keys) */

export type PushState =
  | { state: 'granted'; subscribed: boolean; failureReason?: PushFailureReason }
  | { state: 'denied' }
  | { state: 'default' }
  | { state: 'unsupported'; reason?: string }

/** SW مخصوص پوش — فایل استاتیک بدون workbox؛ در dev سرو می‌شود */
const SW_PUSH_URL = '/sw-push.js'

/** مهلت‌های انتظار — هیچ await معلق نمی‌ماند */
const READY_TIMEOUT_MS = 8_000
const GETSTATE_TIMEOUT_MS = 4_000
const FETCH_TIMEOUT_MS = 10_000
/** subscribe می‌تواند (فایرفاکس/شبکه‌ی کند) طول بکشد — ۳۰ ثانیه سقف */
const SUBSCRIBE_TIMEOUT_MS = 30_000

/** رقابتِ promise با تایمر — برنده‌ی اول؛ هیچ‌وقت معلق نمی‌ماند */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * ثبت‌شده‌ی فعلی (اگر باشد) — سریع؛ null یعنی «هیچ SWی نیست».
 * (getRegistration بدون آرگومان = scope همین صفحه)
 */
async function getRegistrationFast(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/**
 * اطمینان از وجود سرویس‌ورکر برای پوش:
 *  • SW موجود (prod: sw.js ورک‌باکس) → همان
 *  • هیچ SW نیست → ثبت sw-push.js (استاتیک، فقط هندلر پوش)
 * فایل در public است و vite هم در dev سرو می‌کند.
 */
async function ensurePushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const existing = await getRegistrationFast()
  if (existing) return existing
  try {
    return await navigator.serviceWorker.register(SW_PUSH_URL)
  } catch {
    return null
  }
}

/** navigator.serviceWorker.ready با مهلت — معلق نمی‌ماند */
async function readyWithTimeout(ms: number): Promise<ServiceWorkerRegistration | null> {
  try {
    return await withTimeout(navigator.serviceWorker.ready, ms, null)
  } catch {
    return null
  }
}

/**
 * fetch با مهلت + Bearer + نشستِ تازه + یک ریتری روی ۴۰۱ (الگوی authJson).
 * stage-50 — قبلاً توکنِ منقضی یعنی ۴۰۱ و شکستِ همیشگی ثبت اشتراک؛
 * حالا اول نشست تازه می‌شود، و اگر باز ۴۰۱ آمد، tryRefresh و تلاش مجدد.
 * stage-51 — برای vapid-public هم استفاده می‌شود: مسیر در بک‌اند جدید
 * عمومی است؛ روی بک‌اند قدیمی (محافظت‌شده) با همین Bearer جواب می‌گیرد.
 * خروجی null = مهلت/شبکه — کالر حالتِ «تلاش مجدد» نشان می‌دهد.
 */
export async function authedPushFetch(
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  // نشست را قبل از حرکت تازه کن (توکنِ ۱۵ دقیقه‌ای ممکن است مرده باشد)
  await ensureSession().catch(() => {})
  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    }
    const token = getAccessToken()
    if (token) headers.authorization = `Bearer ${token}`
    return headers
  }
  const run = (): Promise<Response | null> =>
    withTimeout(
      fetch(url, { ...init, headers: buildHeaders(), credentials: 'include' }),
      FETCH_TIMEOUT_MS,
      null,
    ).catch(() => null)

  let res = await run()
  if (res !== null && res.status === 401) {
    // توکن کهنه — یک‌بار نوسازی و تلاش مجدد
    const refreshed = await tryRefresh().catch(() => false)
    if (refreshed) res = await run()
  }
  return res
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
  // stage-50 — fast-path: بدون SW فوری جواب بده (قبلاً ۴ ثانیه
  // انتظارِ بی‌نتیجه روی ready می‌کشید — حالت اولیه‌ی آیکون دیر می‌آمد)
  const reg = await getRegistrationFast()
  if (!reg) return { state: 'granted', subscribed: false }
  try {
    const existing = await withTimeout(reg.pushManager.getSubscription(), GETSTATE_TIMEOUT_MS, null)
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

    // stage-50 — SW: اول ثبت‌شده را ببین (سریع)؛ نبود ⇒ همین‌جا ثبت
    // sw-push.js؛ فقط بعدش منتظر فعال‌شدن بمان. (قبلاً در نبود SW، ۸
    // ثانیه waiting قبل از ثبت می‌ماند — بخشی از «گیر کردن دکمه».)
    let reg = await ensurePushRegistration()
    if (reg) reg = (await readyWithTimeout(READY_TIMEOUT_MS)) ?? reg
    if (!reg) return { state: 'granted', subscribed: false, failureReason: 'subscribe' }

    let sub = await reg.pushManager.getSubscription()

    if (!sub) {
      // کلید عمومی VAPID از سرور (base64url ۶۵ بایت)
      // stage-51 — 🔴 باگ ریشه‌ای: این GET قبلاً بدون Bearer بود و مسیر
      // در بک‌اند requireAuth داشت ⇒ همیشه ۴۰۱ ⇒ subscribe هیچ‌وقت اجرا
      // نمی‌شد ⇒ هیچ پوشی نمی‌رسید. حالا با authedPushFetch: روی بک‌اند
      // جدید (عمومی) و قدیمی (محافظت‌شده) هر دو کار می‌کند.
      const keyRes = await authedPushFetch(`${apiBase()}/notifications/vapid-public`, {
        method: 'GET',
      })
      if (!keyRes || !keyRes.ok) {
        // گزارش شفاف — علت واقعی دیگر بی‌صدا نیست (بدون توکن در لاگ)
        console.warn(
          '[push] vapid-public ناموفق:',
          keyRes ? `HTTP ${keyRes.status}` : 'شبکه/مهلت',
        )
        return { state: 'granted', subscribed: false, failureReason: 'vapid' }
      }
      let key: string | undefined
      try {
        ;({ key } = (await keyRes.json()) as { key?: string })
      } catch (err) {
        console.warn('[push] vapid-public: JSON خراب:', err)
        return { state: 'granted', subscribed: false, failureReason: 'vapid' }
      }
      if (!key) {
        console.warn('[push] vapid-public: کلید خالی برگشت')
        return { state: 'granted', subscribed: false, failureReason: 'vapid' }
      }

      const applicationServerKey = urlBase64ToUint8Array(key)
      // stage-50 — مهلتِ صریح: subscribe در فایرفاکس/شبکه‌ی کند می‌توانست
      // تا ابد معلق بماند (بقیه‌ی «گیر کردن دکمه»). timeout ⇒ subscribed=false
      // با پیام تلاش‌مجدد در UI — نه دکمه‌ی قفل‌شده.
      try {
        sub = await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }),
          SUBSCRIBE_TIMEOUT_MS,
          null,
        )
      } catch (err) {
        // رد صریح مرورگر (مثلاً AbortError فایرفاکس) — گزارش + علت دقیق
        console.warn(
          '[push] pushManager.subscribe رد شد:',
          err instanceof Error ? `${err.name}: ${err.message}` : err,
        )
        return { state: 'granted', subscribed: false, failureReason: 'subscribe' }
      }
      if (!sub) {
        console.warn(`[push] subscribe بعد از ${SUBSCRIBE_TIMEOUT_MS / 1000}s مهلت پر شد`)
        return { state: 'granted', subscribed: false, failureReason: 'subscribe' }
      }
    }

    // ثبت در بک‌اند — stage-50: با نشست تازه + ریتری ۴۰۱ (authedPushFetch)
    const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
      console.warn('[push] ساختار اشتراک ناقص است (endpoint/keys)')
      return { state: 'granted', subscribed: false, failureReason: 'invalid' }
    }
    const regRes = await authedPushFetch(`${apiBase()}/notifications/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: raw.endpoint,
        keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
      }),
    })
    if (!regRes || !regRes.ok) {
      // گزارش شفاف — علت واقعی دیگر بی‌صدا نیست (بدون توکن در لاگ)
      console.warn(
        '[push] ثبت اشتراک ناموفق:',
        regRes ? `HTTP ${regRes.status}` : 'شبکه/مهلت',
      )
      return { state: 'granted', subscribed: false, failureReason: 'register' }
    }
    return { state: 'granted', subscribed: true }
  } catch (err) {
    console.error('[push] enablePush ناموفق:', err)
    return { state: 'granted', subscribed: false, failureReason: 'register' }
  }
}

/** لغو اشتراک — هم مرورگر هم بک‌اند */
export async function disablePush(): Promise<PushState> {
  try {
    const reg = await getRegistrationFast()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      const raw = sub.toJSON() as { endpoint?: string }
      if (raw.endpoint) {
        await authedPushFetch(`${apiBase()}/notifications/subscriptions`, {
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