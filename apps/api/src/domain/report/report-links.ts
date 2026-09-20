//src/domain/report/report-links.ts
import type { AppConfig } from '#/infra/config/env'

/**
 * توکن‌های امضاشده‌ی گزارش — دو خانواده:
 *
 * ۱) cron: گزارش روزانه/هفتگی — توکن ثابت per-kind (مثل قبل)
 * ۲) پنل: توکن scope-دار — «کی، چه صفحه‌ای، چه فیلترهایی»
 *    payload داخل امضا → لینک ادمین۲ بین افراد شیر نمی‌شود
 */
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

  // ── cron ──

  cronToken(kind: 'daily' | 'weekly'): string {
    return `c.${kind}.${this.hash(`cron:${kind}`)}`
  }

  verifyCron(token: string): 'daily' | 'weekly' | null {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'c') return null
    if (this.cronToken(parts[1] as 'daily') === token) return parts[1] as 'daily'
    return null
  }

  // ── پنل — scope-دار ──

  panelToken(scope: { page: string; userId?: string; filters?: Record<string, string> }): string {
    const payload = JSON.stringify({ p: scope.page, u: scope.userId, f: scope.filters ?? {} })
    return `p.${this.encode(payload)}.${this.hash(`panel:${payload}`)}`
  }

  verifyPanel(token: string): { page: string; userId?: string; filters: Record<string, string> } | null {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'p') return null
    try {
      const payload = this.decode(parts[1]!)
      if (this.hash(`panel:${payload}`) !== parts[2]) return null
      const parsed = JSON.parse(payload) as { p: string; u?: string; f?: Record<string, string> }
      return { page: parsed.p, userId: parsed.u, filters: parsed.f ?? {} }
    } catch {
      return null
    }
  }

  url(path: string): string {
    return `${this.config.siteUrl}${path}`
  }
}