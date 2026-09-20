// src/http/routes/geo.routes.ts
import { Elysia, t } from 'elysia'

import type { GeoService } from '#/domain/geo/geo.service'
import type { SessionService } from '#/domain/auth/session.service'
import type { RedisService } from '#/infra/redis/redis'
import { requireAdmin } from '#/http/hooks/require-auth'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'

export interface GeoRoutesDeps {
  geo: GeoService
  sessions: SessionService
  redis: RedisService
}

const IP_PATTERN =
  '^(\\d{1,3}\\.){3}\\d{1,3}$|^([0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}$|^([0-9a-f]{1,4}:){1,7}:([0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}$'

/**
 * phase-fix — جغرافیا:
 *  /geo/gate?ip=  → عمومی؛ فرانت SSR می‌پرسد: «این IP مسدود است؟»
 *                   (خودِ API جداگانه با XFF خودش مسدود می‌کند)
 *  /geo/status    → فقط ادمین اصلی؛ وضعیت بازه‌ها برای صفحه تنظیمات
 */
export const geoRoutes = (deps: GeoRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/geo', tags: ['Geo'] })
    .get(
      '/gate',
      async ({ query }) => ({ blocked: await deps.geo.shouldBlock(query.ip) }),
      {
        query: t.Object({
          ip: t.String({ minLength: 3, maxLength: 45, pattern: IP_PATTERN }),
        }),
        beforeHandle: [
          // عمومی و بدون auth — سقف IP لازم است (CGNAT را در نظر بگیر: سخاوتمند)
          ipRateLimit({ redis: deps.redis, scope: 'geo-gate', limit: 240, windowSeconds: 60 }),
        ],
        detail: {
          summary: 'Geo gate — is this IP blocked by iran-only policy?',
          description:
            'Used by the web SSR layer. Internal/private IPs and GEO_BYPASS_IPS are always allowed.',
        },
      },
    )

  const adminRoutes = new Elysia({ prefix: '/geo', tags: ['Geo'] })
    .use(requireAdmin(deps.sessions))
    .get('/status', () => deps.geo.status(), {
      detail: { summary: 'Geo service status (main admin only)' },
    })

  return new Elysia().use(publicRoutes).use(adminRoutes)
}