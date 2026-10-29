// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/report.routes.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر فاز-۲: توکن‌های r. + مسیر /download/:token (بسته‌ی ZIP)
// ═══════════════════════════════════════════════════════════════

// src/http/routes/report.routes.ts
import { Elysia, t } from 'elysia'
import { html } from '@elysia/html'

import type { SessionService } from '#/domain/auth/session.service'
import type { ReportService } from '#/domain/report/report.service'
import type { ReportLinks } from '#/domain/report/report-links'
import { requireAdmin } from '#/http/hooks/require-auth'
import { ReportPage } from '#/http/templates/report'

export interface ReportRoutesDeps {
  sessions: SessionService
  reports: ReportService
  links: ReportLinks
}

export const reportRoutes = (deps: ReportRoutesDeps) => {
  // ── عمومی — توکن خودش گارد است (امضا + انقضا) ──
  const publicRoutes = new Elysia({ prefix: '/reports', tags: ['Reports'] })
    .use(html())

    .get(
      '/view/:token',
      async ({ params }) => {
        if (!deps.links.verifyReport(params.token)) return forbidden()
        const vm = await deps.reports.snapshotViewModel(params.token)
        if (!vm) return missingReport()
        return new Response(ReportPage(vm), {
          headers: { ...PRIVATE_REPORT_HEADERS, 'content-type': 'text/html; charset=utf-8' },
        })
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: {
          summary: 'Saved report page (signed expiring link from SMS)',
          description:
            'The report date and contents are fixed when the SMS is generated.',
        },
      },
    )

    .get(
      '/csv/:token',
      async ({ params }) => {
        const kind = deps.links.verifyReport(params.token)
        if (!kind) return forbidden()
        const csv = await deps.reports.snapshotCsv(params.token)
        if (csv === null) return missingReport()
        return new Response(csv, {
          headers: {
            ...PRIVATE_REPORT_HEADERS,
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="sinshin-${kind}-orders.csv"`,
            'content-length': String(Buffer.byteLength(csv, 'utf8')),
          },
        })
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: { summary: 'CSV export of orders (Excel-compatible, UTF-8 BOM)' },
      },
    )

    // ── فاز-۲ — بسته‌ی کامل قابل دانلود (ZIP) ──
    // روزانه: docker-logs + orders.csv + new-users.csv | هفتگی: orders + users
    // این همان لینکی است که قالب SMS.ir باید به آن اشاره کند:
    //   https://…/api/reports/download/#TOKEN#
    .get(
      '/download/:token',
      async ({ params }) => {
        if (!deps.links.verifyReport(params.token)) return forbidden()
        const snapshot = await deps.reports.downloadSnapshot(params.token)
        if (!snapshot) return missingReport()
        return new Response(snapshot.bytes as unknown as ArrayBuffer, {
          headers: {
            ...PRIVATE_REPORT_HEADERS,
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${snapshot.filename}"`,
            'content-length': String(snapshot.bytes.byteLength),
          },
        })
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: {
          summary: 'Download full report bundle (ZIP)',
          description:
            'daily: docker-logs.txt + orders.csv + new-users.csv + summary.txt | weekly: orders.csv + users.csv + summary.txt. Downloads the saved archive associated with this expiring SMS token.',
        },
      },
    )

  // ── محافظت‌شده ──
  const guarded = new Elysia({ prefix: '/reports', tags: ['Reports'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/send/:kind',
      async ({ params }) => {
        // فاز-۲ — همان جریان کامل کرون (روزانه شامل جمع‌آوری+پاک‌سازی لاگ داکر)
        const result =
          params.kind === 'daily'
            ? await deps.reports.runDailyFlow()
            : await deps.reports.runWeeklyFlow()
        return {
          success: true,
          token: result.token,
          smsSent: result.smsOk,
          ...(params.kind === 'daily' && 'logs' in result ? { logs: result.logs } : {}),
        }
      },
      {
        params: t.Object({ kind: t.Union([t.Literal('daily'), t.Literal('weekly')]) }),
        detail: {
          summary: 'Manually run report flow + SMS (admin only)',
          description:
            'Generate and verify a saved ZIP before sending its short token to the main administrators. Daily reports also archive Docker logs.',
        },
      },
    )

    .post(
      '/panel-link',
      ({ user, body }) => ({
        success: true,
        url: deps.links.url(
          `/api/reports/panel/${deps.links.panelToken({
            page: body.page,
            userId: user.role === 'admin2' ? user.id : body.userId,
            filters: body.filters,
          })}`,
        ),
      }),
      {
        body: t.Object({
          page: t.String({ maxLength: 40 }),
          userId: t.Optional(t.String({ maxLength: 40 })),
          filters: t.Optional(t.Record(t.String(), t.String())),
        }),
        detail: {
          summary: 'Create a scoped live-report link (admin / admin2)',
          description:
            'Token embeds page+user+filters in the signature — links cannot be shared across admins. ' +
            'امن-۱: token expires 24h after creation; expired or old-format (no-expiry) tokens are rejected.',
        },
      },
    )

  return new Elysia().use(publicRoutes).use(guarded)
}

export function forbidden(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'FORBIDDEN', message: 'لینک گزارش نامعتبر یا منقضی شده است.' } }),
    { status: 403, headers: { ...PRIVATE_REPORT_HEADERS, 'content-type': 'application/json; charset=utf-8' } },
  )
}

const PRIVATE_REPORT_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
} as const

function missingReport(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'NOT_FOUND', message: 'فایل گزارش در دسترس نیست؛ گزارش تازه‌ای از پنل مدیریت درخواست کنید.' } }),
    { status: 404, headers: { ...PRIVATE_REPORT_HEADERS, 'content-type': 'application/json; charset=utf-8' } },
  )
}
