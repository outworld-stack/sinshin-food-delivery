// src/domain/geo/geo.service.ts
/**
 * phase-fix — محدودیت دسترسی جغرافیایی «فقط ایران».
 *
 * منبع داده: فایل delegated رسمی RIPE (ناحیه‌ی ثبت ایران؛ روزی یک‌بار
 * به‌روز می‌شود، بدون کلید، بدون محدودیت نرخ) — بازه‌های IP ایران به‌صورت
 * محلی چک می‌شوند؛ یعنی صفر تماس خارجی به‌ازای هر درخواست در پیک.
 *
 * سیاست‌ها:
 *  - کلید روشن/خاموش در settings (iran_only_access) — پیش‌فرض روشن.
 *    مقدار با کش ۱۵ ثانیه‌ای خوانده می‌شود (بدون کوئری DB در هر درخواست).
 *  - IP های داخلی/لوکال (Docker/Caddy/health) همیشه آزاد.
 *  - fail-open: اگر بازه‌ها هنوز لود نشده‌اند یا RIPE در دسترس نیست،
 *    درخواست عبور می‌کند (قطع دسترسی کل سایت ممنوع).
 *  - GEO_BYPASS_IPS در env — عبور بی‌قید و شرط (ادمین با VPN).
 */
import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { settings, SETTING_KEYS } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SettingsService } from '#/domain/settings/settings.service'

const RIPE_URL = 'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest'
const FETCH_TIMEOUT_MS = 30_000
const RETRY_MS = 15 * 60_000
const TOGGLE_TTL_MS = 15_000

// ── ابزارهای IP ──

function ipv4ToLong(raw: string): number | null {
  const p = raw.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return (((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0)
}

/** IPv6 → bigint (با پشتیبانی :: و فرمت جاسازی‌شده IPv4) */
function ipv6ToBig(raw: string): bigint | null {
  let s = raw.toLowerCase()
  const v4embedded = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4embedded) {
    const v4 = ipv4ToLong(v4embedded[2]!)
    if (v4 === null) return null
    s = `${v4embedded[1]!}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0]!.split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1]!.split(':') : []
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && head.length + tail.length > 8) return null
  const missing = 8 - head.length - tail.length
  const groups = [
    ...head,
    ...(halves.length === 2 ? Array.from({ length: Math.max(missing, 0) }, () => '0') : []),
    ...tail,
  ]
  if (groups.length !== 8) return null
  let out = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out = (out << 16n) + BigInt(parseInt(g, 16))
  }
  return out
}

function inV4Ranges(ip: number, ranges: Array<[number, number]>): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end] = ranges[mid]!
    if (ip < start) hi = mid - 1
    else if (ip > end) lo = mid + 1
    else return true
  }
  return false
}

function inV6Ranges(ip: bigint, ranges: Array<[bigint, bigint]>): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end] = ranges[mid]!
    if (ip < start) hi = mid - 1
    else if (ip > end) lo = mid + 1
    else return true
  }
  return false
}

/** IP خصوصی/لوکال — شبکه‌ی داخلی Docker و health-check ها */
function isPrivateIp(ip: string): boolean {
  const v4 = ipv4ToLong(ip)
  if (v4 !== null) {
    const b0 = v4 >>> 24
    const b1 = (v4 >>> 16) & 0xff
    if (b0 === 10 || b0 === 127) return true // خصوصی + لوکال
    if (b0 === 169 && b1 === 254) return true // link-local
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true // خصوصی
    if (b0 === 192 && b1 === 168) return true // خصوصی
    if (b0 === 100 && b1 >= 64) return true // CGNAT داخلی (100.64/10)
    return false
  }
  // IPv6 — لوکال/unique-local + نگاشتِ IPv4 خصوصی
  const v6 = ipv6ToBig(ip)
  if (v6 === null) return true // ناپارسپذیر = داخلی تلقی می‌شود (عبور)
  if (v6 === 0n) return true // ::
  if (v6 === 1n) return true // ::1
  if ((v6 >> 120n) === 0xfcn) return true // fc00::/7 — unique-local
  if ((v6 >> 120n) === 0xfen) return true // fe80::/10 — link-local
  if ((v6 >> 32n) === 0xffffn) {
    // ::ffff:a.b.c.d — نگاشت IPv4؛ بخش v4 را چک کن
    const embedded = Number(v6 & 0xffffffffn) >>> 0
    return isPrivateIp(
      `${(embedded >>> 24) & 0xff}.${(embedded >>> 16) & 0xff}.${(embedded >>> 8) & 0xff}.${embedded & 0xff}`,
    )
  }
  return false
}

function mergeV4(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

function mergeV6(ranges: Array<[bigint, bigint]>): Array<[bigint, bigint]> {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const out: Array<[bigint, bigint]> = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1n) last[1] = last[1] > r[1] ? last[1] : r[1]
    else out.push([r[0], r[1]])
  }
  return out
}

export interface GeoStatus {
  enabled: boolean
  rangesLoaded: boolean
  rangesLoadedAt: string | null
  ipv4Prefixes: number
  ipv6Prefixes: number
  bypassIps: number
}

export class GeoService {
  private irV4: Array<[number, number]> = []
  private irV6: Array<[bigint, bigint]> = []
  private rangesLoadedAt = 0
  private loading: Promise<boolean> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private toggleCache: { value: boolean; at: number } | null = null
  private warnedNoRanges = false
  private readonly bypass: Set<string>

  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      settings: SettingsService
    },
  ) {
    this.bypass = new Set(deps.config.geoBypassIps)
  }

  /** بوت — لود اولیه‌ی بازه‌ها (fail-open تا آماده شود) */
  warmup(): void {
    void this.refresh()
  }

  /** تازه‌سازی بازه‌ها — تک‌پرواز؛ در شکست، ۱۵ دقیقه بعد دوباره */
  async refresh(): Promise<boolean> {
    if (this.loading) return this.loading
    if (this.retryTimer) return false // تایمرِ تلاش مجدد فعال است
    this.loading = this.fetchRanges()
    const ok = await this.loading
    this.loading = null
    if (!ok && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.refresh()
      }, RETRY_MS)
    }
    return ok
  }

  private async fetchRanges(): Promise<boolean> {
    try {
      // فرمت extended: ستون پنجم برای ipv4 = تعداد آدرس، برای ipv6 = طول پیشوند
      const res = await Bun.fetch(RIPE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`ripe http ${res.status}`)
      const text = await res.text()

      const v4: Array<[number, number]> = []
      const v6: Array<[bigint, bigint]> = []
      for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) continue
        const p = line.split('|')
        if (p.length < 5 || p[1] !== 'IR') continue
        const type = p[2] ?? ''
        const start = p[3] ?? ''
        const count = Number(p[4])
        if (!Number.isFinite(count) || count <= 0) continue
        if (type === 'ipv4') {
          const lo = ipv4ToLong(start)
          if (lo === null) continue
          v4.push([lo, lo + count - 1])
        } else if (type === 'ipv6' && count <= 128) {
          const lo = ipv6ToBig(start)
          if (lo === null) continue
          v6.push([lo, lo + (1n << BigInt(128 - count)) - 1n])
        }
      }
      if (v4.length === 0) throw new Error('ripe: no IR ipv4 ranges parsed')

      this.irV4 = mergeV4(v4)
      this.irV6 = mergeV6(v6)
      this.rangesLoadedAt = Date.now()
      this.warnedNoRanges = false
      console.log(
        `[geo] RIPE loaded — ${this.irV4.length} ipv4 / ${this.irV6.length} ipv6 IR ranges`,
      )
      return true
    } catch (err) {
      console.error('[geo] RIPE fetch failed (fail-open until loaded):', err)
      return false
    }
  }

  /** کلید «فقط ایران» — کش ۱۵ ثانیه‌ای؛ پیش‌فرض روشن */
  async iranOnlyEnabled(): Promise<boolean> {
    const now = Date.now()
    if (this.toggleCache && now - this.toggleCache.at < TOGGLE_TTL_MS) {
      return this.toggleCache.value
    }
    let value = true
    try {
      const row = await this.deps.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, SETTING_KEYS.iranOnlyAccess))
        .then((rows) => rows[0])
      // غیبت ردیف = روشن (پیش‌فرض)؛ مقدار غیرواقعی هم = روشن (امن‌ترین حالت)
      value = row?.value !== false
    } catch {
      // DB پایین — آخرین مقدار کش‌شده، وگرنه پیش‌فرض (روشن)
      value = this.toggleCache?.value ?? true
    }
    this.toggleCache = { value, at: now }
    return value
  }

  /** آیا این IP ایران است؟ (بدون توجه به کلید) */
  isIranIp(ip: string): boolean {
    if (this.irV4.length === 0) {
      if (!this.warnedNoRanges) {
        this.warnedNoRanges = true
        console.warn('[geo] ranges not loaded yet — allowing (fail-open)')
      }
      return true
    }
    const v4 = ipv4ToLong(ip)
    if (v4 !== null) return inV4Ranges(v4, this.irV4)
    const v6 = ipv6ToBig(ip)
    if (v6 !== null) return inV6Ranges(v6, this.irV6)
    return true // ناپارسپذیر — عبور
  }

  /** تصمیم نهایی مسدودی — تنها تابعی که هوک http صدا می‌زند */
  async shouldBlock(ip: string): Promise<boolean> {
    if (!ip) return false
    if (isPrivateIp(ip)) return false
    if (this.bypass.has(ip)) return false
    if (!(await this.iranOnlyEnabled())) return false
    return !this.isIranIp(ip)
  }

  /** وضعیت برای پنل ادمین */
  async status(): Promise<GeoStatus> {
    return {
      enabled: await this.iranOnlyEnabled(),
      rangesLoaded: this.irV4.length > 0,
      rangesLoadedAt: this.rangesLoadedAt > 0 ? new Date(this.rangesLoadedAt).toISOString() : null,
      ipv4Prefixes: this.irV4.length,
      ipv6Prefixes: this.irV6.length,
      bypassIps: this.bypass.size,
    }
  }
}