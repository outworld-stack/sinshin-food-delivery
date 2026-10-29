//src/domain/report/report-links.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

import type { AppConfig } from '#/infra/config/env'

/** رارد M13 — مقایسه‌ی زمان-ثابت برای توکن‌ها */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/**
 * توکن‌های امضاشده‌ی گزارش — دو خانواده:
 *
 * ۱) report: توکن ۲۴ کاراکتری پیامک روزانه/هفتگی با زمان صدور، عمر و نوع
 *    داخل امضا. لینک‌های کامل قدیمی r. تا پایان اعتبارشان پذیرفته می‌شوند.
 *
 * ۲) پنل: توکن scope-دار — «کی، چه صفحه‌ای، چه فیلترهایی»
 *    payload داخل امضا → لینک ادمین۲ بین افراد شیر نمی‌شود
 *
 * امن-۱: توکن پنل «منقضی‌شونده» است — exp (epoch ثانیه) داخل payload
 * امضا می‌شود. توکن‌های قدیمیِ بدون exp پس از این تغییر رد می‌شوند؛
 * لینک تازه از POST /reports/panel-link گرفته می‌شود.
 */
const PANEL_TOKEN_TTL_SECONDS = 24 * 60 * 60 // ۲۴ ساعت

export type ReportKind = 'daily' | 'weekly'

export interface ReportTokenDetails {
  kind: ReportKind
  issuedAt: number
  expiresAt: number
}

export class ReportLinks {
  constructor(private readonly config: AppConfig) {}

  private hash(payload: string): string {
    return new Bun.CryptoHasher('sha256')
      .update(`rpt:${payload}:${this.config.jwtSecret}`)
      .digest('hex')
      .slice(0, 32)
  }

  private encode(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64url')
  }

  private decode(s: string): string {
    return Buffer.from(s, 'base64url').toString('utf8')
  }

  // ── گزارش‌های پیامکی ──

  /** 18 bytes encode to 24 URL-safe characters, within SMS.ir's 25-character limit.
   * The timestamp, kind and TTL are authenticated; changing config cannot invalidate sent links.
   */
  reportToken(kind: ReportKind, iat = Math.floor(Date.now() / 1000)): string {
    if (!Number.isInteger(iat) || iat <= 0 || iat > 0xffffffff) {
      throw new Error('Invalid report issue time')
    }
    const configuredTtl = this.config.reports.tokenTtlHours
    const ttlHours = Number.isFinite(configuredTtl) && configuredTtl >= 1
      ? Math.min(0x7fff, Math.floor(configuredTtl)) : 24
    const payload = Buffer.alloc(6)
    payload.writeUInt32BE(iat, 0)
    payload.writeUInt16BE(ttlHours | (kind === 'weekly' ? 0x8000 : 0), 4)
    return Buffer.concat([payload, this.reportMac(payload)]).toString('base64url')
  }

  private reportMac(payload: Uint8Array): Buffer {
    return createHmac('sha256', this.config.jwtSecret)
      .update('sinshin-report-v2:').update(payload).digest().subarray(0, 12)
  }

  verifyReport(token: string): ReportKind | null {
    return this.verifyReportDetails(token)?.kind ?? null
  }

  verifyReportDetails(token: string): ReportTokenDetails | null {
    const now = Math.floor(Date.now() / 1000)
    if (/^[A-Za-z0-9_-]{24}$/.test(token)) {
      const bytes = Buffer.from(token, 'base64url')
      const payload = bytes.subarray(0, 6)
      if (!timingSafeEqual(bytes.subarray(6), this.reportMac(payload))) return null
      const issuedAt = payload.readUInt32BE(0)
      const packed = payload.readUInt16BE(4)
      const ttlHours = packed & 0x7fff
      const expiresAt = issuedAt + ttlHours * 3600
      if (!ttlHours || !issuedAt || issuedAt > now + 60 || expiresAt <= now) return null
      return { kind: packed & 0x8000 ? 'weekly' : 'daily', issuedAt, expiresAt }
    }

    // Keep unmodified, still-valid links sent before the compact format usable.
    const parts = token.split('.')
    if (parts.length !== 5 || parts[0] !== 'r') return null
    const kind = parts[1] === 'daily' || parts[1] === 'weekly' ? (parts[1] as ReportKind) : null
    if (!kind) return null
    const iat = Number(parts[2])
    const exp = Number(parts[3])
    if (!Number.isInteger(iat) || iat <= 0) return null
    if (!Number.isInteger(exp) || exp <= iat) return null
    if (iat > now + 60) return null
    if (exp <= now) return null
    const ttl = Math.max(1, Math.floor(this.config.reports.tokenTtlHours)) * 3600
    const legacy = `r.${kind}.${iat}.${iat + ttl}.${this.hash(`report:${kind}:${iat}`)}`
    if (!safeEqual(legacy, token)) return null
    return { kind, issuedAt: iat, expiresAt: exp }
  }

  /** ثانیه‌ی باقی‌مانده‌ی اعتبار توکن (برای هدر/لاگ) — منفی = منقضی */
  reportTokenTtlLeft(token: string): number {
    const details = this.verifyReportDetails(token)
    return details ? details.expiresAt - Math.floor(Date.now() / 1000) : -1
  }

  // ── پنل — scope-دار ──

  panelToken(scope: { page: string; userId?: string; filters?: Record<string, string> }): string {
    const payload = JSON.stringify({
      p: scope.page,
      u: scope.userId,
      f: scope.filters ?? {},
      // امن-۱: انقضا داخل امضا — لینک گزارش پنل دیگر دائمی نیست
      e: Math.floor(Date.now() / 1000) + PANEL_TOKEN_TTL_SECONDS,
    })
    return `p.${this.encode(payload)}.${this.hash(`panel:${payload}`)}`
  }

  verifyPanel(token: string): { page: string; userId?: string; filters: Record<string, string> } | null {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'p') return null
    try {
      const payload = this.decode(parts[1]!)
      if (this.hash(`panel:${payload}`) !== parts[2]) return null
      const parsed = JSON.parse(payload) as {
        p: string
        u?: string
        f?: Record<string, string>
        e?: unknown
      }
      // امن-۱: بدون exp (توکن قدیمی) یا منقضی → رد
      if (typeof parsed.e !== 'number' || !Number.isFinite(parsed.e) || parsed.e <= 0) return null
      if (parsed.e < Math.floor(Date.now() / 1000)) return null
      return { page: parsed.p, userId: parsed.u, filters: parsed.f ?? {} }
    } catch {
      return null
    }
  }

  url(path: string): string {
    return `${this.config.siteUrl}${path}`
  }
}
