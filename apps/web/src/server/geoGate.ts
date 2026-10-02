// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 7 از 17
// مسیر مقصد: apps/web/src/server/geoGate.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// src/server/geoGate.ts
/**
 * phase-fix → round-37 — دروازه‌ی جغرافیایی سمت SSR.
 *
 * هر درخواستِ اولیه‌ی صفحه: IP واقعی از XFF (آخرین عنصر — نوشته‌ی Caddy)
 * گرفته می‌شود، یک‌بار از API پرسیده می‌شود و نتیجه در حافظه‌ی سرور کش
 * می‌شود (در پیک = صفر تماس اضافه برای بازدیدکننده‌های تکراری).
 *
 * round-37 — دو تغییر:
 *  ① رأی حالا «mode» را هم دارد (iran-only | iran-iraq | world) تا
 *     ریدایرکت به /geo-blocked?m=iran-iraq پیام درست را نشان دهد
 *     («فقط از ایران و عراق» به‌جای «اگر از ایران هستید…»).
 *  ② TTLها جهت‌دار شدند — قبلاً هر رأی ده دقیقه کش می‌شد و ادمینِ
 *     که قفل را برمی‌داشت ۱۰ دقیقه کاربر مسدودش را مسدود نگه می‌داشت:
 *      • رأیِ آزاد → ۲ دقیقه (کاربرِ آزادِ خارجی بعد از قفل‌شدن حداکثر
 *        ۲ دقیقه بعد داخل صفحه‌ی مسدود می‌رود — قبلاً ۱۰ دقیقه بی‌قفل ماند)
 *      • رأیِ مسدود → ۶۰ ثانیه (بعد از بازکردن قفل/تغییر دامنه، کاربر
 *        حداکثر ۱ دقیقه بعد وارد می‌شود — قبلاً ۱۰ دقیقه بیرون ماند)
 *  در پیک، هر بازدیدکننده‌ی خارجی در بدترین حالت ۱ تماس در دقیقه به
 *  /geo/gate می‌زند که خودش کش ۱۵ثانیه‌ای و محدودیت نرخ دارد — بار ناچیز.
 *
 * سیاستِ عبور در شکست: خطای API/شبکه = عبور (سایت به‌خاطر محدودیت جغرافیایی
 * نباید برای همه قطع شود) — با کش کوتاهِ ۳۰ ثانیه‌ای.
 * مسدود = ریدایرکت به صفحه‌ی اختصاصی /geo-blocked (با پارامتر m).
 * IPهای خصوصی/داخلی و بیلد/پیش‌رندر بدون تماس با API عبور می‌کنند.
 *
 * سئو-۱: کرالرهای معتبر (گوگل/بینگ/… + بات‌های پیش‌نمایش شبکه‌های اجتماعی)
 * قبل از هر بررسی IP معاف می‌شوند — منطق مشترک در @sinshin/shared
 * (crawlers.ts) و همان در هوک onRequest بک‌اند هم اعمال شده است.
 */
import { getRequest } from '@tanstack/react-start/server'
import { isTrustedCrawlerUserAgent } from '@sinshin/shared'
import type { GeoAccessMode, GeoGateVerdict } from '@sinshin/shared'
import { apiBase } from '#/lib/api'

/** رأیِ آزاد — پایدار؛ فقط بعد از قفل‌شدنِ دوباره باید نسبتاً زود منقضی شود */
const ALLOW_TTL_MS = 2 * 60_000
/** رأیِ مسدود — کوتاه: بعد از بازکردن قفل/تغییر دامنه، کاربر زود وارد شود */
const BLOCK_TTL_MS = 60_000
// رأیِ عبورِ حاصل از خطا فقط ۳۰ ثانیه کش می‌شود — قطعیِ لحظه‌ای API نباید کاربر را
// مدت طولانی «آزاد» نگه دارد (و برعکس)
const FAIL_TTL_MS = 30_000
const MAX_ENTRIES = 5000

/** رارد ۴۶ — WebGeoMode و GeoGateVerdict به قرارداد مشترک منتقل شدند
 *  (GeoAccessMode/GeoGateVerdict در @sinshin/shared؛ روت /geo/gate بک‌اند
 *  هم با همان تایپ annotate شد) — شکل‌ها بدون تغییر. */

const cache = new Map<string, { verdict: GeoGateVerdict; at: number; ttl: number }>()

/**
 * IP خصوصی/بازگشتی — درخواست‌های داخلی (بررسی سلامت، پاس‌های
 * بیلد/پیش‌رندر نیترو، localhost). GeoService هم به این‌ها اجازه می‌داد؛
 * فقط رفت‌وبرگشت اضافه حذف می‌شود. بدون XFF (محیط توسعه بدون پروکسی) همین‌طور
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
  if (!raw) return null // محیط توسعه بدون پروکسی — عبور
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.at(-1) ?? null
}

function parseMode(raw: unknown): GeoAccessMode {
  return raw === 'iran-iraq' || raw === 'world' ? raw : 'iran-only'
}

/**
 * رأی دروازه برای «درخواست جاری» — هم blocked هم mode.
 * (اسم قدیمی isBlockedByGeo حذف شد؛ تنها مصرف‌کننده __root.tsx بود که
 * حالا ریدایرکتش به m پارامتر نیاز دارد.)
 */
export async function getGeoGate(): Promise<GeoGateVerdict> {
  const request = getRequest()

  // سئو-۱ — معافیت کرالرها: قبل از هر چیز (حتی استخراج IP و کش)،
  // ربات‌های معتبر عبور می‌کنند. برای بقیه، مسیر دقیقاً همان قبلی است.
  if (isTrustedCrawlerUserAgent(request?.headers.get('user-agent'))) {
    return { blocked: false, mode: 'world' }
  }

  const ip = clientIpFromRequest()
  if (!ip) return { blocked: false, mode: 'world' }
  if (isPrivateIp(ip)) return { blocked: false, mode: 'world' } // بدون تماس با API

  const hit = cache.get(ip)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.verdict

  const remember = (verdict: GeoGateVerdict, ttl: number) => {
    if (cache.size > MAX_ENTRIES) cache.clear()
    cache.set(ip, { verdict, at: Date.now(), ttl })
  }

  try {
    const res = await fetch(`${apiBase()}/geo/gate?ip=${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) {
      const failOpen: GeoGateVerdict = { blocked: false, mode: 'world' }
      remember(failOpen, FAIL_TTL_MS) // عبور در شکست — کوتاه
      return failOpen
    }
    const data = (await res.json()) as { blocked?: boolean; mode?: unknown }
    const verdict: GeoGateVerdict = {
      blocked: data.blocked === true,
      mode: parseMode(data.mode),
    }
    // round-37 — TTL جهت‌دار: مسدود کوتاه‌تر تا تغییر سیاست سریع اعمال شود
    remember(verdict, verdict.blocked ? BLOCK_TTL_MS : ALLOW_TTL_MS)
    return verdict
  } catch {
    const failOpen: GeoGateVerdict = { blocked: false, mode: 'world' }
    remember(failOpen, FAIL_TTL_MS) // عبور در شکست — کوتاه
    return failOpen
  }
}