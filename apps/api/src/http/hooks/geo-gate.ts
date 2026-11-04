import { isCrawlerGeoExemptRequest } from '@sinshin/shared'
import type { GeoService } from '#/domain/geo/geo.service'
import { clientIp } from '#/domain/shared/net'

/** The same country gate protects API routes and uploaded public media. */
export function createGeoGate(geo: Pick<GeoService, 'shouldBlock' | 'accessMode'>) {
  return async (request: Request): Promise<Response | undefined> => {
    // Payment callbacks already verify signed state. A customer's VPN change
    // while returning from the bank must not prevent payment reconciliation.
    const pathname = new URL(request.url).pathname
    if (/^\/api\/payments\/[^/]+\/callback$/.test(pathname)) return
    if (isCrawlerGeoExemptRequest(request, 'api')) return

    const ip = clientIp(request.headers.get('x-forwarded-for'))
    if (!ip || !(await geo.shouldBlock(ip))) return

    const mode = await geo.accessMode()
    const message =
      mode === 'iran-iraq'
        ? 'دسترسی به این سرویس فقط از ایران و عراق امکان‌پذیر است. اگر داخل یکی از این دو کشور هستید، لطفاً VPN خود را خاموش کنید و صفحه را رفرش کنید.'
        : 'لطفاً اگر از ایران هستید، لطفاً VPN خودتان را خاموش کنید و صفحه را رفرش کنید.'
    return new Response(
      JSON.stringify({ error: { code: 'GEO_BLOCKED', message, policy: mode } }),
      {
        status: 403,
        headers: {
          'content-type': 'application/json',
          // A country-specific denial must never replace public content in a
          // shared cache, including for the next search crawler request.
          'cache-control': 'private, no-store',
          'x-robots-tag': 'noindex',
        },
      },
    )
  }
}
