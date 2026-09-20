//src/http/routes/reconcile.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface ReconcileRoutesDeps {
  sessions: SessionService
  reconcile: ReconcileService
}

export const reconcileRoutes = (deps: ReconcileRoutesDeps) =>
  new Elysia({ prefix: '/admin/reconcile', tags: ['Admin / Reconcile'] })
    .use(requireAdmin(deps.sessions))

    .get(
      '/findings',
      ({ query }) =>
        deps.reconcile.listFindings({
          status: query.status || undefined,
          severity: query.severity || undefined,
          checkId: query.checkId || undefined,
        }),
      {
        query: t.Object({
          status: t.Optional(t.String({ maxLength: 20 })),
          severity: t.Optional(t.String({ maxLength: 12 })),
          checkId: t.Optional(t.String({ maxLength: 10 })),
        }),
        detail: { summary: 'Reconcile findings (filterable)' },
      },
    )

    .get('/summary', () => deps.reconcile.summary(), {
      detail: { summary: 'Open findings summary by check' },
    })

    .post(
      '/findings/:id/acknowledge',
      ({ params }) => deps.reconcile.acknowledge(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Acknowledge a finding (manual review done)' },
      },
    )

    .post(
      '/run',
      async () => {
        const report = await deps.reconcile.run()
        await deps.reconcile.persistFindings(report)
        return {
          ranAt: report.ranAt,
          totalOpen: report.totalOpen,
          checks: report.checks.map((c) => ({
            checkId: c.checkId,
            severity: c.severity,
            findings: c.findings.length,
            wouldFix: c.wouldFix,
          })),
        }
      },
      {
        detail: {
          summary: 'Run reconcile now (dry-run respects per-check flags)',
          description: 'R1 auto-fix only if RECONCILE_AUTO_R1=on. Default: report-only.',
        },
      },
    )