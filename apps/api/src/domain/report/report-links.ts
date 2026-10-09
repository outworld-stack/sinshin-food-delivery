// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/report/report-links.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با M13)
// تغییر فاز-۲: خانواده‌ی cron → report (r.) با انقضای قابل‌تنظیم
// ═══════════════════════════════════════════════════════════════

//src/domain/report/report-links.ts
import { timingSafeEqual } from 'node:crypto'

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
 * ۱) report (فاز-۲، جایگزین cron): پیامک گزارش روزانه/هفتگی —
 *    امضاشده + منقضی‌شونده (REPORT_TOKEN_TTL_HOURS؛ پیش‌فرض ۲۴ ساعت)
 *    + iat برای ضد-بازی. پیامک فورواردشده دیگر لینک دائمی نیست.
 *    ⚠️ توکن‌های قدیمیِ خانواده‌ی c. (فاز-۱) دیگر معتبر نیستند —
 *    عمدی است (توکن ثابت روزانه/هفتگی حذف شد).
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

  // ── گزارش‌های پیامکی (فاز-۲ — r.) ──

  /**
   * توکن لینک گزارش — این تنها چیزی است که به SMS.ir می‌رود؛
   * URL کامل از قالب پنل SMS.ir ساخته می‌شود (#TOKEN#).
   * TTL از کانفیگ: REPORT_TOKEN_TTL_HOURS (پیش‌فرض ۲۴).
   */
  reportToken(kind: ReportKind, iat = Math.floor(Date.now() / 1000)): string {
    const ttl = Math.max(1, Math.floor(this.config.reports.tokenTtlHours)) * 3600
    // exp داخل امضا — تاییدِ انقضا حین verify
    return `r.${kind}.${iat}.${iat + ttl}.${this.hash(`report:${kind}:${iat}`)}`
  }

  /**
   * اعتبار توکن گزارش — امضا + ساختار + انقضا (زمان-ثابت).
   * iat در آینده (> ۶۰s) هم رد می‌شود (ساعتِ کج).
   */
  verifyReport(token: string): ReportKind | null {
    const parts = token.split('.')
    if (parts.length !== 5 || parts[0] !== 'r') return null
    const kind = parts[1] === 'daily' || parts[1] === 'weekly' ? (parts[1] as ReportKind) : null
    if (!kind) return null
    const iat = Number(parts[2])
    const exp = Number(parts[3])
    if (!Number.isInteger(iat) || iat <= 0) return null
    if (!Number.isInteger(exp) || exp <= iat) return null
    const now = Math.floor(Date.now() / 1000)
    if (iat > now + 60) return null
    if (exp < now) return null
    if (!safeEqual(this.reportToken(kind, iat), token)) return null
    return kind
  }

  /** ثانیه‌ی باقی‌مانده‌ی اعتبار توکن (برای هدر/لاگ) — منفی = منقضی */
  reportTokenTtlLeft(token: string): number {
    const parts = token.split('.')
    const exp = Number(parts[3])
    return Number.isInteger(exp) ? exp - Math.floor(Date.now() / 1000) : -1
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
