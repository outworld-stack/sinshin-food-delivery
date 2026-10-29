// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/infra/logs/docker-logs.service.ts
// ═══════════════════════════════════════════════════════════════

// src/infra/logs/docker-logs.service.ts
/**
 * جمع‌آوری لاگ‌های داکر برای گزارش روزانه روی volume پایدار.
 *
 * معماری (بدون docker CLI — فقط HTTP روی سوکت):
 *  • /var/run/docker.sock به کانتینر api مونت می‌شود (compose) و
 *    Bun.fetch با گزینه‌ی unix روی همان سوکت حرف می‌زند.
 *  • «لاگ‌های امروز» = از آخرین جمع‌آوری موفق (marker روی volume)
 *    تا الان — marker فقط بعد از ذخیره بسته و ارسال پیامک جلو می‌رود.
 *    فایل زنده لاگ دست‌نخورده می‌ماند؛ داکر با تنظیم rotation آن را نگه می‌دارد.
 *
 * متد قدیمی پاک‌سازی (truncate، دیگر از جریان گزارش فراخوانی نمی‌شود):
 *  • docker.sock حذفِ تاریخ-محور لاگ ندارد؛ فایل‌های json-file روی
 *    میزبان‌اند. برای پاک‌سازیِ امن، یک کانتینر «کمکی» یک‌بارمصرف از
 *    «همان ایمیج api» ساخته می‌شود که /var/lib/docker/containers میزبان را
 *    read-write مونت می‌کند و فقط `truncate -s 0` روی فایل‌های لاگ می‌زند؛
 *    بعد از خروج خودکار حذف می‌شود (AutoRemove).
 *  • ⚠️ سطح دسترسی: docker.sock = ریشه‌ی میزبان. این سرویس فقط در
 *    محیطِ تک‌سرورِ خودمدیریتی با سوکت مونت‌شده فعال است؛ اگر سوکت نبود
 *    یا DOCKER_LOGS_ENABLED=off بود، همه‌چیز بی‌صدا skip می‌شود —
 *    گزارش روزانه بدون فایل لاگ ولی کامل ارسال می‌شود.
 *
 * ضد-کرش:
 *  • هیچ متدی هرگز throw نمی‌کند؛ خروجی همیشه «چیزی که شد» است.
 *  • هر مرحله timeout مستقل دارد؛ خطای یک کانتینر بقیه را نمی‌اندازد.
 *  • سوکت غایب/بی‌دسترسی → { collected: false } و ادامه‌ی سیستم عادی.
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import type { AppConfig } from '#/infra/config/env'

/** پیشوند نام کانتینر کمکی truncate — برای شناسایی/فیلتر */
const HELPER_PREFIX = 'sinshin-log-truncate-'

/** پوشه‌ی آرشیو روی volume آپلود (دوام = بین ری‌استارت‌ها) */
const ARCHIVE_DIRNAME = '.reports'

export interface DockerLogCollectResult {
  /** آیا جمع‌آوری انجام شد (سوکت در دسترس بود) */
  collected: boolean
  /** تعداد کانتینرهایی که لاگشان گرفته شد */
  containers: number
  /** نام کانتینرهایی که skip شدند (بدون شکست کل) */
  skipped: string[]
  /** از چه زمانی جمع شد */
  since: Date
  until: Date
  /** مسیر فایل آرشیو (اگر collected) */
  archivePath: string | null
  /** تعداد بایت لاگ */
  bytes: number
}

export interface DockerTruncateResult {
  /** آیا truncate انجام شد */
  done: boolean
  /** کانتینرهایی که فایلشان truncate شد */
  truncated: string[]
  /** علت skip — برای لاگ */
  note: string
}

interface DockerContainerSummary {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
}

interface DockerContainerInspect {
  Id: string
  LogPath?: string
  Config?: { Image?: string }
}

export class DockerLogsService {
  constructor(private readonly config: AppConfig, private readonly fetcher: typeof Bun.fetch = Bun.fetch) {}

  private get enabled(): boolean {
    return this.config.reports.dockerLogsEnabled
  }

  private get socket(): string {
    return this.config.reports.dockerSocket
  }

  /** فراخوانی Docker Engine API روی سوکت یونیکس */
  private async dockerApi<T>(path: string, init?: RequestInit & { timeoutMs?: number; responseType?: 'arrayBuffer' }): Promise<T | null> {
    try {
      const { timeoutMs, responseType, ...request } = init ?? {}
      const res = await this.fetcher(`http://docker.local${path}`, {
        ...request,
        // Bun — گزینه‌ی unix: سوکت را جایگزین TCP می‌کند
        unix: this.socket,
        signal: AbortSignal.timeout(timeoutMs ?? 8_000),
      } as Parameters<typeof Bun.fetch>[1])
      if (!res.ok) return null
      if (responseType === 'arrayBuffer') return await res.arrayBuffer() as T
      return (await res.json().catch(() => null)) as T | null
    } catch {
      return null
    }
  }

  private archiveDir(): string {
    return join(this.config.uploadDir, ARCHIVE_DIRNAME)
  }

  /** تاریخ آخرین جمع‌آوری موفق — null = اولین بار (از ۲۴ ساعت قبل شروع کن) */
  readMarker(): Date | null {
    try {
      const raw = readFileSync(join(this.archiveDir(), 'last-docker-log-collect'), 'utf8').trim()
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? null : d
    } catch {
      return null
    }
  }

  private writeMarker(now: Date): void {
    const temporary = join(this.archiveDir(), `last-docker-log-collect.${crypto.randomUUID()}.tmp`)
    try {
      mkdirSync(this.archiveDir(), { recursive: true, mode: 0o700 })
      writeFileSync(temporary, now.toISOString(), { mode: 0o600 })
      renameSync(temporary, join(this.archiveDir(), 'last-docker-log-collect'))
    } catch (err) {
      console.error('[docker-logs] نوشتن marker ناموفق:', err)
    } finally {
      try { rmSync(temporary) } catch { /* No temporary marker remains after a successful rename. */ }
    }
  }

  /** لیست کانتینرهای در حال اجرا — نام‌های کوتاه (بدون /) */
  async listContainers(): Promise<DockerContainerSummary[]> {
    const list = await this.dockerApi<DockerContainerSummary[]>('/containers/json?all=0')
    if (!list) return []
    // کانتینر کمکیِ truncate خودش را جمع نکن
    return list.filter((c) => !c.Names.some((n) => n.startsWith(`/${HELPER_PREFIX}`)))
  }

  /**
   * جمع‌آوری لاگ‌های همه‌ی کانتینرها از «since» تا الان + آرشیو در فایل.
   * هرگز throw نمی‌کند. سقف: logsMaxMb به‌ازای کل خروجی (دم تاکِ هر
   * کانتینر نگه داشته می‌شود — جدیدترین لاگ مهم‌ترین است).
   */
  async collectAndArchive(sinceOverride?: Date): Promise<DockerLogCollectResult> {
    const collectedUntil = new Date()
    const since = sinceOverride ?? this.readMarker() ?? new Date(Date.now() - 24 * 3600_000)
    const empty: DockerLogCollectResult = {
      collected: false, containers: 0, skipped: [], since, until: collectedUntil, archivePath: null, bytes: 0,
    }
    if (!this.enabled) {
      empty.skipped.push('DOCKER_LOGS_ENABLED=off')
      return empty
    }

    const containers = await this.listContainers()
    if (containers.length === 0) {
      empty.skipped.push('docker-socket-unreachable')
      return empty
    }

    const sinceEpoch = Math.floor(since.getTime() / 1000)
    const maxBytes = Math.max(1, this.config.reports.logsMaxMb) * 1024 * 1024
    const parts: string[] = []
    let totalBytes = 0
    const skipped: string[] = []

    for (const c of containers) {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12)
      try {
        const raw = await this.dockerApi<ArrayBuffer | null>(
          `/containers/${c.Id}/logs?stdout=1&stderr=1&timestamps=1&since=${sinceEpoch}&follow=false`,
          { timeoutMs: 15_000, responseType: 'arrayBuffer' },
        )
        if (raw === null) {
          skipped.push(name)
          continue
        }
        const demux = demuxDockerStream(new Uint8Array(raw))
        if (demux.length === 0) {
          // لاگ خالی در این بازه — طبیعی است (مثلاً backup یک‌بارمصرف)
          parts.push(`\n════ ${name} (${c.Image}) — لاگی از ${since.toISOString()} تا الان نیست ════\n`)
          continue
        }
        // سقف سراسری — دم کانتینر را نگه دار
        let text = demux
        if (totalBytes + Buffer.byteLength(text, 'utf8') > maxBytes) {
          const room = Math.max(0, maxBytes - totalBytes)
          if (room < 1024) {
            skipped.push(`${name} (سقف حجم)`)
            continue
          }
          text = Buffer.from(text, 'utf8').subarray(-room).toString('utf8')
          text = `[... لاگ این کانتینر برای جا شدن در سقف ${this.config.reports.logsMaxMb}MB بریده شد — فقط انتهای آن]\n` + text
          skipped.push(`${name} (لاگ ناقص به‌علت سقف حجم)`)
        }
        parts.push(`\n════ ${name} (${c.Image}) — از ${since.toISOString()} ════\n${text}`)
        totalBytes += Buffer.byteLength(text, 'utf8')
      } catch (err) {
        console.error(`[docker-logs] کانتینر ${name} skip شد:`, err)
        skipped.push(name)
      }
    }

    const tehranDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const header =
      `# لاگ‌های داکر سین‌شین — ${tehranDay}\n` +
      `# بازه: ${since.toISOString()} تا ${new Date().toISOString()}\n` +
      `# کانتینرها: ${containers.length} (${skipped.length} skip)\n` +
      `# لاگ‌های سرور با چرخش استاندارد داکر نگهداری می‌شوند و هنگام تهیه گزارش پاک نمی‌شوند.\n`

    let archivePath: string | null = null
    let temporary: string | null = null
    try {
      mkdirSync(this.archiveDir(), { recursive: true, mode: 0o700 })
      // Unique source archive avoids a manual rerun overwriting logs referenced by an in-flight report.
      archivePath = join(this.archiveDir(), `daily-logs-${tehranDay}-${crypto.randomUUID()}.txt`)
      temporary = `${archivePath}.tmp`
      writeFileSync(temporary, header + parts.join(''), { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, archivePath)
    } catch (err) {
      console.error('[docker-logs] نوشتن آرشیو ناموفق:', err)
      archivePath = null
      skipped.push('archive-write-failed')
    } finally {
      if (temporary) { try { rmSync(temporary) } catch { /* Already published or not written. */ } }
    }

    // پاک‌سازی آرشیوهای قدیمی — ۳ روز آخر بمانَد (لینک ۲۴ ساعته است)
    this.pruneOldArchives(3)

    return {
      collected: archivePath !== null,
      containers: containers.length - skipped.length,
      skipped,
      since,
      until: collectedUntil,
      archivePath,
      bytes: totalBytes,
    }
  }

  /** Advance only after the containing report is durable and its SMS has succeeded. */
  completeCollection(result: DockerLogCollectResult): void {
    if (result.collected && result.archivePath && result.skipped.length === 0) this.writeMarker(result.until)
  }

  /** حذف آرشیوهای قدیمی‌تر از N روز */
  private pruneOldArchives(keepDays: number): void {
    try {
      const cutoff = Date.now() - keepDays * 86400_000
      for (const f of readdirSync(this.archiveDir())) {
        if (!f.startsWith('daily-logs-')) continue
        const p = join(this.archiveDir(), f)
        if (statSync(p).mtimeMs < cutoff) {
          try { rmSync(p) } catch { /* هیچ‌کاری نمی‌کند */ }
        }
      }
    } catch {
      /* پوشه نیست — بی‌خیال */
    }
  }

  /** مسیر آرشیو روزِ تهرانِ «امروز» — برای بسته‌ی ZIP */
  todayArchivePath(): string {
    return this.archivePathFor(new Date())
  }

  /** Legacy report links retain the log archive belonging to their issue date. */
  archivePathFor(date: Date): string {
    const tehranDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date)
    const legacy = join(this.archiveDir(), `daily-logs-${tehranDay}.txt`)
    try {
      const latest = readdirSync(this.archiveDir())
        .filter((name) => name.startsWith(`daily-logs-${tehranDay}-`) && name.endsWith('.txt'))
        .map((name) => ({ name, time: statSync(join(this.archiveDir(), name)).mtimeMs }))
        .sort((a, b) => b.time - a.time)[0]
      return latest ? join(this.archiveDir(), latest.name) : legacy
    } catch {
      return legacy
    }
  }

  /** محتوای آرشیو (اگر هست) — null = نبود (لینک دیر باز شده) */
  readArchive(path: string): string | null {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * Truncate فایل‌های لاگ کانتینرها روی میزبان — کانتینر کمکی یک‌بارمصرف.
   * هرگز throw نمی‌کند؛ نتیجه فقط برای لاگ است.
   */
  async truncateAll(): Promise<DockerTruncateResult> {
    if (!this.enabled) {
      return { done: false, truncated: [], note: 'DOCKER_LOGS_ENABLED=off' }
    }
    if (!this.config.reports.dockerLogsTruncate) {
      return { done: false, truncated: [], note: 'DOCKER_LOGS_TRUNCATE=off' }
    }

    const containers = await this.listContainers()
    if (containers.length === 0) {
      return { done: false, truncated: [], note: 'docker-socket-unreachable' }
    }

    // مسیر فایل لاگ هر کانتینر (روی میزبان) + کانتینرهای بدون json-file
    const logPaths: string[] = []
    const withPaths: string[] = []
    let driverSkip = 0
    for (const c of containers) {
      const inspect = await this.dockerApi<DockerContainerInspect>(`/containers/${c.Id}/json`)
      const lp = inspect?.LogPath
      if (!lp || !lp.startsWith('/var/lib/docker/containers/')) {
        driverSkip++
        continue
      }
      logPaths.push(lp)
      withPaths.push(c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12))
    }
    if (logPaths.length === 0) {
      return {
        done: false,
        truncated: [],
        note: `no-json-file-logs (${driverSkip} کانتینر با درایور غیر json-file یا LogPath نامشخص)`,
      }
    }

    // کانتینر کمکی: همان ایمیج api (همیشه locally موجود؛ بدون pull)
    const created = await this.createHelperContainer(logPaths)
    if (!created) {
      return { done: false, truncated: withPaths, note: 'helper-container-create-failed' }
    }
    return { done: true, truncated: withPaths, note: `helper ${created}` }
  }

  /**
   * ساخت + استارت کانتینر کمکی truncate (AutoRemove).
   * Cmd فقط فایل‌های داده‌شده را صفر می‌کند — هیچ چیز دیگری لمس نمی‌شود.
   */
  private async createHelperContainer(hostLogPaths: string[]): Promise<string | null> {
    const name = `${HELPER_PREFIX}${Date.now()}`
    // خود ایمیج api — از HOSTNAME (شناسه‌ی کانتینر خودمان) استخراج می‌شود
    const selfId = Bun.env.HOSTNAME ?? ''
    let image = 'sinshin/api'
    if (selfId) {
      const self = await this.dockerApi<DockerContainerInspect>(`/containers/${selfId}/json`)
      if (self?.Config?.Image) image = self.Config.Image
    }

    const shell =
      'set -e; ' +
      hostLogPaths
        .map((p) => `truncate -s 0 "${p.replace('/var/lib/docker/containers/', '/hostlogs/')}" 2>/dev/null || true;`)
        .join(' ')

    try {
      const res = await this.fetcher('http://docker.local/containers/create?name=' + name, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          Image: image,
          Cmd: ['sh', '-c', shell],
          Labels: { 'sinshin.role': 'log-truncate' },
          HostConfig: {
            AutoRemove: true,
            Binds: ['/var/lib/docker/containers:/hostlogs'],
            // بدون شبکه — کارش فقط فایل است
            NetworkMode: 'none',
          },
        }),
        unix: this.socket,
        signal: AbortSignal.timeout(10_000),
      } as Parameters<typeof Bun.fetch>[1])
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.error(`[docker-logs] ساخت کانتینر کمکی ناموفق (${res.status}): ${text.slice(0, 300)}`)
        return null
      }
      const start = await this.fetcher(`http://docker.local/containers/${name}/start`, {
        method: 'POST',
        unix: this.socket,
        signal: AbortSignal.timeout(10_000),
      } as Parameters<typeof Bun.fetch>[1])
      if (!start.ok && start.status !== 304) {
        console.error(`[docker-logs] استارت کانتینر کمکی ناموفق (${start.status})`)
        return null
      }
      return name
    } catch (err) {
      console.error('[docker-logs] کانتینر کمکی truncate ناموفق:', err)
      return null
    }
  }
}

/**
 * جداکردن استریم لاگ داکر — فریم‌های [type(1) 0(3) size(4)][payload].
 * (TTY=false همیشه این قالب را برمی‌گرداند.)
 */
export function demuxDockerStream(buf: Uint8Array): string {
  if (buf.length === 0) return ''
  // TTY responses contain plain text; multiplexed Docker frames start with a stream identifier.
  if (buf[0]! > 3) return new TextDecoder().decode(buf)
  const decoders = new Map<number, TextDecoder>()
  const chunks: string[] = []
  let pos = 0
  while (pos < buf.length) {
    if (buf.length - pos < 8) throw new Error('Truncated Docker log frame header')
    const stream = buf[pos]!
    if (stream > 2 || buf[pos + 1] !== 0 || buf[pos + 2] !== 0 || buf[pos + 3] !== 0) {
      throw new Error('Invalid Docker log frame header')
    }
    const size =
      (buf[pos + 4]! * 0x1000000) +
      (buf[pos + 5]! * 0x10000) +
      (buf[pos + 6]! * 0x100) +
      buf[pos + 7]!
    pos += 8
    if (size > buf.length - pos) throw new Error('Truncated Docker log frame payload')
    // stdout/stderr may interleave while a UTF-8 character spans two frames of the same stream.
    let decoder = decoders.get(stream)
    if (!decoder) {
      decoder = new TextDecoder()
      decoders.set(stream, decoder)
    }
    chunks.push(decoder.decode(buf.subarray(pos, pos + size), { stream: true }))
    pos += size
  }
  for (const decoder of decoders.values()) chunks.push(decoder.decode())
  return chunks.join('')
}
