//src/infra/health/probes.ts
import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'

/** نتیجهٔ probe با مدت‌اندیشی — منبع مشترک /health، /health/metrics و job هشدار */
export interface ProbeResult {
  dbUp: boolean
  dbMs: number
  redisUp: boolean
  redisMs: number
}

/**
 * round-19 — probe مشترک db+redis (قبلاً کپی خصوصیِ health.routes بود).
 * مسیرهای سلامت و job هشدارِ پیامک هر دو همین یک تابع را می‌سنجند تا
 * «آلارم» و «وضعیت گزارش‌شده» هرگز از هم واگرا نشوند (DRY).
 *
 * غیر-پرتاب: هر دو ping خطای خود را قورت می‌دهند (false برمی‌گردانند).
 */
export async function probe(db: Database, redis: RedisService): Promise<ProbeResult> {
  const timed = async (ping: () => Promise<boolean>): Promise<{ ok: boolean; ms: number }> => {
    const t0 = performance.now()
    const ok = await ping()
    return { ok, ms: Math.round(performance.now() - t0) }
  }
  const [database, redisProbe] = await Promise.all([
    timed(() => db.ping()),
    timed(() => redis.ping()),
  ])
  return { dbUp: database.ok, dbMs: database.ms, redisUp: redisProbe.ok, redisMs: redisProbe.ms }
}
