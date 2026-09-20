//src/workers/jobs/reconcile.job.ts
import type { AppConfig } from '#/infra/config/env'
import type { Db } from '#/infra/db/client'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'
import type { DailyJob } from '#/workers/scheduler'

/**
 * مغایرت‌گیری مالی — ۰۳:۰۰ تهران.
 * Flags per-check در env (RECONCILE_AUTO_R1 و ...) — پیش‌فرض همه report-only.
 */
export class ReconcileJob implements DailyJob {
  readonly name = 'reconcile'
  readonly time = '03:00'
  readonly catchUp = true

  constructor(
    private readonly deps: { config: AppConfig; db: Db; reconcile: ReconcileService },
  ) {}

  async run(): Promise<void> {
    const report = await this.deps.reconcile.run()
    await this.deps.reconcile.persistFindings(report)

    const lines = report.checks.map(
      (c) => `${c.checkId}: ${c.findings.length} finding(s)${c.wouldFix > 0 ? `, would-fix=${c.wouldFix}` : ''}`,
    )
    console.log(`[cron:reconcile] ${report.totalOpen} open — ${lines.join(' | ')}`)

    const crit = report.checks.find((c) => c.severity === 'critical' && c.findings.length > 0)
    if (crit) {
      console.warn('[cron:reconcile] CRITICAL findings present — check admin panel')
    }
  }
}