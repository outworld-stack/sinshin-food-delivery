export type PaymentTarget = {
  gateway: 'ZARINPAL' | 'SEP' | 'MELLAT' | 'MOCK'
  method: 'GET' | 'POST' | 'MOCK'
  url: string
  token: string
}

/** Exact provider endpoints only. Do not normalize an untrusted URL before
 * checking it: URL parsers can conceal credentials, backslashes and dot paths. */
export function parsePaymentTarget(value: string): PaymentTarget | null {
  if (typeof value !== 'string' || value.length > 1000 || /[\s\x00-\x1f\x7f]/.test(value)) return null
  const zarinpal = /^https:\/\/(?:payment|sandbox)\.zarinpal\.com\/pg\/StartPay\/([A-Za-z0-9_-]{1,120})$/.exec(value)
  if (zarinpal) return { gateway: 'ZARINPAL', method: 'GET', url: value, token: zarinpal[1]! }
  const sep = /^https:\/\/sep\.shaparak\.ir\/api\/v1\/Payment\/PaymentPage\?Token=([^&#]+)$/.exec(value)
  if (sep) {
    try {
      const token = decodeURIComponent(sep[1]!)
      if (/^[A-Za-z0-9_+/=-]{1,200}$/.test(token) && encodeURIComponent(token) === sep[1]) {
        return { gateway: 'SEP', method: 'GET', url: value, token }
      }
    } catch { /* Malformed percent encoding. */ }
    return null
  }
  const mellat = /^https:\/\/bpm\.shaparak\.ir\/StartPay\/([A-Za-z0-9]{1,100})$/.exec(value)
  if (mellat) return {
    gateway: 'MELLAT', method: 'POST',
    url: 'https://bpm.shaparak.ir/pgwchannel/startpay.mellat', token: mellat[1]!,
  }
  const mock = /^\/api\/payments\/mock\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{32})$/.exec(value)
  return mock ? { gateway: 'MOCK', method: 'MOCK', url: value, token: mock[1]! } : null
}
