// src/server/geoGate.ts
/**
 * phase-fix — دروازه‌ی جغرافیایی سمت SSR.
 *
 * هر درخواستِ اولیه‌ی صفحه: IP واقعی از XFF (آخرین entry — نوشته‌ی Caddy)
 * گرفته می‌شود، یک‌بار از API پرسیده می‌شود و نتیجه ۱۰ دقیقه در حافظه‌ی
 * سرور کش می‌شود (در پیک = صفر تماس اضافه برای بازدیدکننده‌های تکراری).
 *
 * fail-open: خطای API/شبکه = عبور (سایت به‌خاطر محدودیت جغرافیایی
 * نباید برای همه قطع شود). مسدود = ریدایرکت به صفحه‌ی اختصاصی /geo-blocked.
 */
import { getRequest } from '@tanstack/react-start/server'
import { apiBase } from '#/lib/api'

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 5000

const cache = new Map<string, { blocked: boolean; at: number }>()

function clientIpFromRequest(): string | null {
  const request = getRequest()
  if (!request) return null
  const raw = request.headers.get('x-forwarded-for')
  if (!raw) return null // dev بدون پروکسی — عبور
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.at(-1) ?? null
}

export async function isBlockedByGeo(): Promise<boolean> {
  const ip = clientIpFromRequest()
  if (!ip) return false

  const hit = cache.get(ip)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.blocked

  try {
    const res = await fetch(`${apiBase()}/geo/gate?ip=${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return false // fail-open
    const data = (await res.json()) as { blocked?: boolean }
    const blocked = data.blocked === true
    if (cache.size > MAX_ENTRIES) cache.clear()
    cache.set(ip, { blocked, at: Date.now() })
    return blocked
  } catch {
    return false // fail-open
  }
}