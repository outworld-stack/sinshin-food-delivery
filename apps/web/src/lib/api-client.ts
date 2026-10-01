// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 27 از 49
// مسیر مقصد: apps/web/src/lib/api-client.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/lib/api-client.ts
import { treaty } from '@elysiajs/eden'
import { apiRoot } from '#/lib/api'
import { getAccessToken, onUnauthorized, tryRefresh } from '#/lib/auth-session'
import { langHeaders } from '#/lib/lang-header'
import type { App } from '../../../api/src/app-type'

/** fetch با توکن + refresh خودکار روی 401 + کوکی‌های same-origin */
async function authFetch(url: any, options: any): Promise<Response> {
  const token = getAccessToken()
  // round-34 — هدر زبان از کوکی sinshin-lang (داشبورد عربی؛ ادمین بی‌اثر)
  const headers: Record<string, string> = {
    ...(options?.headers ?? {}),
    ...(await langHeaders()),
  }
  if (token) headers['authorization'] = `Bearer ${token}`

  const res = await fetch(url, { ...options, headers, credentials: 'include' })

  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const newToken = getAccessToken()
      if (newToken) headers['authorization'] = `Bearer ${newToken}`
      return fetch(url, { ...options, headers, credentials: 'include' })
    }
    onUnauthorized()
  }
  return res
}

// ⬅ phase-4: treaty تایپ‌دار — «as any» مرده
const client = treaty<App>(apiRoot(), {
  fetcher: authFetch as unknown as typeof fetch,
})

/** پراکسی auth دار — ریشه‌اش /api است */
export const authApi = client.api

export { tryRefresh }