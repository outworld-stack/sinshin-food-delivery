// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/scripts/generate-vapid-keys.ts
// اجرا:  cd apps/api && bun scripts/generate-vapid-keys.ts
// ═══════════════════════════════════════════════════════════════

// scripts/generate-vapid-keys.ts
/**
 * فاز-۲ — تولید جفت‌کلید VAPID برای Web Push (بدون openssl، فقط WebCrypto).
 *
 * خروجی: دو خط آماده‌ی کپی در .env ریشه:
 *   VAPID_PUBLIC_KEY=<base64url ۶۵ بایت — با پیشوند 0x04>
 *   VAPID_PRIVATE_KEY=<base64url ۳۲ بایت>
 *
 * نکته‌ها:
 *  • کلیدها را «یک‌بار» بساز و نگه دار — چرخش کلید یعنی از دست رفتنِ
 *    همه‌ی اشتراک‌های پوش (مرورگر با کلید عمومی قدیمی subscribe کرده).
 *  • این اسکریپت هیچ فایلی نمی‌نویسد؛ فقط چاپ می‌کند.
 */

/** شکل JWK برای EC P-256 (بدون وابستگی به lib.dom) */
interface EcJwk {
  kty: 'EC'
  crv: string
  x: string
  y?: string
  d?: string
}

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as unknown as EcJwk
if (!jwk.d || !jwk.x || !jwk.y) {
  throw new Error('خروجی JWK کامل نیست (d/x/y) — غیرممکن؛ دوباره اجرا کن.')
}

// d = کلید خصوصی خام (۳۲ بایت) | xy = کلید عمومی (۶۵ بایت: 0x04 || x || y)
const priv = b64urlToBytes(jwk.d)
const pub = new Uint8Array(65)
pub[0] = 0x04
pub.set(b64urlToBytes(jwk.x), 1)
pub.set(b64urlToBytes(jwk.y), 33)

if (priv.length !== 32 || pub.length !== 65) {
  throw new Error(`طول کلیدها غلط است: priv=${priv.length}, pub=${pub.length}`)
}

console.log('── کلیدهای VAPID سین‌شین (Web Push) ──────────────────────')
console.log('این دو خط را در فایل .env ریشه (کنار بقیه‌ی متغیرها) بگذار:')
console.log()
console.log(`VAPID_PUBLIC_KEY=${bytesToB64url(pub)}`)
console.log(`VAPID_PRIVATE_KEY=${bytesToB64url(priv)}`)
console.log()
console.log('VAPID_SUBJECT=mailto:admin@sinshin-foodpark.ir   # پیش‌فرض همین است — اختیاری')
console.log('──────────────────────────────────────────────────────────')
console.log('⚠️  کلید خصوصی را هرگز در گیت/لاگ/چت نفرست — فقط .env (که در .gitignore است).')
console.log('⚠️  یک‌بار بساز و برای همیشه نگه دار؛ چرخش کلید = پاک‌شدن همه‌ی اشتراک‌های پوش.')

// ── helpers (هم‌ارزش web-push.ts — محلی و مستقل) ──

function b64urlToBytes(s: string): Uint8Array {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i] ?? 0)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ماژول بودن فایل (top-level await مجاز شود)
export {}
