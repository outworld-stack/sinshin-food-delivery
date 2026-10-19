// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/print/print.service.ts (فایل جدید)
// «پل چاپِ» سرور — تشخیص/پیکربندی/انتخاب/چاپِ چاپگرهای شبکهٔ رستوران.
//
// چرا سرور؟ حقیقتِ سندباکسِ وب (تحقیق استیج-۸۸، دستهٔ A): صفحهٔ وب
// هرگز فهرستِ چاپگرهای سیستم‌عامل را نمی‌بیند — Web Print API فقط برای
// Isolated Web Appsِ کروم است و window.print فقط دیالوگ می‌دهد. راهِ
// استانداردِ POSهای واقعی (Toast/Deliverect/…): خودِ API با سوکتِ خام
// TCP 9100 حرف می‌زند. صفر ابزارِ شخصِ ثالث — node:netِ خودِ Bun.
//
//  · تشخیص: اسکنِ زیرشبکه (خروجی NATِ داکر عبور می‌کند؛ mDNS در bridge
//    عبور نمی‌کند → سند‌سازی در REFERENCE) + ورودِ دستیِ IP.
//  · پیکربندی: جدول printers + تخصیصِ «هر نوع فاکتور → چاپگر» در
//    settings (کلید invoice_printers) — همان الگوی درگاه‌های پرداخت.
//  · چاپ: بیت‌مپِ 1bpp (رندرشده در canvasِ مرورگر برای شکل‌گیریِ فارسی)
//    → GS v 0 قطعه‌قطعه → برش — طولِ کاغذ = طولِ محتوا.
//  · وضعیت: DLE EOT پیش از هر کار — کاغذِ تمام = خطای صریح قبل از ارسال.
//
// ═══ stage-89 — پنج ایرادِ بازبینیِ کارفرما ═══
//  P1) «مسیرِ واقعیِ شبکه» شفاف شد: networkReport() توپولوژیِ کارت‌های
//      سرور (با ماسکِ واقعی) + جایِ IP هر چاپگر نسبت به زیرشبکه‌های سرور
//      + راهنمای فارسیِ صریح (LAN / VPS / تونل / دیالوگِ مرورگر) — و
//      خطایِ چاپ به مقصدِ دور، راهنما را هم می‌آورد.
//  P2) سیاستِ مقصدِ شبکه در printNet.ts یکجا اعمال می‌شود: فقط LAN
//      خصوصی (10/8 · 172.16/12 · 192.168/16) مجاز است؛ loopback (سرویس‌های
//      خودِ سرور)، link-local (metadata ابر!)، CGNAT، multicast، broadcast
//      و آدرسِ عمومی مسدود. hostname قبل از اتصال resolve و «IP نهایی»
//      سیاست‌گذاری می‌شود و اتصال به همان IP پین می‌شود (ضد DNS-rebind).
//  P3) ریاضیاتِ CIDR کامل ۳۲ بیتی شد (هر ۴ اکتت + ماسکِ کامل) —
//      192.168.1.128/25 حالا نیمهٔ بالایی را اسکن می‌کند؛ پیش‌فرضِ اسکن
//      از ماسکِ واقعیِ کارت ساخته می‌شود؛ شبکه‌های بزرگ‌تر از /23 به /24 خودِ کارت محدودند.
//  P4) اسکن فقط پورتِ 9100 — تنها انتقالِ پیاده‌شده RAW/JetDirect است؛
//      631 (IPP) باز هم به معنیِ پذیرشِ ESC/POS خام نیست.
//  P5) وضعیتِ نهایی = اتصالِ TCP «و» بیتِ خودِ دستگاه؛ چاپگرِ که خودش
//      آفلاین بگوید سبز نشان داده نمی‌شود و چاپ/تست رد می‌شود.
// ═══════════════════════════════════════════════════════════════

//src/domain/print/print.service.ts
import dns from 'node:dns/promises'
import { eq, inArray } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { printers, PRINTER_WIDTH_DOTS, SETTING_KEYS } from '#/infra/db/schema'
import type { SettingsService } from '#/domain/settings/settings.service'
import { Err } from '#/domain/shared/errors'
import { isUniqueViolation } from '#/domain/shared/pg'
import { sendRaw } from '#/domain/print/printTransport'
import type {
  InvoicePrinterAssignmentDto,
  PrinterDto,
  PrinterNetworkReportDto,
} from '@sinshin/shared'
import {
  buildRasterJob,
  buildTestJob,
  cmdStatus,
  parseStatusPaper,
  parseStatusPrinter,
} from '#/domain/print/escpos'
import {
  cidrHosts,
  cidrParse,
  classifyIpv4,
  ipAllowedForPrinters,
  ipBlockReasonFa,
  ipInCidr,
  ipToString,
  parseIpv4,
  scanCidrAllowed,
  serverSubnets,
  type CidrInfo,
  type IpKind,
  type ServerSubnet,
} from '#/domain/print/printNet'

/** TTL کشِ probe — مودال با هر بازشدن لیست را می‌خواهد؛ چاپگر اذیت نمی‌شود */
const PROBE_CACHE_TTL_MS = 8_000
const PROBE_CONNECT_TIMEOUT_MS = 900
const PRINT_CONNECT_TIMEOUT_MS = 3_000
const PRINT_WRITE_TIMEOUT_MS = 20_000
const MAX_RECEIPT_HEIGHT_DOTS = 4_000
const DISCOVER_CONCURRENCY = 64
const DISCOVER_PORT_TIMEOUT_MS = 350
const DISCOVER_MAX_HOSTS = 512
/** P4 — تنها انتقالِ پیاده‌شده RAW/JetDirect است؛ IPP واقعی پیاده نشده */
export const DISCOVER_PORTS = [9100] as const
/** P2 — پورتِ مجازِ ثبتِ چاپگر: فقط 9100 (خامِ ESC/POS) */
const PRINTER_RAW_PORT = 9100
const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,63}$/

export interface ProbeResult {
  online: boolean
  /** «آنلاین» ولی بی‌پاسخِ وضعیت (بعضی فرم‌ورها DLE EOT نمی‌دهند) */
  detail: string | null
  paperEnd: boolean
  paperNearEnd: boolean
  offline: boolean
}

/** مقصدِ شبکه‌ایِ «سیاست‌گذاری‌شده» — hostname حل‌شده یا IP literal */
interface ResolvedTarget {
  /** نشانی‌ای که واقعاً به آن وصل می‌شویم (پین‌شده — ضدِ rebind) */
  connectIp: string
  kind: IpKind
}

export class PrinterService {
  constructor(
    private readonly deps: { db: Db; settings: SettingsService },
  ) {}

  private readonly probeCache = new Map<string, { at: number; result: ProbeResult }>()

  // ── سیاست (P2) — پرچم‌های dev/test فقط با env صریح ──

  private flags(): { allowLoopback: boolean; allowAnyPort: boolean } {
    return {
      allowLoopback: process.env.PRINT_ALLOW_LOOPBACK === '1',
      allowAnyPort: process.env.PRINT_ALLOW_ANY_PORT === '1',
    }
  }

  /**
   * حل و سیاست‌گذاریِ مقصد (P2): شکل → resolve → دسته → سیاست.
   * خروجی: مقصدِ پین‌شده برای اتصال؛ یا خطای صریحِ فارسی.
   */
  private async resolveTarget(host: string, forRegistration: boolean): Promise<ResolvedTarget> {
    const h = host.trim()
    if (!HOST_RE.test(h)) {
      throw Err.validation(
        'نشانی چاپگر معتبر نیست — فقط IP یا نام میزبان (مثال: 192.168.1.87).',
      )
    }
    const { allowLoopback } = this.flags()
    const literal = parseIpv4(h)
    if (literal !== null) {
      const kind = classifyIpv4(literal)
      if (!ipAllowedForPrinters(kind, { allowLoopback })) {
        throw Err.validation(ipBlockReasonFa(kind))
      }
      return { connectIp: ipToString(literal), kind }
    }
    // hostname — IP نهایی بررسی می‌شود (همهٔ نشانی‌های حل‌شده باید مجاز باشند)
    let addrs: Array<{ address: string }> = []
    try {
      addrs = (await dns.lookup(h, { family: 4, all: true })) as Array<{ address: string }>
    } catch {
      addrs = []
    }
    if (addrs.length === 0) {
      throw Err.validation(
        forRegistration
          ? `نام میزبانِ «${h}» حل نمی‌شود (DNS) — IP چاپگر را مستقیم وارد کنید (از صفحهٔ تستِ خودِ چاپگر).`
          : `نام میزبانِ «${h}» دیگر حل نمی‌شود (DNS) — چاپگر آفلاین است.`,
      )
    }
    let chosen: ResolvedTarget | null = null
    for (const a of addrs) {
      const n = parseIpv4(a.address)
      if (n === null) continue
      const kind = classifyIpv4(n)
      if (!ipAllowedForPrinters(kind, { allowLoopback })) {
        throw Err.validation(
          `IP نهاییِ «${h}» (${a.address}) مجاز نیست — ${ipBlockReasonFa(kind)}`,
        )
      }
      if (!chosen) chosen = { connectIp: a.address, kind }
    }
    if (!chosen) {
      throw Err.validation(`نام میزبانِ «${h}» نشانیِ IPv4ِ معتبر ندارد.`)
    }
    return chosen
  }

  /** پورتِ مقصد (P2): فقط 9100 — مگر پرچمِ dev/test صریح روشن باشد */
  private assertPort(port: number): void {
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) {
      if (port === PRINTER_RAW_PORT) return
      if (this.flags().allowAnyPort) return
      throw Err.validation(
        `پورتِ ${port} پشتیبانی نمی‌شود — تنها انتقالِ پیاده‌شده RAW/JetDirect روی پورتِ 9100 است (ESC/POS خام).`,
      )
    }
    throw Err.validation('پورت چاپگر باید بین ۱ تا ۶۵۵۳۵ باشد (پیش‌فرض 9100).')
  }

  /**
   * probe کامل: حلِ مقصد + سیاست (P2) + اتصال + DLE EOT 1 و 4.
   * مقصدِ مسدود بدونِ اتصال آفلاین برمی‌گردد (اتصال به metadata/loopback
   * اصلاً باز نمی‌شود).
   */
  private async probe(host: string, port: number): Promise<ProbeResult> {
    let target: ResolvedTarget
    try {
      this.assertPort(port)
      target = await this.resolveTarget(host, false)
    } catch (err) {
      const raw = err instanceof Error && err.message ? err.message : 'مقصدِ شبکهٔ چاپگر مجاز نیست.'
      // ستونِ دیتابیس ۱۴۰ حرف است — جزئیات هرگز نباید «لیست» را بشکند
      return { online: false, detail: raw.slice(0, 140), paperEnd: false, paperNearEnd: false, offline: false }
    }
    const res = await sendRaw(target.connectIp, port, Buffer.concat([cmdStatus(1), cmdStatus(4)]), {
      connectTimeoutMs: PROBE_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: 1_500,
      collectReplyMs: 500,
    })
    if (!res.online) {
      return { online: false, detail: null, paperEnd: false, paperNearEnd: false, offline: false }
    }
    if (!res.reply || res.reply.length === 0) {
      return { online: true, detail: 'بدون پاسخ وضعیت', paperEnd: false, paperNearEnd: false, offline: false }
    }
    const st = parseStatusPrinter(res.reply[0] as number)
    const paper = res.reply.length > 1
      ? parseStatusPaper(res.reply[1] as number)
      : { paperEnd: false, paperNearEnd: false }
    let detail: string | null = res.reply.length > 1 ? null : 'بدون پاسخ وضعیت کاغذ'
    if (paper.paperEnd) detail = 'کاغذ تمام شده است'
    else if (paper.paperNearEnd) detail = 'کاغذ رو به اتمام'
    else if (st.offline) detail = 'چاپگر خودش را آفلاین اعلام کرده است (درِ باز / صف پارچه / خط)'
    return { online: true, detail, ...paper, offline: st.offline }
  }

  // ── CRUD ──

  /**
   * وضعیتِ نهایی (P5): «آنلاین» یعنی اتصالِ TCP برقرار «و» خودِ دستگاه
   * بیتِ آفلاین نداده. سوکتِ باز + خود‌گزارشِ آفلاین = آفلاین.
   */
  private static combinedStatus(p: ProbeResult): 'online' | 'offline' {
    return p.online && !p.offline ? 'online' : 'offline'
  }

  private toDto(row: typeof printers.$inferSelect, probe?: ProbeResult): PrinterDto {
    const status: PrinterDto['status'] = probe
      ? PrinterService.combinedStatus(probe)
      : row.lastStatus === 'online' || row.lastStatus === 'offline'
        ? row.lastStatus
        : 'unknown'
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      widthDots: row.widthDots,
      autoCut: row.autoCut,
      status,
      statusDetail: probe ? probe.detail : row.lastStatusDetail,
      lastStatusAt: (probe ? new Date() : row.lastStatusAt)?.toISOString() ?? null,
    }
  }

  /** لیست + وضعیتِ زنده — کشِ ۸ ثانیه + ذخیرهٔ تغییر وضعیت روی ردیف */
  async list(): Promise<PrinterDto[]> {
    const rows = await this.deps.db.select().from(printers)
    if (rows.length === 0) return []
    const now = Date.now()
    const probes = await Promise.all(
      rows.map(async (row) => {
        const cached = this.probeCache.get(row.id)
        if (cached && now - cached.at < PROBE_CACHE_TTL_MS) return cached.result
        const result = await this.probe(row.host, row.port)
        this.probeCache.set(row.id, { at: now, result })
        return result
      }),
    )
    // ذخیرهٔ تغییرات وضعیت (fire-and-forget نیست — ولی خطایش بی‌اهمیت است)
    await Promise.all(
      rows.map(async (row, i) => {
        const p = probes[i] as ProbeResult
        const status = PrinterService.combinedStatus(p)
        if (row.lastStatus !== status || row.lastStatusDetail !== p.detail) {
          await this.deps.db
            .update(printers)
            .set({
              lastStatus: status,
              lastStatusDetail: p.detail?.slice(0, 140) ?? null,
              lastStatusAt: new Date(),
            })
            .where(eq(printers.id, row.id))
        }
      }),
    )
    return rows.map((row, i) => this.toDto(row, probes[i] as ProbeResult))
  }

  private validateHostShape(host: string): string {
    const h = host.trim()
    if (!HOST_RE.test(h)) {
      throw Err.validation('نشانی چاپگر معتبر نیست — فقط IP یا نام میزبان (مثال: 192.168.1.87).')
    }
    return h
  }

  async add(input: {
    name: string
    host: string
    port?: number
    widthDots?: number
    autoCut?: boolean
  }): Promise<PrinterDto> {
    const name = input.name.trim().slice(0, 60)
    if (!name) throw Err.validation('نام چاپگر را وارد کنید (مثلاً «چاپگر آشپزخانه»).')
    const host = this.validateHostShape(input.host)
    const port = input.port ?? PRINTER_RAW_PORT
    this.assertPort(port)
    // P2 — IP/hostname نهاییِ مقصد قبل از ذخیره سیاست‌گذاری می‌شود
    await this.resolveTarget(host, true)
    const widthDots = input.widthDots ?? 576
    if (!PRINTER_WIDTH_DOTS.includes(widthDots as (typeof PRINTER_WIDTH_DOTS)[number])) {
      throw Err.validation('عرض کاغذ چاپگر معتبر نیست (۵۷۶ dot برای ۸۰mm یا ۳۸۴ dot برای ۵۸mm).')
    }
    const [row] = await this.deps.db
      .insert(printers)
      .values({ name, host, port, widthDots, autoCut: input.autoCut ?? true })
      .onConflictDoNothing({ target: [printers.host, printers.port] })
      .returning()
    if (!row) throw Err.conflict('چاپگری با همین IP و پورت از قبل ثبت شده است.')
    return this.toDto(row)
  }

  async update(
    id: string,
    patch: {
      name?: string
      host?: string
      port?: number
      widthDots?: number
      autoCut?: boolean
    },
  ): Promise<PrinterDto> {
    const values: Partial<typeof printers.$inferInsert> = { updatedAt: new Date() }
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 60)
      if (!name) throw Err.validation('نام چاپگر نمی‌تواند خالی باشد.')
      values.name = name
    }
    if (patch.host !== undefined) {
      const host = this.validateHostShape(patch.host)
      if (patch.port !== undefined) this.assertPort(patch.port)
      await this.resolveTarget(host, true)
      values.host = host
    } else if (patch.port !== undefined) {
      this.assertPort(patch.port)
    }
    if (patch.port !== undefined) values.port = patch.port
    if (patch.widthDots !== undefined) {
      if (!PRINTER_WIDTH_DOTS.includes(patch.widthDots as (typeof PRINTER_WIDTH_DOTS)[number])) {
        throw Err.validation('عرض کاغذ چاپگر معتبر نیست.')
      }
      values.widthDots = patch.widthDots
    }
    if (patch.autoCut !== undefined) values.autoCut = patch.autoCut
    const [row] = await this.deps.db
      .update(printers)
      .set(values)
      .where(eq(printers.id, id))
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw Err.conflict('چاپگری با همین IP و پورت از قبل ثبت شده است.')
        }
        throw error
      })
    if (!row) throw Err.notFound('چاپگر پیدا نشد.')
    this.probeCache.delete(id)
    return this.toDto(row)
  }

  async remove(id: string): Promise<void> {
    const [row] = await this.deps.db.delete(printers).where(eq(printers.id, id)).returning()
    if (!row) throw Err.notFound('چاپگر پیدا نشد.')
    this.probeCache.delete(id)
    // تخصیصِ فاکتورها اگر به این چاپگر اشاره می‌کند پاک شود — رفرنسِ مرده نه
    const assignment = await this.assignment()
    const next: InvoicePrinterAssignmentDto = {
      sales: assignment.sales === id ? null : assignment.sales,
      kitchen: assignment.kitchen === id ? null : assignment.kitchen,
    }
    if (next.sales !== assignment.sales || next.kitchen !== assignment.kitchen) {
      await this.setAssignment(next)
    }
  }

  // ── گزارشِ توپولوژیِ شبکه (P1) — «مسیرِ واقعیِ شبکه» شفاف ──

  /**
   * سرور چه کارت‌هایی/زیرشبکه‌هایی دارد، IP هر چاپگر کجاست نسبت به آن‌ها،
   * و در هر حالتِ استقرار (LAN / دور) چه باید کرد — بدون حدس، با راهنما.
   */
  async networkReport(): Promise<PrinterNetworkReportDto> {
    const subnets = serverSubnets()
    const subnetInfos = subnets
      .map((s) => ({ s, info: cidrParse(s.cidr) }))
      .filter((x): x is { s: ServerSubnet; info: CidrInfo } => x.info !== null)
    const envRaw = process.env.PRINT_SCAN_CIDRS?.trim()
    const envScanCidrs = envRaw
      ? envRaw.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
      : []
    const rows = await this.deps.db.select().from(printers)
    const printerEntries: PrinterNetworkReportDto['printers'] = []
    let resolvable = 0
    let inSubnet = 0
    for (const row of rows) {
      const literal = parseIpv4(row.host)
      let ip: string | null = null
      let kind: IpKind | 'unknown' = 'unknown'
      if (literal !== null) {
        ip = ipToString(literal)
        kind = classifyIpv4(literal)
      } else {
        try {
          const addrs = (await dns.lookup(row.host, { family: 4, all: true })) as Array<{ address: string }>
          const first = addrs[0]?.address
          const n = first !== undefined ? parseIpv4(first) : null
          if (n !== null) {
            ip = ipToString(n)
            kind = classifyIpv4(n)
          }
        } catch {
          ip = null
        }
      }
      const ipNum = ip !== null ? parseIpv4(ip) : null
      const inside =
        ipNum !== null && subnetInfos.some(({ info }) => ipInCidr(ipNum as number, info))
      if (ip !== null) resolvable += 1
      if (inside) inSubnet += 1
      printerEntries.push({
        id: row.id,
        name: row.name,
        host: row.host,
        ip,
        ipKind: kind,
        inServerSubnet: inside,
        status: row.lastStatus === 'online' || row.lastStatus === 'offline' ? row.lastStatus : 'unknown',
      })
    }
    let deploymentMode: PrinterNetworkReportDto['deploymentMode'] = 'empty'
    if (printerEntries.length > 0) {
      deploymentMode = resolvable > 0 && resolvable === inSubnet ? 'lan' : 'remote'
    }
    const guidance: string[] = []
    if (deploymentMode === 'lan') {
      guidance.push(
        'سرور روی همان زیرشبکهٔ چاپگرهاست — مسیرِ شبکه هست و چاپِ مستقیم باید کار کند. اگر probe قرمز است، فایروال چاپگر یا پورتِ 9100 را بررسی کنید.',
      )
    } else if (deploymentMode === 'remote') {
      guidance.push(
        'IP چاپگرها بیرونِ زیرشبکه‌های این سرور است. چاپِ مستقیم «فقط» وقتی سرور از شبکهٔ رستوران به چاپگر مسیر داشته باشد کار می‌کند:',
      )
      guidance.push(
        '· اگر API روی سرور ابری (VPS) بیرون از رستوران است: IP خصوصی چاپگر (مثل 192.168.1.50) بدون مسیر از اینجا قابل دسترسی نیست — تنظیمِ PRINT_SCAN_CIDRS به‌تنهایی مسیر نمی‌سازد. یا API را روی دستگاهِ داخلِ رستوران اجرا کنید، یا تونل site-to-site (مثل WireGuard) بین سرور و روترِ رستوران برقرار کنید، یا چاپ با «دیالوگِ مرورگر» را نگه دارید (پشتیبانِ همیشگی).',
      )
      guidance.push(
        '· اگر API با docker روی همان ماشینِ رستوران است، NAT خروجی معمولاً به LAN می‌رسد — probe چاپگر را بگیرید (وضعیتِ سبز = مسیر هست).',
      )
    } else {
      guidance.push(
        'چاپگری ثبت نشده — بعد از ثبت، همین گزارش جایِ IP چاپگر نسبت به شبکهٔ سرور و راهنمایِ استقرار را نشان می‌دهد.',
      )
    }
    const envOutside = envScanCidrs.filter((c) => {
      const info = scanCidrAllowed(c, { allowLoopback: true })
      if (!info) return false
      const ipNum = info.network
      return !subnetInfos.some(({ info: si }) => ipInCidr(ipNum, si))
    })
    if (envOutside.length > 0) {
      guidance.push(
        `هشدار: PRINT_SCAN_CIDRS (${envOutside.join('، ')}) بیرونِ زیرشبکه‌های خودِ سرور است — اسکنِ پیش‌فرضِ آن بازه‌ها فقط وقتی سرور روی همان LAN باشد چیزی پیدا می‌کند.`,
      )
    }
    return {
      serverSubnets: subnets.map((s) => ({ name: s.name, ip: s.ip, cidr: s.cidr })),
      envScanCidrs,
      deploymentMode,
      guidance,
      printers: printerEntries,
    }
  }

  /**
   * راهنمایِ خطایِ «چاپ به مقصدِ دور» (P1) — فقط وقتی IP خصوصیِ
   * بیرونِ زیرشبکه‌های سرور باشد اضافه می‌شود؛ دیگر خطایِ VPS بی‌توضیح نیست.
   */
  private async remoteHint(host: string): Promise<string | null> {
    const literal = parseIpv4(host)
    let ipNum: number | null = literal
    if (ipNum === null) {
      try {
        const addrs = (await dns.lookup(host, { family: 4, all: true })) as Array<{ address: string }>
        const first = addrs[0]?.address
        ipNum = first !== undefined ? parseIpv4(first) : null
      } catch {
        ipNum = null
      }
    }
    if (ipNum === null) return null
    const kind = classifyIpv4(ipNum)
    if (kind !== 'privatelan') return null
    const inside = serverSubnets().some((s) => {
      const info = cidrParse(s.cidr)
      return info !== null && ipInCidr(ipNum as number, info)
    })
    if (inside) return null
    return ' — IP خصوصیِ چاپگر بیرونِ زیرشبکه‌های این سرور است؛ اگر API روی سرور ابری/VPS بیرون از رستوران است، بدون تونل/VPN به LAN رستوران نمی‌رسد (گزارشِ کامل: پنل چاپگرها → «شبکهٔ سرور»)'
  }

  // ── تخصیصِ «هر نوع فاکتور → چاپگر» (settings؛ الگوی درگاه‌ها) ──

  async assignment(): Promise<InvoicePrinterAssignmentDto> {
    const raw = await this.deps.settings.get<unknown>(SETTING_KEYS.invoicePrinters, {})
    const sales = (raw as { sales?: unknown }).sales
    const kitchen = (raw as { kitchen?: unknown }).kitchen
    return {
      sales: typeof sales === 'string' && sales.length > 0 ? sales : null,
      kitchen: typeof kitchen === 'string' && kitchen.length > 0 ? kitchen : null,
    }
  }

  async setAssignment(next: InvoicePrinterAssignmentDto): Promise<void> {
    // Set — هر دو فاکتور می‌توانند به «یک» چاپگر اشاره کنند (تکرار ممنوع در شمارش)
    const wanted = [
      ...new Set(
        [next.sales, next.kitchen].filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        ),
      ),
    ]
    if (wanted.length > 0) {
      const found = await this.deps.db
        .select({ id: printers.id })
        .from(printers)
        .where(inArray(printers.id, wanted))
      if (found.length !== wanted.length) {
        throw Err.validation('چاپگرِ انتخاب‌شده برای یکی از فاکتورها پیدا نشد.')
      }
    }
    await this.deps.settings.set(SETTING_KEYS.invoicePrinters, {
      sales: next.sales ?? null,
      kitchen: next.kitchen ?? null,
    })
  }

  // ── چاپ ──

  async dispatch(input: {
    printerId: string
    widthPx: number
    heightPx: number
    rows: string
  }): Promise<{ bytes: number }> {
    const [row] = await this.deps.db.select().from(printers).where(eq(printers.id, input.printerId))
    if (!row) throw Err.notFound('چاپگر مقصد پیدا نشد.')
    const widthPx = input.widthPx
    const heightPx = input.heightPx
    if (widthPx !== row.widthDots) {
      throw Err.validation(
        `عرضِ رسید (${widthPx} dot) با کاغذِ چاپگر «${row.name}» (${row.widthDots} dot) نمی‌خواند.`,
      )
    }
    if (!Number.isSafeInteger(heightPx) || heightPx < 1 || heightPx > MAX_RECEIPT_HEIGHT_DOTS) {
      throw Err.validation(`ارتفاع رسید نامعتبر است (۱ تا ${MAX_RECEIPT_HEIGHT_DOTS} dot).`)
    }
    const bytesPerRow = Math.ceil(widthPx / 8)
    const expected = bytesPerRow * heightPx
    let rows: Buffer
    try {
      rows = Buffer.from(input.rows, 'base64')
    } catch {
      throw Err.validation('دادهٔ تصویر رسید معتبر نیست.')
    }
    if (rows.length !== expected) {
      throw Err.validation(
        `دادهٔ تصویر رسید ناقص است — ${rows.length} بایت به‌جایِ ${expected}.`,
      )
    }
    // P2 — مقصد دوباره سیاست‌گذاری می‌شود (ضدِ تغییرِ DNS/ردیفِ کهنه) و
    // اتصال به IP پین‌شده می‌رود
    const target = await this.resolveTarget(row.host, false)
    this.assertPort(row.port)
    // پیش‌پرواز — کاغذ/آفلاینِ دستگاه، قبل از ارسالِ رستری
    const pre = await this.probe(row.host, row.port)
    if (!pre.online) {
      const hint = await this.remoteHint(row.host)
      throw Err.validation(
        `چاپگر «${row.name}» (${row.host}:${row.port}) در شبکه در دسترس نیست${hint ?? ''}.`,
      )
    }
    if (pre.paperEnd) {
      throw Err.validation(`کاغذِ چاپگر «${row.name}» تمام شده است.`)
    }
    // P5 — دستگاهِ خود-آفلاین: سوکت باز است ولی چاپ نمی‌شود؛ ردِ صریح
    if (pre.offline) {
      throw Err.validation(
        `چاپگر «${row.name}» خودش را آفلاین اعلام کرده است (درِ باز / صف پارچه / خط) — چاپ رد شد.`,
      )
    }
    const job = buildRasterJob(widthPx, heightPx, new Uint8Array(rows), { autoCut: row.autoCut })
    const res = await sendRaw(target.connectIp, row.port, job, {
      connectTimeoutMs: PRINT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: PRINT_WRITE_TIMEOUT_MS,
      collectReplyMs: 250,
    })
    if (!res.online) {
      const hint = await this.remoteHint(row.host)
      throw Err.validation(`ارسال به چاپگر «${row.name}» ناموفق بود (${res.reason})${hint ?? ''}.`)
    }
    return { bytes: job.length }
  }

  /** صفحهٔ تستِ اسکی — از همان سوکت؛ برایِ اطمینانِ اتصال/IP بدونِ مرورگر */
  async test(id: string): Promise<{ bytes: number }> {
    const [row] = await this.deps.db.select().from(printers).where(eq(printers.id, id))
    if (!row) throw Err.notFound('چاپگر پیدا نشد.')
    const target = await this.resolveTarget(row.host, false)
    this.assertPort(row.port)
    // P5 — پیش‌پروای همانِ dispatch: دستگاهِ خود-آفلاین/بی‌کاغذ تست نمی‌گیرد
    const pre = await this.probe(row.host, row.port)
    if (!pre.online) {
      const hint = await this.remoteHint(row.host)
      throw Err.validation(
        `چاپگر «${row.name}» (${row.host}:${row.port}) در شبکه در دسترس نیست${hint ?? ''}.`,
      )
    }
    if (pre.paperEnd) {
      throw Err.validation(`کاغذِ چاپگر «${row.name}» تمام شده است.`)
    }
    if (pre.offline) {
      throw Err.validation(
        `چاپگر «${row.name}» خودش را آفلاین اعلام کرده است — صفحهٔ تست ارسال نشد.`,
      )
    }
    const job = buildTestJob({
      name: row.name,
      host: row.host,
      widthDots: row.widthDots,
      autoCut: row.autoCut,
    })
    const res = await sendRaw(target.connectIp, row.port, job, {
      connectTimeoutMs: PRINT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: PRINT_WRITE_TIMEOUT_MS,
      collectReplyMs: 250,
    })
    if (!res.online) {
      const hint = await this.remoteHint(row.host)
      throw Err.validation(`ارسال به چاپگر «${row.name}» ناموفق بود (${res.reason})${hint ?? ''}.`)
    }
    return { bytes: job.length }
  }

  // ── تشخیص: اسکنِ زیرشبکه ──

  /** CIDRهای پیش‌فرض — env PRINT_SCAN_CIDRS (جداشده با کاما) وگرنه
   *  زیرشبکه‌های خصوصیِ کارت‌های سرور؛ بازه‌های بزرگ‌تر از /23 به /24 خودِ کارت محدودند.
   *  در docker bridge همان شبکهٔ داکر است — برایِ LAN رستوران env را
   *  تنظیم کنید؛ مستند در REFERENCE */
  private defaultScanCidrs(): { cidrs: string[]; rejected: string[] } {
    const raw = process.env.PRINT_SCAN_CIDRS?.trim()
    if (raw) {
      const all = raw.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
      const { allowLoopback } = this.flags()
      const cidrs: string[] = []
      const rejected: string[] = []
      for (const c of all) {
        if (scanCidrAllowed(c, { allowLoopback })) cidrs.push(c)
        else rejected.push(c)
      }
      return { cidrs: cidrs.slice(0, 4), rejected }
    }
    const { allowLoopback } = this.flags()
    return {
      cidrs: serverSubnets()
        .filter((s) => scanCidrAllowed(s.cidr, { allowLoopback }) !== null)
        .map((s) => {
          // Docker/VPN interfaces often cover /16 or /8. Scan the interface's
          // own /24 by default; keep its actual netmask in the topology report.
          if (s.prefix >= 23) return s.cidr
          const local = cidrParse(`${s.ip}/24`) as CidrInfo
          return `${ipToString(local.network)}/24`
        })
        .slice(0, 4),
      rejected: [],
    }
  }

  /** اسکنِ «فقط پورتِ 9100» روی CIDRهای مجاز (P2/P3/P4) — NAT داکر را عبور می‌کند */
  async discover(input: { cidr?: string }): Promise<{
    scanned: string[]
    found: Array<{ host: string; port: number }>
  }> {
    const { allowLoopback } = this.flags()
    let cidrs: string[]
    if (input.cidr?.trim()) {
      const wanted = input.cidr.trim()
      // P2 — بازهٔ صریح هم باید شبکهٔ خصوصی باشد؛ loopback/metadata/عمومی رد
      if (!scanCidrAllowed(wanted, { allowLoopback })) {
        const parsed = cidrParse(wanted)
        throw Err.validation(
          parsed
            ? `بازهٔ اسکن مجاز نیست — ${ipBlockReasonFa(classifyIpv4(parsed.network))}`
            : 'بازهٔ اسکن معتبر نیست (مثال: 192.168.1.0/24).',
        )
      }
      cidrs = [wanted]
    } else {
      const def = this.defaultScanCidrs()
      cidrs = def.cidrs
      if (cidrs.length === 0) {
        throw Err.validation(
          'بازهٔ اسکن مشخص نیست — CIDR شبکهٔ رستوران را وارد کنید (مثلاً 192.168.1.0/24).',
        )
      }
      if (def.rejected.length > 0) {
        throw Err.validation(
          `PRINT_SCAN_CIDRS نامعتبر/غیرمجاز است: ${def.rejected.join('، ')} — فقط شبکه‌های خصوصیِ رستوران (10.x / 172.16-31.x / 192.168.x) و در حالتِ توسعه 127.x مجازند.`,
        )
      }
    }
    const uniqueHosts = new Set<string>()
    for (const cidr of cidrs) {
      const addresses = scanCidrAllowed(cidr, { allowLoopback })
        ? cidrHosts(cidr, DISCOVER_MAX_HOSTS)
        : []
      if (addresses.length === 0) {
        throw Err.validation(`بازهٔ اسکن ${cidr} معتبر نیست یا بیش از سقف ۵۱۲ میزبان است.`)
      }
      for (const host of addresses) uniqueHosts.add(host)
    }
    const hosts = [...uniqueHosts]
    if (hosts.length === 0) {
      throw Err.validation('بازهٔ اسکن معتبر نیست (مثال: 192.168.1.0/24 — تا سقف ۵۱۲ میزبان).')
    }
    if (hosts.length > DISCOVER_MAX_HOSTS) {
      throw Err.validation(
        `بازهٔ اسکن بیش از حد بزرگ است — حداکثر ${DISCOVER_MAX_HOSTS} میزبان.`,
      )
    }
    const found: Array<{ host: string; port: number }> = []
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = cursor++
        if (i >= hosts.length) return
        const host = hosts[i] as string
        // P4 — فقط 9100: تنها انتقالِ واقعیِ پیاده‌شده (631 = IPP نیست)
        for (const port of DISCOVER_PORTS) {
          const res = await sendRaw(host, port, new Uint8Array(0), {
            connectTimeoutMs: DISCOVER_PORT_TIMEOUT_MS,
            writeTimeoutMs: 200,
          })
          if (res.online) {
            found.push({ host, port })
            break
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(DISCOVER_CONCURRENCY, hosts.length) }, worker))
    return { scanned: cidrs, found }
  }
}
