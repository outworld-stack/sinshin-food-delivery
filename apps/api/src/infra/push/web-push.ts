// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/infra/push/web-push.ts
// ═══════════════════════════════════════════════════════════════

// src/infra/push/web-push.ts
/**
 * فاز-۲ — Web Push «از صفر» — بدون هیچ پکیج خارجی.
 *
 * پیاده‌سازی مستقیم پروتکل‌های استاندارد با WebCrypto (در Bun کامل است):
 *  • RFC 8292 (VAPID): JWT امضاشده با ECDSA P-256 (ES256) در هدر
 *    Authorization — هویت سرور ما نزد سرور پوش مرورگر.
 *  • RFC 8291 + RFC 8188 (aes128gcm): رمزنگاری payload با ECDH P-256 +
 *    HKDF-SHA256 → AES-128-GCM؛ کلید عمومی اشتراک (p256dh/auth).
 *
 * چرا دست‌ساز؟ zero-dependency (بدون ریسک سازگاری پکیج در Bun)،
 * منطق زیر چشم خودمان و fail-soft مطلق — هیچ مسیری throw نمی‌کند.
 *
 * خروجی هر ارسال سه‌حالته است:
 *  ok   → تحویل (201) — شمارش موفق
 *  gone → 404/410 — اشتراک مرده؛ کالر باید غیرفعالش کند
 *  fail → هر چیز دیگر (شبکه/429/5xx) — بعداً دوباره
 */

import type { AppConfig } from '#/infra/config/env'

/** شکل JWK برای EC P-256 (بدون وابستگی به lib.dom) */
interface EcJwk {
  kty: 'EC'
  crv: string
  x: string
  y?: string
  d?: string
}

/**
 * importKey با فرمت 'jwk' — در رانتایمِ Bun کاملاً استاندارد است ولی
 * نسخه‌ی فعلی bun-types این overload را ندارد؛ shim تایپ‌دارِ امن
 * (فقط تایپ را رد می‌کند، رفتار رانتایم دست‌نخورده).
 */
const importJwkKey = (
  algorithm: { name: string; namedCurve?: string },
  keyData: EcJwk,
  usages: ReadonlyArray<'sign' | 'verify' | 'deriveBits' | 'deriveKey' | 'encrypt' | 'decrypt'>,
): Promise<CryptoKey> =>
  (crypto.subtle as unknown as {
    importKey(
      format: string,
      keyData: unknown,
      algorithm: unknown,
      extractable: boolean,
      usages: unknown,
    ): Promise<CryptoKey>
  }).importKey('jwk', keyData, algorithm, false, usages)

export interface PushSubscriptionTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushOutcome =
  | { kind: 'ok' }
  | { kind: 'gone'; status: number }
  | { kind: 'fail'; status?: number; error?: string }

export interface PushPayload {
  title: string
  body: string
  url?: string
  /** برچسبِ گروه (جایگزینی نوتیفیکیشن قبلی هم‌برچسب) */
  tag?: string
  data?: Record<string, unknown>
}

// ── base64url helpers ──

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  // pad هم قبول می‌شود؛ ناموجودها بی‌صدا حذف
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i] ?? 0)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── کلیدهای VAPID (بارگذاری یک‌بار و کش) ──

interface LoadedVapidKeys {
  /** CryptoKey برای ECDSA (sign) */
  signingKey: CryptoKey
  /** بایت‌های خام کلید عمومی (۶۵ بایت) — برای هدر k= */
  publicBytes: Uint8Array
}

let vapidCache: LoadedVapidKeys | null = null

async function loadVapidKeys(config: AppConfig): Promise<LoadedVapidKeys | null> {
  if (vapidCache) return vapidCache
  try {
    const priv = b64urlToBytes(config.push.vapidPrivateKey) // ۳۲ بایت d
    const pub = b64urlToBytes(config.push.vapidPublicKey) // ۶۵ بایت 04||x||y
    if (priv.length !== 32 || pub.length !== 65 || pub[0] !== 0x04) {
      console.error(
        `[push] ساختار کلید VAPID نامعتبر (priv=${priv.length}B, pub=${pub.length}B) — ` +
        'با scripts/generate-vapid-keys.ts بساز.',
      )
      return null
    }
    const x = pub.subarray(1, 33)
    const y = pub.subarray(33, 65)
    const jwk: EcJwk = {
      kty: 'EC', crv: 'P-256',
      x: bytesToB64url(x), y: bytesToB64url(y), d: bytesToB64url(priv),
    }
    const signingKey = await importJwkKey({ name: 'ECDSA', namedCurve: 'P-256' }, jwk, ['sign'])
    vapidCache = { signingKey, publicBytes: pub }
    return vapidCache
  } catch (err) {
    console.error('[push] بارگذاری کلیدهای VAPID ناموفق:', err)
    return null
  }
}

// ── VAPID Authorization header (RFC 8292) ──

async function vapidAuthHeader(
  keys: LoadedVapidKeys,
  endpoint: string,
  subject: string,
): Promise<string> {
  // aud = origin سرور پوش
  const aud = new URL(endpoint).origin
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }
  const enc = new TextEncoder()
  const h = bytesToB64url(enc.encode(JSON.stringify(header)))
  const p = bytesToB64url(enc.encode(JSON.stringify(payload)))
  // ES256 — امضای WebCrypto خام r||s (۶۴ بایت) همان فرمت امضای JWS است
  const sigRaw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.signingKey,
    enc.encode(`${h}.${p}`),
  )
  const s = bytesToB64url(new Uint8Array(sigRaw))
  return `vapid t=${h}.${p}.${s}, k=${bytesToB64url(keys.publicBytes)}`
}

// ── رمزنگاری پیام (RFC 8291 + RFC 8188 — aes128gcm) ──

/** نسخه‌ی کامل: سر + بدنه — این تابع اصلی رمزنگاری است */
async function encryptPayloadFull(
  payload: string,
  uaPublic: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { cek, nonce, ephPub } = await deriveKeysFull(uaPublic, authSecret, salt)

  const data = new TextEncoder().encode(payload)
  // رکورد تنها: data || 0x02 (padding delimiter آخر)
  const record = new Uint8Array(new ArrayBuffer(data.length + 1))
  record.set(data)
  record[data.length] = 0x02

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  )

  // بدنه‌ی aes128gcm: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext
  const rs = 4096 // اندازه‌ی رکورد اعلامی — تک‌رکوردی؛ سازگار با همه‌ی پیاده‌سازی‌ها
  const out = new Uint8Array(new ArrayBuffer(16 + 4 + 1 + 65 + cipher.length))
  out.set(salt, 0)
  const dv = new DataView(out.buffer)
  dv.setUint32(16, rs, false)
  out[20] = 65
  out.set(ephPub, 21)
  out.set(cipher, 86)
  return out
}

// HKDF کامل با برگرداندن کلید عمومی ephemeral — هسته‌ی RFC 8291
async function deriveKeysFull(
  uaPublicBytes: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ cek: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer>; ephPub: Uint8Array<ArrayBuffer> }> {
  const uaJwk: EcJwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(uaPublicBytes.subarray(1, 33)),
    y: bytesToB64url(uaPublicBytes.subarray(33, 65)),
  }
  const uaKey = await importJwkKey({ name: 'ECDH', namedCurve: 'P-256' }, uaJwk, [])
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  // deriveBits/exportKey هر دو ArrayBuffer برمی‌گردانند → Uint8Array<ArrayBuffer>
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256),
  )
  const ephPub = new Uint8Array(
    await crypto.subtle.exportKey('raw', eph.publicKey),
  )

  // IKM = shared || authSecret (RFC 8291 §2.1 — «ikm» از دو بخش)
  const ikm = new Uint8Array(new ArrayBuffer(shared.length + authSecret.length))
  ikm.set(shared)
  ikm.set(authSecret, shared.length)

  const webcrypto = crypto.subtle
  const saltKey = await webcrypto.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const prk = new Uint8Array(await webcrypto.sign('HMAC', saltKey, ikm))
  const prkKey = await webcrypto.importKey('raw', prk, { name: 'HKDF' }, false, ['deriveBits'])
  const enc = new TextEncoder()
  const cek = new Uint8Array(
    await webcrypto.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('Content-Encoding: aes128gcm\0') },
      prkKey, 128,
    ),
  )
  const nonce = new Uint8Array(
    await webcrypto.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('Content-Encoding: nonce\0') },
      prkKey, 96,
    ),
  )
  return { cek, nonce, ephPub }
}

// ── ارسال ──

/**
 * ارسال یک Web Push به یک اشتراک — هرگز throw نمی‌کند.
 * TTL/Topic/Urgency هدرهای استاندارد؛ abort روی تایم‌اوت.
 */
export async function sendWebPush(
  config: AppConfig,
  target: PushSubscriptionTarget,
  payload: PushPayload,
): Promise<PushOutcome> {
  const keys = await loadVapidKeys(config)
  if (!keys) return { kind: 'fail', error: 'vapid-keys-invalid' }

  try {
    const body = await encryptPayloadFull(
      JSON.stringify(payload),
      b64urlToBytes(target.p256dh),
      b64urlToBytes(target.auth),
    )
    const authorization = await vapidAuthHeader(keys, target.endpoint, config.push.vapidSubject)

    const res = await Bun.fetch(target.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/octet-stream',
        'content-encoding': 'aes128gcm',
        ttl: String(Math.min(2419200, Math.max(0, config.push.ttlSeconds))),
        urgency: 'normal',
        ...(payload.tag ? { topic: payload.tag.slice(0, 32) } : {}),
      },
      // Uint8Array<ArrayBuffer> — BodyInit استاندارد
      body: body as unknown as ArrayBuffer,
      signal: AbortSignal.timeout(10_000),
    } as Parameters<typeof Bun.fetch>[1])

    if (res.status === 201 || res.status === 200) return { kind: 'ok' }
    // اشتراک مرده — RFC 8030: 404/410 یعنی دیگر تلاش نکن
    if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status }
    return { kind: 'fail', status: res.status }
  } catch (err) {
    return { kind: 'fail', error: err instanceof Error ? err.message : String(err) }
  }
}

/** برای تست‌های داخلی — ریست کش کلیدها (بعد از چرخش کلید در تست) */
export function resetVapidCache(): void {
  vapidCache = null
}
