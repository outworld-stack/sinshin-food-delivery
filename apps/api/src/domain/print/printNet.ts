// ═══════════════════════════════════════════════════════════════
// stage-89 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/print/printNet.ts (فایل جدید)
// ریاضیات و «سیاستِ مقصدهای شبکه» چاپ — توابعِ خالصِ جدا از سرویس.
//
// چرا فایل جدا؟ سه دلیل:
//  ۱) اصلاحِ P3 (بازبینی استیج-۸۸): محاسبهٔ CIDR باید «هر چهار اکتت» و
//     ماسکِ کاملِ ۳۲ بیتی را ببیند — 192.168.1.128/25 یعنی نیمهٔ «بالایی»
//     (129..254) نه 192.168.1.0/25. توابعِ خالص = تستِ مستقیمِ بایت‌به‌بایت.
//  ۲) اصلاحِ P2 (SSRF): یک منبعِ واحدِ حقیقت برای «کدام مقصد مجاز است» —
//     چاپگرِ فیشِ رستوران همیشه روی IP خصوصیِ RFC1918 است؛ loopback (سرویس‌های
//     خودِ سرور!)، link-local (metadata ابر!)، CGNAT، multicast و آدرسِ عمومی
//     «مقصدهای چاپ» نیستند و مسدود می‌شوند.
//  ۳) اصلاحِ P1: همان ماژول گزارشِ توپولوژیِ شبکهٔ سرور (کارت‌ها + ماسکِ
//     واقعی، نه فرضِ /24) را می‌سازد تا «مسیرِ واقعیِ شبکهٔ چاپگر» شفاف شود.
//
// هیچ وابستگی‌ای جز node:os (برای کارت‌های شبکه) ندارد — صفر پکیج.
// ═══════════════════════════════════════════════════════════════

//src/domain/print/printNet.ts
import os from 'node:os'

export type IpKind =
  | 'loopback'
  | 'linklocal'
  | 'privatelan'
  | 'cgnat'
  | 'multicast'
  | 'broadcast'
  | 'public'

/** فقط IPv4 — هر چهار اکتت 0..255؛ خروجی uint32 (ناگاتیو نیست) */
export function parseIpv4(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const c = Number(m[3])
  const d = Number(m[4])
  if (a > 255 || b > 255 || c > 255 || d > 255) return null
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0
}

export function ipToString(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`
}

/** دستهٔ یک IPv4 — مبنای «سیاستِ مقصد» (P2) */
export function classifyIpv4(n: number): IpKind {
  if ((n >>> 24) === 127) return 'loopback'
  if ((n >>> 16) === 0xa9fe) return 'linklocal' // 169.254/16 — شاملِ metadata ابر
  if ((n >>> 24) === 10) return 'privatelan'
  if ((n >>> 20) === 0xac1) return 'privatelan' // 172.16/12
  if ((n >>> 16) === 0xc0a8) return 'privatelan' // 192.168/16
  if ((n >>> 22) === 0x191) return 'cgnat' // 100.64/10 — ۱۰ بیتِ بالا = 0b0110010001
  if ((n >>> 28) >= 0xe) return 'multicast' // 224/4
  if ((n >>> 24) === 255) return 'broadcast'
  return 'public'
}

export interface CidrInfo {
  /** نشانی شبکه (-aligned) */
  network: number
  broadcast: number
  prefix: number
  /** تعداد کل نشانی‌ها (2^(32-prefix)) */
  count: number
}

/**
 * CIDR درست (اصلاح P3): هر چهار اکتت اعتبارسنجی و network/broadcast با
 * ماسکِ کاملِ ۳۲ بیتی. prefix مجاز اینجا 0..32 — سقفِ اسکن جدا اعمال
 * می‌شود ( cidrHosts).
 */
export function cidrParse(cidr: string): CidrInfo | null {
  const m = cidr.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return null
  const base = parseIpv4(`${m[1] as string}.${m[2] as string}.${m[3] as string}.${m[4] as string}`)
  if (base === null) return null
  const prefix = Number(m[5])
  if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > 32) return null
  // ماسک ۳۲ بیتی — بدون شیفتِ ۳۲ (UB در JS: 1<<32 === 1)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (base & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  return { network, broadcast, prefix, count: 2 ** (32 - prefix) }
}

/** آیا IP داخل این شبکه است؟ */
export function ipInCidr(ip: number, info: CidrInfo): boolean {
  return ip >= info.network && ip <= info.broadcast
}

/**
 * میزبان‌های قابل‌اسکنِ یک CIDR — network+1 تا broadcast-1 (P3).
 * بزرگ‌تر از maxHosts یا prefix نامعقول → [] (خطای صریح بر عهدهٔ فراخوان).
 */
export function cidrHosts(cidr: string, maxHosts: number, minPrefix = 8, maxPrefix = 30): string[] {
  const info = cidrParse(cidr)
  if (!info) return []
  if (info.prefix < minPrefix || info.prefix > maxPrefix) return []
  if (info.count - 2 > maxHosts) return []
  const out: string[] = []
  for (let n = info.network + 1; n < info.broadcast; n++) {
    out.push(ipToString(n >>> 0))
  }
  return out
}

/** پیشوند از ماسکِ نقطه‌دار (255.255.255.0 → 24) — برای کارت‌های واقعی (P3) */
export function prefixFromNetmask(mask: string): number | null {
  const n = parseIpv4(mask)
  if (n === null) return null
  // ماسکِ معتبر = رشتهٔ پیوستهٔ ۱ از بیتِ بالا؛ شمارش با ریاضیِ صحیح
  let prefix = -1
  for (let p = 0; p <= 32; p++) {
    const m = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0
    if (m === n) {
      prefix = p
      break
    }
  }
  return prefix
}

export interface ServerSubnet {
  name: string
  ip: string
  /** CIDRِ واقعیِ کارت (با ماسکِ خودِ interface — نه فرضِ /24) */
  cidr: string
  prefix: number
}

/**
 * زیرشبکه‌های IPv4ِ خودِ سرور با «ماسکِ واقعی» (اصلاح P3) — پیش‌فرضِ
 * اسکن و مبنای گزارشِ توپولوژی (P1). کارت‌های internal و /31-/32 (پوینت‌
 * تو‌پوینت/لوکال‌های تک‌نشانه) و 0.0.0.0 رد می‌شوند.
 */
export function serverSubnets(): ServerSubnet[] {
  const out = new Map<string, ServerSubnet>()
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!('netmask' in addr) || typeof addr.netmask !== 'string') continue
      const prefix = prefixFromNetmask(addr.netmask)
      const ipNum = parseIpv4(addr.address)
      if (prefix === null || ipNum === null || prefix > 30) continue
      const info = cidrParse(`${addr.address}/${prefix}`)
      if (!info) continue
      const cidr = `${ipToString(info.network)}/${prefix}`
      out.set(cidr, { name, ip: addr.address, cidr, prefix })
    }
  }
  return [...out.values()]
}

export interface PrintPolicyFlags {
  /** dev/test — چاپگرِ فیک روی 127.0.0.1 (پیش‌فرضِ تولید: خاموش) */
  allowLoopback?: boolean
}

/** سیاستِ «مقصدِ چاپ» — فقط LAN خصوصی (+loopback در dev) مجاز است (P2) */
export function ipAllowedForPrinters(kind: IpKind, flags: PrintPolicyFlags): boolean {
  if (kind === 'privatelan') return true
  if (kind === 'loopback' && flags.allowLoopback === true) return true
  return false
}

/** CIDRِ مجازِ «اسکن»: شبکهٔ RFC1918 (یا loopback در dev) — بقیه رد (P2) */
export function scanCidrAllowed(cidr: string, flags: PrintPolicyFlags): CidrInfo | null {
  const info = cidrParse(cidr)
  if (!info) return null
  const kind = classifyIpv4(info.network)
  if (!ipAllowedForPrinters(kind, flags)) return null
  return info
}

/** متنِ فارسیِ علتِ مسدودی — برای خطای صریح (سیاست باید «روشن» خطا بدهد) */
export function ipBlockReasonFa(kind: IpKind): string {
  switch (kind) {
    case 'public':
      return 'آدرسِ عمومی/اینترنتی برای چاپگرِ رستوران مجاز نیست — چاپگرِ فیش روی IP خصوصیِ شبکهٔ محلی است (192.168.x.x / 10.x.x.x / 172.16..172.31.x.x).'
    case 'loopback':
      return 'مقصدهای loopback (127.x.x.x) به‌طور پیش‌فرض مسدودند — چاپگرِ روی همین سرور فقط در حالتِ توسعه (PRINT_ALLOW_LOOPBACK=1) مجاز است.'
    case 'linklocal':
      return 'آدرسِ link-local (169.254.x.x) — از جمله سرویس‌های metadata ابر — مقصدِ چاپ نیست و مسدود شد.'
    case 'cgnat':
      return 'بازهٔ CGNAT (100.64..100.127.x.x) مقصدِ چاپ نیست و مسدود شد.'
    case 'multicast':
      return 'آدرسِ multicast برای چاپگر مجاز نیست.'
    case 'broadcast':
      return 'آدرسِ broadcast برای چاپگر مجاز نیست.'
    default:
      return 'مقصدِ شبکهٔ درخواستی مجاز نیست.'
  }
}
