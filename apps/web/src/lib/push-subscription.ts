// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/lib/push-subscription.ts
// ═══════════════════════════════════════════════════════════════

// src/lib/push-subscription.ts
/**
 * فاز-۲ — اشتراک Web Push سمت کلاینت.
 *
 * جریان (همه‌ی گاردها داخلی — هرگز throw به UI):
 *  ۱) SW آماده؟ (build:pwa — در dev ثبت نمی‌شود)
 *  ۲) permission — اگر default بود درخواست بگیر؛ denied = تهی
 *  ۳) کلید عمومی VAPID از API (GET /notifications/vapid-public)
 *  ۴) pushManager.subscribe({ userVisibleOnly, applicationServerKey })
 *  ۵) ثبت endpoint در بک‌اند (POST /notifications/subscriptions)
 *
 * نکته‌ی iOS: پوش فقط وقتی PWA روی هوم‌اسکرین نصب شده باشد کار می‌کند
 * (محدودیت اپل — 16.4+)؛ در مرورگر عادیِ iOS subscribe خطا می‌دهد که
 * همین‌جا به 'unsupported-in-ios-browser' ترجمه می‌شود.
 */

import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export type PushState =
  | { state: 'granted'; subscribed: boolean }
  | { state: 'denied' }
  | { state: 'default' }
  | { state: 'unsupported'; reason?: string }

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
  try {
    const reg = await navigator.serviceWorker.ready
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

    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()

    if (!sub) {
      // کلید عمومی VAPID از سرور (base64url ۶۵ بایت)
      const keyRes = await authedFetch(`${apiBase()}/notifications/vapid-public`, { method: 'GET' })
      if (!keyRes.ok) {
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
    const regRes = await authedFetch(`${apiBase()}/notifications/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: raw.endpoint,
        keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
      }),
    })
    return { state: 'granted', subscribed: regRes.ok }
  } catch (err) {
    console.error('[push] enablePush ناموفق:', err)
    return { state: 'granted', subscribed: false }
  }
}

/** لغو اشتراک — هم مرورگر هم بک‌اند */
export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const raw = sub.toJSON() as { endpoint?: string }
      if (raw.endpoint) {
        await authedFetch(`${apiBase()}/notifications/subscriptions`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: raw.endpoint }),
        }).catch(() => { /* بک‌اند نشد — مرورگر را باز هم می‌بندیم */ })
      }
      await sub.unsubscribe()
    }
  } catch (err) {
    console.error('[push] disablePush ناموفق:', err)
  }
  return { state: 'granted', subscribed: false }
}

// ── helpers ──

/** fetch با Bearer (اگر توکن بود) — بدون رفرش‌لوپ؛ این مسیر حیاتی نیست */
async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  return fetch(url, { ...init, headers, credentials: 'include' })
}

/** base64url → Uint8Array<ArrayBuffer> برای applicationServerKey (BufferSource) */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
