/** Only browser push services may receive server-side subscription requests. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048 || /[\s\\]/.test(endpoint)) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    const host = url.hostname
    return host === 'fcm.googleapis.com'
      || host === 'fcm-x.googleapis.com'
      || host === 'android.googleapis.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.notify.windows.com')
  } catch {
    return false
  }
}

export function decodePushKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('keys-invalid')
  const raw = value.replace(/=+$/, '')
  const bytes = new Uint8Array(Buffer.from(raw, 'base64url'))
  // Buffer's decoder tolerates malformed input; require an exact round trip.
  if (Buffer.from(bytes).toString('base64url') !== raw) throw new Error('keys-invalid')
  return bytes
}

export async function hasValidPushKeys(p256dh: string, auth: string): Promise<boolean> {
  try {
    const publicKey = decodePushKey(p256dh)
    const secret = decodePushKey(auth)
    if (publicKey.length !== 65 || publicKey[0] !== 4 || secret.length !== 16) return false
    // A correctly sized blob can still be an invalid point on the P-256 curve.
    await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    return true
  } catch {
    return false
  }
}
