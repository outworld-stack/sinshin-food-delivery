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
// ═══════════════════════════════════════════════════════════════

//src/domain/print/print.service.ts
import net from 'node:net'
import os from 'node:os'
import { and, eq, inArray } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { printers, PRINTER_WIDTH_DOTS, SETTING_KEYS } from '#/infra/db/schema'
import type { SettingsService } from '#/domain/settings/settings.service'
import { Err } from '#/domain/shared/errors'
import type { InvoicePrinterAssignmentDto, PrinterDto } from '@sinshin/shared'
import {
  buildRasterJob,
  buildTestJob,
  cmdStatus,
  parseStatusPaper,
  parseStatusPrinter,
} from '#/domain/print/escpos'

/** TTL کشِ probe — مودال با هر بازشدن لیست را می‌خواهد؛ چاپگر اذیت نمی‌شود */
const PROBE_CACHE_TTL_MS = 8_000
const PROBE_CONNECT_TIMEOUT_MS = 900
const PRINT_CONNECT_TIMEOUT_MS = 3_000
const PRINT_WRITE_TIMEOUT_MS = 20_000
const MAX_RECEIPT_HEIGHT_DOTS = 4_000
const DISCOVER_CONCURRENCY = 64
const DISCOVER_PORT_TIMEOUT_MS = 350
const DISCOVER_MAX_HOSTS = 512
const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,63}$/

export interface ProbeResult {
  online: boolean
  /** «آنلاین» ولی بی‌پاسخِ وضعیت (بعضی فرم‌ورها DLE EOT نمی‌دهند) */
  detail: string | null
  paperEnd: boolean
  paperNearEnd: boolean
  offline: boolean
}

export class PrinterService {
  constructor(
    private readonly deps: { db: Db; settings: SettingsService },
  ) {}

  private readonly probeCache = new Map<string, { at: number; result: ProbeResult }>()

  // ── TCP خام — لایهٔ سوکتِ مشترکِ probe/چاپ ──

  /**
   * اتصال + نوشتنِ بایت‌ها + خواندنِ پاسخِ وضعیت (اگر باشد).
   * replyBytes=0 یعنی فقط بنویس و ببند. پاسخِ DLE EOT تا ۶۰۰ms جمع
   * می‌شود؛ بی‌پاسخی خطا نیست (بهترین تلاش).
   */
  private sendRaw(
    host: string,
    port: number,
    payload: Uint8Array,
    opts: { connectTimeoutMs: number; writeTimeoutMs?: number; collectReplyMs?: number },
  ): Promise<{ online: true; reply: Buffer | null } | { online: false; reason: string }> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const chunks: Buffer[] = []
      let settled = false
      let replyTimer: ReturnType<typeof setTimeout> | null = null
      let writeTimer: ReturnType<typeof setTimeout> | null = null
      const finish = (res: { online: true; reply: Buffer | null } | { online: false; reason: string }) => {
        if (settled) return
        settled = true
        if (replyTimer) clearTimeout(replyTimer)
        if (writeTimer) clearTimeout(writeTimer)
        socket.destroy()
        resolve(res)
      }
      socket.setTimeout(opts.connectTimeoutMs)
      socket.once('connect', () => {
        socket.setTimeout(0)
        if (payload.length > 0) {
          const written = socket.write(Buffer.from(payload), (err) => {
            if (err) finish({ online: false, reason: 'write-error' })
          })
          // مهلتِ کلِ نوشتن — چاپگرِ قفل‌شده write را برای همیشه معلق می‌کند
          writeTimer = setTimeout(
            () => finish({ online: false, reason: 'write-timeout' }),
            opts.writeTimeoutMs ?? 3_000,
          )
          if (!written) socket.once('drain', () => { if (writeTimer) clearTimeout(writeTimer) })
        }
        // جمعِ پاسخِ وضعیت — سکوتِ ۶۰۰ms = تمام
        const quiet = opts.collectReplyMs ?? 600
        const armQuiet = () => {
          if (replyTimer) clearTimeout(replyTimer)
          replyTimer = setTimeout(() => {
            finish({ online: true, reply: chunks.length ? Buffer.concat(chunks) : null })
          }, quiet)
        }
        socket.on('data', (d: Buffer) => {
          chunks.push(d)
          armQuiet()
        })
        armQuiet()
      })
      socket.once('timeout', () => finish({ online: false, reason: 'timeout' }))
      socket.once('error', (err: NodeJS.ErrnoException) => {
        finish({ online: false, reason: err.code ?? 'error' })
      })
      socket.once('close', () => {
        if (!settled) finish({ online: true, reply: chunks.length ? Buffer.concat(chunks) : null })
      })
      socket.connect(port, host)
    })
  }

  /** probe کامل: اتصال + DLE EOT 1 و 4 */
  private async probe(host: string, port: number): Promise<ProbeResult> {
    const res = await this.sendRaw(host, port, Buffer.concat([cmdStatus(1), cmdStatus(4)]), {
      connectTimeoutMs: PROBE_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: 1_500,
      collectReplyMs: 500,
    })
    if (!res.online) {
      return { online: false, detail: null, paperEnd: false, paperNearEnd: false, offline: false }
    }
    if (!res.reply || res.reply.length < 2) {
      return { online: true, detail: 'بدون پاسخ وضعیت', paperEnd: false, paperNearEnd: false, offline: false }
    }
    const st = parseStatusPrinter(res.reply[0] as number)
    const paper = parseStatusPaper(res.reply[1] as number)
    let detail: string | null = null
    if (paper.paperEnd) detail = 'کاغذ تمام شده است'
    else if (paper.paperNearEnd) detail = 'کاغذ رو به اتمام'
    else if (st.offline) detail = 'چاپگر آفلاین است'
    return { online: true, detail, ...paper, offline: st.offline }
  }

  // ── CRUD ──

  private toDto(row: typeof printers.$inferSelect, probe?: ProbeResult): PrinterDto {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      widthDots: row.widthDots,
      autoCut: row.autoCut,
      status: probe ? (probe.online ? 'online' : 'offline') : row.lastStatus === 'online' || row.lastStatus === 'offline' ? row.lastStatus : 'unknown',
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
        const status = p.online ? 'online' : 'offline'
        if (row.lastStatus !== status || row.lastStatusDetail !== p.detail) {
          await this.deps.db
            .update(printers)
            .set({ lastStatus: status, lastStatusDetail: p.detail, lastStatusAt: new Date() })
            .where(eq(printers.id, row.id))
        }
      }),
    )
    return rows.map((row, i) => this.toDto(row, probes[i] as ProbeResult))
  }

  private validateHost(host: string): string {
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
    const host = this.validateHost(input.host)
    const port = input.port ?? 9100
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw Err.validation('پورت چاپگر باید بین ۱ تا ۶۵۵۳۵ باشد (پیش‌فرض 9100).')
    }
    const widthDots = input.widthDots ?? 576
    if (!PRINTER_WIDTH_DOTS.includes(widthDots as (typeof PRINTER_WIDTH_DOTS)[number])) {
      throw Err.validation('عرض کاغذ چاپگر معتبر نیست (۵۷۶ dot برای ۸۰mm یا ۳۸۴ dot برای ۵۸mm).')
    }
    const dup = await this.deps.db
      .select({ id: printers.id })
      .from(printers)
      .where(and(eq(printers.host, host), eq(printers.port, port)))
      .limit(1)
    if (dup.length > 0) {
      throw Err.conflict('چاپگری با همین IP و پورت از قبل ثبت شده است.')
    }
    const [row] = await this.deps.db
      .insert(printers)
      .values({ name, host, port, widthDots, autoCut: input.autoCut ?? true })
      .returning()
    if (!row) throw Err.internal('ذخیرهٔ چاپگر ناموفق بود.')
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
    if (patch.host !== undefined) values.host = this.validateHost(patch.host)
    if (patch.port !== undefined) {
      if (!Number.isSafeInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
        throw Err.validation('پورت چاپگر باید بین ۱ تا ۶۵۵۳۵ باشد.')
      }
      values.port = patch.port
    }
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
    // پیش‌پروازِ کاغذ — سفارشِ چاپِ بی‌کاغذ همان لحظه خطای صریح می‌دهد
    const pre = await this.probe(row.host, row.port)
    if (!pre.online) {
      throw Err.validation(`چاپگر «${row.name}» (${row.host}:${row.port}) در شبکه در دسترس نیست.`)
    }
    if (pre.paperEnd) {
      throw Err.validation(`کاغذِ چاپگر «${row.name}» تمام شده است.`)
    }
    const job = buildRasterJob(widthPx, heightPx, new Uint8Array(rows), { autoCut: row.autoCut })
    const res = await this.sendRaw(row.host, row.port, job, {
      connectTimeoutMs: PRINT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: PRINT_WRITE_TIMEOUT_MS,
      collectReplyMs: 250,
    })
    if (!res.online) {
      throw Err.validation(`ارسال به چاپگر «${row.name}» ناموفق بود (${res.reason}).`)
    }
    return { bytes: job.length }
  }

  /** صفحهٔ تستِ اسکی — از همان سوکت؛ برایِ اطمینانِ اتصال/IP بدونِ مرورگر */
  async test(id: string): Promise<{ bytes: number }> {
    const [row] = await this.deps.db.select().from(printers).where(eq(printers.id, id))
    if (!row) throw Err.notFound('چاپگر پیدا نشد.')
    const job = buildTestJob({
      name: row.name,
      host: row.host,
      widthDots: row.widthDots,
      autoCut: row.autoCut,
    })
    const res = await this.sendRaw(row.host, row.port, job, {
      connectTimeoutMs: PRINT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs: PRINT_WRITE_TIMEOUT_MS,
      collectReplyMs: 250,
    })
    if (!res.online) {
      throw Err.validation(`ارسال به چاپگر «${row.name}» ناموفق بود (${res.reason}).`)
    }
    return { bytes: job.length }
  }

  // ── تشخیص: اسکنِ زیرشبکه ──

  /** CIDRهای پیش‌فرض — env PRINT_SCAN_CIDRS (جداشده با کاما) وگرنه
   *  زیرشبکه‌های کارت‌های شبکهٔ خودِ سرور (در docker bridge همان شبکهٔ
   *  داکر است — برایِ LAN رستوران env را تنظیم کنید؛ مستند در REFERENCE) */
  private defaultScanCidrs(): string[] {
    const raw = process.env.PRINT_SCAN_CIDRS?.trim()
    if (raw) {
      return raw
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .slice(0, 4)
    }
    const out = new Set<string>()
    for (const list of Object.values(os.networkInterfaces())) {
      for (const addr of list ?? []) {
        if (addr.family !== 'IPv4' || addr.internal) continue
        const ip = addr.address
        const m = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/)
        if (m) out.add(`${m[1] as string}.0/24`)
      }
    }
    return [...out].slice(0, 4)
  }

  /** اسکنِ پورت‌های 9100 و 631 روی یک CIDR — خروجی NAT داکر را عبور می‌کند */
  async discover(input: { cidr?: string }): Promise<{
    scanned: string[]
    found: Array<{ host: string; port: number }>
  }> {
    const cidrs = input.cidr?.trim() ? [input.cidr.trim()] : this.defaultScanCidrs()
    if (cidrs.length === 0) {
      throw Err.validation('بازهٔ اسکن مشخص نیست — CIDR را وارد کنید (مثلاً 192.168.1.0/24).')
    }
    const hosts: string[] = []
    for (const cidr of cidrs) hosts.push(...cidrHosts(cidr))
    if (hosts.length === 0) {
      throw Err.validation('بازهٔ اسکن معتبر نیست (مثال: 192.168.1.0/24).')
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
        for (const port of [9100, 631]) {
          const res = await this.sendRaw(host, port, new Uint8Array(0), {
            connectTimeoutMs: DISCOVER_PORT_TIMEOUT_MS,
            writeTimeoutMs: 200,
          })
          if (res.online) {
            found.push({ host, port })
            break // هر میزبان یک‌بار (پورتِ اولِ باز)
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(DISCOVER_CONCURRENCY, hosts.length) }, worker))
    return { scanned: cidrs, found }
  }
}

/** میزبان‌های یک CIDR (فقط /8../30 معقول؛ بزرگ‌تر رد) */
function cidrHosts(cidr: string): string[] {
  const m = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return []
  const base = [Number(m[1]), Number(m[2]), Number(m[3])] as const
  const prefix = Number(m[5])
  if (base.some((o) => !Number.isSafeInteger(o) || o < 0 || o > 255) || prefix < 8 || prefix > 30) {
    return []
  }
  const count = 2 ** (32 - prefix)
  if (count > DISCOVER_MAX_HOSTS) return []
  const baseNum = (base[0] << 24) | (base[1] << 16) | (base[2] << 8)
  const out: string[] = []
  for (let i = 1; i < count - 1; i++) {
    const n = (baseNum & (0xffffffff << (32 - prefix))) + i
    out.push(`${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`)
  }
  return out
}
