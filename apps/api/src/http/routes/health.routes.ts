//src/http/routes/health.routes.ts
import { Elysia } from 'elysia'

import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { UploadService } from '#/infra/uploads/upload.service'
import type { AppConfig } from '#/infra/config/env'

export interface HealthDeps {
  db: Database
  redis: RedisService
  /** round-16 — پوشهٔ آپلود قابل نوشتن است؟ (خطای mkdir بوت) */
  uploads: UploadService
  config: AppConfig
  startedAt: number
}

export const healthRoutes = (deps: HealthDeps) =>
  new Elysia({ prefix: '/health', tags: ['Health'] })
    .get(
      '/',
      async ({ set }) => {
        const [dbUp, redisUp] = await Promise.all([deps.db.ping(), deps.redis.ping()])
        const uploadsUp = deps.uploads.storageReady
        const ok = dbUp && redisUp && uploadsUp
        if (!ok) set.status = 503
        return {
          status: ok ? 'ok' : 'degraded',
          env: deps.config.env,
          checks: { database: dbUp, redis: redisUp, uploads: uploadsUp },
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