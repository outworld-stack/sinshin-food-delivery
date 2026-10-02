// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 4 از 17
// مسیر مقصد: apps/api/src/http/routes/geo.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// src/http/routes/geo.routes.ts
import { Elysia, t } from 'elysia'

import type { GeoGateVerdict } from '@sinshin/shared'
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
 *
 * round-37 — /geo/gate علاوه بر blocked، «mode» هم برمی‌گرداند تا لایه‌ی SSR
 * بداند کاربر را به کدام پیام بفرستد (فقط ایران / ایران+عراق).
 */
export const geoRoutes = (deps: GeoRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/geo', tags: ['Geo'] })
    .get(
      '/gate',
      // رارد ۴۶ — پاسخ با قرارداد مشترک GeoGateVerdict annotate شد (همان
      // شکل قبلی — قبلاً بی‌نام بود و فرانت کپی خودش را داشت)
      async ({ query }): Promise<GeoGateVerdict> => ({
        blocked: await deps.geo.shouldBlock(query.ip),
        /** round-37 — iran-only | iran-iraq | world (برای پیام صفحه‌ی مسدود) */
        mode: await deps.geo.accessMode(),
      }),
      {
        query: t.Object({
          ip: t.String({ minLength: 3, maxLength: 45, pattern: IP_PATTERN }),
        }),
        beforeHandle: [
          // عمومی و بدون auth — سقف IP لازم است (CGNAT را در نظر بگیر: سخاوتمند)
          ipRateLimit({ redis: deps.redis, scope: 'geo-gate', limit: 240, windowSeconds: 60 }),
        ],
        detail: {
          summary: 'Geo gate — is this IP blocked? + current access mode',
          description:
            'Used by the web SSR layer. Internal/private IPs and GEO_BYPASS_IPS are always allowed. round-37: mode = iran-only | iran-iraq | world — the blocked page picks its message from it.',
        },
      },
    )

  const adminRoutes = new Elysia({ prefix: '/geo', tags: ['Geo'] })
    .use(requireAdmin(deps.sessions))
    .get('/status', () => deps.geo.status(), {
      detail: {
        summary: 'Geo service status (main admin only)',
        description:
          'round-37 — per-country prefixes (iran/iraq), access mode, outside scope, source and bypass count for the settings page card.',
      },
    })

  return new Elysia().use(publicRoutes).use(adminRoutes)
}