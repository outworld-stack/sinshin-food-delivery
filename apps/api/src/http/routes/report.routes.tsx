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
  // ── عمومی — توکن خودش گارد است ──
  const publicRoutes = new Elysia({ prefix: '/reports', tags: ['Reports'] })
    .use(html())

    .get(
      '/view/:token',
      async ({ params, query }) => {
        const kind = deps.links.verifyCron(params.token)
        if (!kind) return forbidden()
        const vm =
          kind === 'daily'
            ? await deps.reports.dailyViewModel(query.range === 'today' ? 'today' : 'yesterday')
            : await deps.reports.weeklyViewModel()
        // phase-4: JSX → string-builder؛ html() برای رشته content-type ست می‌کند
        return ReportPage(vm)
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: { summary: 'Live HTML report page (signed link from SMS)' },
      },
    )

    .get(
      '/csv/:token',
      async ({ params, query }) => {
        const kind = deps.links.verifyCron(params.token)
        if (!kind) return forbidden()
        const range = kind === 'weekly' ? 'week' : query.range === 'today' ? 'today' : 'yesterday'
        const csv = await deps.reports.csvBody(range as 'yesterday')
        return new Response(csv, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="sinshin-${kind}-report.csv"`,
          },
        })
      },
      {
        params: t.Object({ token: t.String({ maxLength: 400 }) }),
        query: t.Object({ range: t.Optional(t.String()) }),
        detail: { summary: 'CSV export (Excel-compatible, UTF-8 BOM)' },
      },
    )

  // ── محافظت‌شده ──
  const guarded = new Elysia({ prefix: '/reports', tags: ['Reports'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/send/:kind',
      async ({ params }) => {
        await deps.reports.smsReportLink(params.kind)
        return { success: true }
      },
      {
        params: t.Object({ kind: t.Union([t.Literal('daily'), t.Literal('weekly')]) }),
        detail: { summary: 'Manually generate + SMS report link (admin only)' },
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

function forbidden(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'FORBIDDEN', message: 'لینک گزارش نامعتبر است.' } }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
}