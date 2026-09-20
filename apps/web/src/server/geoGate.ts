// src/server/geoGate.ts
/**
 * phase-fix — دروازه‌ی جغرافیایی سمت SSR.
 *
 * هر درخواستِ اولیه‌ی صفحه: IP واقعی از XFF (آخرین entry — نوشته‌ی Caddy)
 * گرفته می‌شود، یک‌بار از API پرسیده می‌شود و نتیجه ۱۰ دقیقه در حافظه‌ی
 * سرور کش می‌شود (در پیک = صفر تماس اضافه برای بازدیدکننده‌های تکراری).
 *
 * fail-open: خطای API/شبکه = عبور (سایت به‌خاطر محدودیت جغرافیایی
 * نباید برای همه قطع شود) — با کش کوتاهِ ۳۰ ثانیه‌ای (کار-۸).
 * مسدود = ریدایرکت به صفحه‌ی اختصاصی /geo-blocked.
 * IPهای خصوصی/داخلی و build/prerender (کار-۸) بدون تماس با API عبور می‌کنند.
 *
 * سئو-۱: کرالرهای معتبر (گوگل/بینگ/… + بات‌های پیش‌نمایش شبکه‌های اجتماعی)
 * قبل از هر بررسی IP معاف می‌شوند — بدون این، گوگل فقط صفحه‌ی ۴۰۳ می‌بیند
 * و هیچ صفحه‌ای ایندکس نمی‌شود. سیاست «فقط ایران» برای کاربران واقعی
 * ذره‌ای تغییر نمی‌کند؛ منطق مشترک در @sinshin/shared (crawlers.ts) است
 * و همان در هوک onRequest بک‌اند هم اعمال شده تا رندرِ سمت کلاینتِ
 * کرالرها (Googlebot WRS) هم به /api برخورد نکند.
 */
import { getRequest } from '@tanstack/react-start/server'
import { isTrustedCrawlerUserAgent } from '@sinshin/shared'
import { apiBase } from '#/lib/api'

const TTL_MS = 10 * 60_000
// کار-۸: verdictهای fail-open فقط ۳۰ ثانیه کش می‌شوند — قطعیِ لحظه‌ای API
// نباید یک کاربرِ VPN-دار را ۱۰ دقیقه «آزاد» نگه دارد (و برعکس، تکرارِ مداوم
// خطا هم هر request را به سمت API نمی‌فرستد)
const FAIL_TTL_MS = 30_000
const MAX_ENTRIES = 5000

const cache = new Map<string, { blocked: boolean; at: number; ttl: number }>()

/**
 * کار-۸: IP خصوصی/loopback — درخواست‌های داخلی (health-check، پاس‌های
 * build/prerender نیترو، localhost). GeoService هم این‌ها را allow می‌کرد؛
 * فقط round-trip اضافه حذف می‌شود. بدون XFF (dev بدون پروکسی) همین‌طور
 * بالاتر عبور می‌شود.
 */
function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.toLowerCase()
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true
  }
  const parts = ip.split('.').map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts as [number, number, number, number]
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    )
  }
  return false
}

function clientIpFromRequest(): string | null {
  const request = getRequest()
  if (!request) return null
  const raw = request.headers.get('x-forwarded-for')
  if (!raw) return null // dev بدون پروکسی — عبور
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.at(-1) ?? null
}

export async function isBlockedByGeo(): Promise<boolean> {
  const request = getRequest()

  // سئو-۱ — معافیت کرالرها: قبل از هر چیز (حتی استخراج IP و کش)،
  // ربات‌های معتبر عبور می‌کنند. برای بقیه، مسیر دقیقاً همان قبلی است.
  if (isTrustedCrawlerUserAgent(request?.headers.get('user-agent'))) {
    return false
  }

  const ip = clientIpFromRequest()
  if (!ip) return false
  if (isPrivateIp(ip)) return false // کار-۸ — بدون تماس با API

  const hit = cache.get(ip)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.blocked

  const remember = (blocked: boolean, ttl: number) => {
    if (cache.size > MAX_ENTRIES) cache.clear()
    cache.set(ip, { blocked, at: Date.now(), ttl })
  }

  try {
    const res = await fetch(`${apiBase()}/geo/gate?ip=${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) {
      remember(false, FAIL_TTL_MS) // fail-open کوتاه (کار-۸)
      return false
    }
    const data = (await res.json()) as { blocked?: boolean }
    const blocked = data.blocked === true
    remember(blocked, TTL_MS)
    return blocked
  } catch {
    remember(false, FAIL_TTL_MS) // fail-open کوتاه (کار-۸)
    return false
  }
}