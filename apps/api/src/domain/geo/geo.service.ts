// src/domain/geo/geo.service.ts
/**
 * round-26 — محدودیت دسترسی جغرافیایی «فقط ایران» با زنجیره‌ی منابع.
 *
 * منبع داده (به‌ترتیب تلاش — شکست هر منبع فقط یعنی «منبع بعدی»):
 *  ۱. ftp.ripe.net — فایل delegated رسمی RIPE (مثل قبل؛ روزی یک‌بار به‌روز،
 *     بدون کلید، بدون محدودیت نرخ)
 *  ۲. RIPEstat API — همان داده‌ی RIPE از هاست دیگر (JSON)
 *  ۳. ipdeny.com — آینه‌ی مستقل (دو فایل v4/v6)
 *
 * قبلاً تک‌منبعه با تایم‌اوت ۳۰s بود — یک اختلال نت یعنی خطای RIPE و
 * بازه‌های خالی. حالا هر منبع ۱۰s تایم‌اوت دارد.
 *
 * کش دیسک — آخرین بازه‌های سالم در UPLOAD_DIR/.geo-ir-cache.json ذخیره
 * می‌شود (در پروداکشن روی volume می‌ماند). بوت اول کش را می‌خواند (محلی
 * و آنی — سپر از همان ثانیه‌ی اول روشن است) بعد از شبکه تازه می‌کند؛
 * اگر هر سه منبع شکست بخورند و حافظه خالی باشد، همان کش بارگذاری می‌شود.
 *
 * سیاست‌ها (بدون تغییر):
 *  - کلید روشن/خاموش در settings (iran_only_access) — پیش‌فرض روشن.
 *    مقدار با کش ۱۵ ثانیه‌ای خوانده می‌شود (بدون کوئری DB در هر درخواست).
 *  - IP های داخلی/لوکال (Docker/Caddy/health) همیشه آزاد.
 *  - fail-open: اگر هیچ منبعی و نه کشی چیزی نداشته باشیم، درخواست عبور
 *    می‌کند (قطع دسترسی کل سایت ممنوع) — با این تفاوت که رسیدن به این
 *    حالت حالا عملاً ناممکن شده (سه منبع + کش دیسک + حافظه).
 *  - GEO_BYPASS_IPS در env — عبور بی‌قید و شرط (ادمین با VPN).
 */
import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { settings, SETTING_KEYS } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SettingsService } from '#/domain/settings/settings.service'

/** هر منبع ۱۰ ثانیه — بدترین حالتِ هر سه منبع ≈ ۳۰s (قبلاً ۳۰s فقط برای یکی) */
const FETCH_TIMEOUT_MS = 10_000
const RETRY_MS = 15 * 60_000
const TOGGLE_TTL_MS = 15_000
const CACHE_FILENAME = '.geo-ir-cache.json'

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

// ── منابع داده (round-26) ──

interface GeoRanges {
  v4: Array<[number, number]>
  v6: Array<[bigint, bigint]>
}

async function fetchText(url: string): Promise<string> {
  const res = await Bun.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`http ${res.status}`)
  return res.text()
}

function cidrV4ToRange(cidr: string): [number, number] | null {
  const [ip, bitsRaw] = cidr.trim().split('/')
  if (!ip || bitsRaw === undefined) return null
  const bits = Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null
  const lo = ipv4ToLong(ip)
  if (lo === null) return null
  return [lo, lo + 2 ** (32 - bits) - 1]
}

function cidrV6ToRange(cidr: string): [bigint, bigint] | null {
  const [ip, bitsRaw] = cidr.trim().split('/')
  if (!ip || bitsRaw === undefined) return null
  const bits = Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null
  const lo = ipv6ToBig(ip)
  if (lo === null) return null
  return [lo, lo + (1n << BigInt(128 - bits)) - 1n]
}

/** منبع ۱ — فایل delegated رسمی RIPE (فرمت extended؛ مثل قبل) */
function parseRipeDelegated(text: string): GeoRanges {
  // ستون پنجم برای ipv4 = تعداد آدرس، برای ipv6 = طول پیشوند
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
  return { v4, v6 }
}

/** منبع ۲ — RIPEstat: همان داده‌ی RIPE از هاست دیگر، JSON با پیشوندهای CIDR */
function parseRipestat(raw: string): GeoRanges {
  const json = JSON.parse(raw) as {
    data?: { resources?: { ipv4?: unknown; ipv6?: unknown } }
  }
  const v4: Array<[number, number]> = []
  const v6: Array<[bigint, bigint]> = []
  if (Array.isArray(json.data?.resources?.ipv4)) {
    for (const p of json.data.resources.ipv4) {
      if (typeof p !== 'string') continue
      const r = cidrV4ToRange(p)
      if (r) v4.push(r)
    }
  }
  if (Array.isArray(json.data?.resources?.ipv6)) {
    for (const p of json.data.resources.ipv6) {
      if (typeof p !== 'string') continue
      const r = cidrV6ToRange(p)
      if (r) v6.push(r)
    }
  }
  return { v4, v6 }
}

/** فرمت zone فایل — هر خط یک CIDR (IPv4 و IPv6 هر دو پذیرفته می‌شود) */
function parseZoneFile(text: string): GeoRanges {
  const v4: Array<[number, number]> = []
  const v6: Array<[bigint, bigint]> = []
  for (const line of text.split('\n')) {
    const cidr = line.trim()
    if (!cidr || cidr.startsWith('#') || cidr.startsWith(';')) continue
    if (cidr.includes(':')) {
      const r = cidrV6ToRange(cidr)
      if (r) v6.push(r)
    } else {
      const r = cidrV4ToRange(cidr)
      if (r) v4.push(r)
    }
  }
  return { v4, v6 }
}

/** منبع ۳ — ipdeny: v4 الزامی (ir.zone)، v6 در صورت موفقیت (ir.ipv6.zone) */
async function loadIpdeny(): Promise<GeoRanges> {
  const [v4Res, v6Res] = await Promise.allSettled([
    fetchText('https://ipdeny.com/ipblocks/data/countries/ir.zone'),
    fetchText('https://ipdeny.com/ipblocks/data/countries/ir.ipv6.zone'),
  ])
  if (v4Res.status === 'rejected') throw v4Res.reason
  const out = parseZoneFile(v4Res.value)
  if (v6Res.status === 'fulfilled') out.v6 = parseZoneFile(v6Res.value).v6
  return out
}

const SOURCES: Array<{ name: string; load: () => Promise<GeoRanges> }> = [
  {
    name: 'ftp.ripe.net',
    load: async () =>
      parseRipeDelegated(
        await fetchText(
          'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest',
        ),
      ),
  },
  {
    name: 'ripestat',
    load: async () =>
      parseRipestat(
        await fetchText(
          'https://stat.ripe.net/data/country-resource-list/data.json?resource=ir&v4_format=prefix',
        ),
      ),
  },
  { name: 'ipdeny', load: loadIpdeny },
]

export interface GeoStatus {
  enabled: boolean
  rangesLoaded: boolean
  rangesLoadedAt: string | null
  /** round-26 — آخرین منبعی که بازه‌ها را داده (برای curl /api/geo/status) */
  source: string | null
  ipv4Prefixes: number
  ipv6Prefixes: number
  bypassIps: number
}

export class GeoService {
  private irV4: Array<[number, number]> = []
  private irV6: Array<[bigint, bigint]> = []
  private rangesLoadedAt = 0
  private loadedFrom: string | null = null
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

  /**
   * بوت — round-26: اول کش دیسک (محلی و آنی؛ اگر باشد سپر از همان
   * ثانیه‌ی اول روشن است)، بعد تازه‌سازی از شبکه.
   */
  warmup(): void {
    void (async () => {
      if (this.irV4.length === 0) await this.loadDiskCache('boot')
      await this.refresh()
    })()
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
    for (let i = 0; i < SOURCES.length; i++) {
      const src = SOURCES[i]!
      try {
        const { v4, v6 } = await src.load()
        if (v4.length === 0) throw new Error('no IR ipv4 ranges parsed')
        this.irV4 = mergeV4(v4)
        this.irV6 = mergeV6(v6)
        this.rangesLoadedAt = Date.now()
        this.loadedFrom = src.name
        this.warnedNoRanges = false
        console.log(
          `[geo] loaded from ${src.name} — ${this.irV4.length} ipv4 / ${this.irV6.length} ipv6 IR ranges`,
        )
        void this.writeCache(src.name)
        return true
      } catch (err) {
        // شکست یک منبع فقط یعنی «منبع بعدی» — نه خطای نهایی
        console.warn(
          `[geo] source ${i + 1}/${SOURCES.length} (${src.name}) failed:`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    // هر سه منبع شکست خوردند — اگر حافظه هم خالی است، کش دیسک آخرین سپر است
    if (this.irV4.length === 0 && (await this.loadDiskCache('network failed'))) {
      return true
    }
    console.error(
      '[geo] all sources failed — keeping current ranges (fail-open if empty) until retry in 15m',
    )
    return false
  }

  // ── کش دیسک (round-26) ──

  private get cachePath(): string {
    const dir = this.deps.config.uploadDir.replace(/\/+$/, '')
    return `${dir}/${CACHE_FILENAME}`
  }

  /** ذخیره‌ی آخرین بازه‌های سالم — best-effort، هرگز throw نمی‌کند */
  private async writeCache(source: string): Promise<void> {
    const path = this.cachePath
    try {
      await Bun.$`mkdir -p ${this.deps.config.uploadDir}`
      const payload = JSON.stringify({
        version: 1,
        source,
        savedAt: new Date().toISOString(),
        v4: this.irV4,
        // bigint در JSON ندارد → رشته
        v6: this.irV6.map(([lo, hi]) => [lo.toString(), hi.toString()]),
      })
      // نوشتن اتمیک: اول tmp، بعد mv — خواننده‌ی هم‌زمان هرگز
      // فایل نیمه‌نوشته نمی‌بیند
      const tmp = `${path}.tmp`
      await Bun.write(tmp, payload)
      await Bun.$`mv ${tmp} ${path}`
    } catch (err) {
      console.warn(
        '[geo] disk cache write skipped:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  /** بارگذاری کش — با اعتبارسنجی کامل؛ هر شکست = false (بی‌صدا) */
  private async loadDiskCache(reason: string): Promise<boolean> {
    const path = this.cachePath
    try {
      const f = Bun.file(path)
      if (!(await f.exists())) return false
      const raw = JSON.parse(await f.text()) as {
        version?: unknown
        source?: unknown
        savedAt?: unknown
        v4?: unknown
        v6?: unknown
      }
      if (raw.version !== 1 || !Array.isArray(raw.v4) || raw.v4.length === 0) return false

      const v4: Array<[number, number]> = []
      for (const r of raw.v4) {
        if (
          !Array.isArray(r) ||
          r.length !== 2 ||
          typeof r[0] !== 'number' ||
          !Number.isInteger(r[0]) ||
          typeof r[1] !== 'number' ||
          !Number.isInteger(r[1]) ||
          r[0] < 0 ||
          r[1] < r[0]
        ) {
          return false
        }
        v4.push([r[0], r[1]])
      }

      const v6: Array<[bigint, bigint]> = []
      if (Array.isArray(raw.v6)) {
        for (const r of raw.v6) {
          if (!Array.isArray(r) || r.length !== 2) return false
          try {
            v6.push([BigInt(r[0] as string | number | bigint), BigInt(r[1] as string | number | bigint)])
          } catch {
            return false
          }
        }
      }

      // دوباره merge — به هیچ دیسکی اعتماد نمی‌شود
      this.irV4 = mergeV4(v4)
      this.irV6 = mergeV6(v6)
      this.rangesLoadedAt =
        typeof raw.savedAt === 'string' && Number.isFinite(Date.parse(raw.savedAt))
          ? Date.parse(raw.savedAt)
          : Date.now()
      this.loadedFrom = `${typeof raw.source === 'string' ? raw.source : '?'} (disk)`
      this.warnedNoRanges = false
      console.log(
        `[geo] disk cache loaded (${reason}) — from ${typeof raw.source === 'string' ? raw.source : '?'} saved ${typeof raw.savedAt === 'string' ? raw.savedAt : '?'} — ${this.irV4.length} ipv4 / ${this.irV6.length} ipv6 IR ranges`,
      )
      return true
    } catch {
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
        console.warn(
          '[geo] ranges not loaded (all sources + disk cache failed) — allowing (fail-open)',
        )
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
      source: this.loadedFrom,
      ipv4Prefixes: this.irV4.length,
      ipv6Prefixes: this.irV6.length,
      bypassIps: this.bypass.size,
    }
  }
}
