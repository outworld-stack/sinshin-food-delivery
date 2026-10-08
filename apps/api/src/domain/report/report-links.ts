//src/domain/report/report-links.ts
import { timingSafeEqual } from 'node:crypto'

import type { AppConfig } from '#/infra/config/env'

/** رارد M13 — مقایسه‌ی زمان‌ثابت برای توکن‌ها */
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
 * ۱) cron: گزارش روزانه/هفتگی — توکن ثابت per-kind (مثل قبل)
 * ۲) پنل: توکن scope-دار — «کی، چه صفحه‌ای، چه فیلترهایی»
 *    payload داخل امضا → لینک ادمین۲ بین افراد شیر نمی‌شود
 *
 * امن-۱: توکن پنل «منقضی‌شونده» است — exp (epoch ثانیه) داخل payload
 * امضا می‌شود. توکن‌های قدیمیِ بدون exp پس از این تغییر رد می‌شوند؛
 * لینک تازه از POST /reports/panel-link گرفته می‌شود.
 */
const PANEL_TOKEN_TTL_SECONDS = 24 * 60 * 60 // ۲۴ ساعت

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

  // ── زمان‌بند ──

  // رارد M13 — توکن کرون قبلاً «بدون تاریخ» بود: یک‌بار لو رفت = برای همیشه.
  // حالا iat (epoch) داخل توکن + انقضای ۴۸ ساعت + مقایسه‌ی زمان‌ثابت.
  cronToken(kind: 'daily' | 'weekly', iat = Math.floor(Date.now() / 1000)): string {
    return `c.${kind}.${iat}.${this.hash(`cron:${kind}:${iat}`)}`
  }

  verifyCron(token: string): 'daily' | 'weekly' | null {
    const parts = token.split('.')
    if (parts.length !== 4 || parts[0] !== 'c') return null
    const kind = parts[1] === 'daily' || parts[1] === 'weekly' ? parts[1] : null
    if (!kind) return null
    const iat = Number(parts[2])
    if (!Number.isInteger(iat) || iat <= 0) return null
    // رارد M13 — انقضای ۴۸ ساعت؛ توکن کهنه رد
    if (Date.now() / 1000 - iat > 48 * 3600) return null
    if (!safeEqual(this.cronToken(kind, iat), token)) return null
    return kind
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