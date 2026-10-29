import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReportKind } from '#/domain/report/report-links'
import type { ReportViewModel } from '#/http/templates/report'

interface ArchiveMetadata {
  version: 1
  kind: ReportKind
  issuedAt: number
  expiresAt: number
  filename: string
  from: string
  to: string
  sha256: Record<'report.zip' | 'orders.csv' | 'view.json', string>
}

export interface ReportArchive {
  kind: ReportKind
  issuedAt: number
  expiresAt: number
  filename: string
  from: string
  to: string
  bytes: Uint8Array
  ordersCsv: string
  viewModel: ReportViewModel
}

export interface ReportPublication {
  archive: ReportArchive
  created: boolean
}

const FILES = ['report.zip', 'orders.csv', 'view.json', 'manifest.json'] as const
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const errorCode = (error: unknown) => (error as { code?: string } | null)?.code

/** Private, immutable snapshots on the uploads volume; public image routes cannot serve this directory. */
export class ReportArchiveStore {
  private readonly dir: string

  constructor(uploadDir: string) {
    this.dir = join(uploadDir, '.reports', 'bundles')
  }

  async read(token: string): Promise<ReportArchive | null> {
    const dir = join(this.dir, digest(token))
    let manifest: string
    try {
      manifest = await readFile(join(dir, 'manifest.json'), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
    const meta = JSON.parse(manifest) as ArchiveMetadata
    if (meta.version !== 1 || !['daily', 'weekly'].includes(meta.kind) ||
      !Number.isSafeInteger(meta.issuedAt) || !Number.isSafeInteger(meta.expiresAt) ||
      meta.expiresAt <= meta.issuedAt || !/^sinshin-(daily|weekly)-report-[\d_-]+\.zip$/.test(meta.filename)) {
      throw new Error('Invalid report archive metadata')
    }
    const [bytes, ordersCsv, viewJson] = await Promise.all([
      readFile(join(dir, 'report.zip')),
      readFile(join(dir, 'orders.csv'), 'utf8'),
      readFile(join(dir, 'view.json'), 'utf8'),
    ])
    if (bytes.length <= 22 || bytes.readUInt32LE(0) !== 0x04034b50 ||
      digest(bytes) !== meta.sha256?.['report.zip'] ||
      digest(ordersCsv) !== meta.sha256?.['orders.csv'] ||
      digest(viewJson) !== meta.sha256?.['view.json']) {
      throw new Error('Report archive integrity check failed')
    }
    return { ...meta, bytes, ordersCsv, viewModel: JSON.parse(viewJson) as ReportViewModel }
  }

  async publish(token: string, archive: ReportArchive): Promise<ReportPublication> {
    const existing = await this.read(token)
    if (existing) return { archive: existing, created: false }
    if (archive.bytes.length <= 22 || new DataView(archive.bytes.buffer, archive.bytes.byteOffset).getUint32(0, true) !== 0x04034b50) {
      throw new Error('Cannot publish an empty or invalid ZIP report')
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const temp = join(this.dir, `.tmp-${randomUUID()}`)
    const target = join(this.dir, digest(token))
    await mkdir(temp, { mode: 0o700 })
    const viewJson = JSON.stringify(archive.viewModel)
    const meta: ArchiveMetadata = {
      version: 1, kind: archive.kind, issuedAt: archive.issuedAt, expiresAt: archive.expiresAt,
      filename: archive.filename, from: archive.from, to: archive.to,
      sha256: { 'report.zip': digest(archive.bytes), 'orders.csv': digest(archive.ordersCsv), 'view.json': digest(viewJson) },
    }
    try {
      for (const [name, data] of [
        ['report.zip', archive.bytes], ['orders.csv', archive.ordersCsv],
        ['view.json', viewJson], ['manifest.json', JSON.stringify(meta)],
      ] as const) {
        const file = await open(join(temp, name), 'wx', 0o600)
        try {
          await file.writeFile(data)
          await file.sync()
        } finally {
          await file.close()
        }
      }
      let created = false
      try {
        // An existing nonempty directory cannot be replaced: simultaneous jobs reuse the first snapshot.
        await rename(temp, target)
        created = true
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(errorCode(error) ?? '')) throw error
        const winner = await this.read(token)
        if (!winner) throw error
      }
      const saved = await this.read(token)
      if (!saved) throw new Error('Report archive was not published')
      return { archive: saved, created }
    } finally {
      await this.removeDirectory(temp)
    }
  }

  async pruneExpired(now = Math.floor(Date.now() / 1000)): Promise<void> {
    try {
      for (const entry of await readdir(this.dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (/^\.tmp-[a-f0-9-]{36}$/.test(entry.name)) {
          const dir = join(this.dir, entry.name)
          if ((await lstat(dir)).mtimeMs < now * 1000 - 86400_000) await this.removeDirectory(dir)
          continue
        }
        if (!/^[a-f0-9]{64}$/.test(entry.name)) continue
        const dir = join(this.dir, entry.name)
        try {
          const meta = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as ArchiveMetadata
          if (Number.isSafeInteger(meta.expiresAt) && meta.expiresAt < now) await this.removeDirectory(dir)
        } catch {
          // Unreadable archives are retained for diagnosis, never silently removed.
        }
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') console.warn('[reports] expired archive cleanup failed')
    }
  }

  private async removeDirectory(dir: string): Promise<void> {
    // Callers only supply our generated child directories. No recursive delete or symlink traversal.
    try {
      if (!(await lstat(dir)).isDirectory()) return
      for (const name of FILES) await unlink(join(dir, name)).catch(() => {})
      await rmdir(dir)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') console.warn('[reports] temporary archive cleanup failed')
    }
  }
}
