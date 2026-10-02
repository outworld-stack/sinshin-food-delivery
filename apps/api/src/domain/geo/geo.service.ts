// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 2 از 17
// مسیر مقصد: apps/api/src/domain/geo/geo.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// src/domain/geo/geo.service.ts
/**
 * round-37 — محدودیت دسترسی جغرافیایی «ایران + عراق» با زنجیره‌ی منابع.
 *
 * round-26: فقط ایران با زنجیره‌ی منابع (RIPE delegated → RIPEstat → ipdeny)
 * round-37: همان زنجیره حالا «دوکشوره» است — هر منبع بازه‌های IR و IQ را
 *   با هم می‌آورد. مدل دسترسی سه‌حالته شد:
 *
 *     iran_only_access = true   → فقط ایران (عراق هم مسدود — پیش‌فرض؛
 *                                 کلید عراق در پنل قفل و غیرقابل تغییر)
 *     iran_only_access = false  → بسته به outside_access_scope:
 *        'iraq'  → ایران + عراق (سایر کشورها مسدود)
 *        'world' → همه‌ی کشورها (بدون محدودیت جغرافیایی)
 *
 * سیاست‌های خط مشی (روحیه‌ی round-26 دست‌نخورده):
 *  - IP های داخلی/لوکال (Docker/Caddy/health) همیشه آزاد.
 *  - GEO_BYPASS_IPS در env — عبور بی‌قید و شرط (ادمین با VPN) — برای هر دو کشور.
 *  - fail-open: اگر هیچ منبعی و نه کشی چیزی نداشته باشیم، درخواست عبور می‌کند
 *    (قطع دسترسی کل سایت ممنوع). نکته‌ی عراق: اگر IR آمده باشد اما IQ خالی
 *    بماند (حالت بسیار نادر — هر سه منبع داده‌ی عراق دارند)، isIraqIp مقدار
 *    false می‌دهد: یعنی کاربر عراقی موقتاً مسدود می‌شود ولی سایت برای ایران
 *    بالاست. جهتِ شکست، «امن» انتخاب شد نه «باز برای همه».
 *
 * کش دیسک — round-37 نسخه‌ی 2: بازه‌های دو کشور در
 * UPLOAD_DIR/.geo-ranges-cache.json. فایل قدیمی v1 (فقط ایران،
 * .geo-ir-cache.json) در بوت به‌عنوان سپرِ اولیه خوانده می‌شود و بعد
 * تازه‌سازی از شبکه، نسخه‌ی 2 را می‌نویسد.
 */
import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { settings, SETTING_KEYS } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SettingsService } from '#/domain/settings/settings.service'

/** کش ۱۵ ثانیه‌ای تاگل پنل (داخلی) */
const TOGGLE_TTL_MS = 15_000
/** round-37 — کش دیسک دوکشوره؛ نام قدیمی برای خواندنِ fallback نگه داشته شد */
const CACHE_FILENAME = '.geo-ranges-cache.json'
const LEGACY_CACHE_FILENAME = '.geo-ir-cache.json'

/** round-37 — دامنه‌ی ورود کاربران خارج از ایران (وقتی قفلِ فقط ایران خاموش است) */
export type OutsideScope = 'iraq' | 'world'

/** round-37 — حالت نهایی دروازه؛ ترکیب کلید + دامنه برای نمایش/پیام‌ها */
export type GeoAccessMode = 'iran-only' | 'iran-iraq' | 'world'

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
    // round-28 — CGNAT 100.64.0.0/10
    if (b0 === 100 && b1 >= 64 && b1 < 128) return true // CGNAT داخلی (100.64/10)
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

// ── منابع داده (round-26 → دوکشوره در round-37) ──

interface CountryRanges {
  v4: Array<[number, number]>
  v6: Array<[bigint, bigint]>
}

interface DualRanges {
  ir: CountryRanges
  iq: CountryRanges
}

function emptyRanges(): CountryRanges {
  return { v4: [], v6: [] }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await Bun.fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
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

/**
 * منبع ۱ — فایل delegated رسمی RIPE (فرمت extended).
 * round-37: ستون کشور حالا با مجموعه‌ی {IR, IQ} تطبیق داده می‌شود —
 * یک دانلود، دو کشور.
 */
function parseRipeDelegated(text: string): DualRanges {
  // ستون پنجم برای ipv4 = تعداد آدرس، برای ipv6 = طول پیشوند
  const out: DualRanges = { ir: emptyRanges(), iq: emptyRanges() }
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const p = line.split('|')
    if (p.length < 5) continue
    const cc = p[1] ?? ''
    if (cc !== 'IR' && cc !== 'IQ') continue
    const target = cc === 'IR' ? out.ir : out.iq
    const type = p[2] ?? ''
    const start = p[3] ?? ''
    const count = Number(p[4])
    if (!Number.isFinite(count) || count <= 0) continue
    if (type === 'ipv4') {
      const lo = ipv4ToLong(start)
      if (lo === null) continue
      target.v4.push([lo, lo + count - 1])
    } else if (type === 'ipv6' && count <= 128) {
      const lo = ipv6ToBig(start)
      if (lo === null) continue
      target.v6.push([lo, lo + (1n << BigInt(128 - count)) - 1n])
    }
  }
  return out
}

/** منبع ۲ — RIPEstat: JSON با پیشوندهای CIDR؛ round-37: per-country */
function parseRipestat(raw: string): CountryRanges {
  const json = JSON.parse(raw) as {
    data?: { resources?: { ipv4?: unknown; ipv6?: unknown } }
  }
  const out = emptyRanges()
  if (Array.isArray(json.data?.resources?.ipv4)) {
    for (const p of json.data.resources.ipv4) {
      if (typeof p !== 'string') continue
      const r = cidrV4ToRange(p)
      if (r) out.v4.push(r)
    }
  }
  if (Array.isArray(json.data?.resources?.ipv6)) {
    for (const p of json.data.resources.ipv6) {
      if (typeof p !== 'string') continue
      const r = cidrV6ToRange(p)
      if (r) out.v6.push(r)
    }
  }
  return out
}

/** فرمت zone فایل — هر خط یک CIDR (IPv4 و IPv6 هر دو پذیرفته می‌شود) */
function parseZoneFile(text: string): CountryRanges {
  const out = emptyRanges()
  for (const line of text.split('\n')) {
    const cidr = line.trim()
    if (!cidr || cidr.startsWith('#') || cidr.startsWith(';')) continue
    if (cidr.includes(':')) {
      const r = cidrV6ToRange(cidr)
      if (r) out.v6.push(r)
    } else {
      const r = cidrV4ToRange(cidr)
      if (r) out.v4.push(r)
    }
  }
  return out
}

/**
 * منبع ۲ — دو فراخوانی موازی (ir و iq). فراخوانی ایران الزامی است
 * (شکستش = پرش به منبع بعدی)؛ عراق best-effort — اگر جواب نداد ولی
 * ایران آمد، همین منبع قبول می‌شود و عراق خالی می‌ماند (با هشدار).
 */
async function loadRipestat(timeoutMs: number): Promise<DualRanges> {
  const [irRes, iqRes] = await Promise.allSettled([
    fetchText('https://stat.ripe.net/data/country-resource-list/data.json?resource=ir&v4_format=prefix', timeoutMs),
    fetchText('https://stat.ripe.net/data/country-resource-list/data.json?resource=iq&v4_format=prefix', timeoutMs),
  ])
  if (irRes.status === 'rejected') throw irRes.reason
  const ir = parseRipestat(irRes.value)
  const iq = emptyRanges()
  if (iqRes.status === 'fulfilled') {
    // عراق از همان منبع — ولی شکستش منبع را نمی‌اندازد (best-effort)
    const parsed = parseRipestat(iqRes.value)
    iq.v4 = parsed.v4
    iq.v6 = parsed.v6
  } else {
    console.warn('[geo] ripestat: IQ lookup failed (kept empty):', String(iqRes.reason))
  }
  return { ir, iq }
}

/**
 * منبع ۳ — ipdeny: چهار فایل (ir/iq × v4/v6). v4 ایران الزامی؛
 * بقیه best-effort.
 */
async function loadIpdeny(timeoutMs: number): Promise<DualRanges> {
  const files = await Promise.allSettled([
    fetchText('https://ipdeny.com/ipblocks/data/countries/ir.zone', timeoutMs),
    fetchText('https://ipdeny.com/ipblocks/data/countries/iq.zone', timeoutMs),
    fetchText('https://ipdeny.com/ipblocks/data/countries/ir.ipv6.zone', timeoutMs),
    fetchText('https://ipdeny.com/ipblocks/data/countries/iq.ipv6.zone', timeoutMs),
  ])
  const [irV4, iqV4, irV6, iqV6] = files
  if (irV4.status === 'rejected') throw irV4.reason
  const out: DualRanges = { ir: parseZoneFile(irV4.value), iq: emptyRanges() }
  if (iqV4.status === 'fulfilled') out.iq = parseZoneFile(iqV4.value)
  else console.warn('[geo] ipdeny: iq.zone failed (kept empty):', String(iqV4.reason))
  if (irV6.status === 'fulfilled') out.ir.v6 = parseZoneFile(irV6.value).v6
  if (iqV6.status === 'fulfilled') out.iq.v6 = parseZoneFile(iqV6.value).v6
  return out
}

const SOURCES: Array<{ name: string; load: (timeoutMs: number) => Promise<DualRanges> }> = [
  {
    name: 'ftp.ripe.net',
    load: async (timeoutMs) =>
      parseRipeDelegated(
        await fetchText(
          'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest',
          timeoutMs,
        ),
      ),
  },
  { name: 'ripestat', load: loadRipestat },
  { name: 'ipdeny', load: loadIpdeny },
]

export interface GeoStatus {
  enabled: boolean
  /** round-37 — حالت نهایی دروازه برای پنل/پیام‌ها */
  mode: GeoAccessMode
  /** round-37 — دامنه‌ی خارج از ایران ('iraq' | 'world') */
  outsideScope: OutsideScope
  rangesLoaded: boolean
  rangesLoadedAt: string | null
  /** آخرین منبعی که بازه‌ها را داده (برای پنل ادمین) */
  source: string | null
  /** round-37 — آمار به تفکیک کشور */
  iran: { ipv4Prefixes: number; ipv6Prefixes: number }
  iraq: { ipv4Prefixes: number; ipv6Prefixes: number }
  /** فیلدهای قدیمی (سازگاری با مصرف‌کننده‌های قبلی) = آمار ایران */
  ipv4Prefixes: number
  ipv6Prefixes: number
  bypassIps: number
}

export class GeoService {
  private irV4: Array<[number, number]> = []
  private irV6: Array<[bigint, bigint]> = []
  /** round-37 — بازه‌های عراق */
  private iqV4: Array<[number, number]> = []
  private iqV6: Array<[bigint, bigint]> = []
  private rangesLoadedAt = 0
  private loadedFrom: string | null = null
  private loading: Promise<boolean> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private toggleCache: { value: boolean; at: number } | null = null
  /** round-37 — کش ۱۵ ثانیه‌ای دامنه‌ی خارج از ایران */
  private scopeCache: { value: OutsideScope; at: number } | null = null
  private warnedNoRanges = false
  private warnedNoIraqRanges = false
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
   * بوت — اول کش دیسک (محلی و آنی؛ اگر باشد سپر از همان ثانیه‌ی اول
   * روشن است)، بعد تازه‌سازی از شبکه.
   */
  warmup(): void {
    void (async () => {
      if (this.irV4.length === 0) {
        await this.loadDiskCache('boot')
        // round-37 — سپرِ قدیمی v1 (فقط ایران) اگر نسخه‌ی 2 نبود
        if (this.irV4.length === 0) await this.loadLegacyDiskCache('boot')
      }
      await this.refresh()
    })()
  }

  /** تازه‌سازی بازه‌ها — تک‌پرواز؛ در شکست، فاصله‌ی کانفیکی بعد دوباره */
  async refresh(): Promise<boolean> {
    if (this.loading) return this.loading
    if (this.retryTimer) return false // تایمرِ تلاش مجدد فعال است
    this.loading = this.fetchRanges()
    const ok = await this.loading
    this.loading = null
    if (!ok && !this.retryTimer) {
      // رارد ۴۵ — فاصله‌ی تلاش مجدد از کانفیگ (GEO_RETRY_MINUTES)؛ قبلاً ۱۵ دقیقه‌ی ثابت
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.refresh()
      }, this.deps.config.geo.retryMs)
    }
    return ok
  }

  private async fetchRanges(): Promise<boolean> {
    for (let i = 0; i < SOURCES.length; i++) {
      const src = SOURCES[i]!
      try {
        const { ir, iq } = await src.load(this.deps.config.geo.fetchTimeoutMs)
        if (ir.v4.length === 0) throw new Error('no IR ipv4 ranges parsed')
        this.irV4 = mergeV4(ir.v4)
        this.irV6 = mergeV6(ir.v6)
        this.iqV4 = mergeV4(iq.v4)
        this.iqV6 = mergeV6(iq.v6)
        this.rangesLoadedAt = Date.now()
        this.loadedFrom = src.name
        this.warnedNoRanges = false
        this.warnedNoIraqRanges = this.iqV4.length === 0
        console.log(
          `[geo] loaded from ${src.name} — IR: ${this.irV4.length} v4 / ${this.irV6.length} v6 · IQ: ${this.iqV4.length} v4 / ${this.iqV6.length} v6`,
        )
        if (this.iqV4.length === 0) {
          console.warn(`[geo] source ${src.name} returned no IQ ranges — Iraq gate degraded until next refresh`)
        }
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
    if (this.irV4.length === 0) {
      if (await this.loadDiskCache('network failed')) return true
      if (await this.loadLegacyDiskCache('network failed')) return true
    }
    console.error(
      '[geo] all sources failed — keeping current ranges (fail-open if empty) until retry in 15m',
    )
    return false
  }

  // ── کش دیسک (round-37 — نسخه‌ی 2 دوکشوره) ──

  private get cachePath(): string {
    const dir = this.deps.config.uploadDir.replace(/\/+$/, '')
    return `${dir}/${CACHE_FILENAME}`
  }

  private get legacyCachePath(): string {
    const dir = this.deps.config.uploadDir.replace(/\/+$/, '')
    return `${dir}/${LEGACY_CACHE_FILENAME}`
  }

  /** ذخیره‌ی آخرین بازه‌های سالم — best-effort، هرگز throw نمی‌کند */
  private async writeCache(source: string): Promise<void> {
    const path = this.cachePath
    try {
      await Bun.$`mkdir -p ${this.deps.config.uploadDir}`
      const payload = JSON.stringify({
        version: 2,
        source,
        savedAt: new Date().toISOString(),
        ir: {
          v4: this.irV4,
          // bigint در JSON ندارد → رشته
          v6: this.irV6.map(([lo, hi]) => [lo.toString(), hi.toString()]),
        },
        iq: {
          v4: this.iqV4,
          v6: this.iqV6.map(([lo, hi]) => [lo.toString(), hi.toString()]),
        },
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

  /** بارگذاری کش v2 — با اعتبارسنجی کامل؛ هر شکست = false (بی‌صدا) */
  private async loadDiskCache(reason: string): Promise<boolean> {
    const path = this.cachePath
    try {
      const f = Bun.file(path)
      if (!(await f.exists())) return false
      const raw = JSON.parse(await f.text()) as {
        version?: unknown
        source?: unknown
        savedAt?: unknown
        ir?: { v4?: unknown; v6?: unknown }
        iq?: { v4?: unknown; v6?: unknown }
      }
      if (raw.version !== 2 || !Array.isArray(raw.ir?.v4) || raw.ir.v4.length === 0) return false

      const parseCountry = (c: { v4?: unknown; v6?: unknown } | undefined): CountryRanges | null => {
        if (!c) return null
        const v4: Array<[number, number]> = []
        if (Array.isArray(c.v4)) {
          for (const r of c.v4) {
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
              return null
            }
            v4.push([r[0], r[1]])
          }
        }
        const v6: Array<[bigint, bigint]> = []
        if (Array.isArray(c.v6)) {
          for (const r of c.v6) {
            if (!Array.isArray(r) || r.length !== 2) return null
            try {
              v6.push([BigInt(r[0] as string | number | bigint), BigInt(r[1] as string | number | bigint)])
            } catch {
              return null
            }
          }
        }
        return { v4, v6 }
      }

      const ir = parseCountry(raw.ir)
      if (!ir) return false
      const iq = parseCountry(raw.iq) ?? emptyRanges()

      // دوباره merge — به هیچ دیسکی اعتماد نمی‌شود
      this.irV4 = mergeV4(ir.v4)
      this.irV6 = mergeV6(ir.v6)
      this.iqV4 = mergeV4(iq.v4)
      this.iqV6 = mergeV6(iq.v6)
      this.rangesLoadedAt =
        typeof raw.savedAt === 'string' && Number.isFinite(Date.parse(raw.savedAt))
          ? Date.parse(raw.savedAt)
          : Date.now()
      this.loadedFrom = `${typeof raw.source === 'string' ? raw.source : '?'} (disk)`
      this.warnedNoRanges = false
      this.warnedNoIraqRanges = this.iqV4.length === 0
      console.log(
        `[geo] disk cache v2 loaded (${reason}) — from ${typeof raw.source === 'string' ? raw.source : '?'} saved ${typeof raw.savedAt === 'string' ? raw.savedAt : '?'} — IR: ${this.irV4.length} v4 / ${this.irV6.length} v6 · IQ: ${this.iqV4.length} v4 / ${this.iqV6.length} v6`,
      )
      return true
    } catch {
      return false
    }
  }

  /** round-37 — کش قدیمی v1 (فقط ایران) به‌عنوان سپرِ اولیه‌ی بوت */
  private async loadLegacyDiskCache(reason: string): Promise<boolean> {
    const path = this.legacyCachePath
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

      this.irV4 = mergeV4(v4)
      this.irV6 = mergeV6(v6)
      this.iqV4 = []
      this.iqV6 = []
      this.rangesLoadedAt =
        typeof raw.savedAt === 'string' && Number.isFinite(Date.parse(raw.savedAt))
          ? Date.parse(raw.savedAt)
          : Date.now()
      this.loadedFrom = `${typeof raw.source === 'string' ? raw.source : '?'} (disk v1)`
      this.warnedNoRanges = false
      console.log(
        `[geo] legacy disk cache v1 loaded (${reason}) — IR only: ${this.irV4.length} v4 — IQ ranges will fill on refresh`,
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

  /**
   * round-37 — دامنه‌ی ورود کاربران خارج از ایران (فقط وقتی قفل خاموش است).
   * پیش‌فرض 'iraq' — امن‌ترین حالت بعد از باز کردن قفل: دنیا نیاید داخل؛
   * ادمین صریحاً «همه کشورها» را انتخاب کند تا باز شود.
   */
  async outsideScope(): Promise<OutsideScope> {
    const now = Date.now()
    if (this.scopeCache && now - this.scopeCache.at < TOGGLE_TTL_MS) {
      return this.scopeCache.value
    }
    let value: OutsideScope = 'iraq'
    try {
      const row = await this.deps.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, SETTING_KEYS.outsideAccessScope))
        .then((rows) => rows[0])
      // فقط 'world' صریح پذیرفته می‌شود — هر چیز دیگر (غیبت/غلط) = 'iraq'
      value = row?.value === 'world' ? 'world' : 'iraq'
    } catch {
      value = this.scopeCache?.value ?? 'iraq'
    }
    this.scopeCache = { value, at: now }
    return value
  }

  /** round-37 — حالت نهایی دروازه (برای پیام ۴۰۳، صفحه‌ی مسدود و پنل) */
  async accessMode(): Promise<GeoAccessMode> {
    if (await this.iranOnlyEnabled()) return 'iran-only'
    return (await this.outsideScope()) === 'world' ? 'world' : 'iran-iraq'
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

  /**
   * round-37 — آیا این IP عراق است؟
   * تفاوت با isIranIp: اگر بازه‌های عراق لود نشده باشند، false می‌دهد
   * (نه true) — «فرض عراقی» یعنی باز بودن در برای کل دنیا؛ جهت شکست امن
   * انتخاب شد. سایتِ ایران بالا می‌ماند و عراق تا تازه‌سازی بعدی می‌مانَد بیرون.
   */
  isIraqIp(ip: string): boolean {
    if (this.iqV4.length === 0) {
      if (!this.warnedNoIraqRanges) {
        this.warnedNoIraqRanges = true
        console.warn(
          '[geo] IQ ranges not loaded — treating non-Iran IPs as blocked under iran-iraq scope (Iraq degraded, Iran unaffected)',
        )
      }
      return false
    }
    const v4 = ipv4ToLong(ip)
    if (v4 !== null) return inV4Ranges(v4, this.iqV4)
    const v6 = ipv6ToBig(ip)
    if (v6 !== null) return inV6Ranges(v6, this.iqV6)
    return false // ناپارسپذیر — عراقی فرض نمی‌شود
  }

  /**
   * تصمیم نهایی مسدودی — تنها تابعی که هوک http صدا می‌زند.
   *
   *   قفل ایران روشن  → غیرایرانی مسدود (عراق هم؛ رفتار round-26 دست‌نخورده)
   *   قفل خاموش، عراق → فقط ایران + عراق آزاد
   *   قفل خاموش، همه  → هیچ مسدودی‌ای نیست
   */
  async shouldBlock(ip: string): Promise<boolean> {
    if (!ip) return false
    if (isPrivateIp(ip)) return false
    if (this.bypass.has(ip)) return false
    if (await this.iranOnlyEnabled()) return !this.isIranIp(ip)
    if ((await this.outsideScope()) === 'world') return false
    return !this.isIranIp(ip) && !this.isIraqIp(ip)
  }

  /** وضعیت برای پنل ادمین */
  async status(): Promise<GeoStatus> {
    const [enabled, scope] = await Promise.all([this.iranOnlyEnabled(), this.outsideScope()])
    const mode: GeoAccessMode = enabled ? 'iran-only' : scope === 'world' ? 'world' : 'iran-iraq'
    return {
      enabled,
      mode,
      outsideScope: scope,
      rangesLoaded: this.irV4.length > 0,
      rangesLoadedAt: this.rangesLoadedAt > 0 ? new Date(this.rangesLoadedAt).toISOString() : null,
      source: this.loadedFrom,
      iran: { ipv4Prefixes: this.irV4.length, ipv6Prefixes: this.irV6.length },
      iraq: { ipv4Prefixes: this.iqV4.length, ipv6Prefixes: this.iqV6.length },
      // فیلدهای قدیمی = ایران (سازگاری)
      ipv4Prefixes: this.irV4.length,
      ipv6Prefixes: this.irV6.length,
      bypassIps: this.bypass.size,
    }
  }
}