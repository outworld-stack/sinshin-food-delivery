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
      async ({ params, query }) => {
        const kind = deps.links.verifyReport(params.token)
        if (!kind) return forbidden()
        const vm =
          kind === 'daily'
            ? await deps.reports.dailyViewModel(query.range === 'today' ? 'today' : 'yesterday')
            : await deps.reports.weeklyViewModel()
        // phase-4: JSX → سازنده‌ی رشته؛ html() برای رشته‌ی content-type ست می‌کند
        return ReportPage(vm)
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: {
          summary: 'Live HTML report page (signed expiring link from SMS)',
          description:
            'فاز-۲: توکن‌های خانواده‌ی r. (امضاشده + منقضی‌شونده REPORT_TOKEN_TTL_HOURS). توکن‌های قدیمی c. دیگر معتبر نیستند — عمدی.',
        },
      },
    )

    .get(
      '/csv/:token',
      async ({ params, query }) => {
        const kind = deps.links.verifyReport(params.token)
        if (!kind) return forbidden()
        const range = kind === 'weekly' ? 'week' : query.range === 'today' ? 'today' : 'yesterday'
        const csv = await deps.reports.csvBody(range as 'yesterday')
        return new Response(csv, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="sinshin-${kind}-orders.csv"`,
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
      async ({ params, query }) => {
        const kind = deps.links.verifyReport(params.token)
        if (!kind) return forbidden()
        const zip =
          kind === 'daily'
            ? await deps.reports.dailyBundle(query.range === 'today' ? 'today' : 'yesterday')
            : await deps.reports.weeklyBundle()
        const tehranDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date())
        return new Response(zip as unknown as ArrayBuffer, {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="sinshin-${kind}-report-${tehranDay}.zip"`,
            // لینک منقضی‌شونده است — کش نکند
            'cache-control': 'no-store',
          },
        })
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: {
          summary: 'Download full report bundle (ZIP)',
          description:
            'daily: docker-logs.txt + orders.csv + new-users.csv + summary.txt | weekly: orders.csv + users.csv + summary.txt. Signed expiring token (r-family).',
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
            'daily flow: collect docker logs → archive → truncate → sign token → SMS admins (TOKEN only). weekly flow: sign token → SMS.',
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
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
}
