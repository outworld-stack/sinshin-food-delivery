// Real WebCrypto + independently decrypted RFC 8291 payloads; every HTTP request is mocked.
import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { AppConfig } from '../src/infra/config/env'
import { decodePushKey, hasValidPushKeys, isAllowedPushEndpoint } from '../src/infra/push/subscription-validation'
import { encryptWebPushPayload, resetVapidCache, sendWebPush } from '../src/infra/push/web-push'

const allowed = [
  'https://fcm.googleapis.com/fcm/send/token',
  'https://updates.push.services.mozilla.com/wpush/v2/token',
  'https://web.push.apple.com/token',
  'https://wns2.notify.windows.com/token',
]
for (const endpoint of allowed) assert.ok(isAllowedPushEndpoint(endpoint), endpoint)
for (const endpoint of [
  'https://127.0.0.1/internal', 'https://[::1]/internal', 'https://169.254.169.254/',
  'https://localhost/', 'https://example.com/', 'http://fcm.googleapis.com/token',
  'https://fcm.googleapis.com.attacker.invalid/', 'https://push.services.mozilla.com.attacker.invalid/',
  'https://fcm.googleapis.com@127.0.0.1/', 'https://name:secret@fcm.googleapis.com/',
  'https://fcm.googleapis.com:444/', 'https://fcm.googleapis.com/#token',
  'https://fcm.googleapis.com\\@127.0.0.1/', 'https://fcm.googleapis.com/\npath',
]) assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint)

const ua = createECDH('prime256v1')
ua.generateKeys()
const uaPublic = ua.getPublicKey()
const auth = crypto.getRandomValues(new Uint8Array(16))
const p256dh = uaPublic.toString('base64url')
const authString = Buffer.from(auth).toString('base64url')
assert.equal(await hasValidPushKeys(p256dh, authString), true)
assert.equal(await hasValidPushKeys('B'.repeat(87), authString), false, 'invalid curve point')
assert.equal(await hasValidPushKeys(p256dh, 'A'.repeat(8)), false, 'short auth secret')
assert.equal(await hasValidPushKeys(p256dh + '!invalid', authString), false, 'malformed base64url')

const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey)).toString('base64url')
const privateJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey)
const config = new AppConfig({
  NODE_ENV: 'development', DATABASE_URL: 'postgres://unused:unused@localhost/unused',
  GATEWAY_MODE: 'direct', JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://sinshin.example',
  VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateJwk.d!,
})
const target = { endpoint: allowed[0]!, p256dh, auth: authString }
let calls = 0
let responseStatus = 201
let cancelled = 0
const request = (async (url, options) => {
  calls++
  assert.equal(String(url), target.endpoint)
  assert.equal(options?.redirect, 'error', 'HTTP redirects must never be followed')
  const headers = new Headers(options?.headers)
  assert.equal(headers.get('content-encoding'), 'aes128gcm')
  assert.equal(headers.get('urgency'), 'high')
  assert.equal(headers.get('ttl'), '900')
  const authorization = headers.get('authorization')!
  const jwt = authorization.match(/^vapid t=([^,]+), k=/)![1]!
  const [h, p, signature] = jwt.split('.')
  const claims = JSON.parse(Buffer.from(p!, 'base64url').toString())
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400)
  assert.equal(await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey,
    decodePushKey(signature!), new TextEncoder().encode(`${h}.${p}`),
  ), true, 'VAPID signature verifies')

  // Decrypt from the browser's private key using node:crypto, independently of
  // the sender's WebCrypto/HMAC implementation.
  const packet = Buffer.from(options!.body as Uint8Array)
  assert.equal(packet.readUInt32BE(16), 4096)
  assert.equal(packet[20], 65)
  const serverPublic = packet.subarray(21, 86)
  const shared = ua.computeSecret(serverPublic)
  const ikm = hkdfSync('sha256', shared, auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, serverPublic]), 32)
  const salt = packet.subarray(0, 16)
  const cek = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(packet.subarray(packet.length - 16))
  const plaintext = Buffer.concat([decipher.update(packet.subarray(86, packet.length - 16)), decipher.final()])
  assert.equal(plaintext[plaintext.length - 1], 2)
  assert.deepEqual(JSON.parse(plaintext.subarray(0, -1).toString()), payload)
  return new Response(new ReadableStream({ cancel: () => { cancelled++ } }), { status: responseStatus })
}) as typeof Bun.fetch
const payload = { title: 'آزمون پوش', body: 'پیام سالم', tag: 'order-test', urgency: 'high' as const, ttl: 900 }
try {
  resetVapidCache()
  for (const [status, kind] of [[200, 'ok'], [201, 'ok'], [404, 'gone'], [410, 'gone'], [400, 'fail'], [401, 'fail'], [413, 'fail'], [429, 'fail'], [503, 'fail']] as const) {
    responseStatus = status
    assert.equal((await sendWebPush(config, target, payload, request)).kind, kind)
  }
  assert.equal(cancelled, calls, 'response bodies are released')
  const count = calls
  assert.deepEqual(await sendWebPush(config, { ...target, endpoint: 'https://127.0.0.1/' }, payload, request),
    { kind: 'fail', error: 'endpoint-invalid' })
  assert.deepEqual(await sendWebPush(config, { ...target, p256dh: 'B'.repeat(87) }, payload, request),
    { kind: 'fail', error: 'keys-invalid' })
  const oversized = await sendWebPush(config, target, { ...payload, body: 'x'.repeat(5000) }, request)
  assert.deepEqual(oversized, { kind: 'fail', error: 'payload-too-large' })
  assert.equal(calls, count, 'invalid subscriptions and oversized payloads never reach transport')
  const largest = await encryptWebPushPayload('x'.repeat(3993), new Uint8Array(uaPublic), auth)
  assert.equal(largest.length, 4096, 'largest supported payload fits the push body limit')
  console.log('Push transport: endpoint/key validation, VAPID verification, independent decryption, outcomes, redirects and size boundaries passed.')
} finally {
  resetVapidCache()
}
