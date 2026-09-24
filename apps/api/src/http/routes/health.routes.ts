//src/http/routes/health.routes.ts
import { Elysia } from 'elysia'

import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { UploadService } from '#/infra/uploads/upload.service'
import type { AppConfig } from '#/infra/config/env'
import type { MetricsService } from '#/infra/monitor/metrics'
import type { JobRunRegistry } from '#/infra/monitor/job-registry'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { SessionService } from '#/domain/auth/session.service'
import type { SystemMetricsDto } from '@sinshin/shared'
import { requireAdmin } from '#/http/hooks/require-auth'
import { probe } from '#/infra/health/probes'

export interface HealthDeps {
  db: Database
  redis: RedisService
  /** round-16 — پوشهٔ آپلود قابل نوشتن است؟ (خطای mkdir بوت) */
  uploads: UploadService
  config: AppConfig
  startedAt: number
  /** round-18 — مانیتورینگ */
  sessions: SessionService
  metrics: MetricsService
  jobRuns: JobRunRegistry
  sseHub: SseHub
}

/** round-19 — probe به infra/health/probes.ts منتقل شد (مشترک با job هشدار) */

export const healthRoutes = (deps: HealthDeps) =>
  new Elysia({ prefix: '/health', tags: ['Health'] })
    .get(
      '/',
      async ({ set }) => {
        const { dbUp, dbMs, redisUp, redisMs } = await probe(deps.db, deps.redis)
        const uploadsUp = deps.uploads.storageReady
        const ok = dbUp && redisUp && uploadsUp
        if (!ok) set.status = 503
        return {
          status: ok ? 'ok' : 'degraded',
          env: deps.config.env,
          checks: { database: dbUp, redis: redisUp, uploads: uploadsUp },
          // round-18 — افزایشی؛ مصرف‌کننده‌های موجود فقط status HTTP را می‌بینند
          latencyMs: { database: dbMs, redis: redisMs },
          uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
        }
      },
      {
        detail: {
          summary: 'Readiness — postgres + redis + uploads',
          description: 'Degrades to 503 so Caddy/compose pull the replica out of rotation.',
        },
      },
    )
    .get(
      '/live',
      () => ({
        status: 'alive',
        uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
      }),
      { detail: { summary: 'Liveness — process only, no dependency checks' } },
    )
    // round-18 — اسنپ‌شات کامل فقط برای ادمین اصلی؛ بعد از این use ثبت می‌شود
    .use(requireAdmin(deps.sessions))
    .get(
      '/metrics',
      async (): Promise<SystemMetricsDto> => {
        const { process, http } = deps.metrics.snapshot()
        const { dbUp, dbMs, redisUp, redisMs } = await probe(deps.db, deps.redis)
        const usage = await deps.uploads.usage()
        return {
          status: dbUp && redisUp && usage !== null ? 'ok' : 'degraded',
          env: deps.config.env,
          uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
          generatedAt: new Date().toISOString(),
          process,
          http,
          deps: {
            database: { ok: dbUp, latencyMs: dbMs },
            redis: { ok: redisUp, latencyMs: redisMs },
            uploads: {
              ok: usage !== null,
              files: usage?.files ?? null,
              totalMB:
                usage === null ? null : Math.round((usage.totalBytes / 1048576) * 10) / 10,
              capped: usage?.capped ?? false,
            },
          },
          sse: deps.sseHub.stats(),
          jobs: deps.jobRuns.snapshot(),
        }
      },
      {
        detail: {
          summary: 'Metrics snapshot — process, http, deps, sse, jobs',
          description:
            'Main admin only. In-process counters (no external collector): request/error rates, latency percentiles, event-loop lag, memory, dependency ping latencies, upload disk usage, SSE fan-out size and last run of every scheduled job.',
        },
      },
    )
