// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 4 از 17
// مسیر مقصد: apps/api/src/http/routes/geo.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/geo.routes.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱/round-37)
// تغییر فاز-۲: پروکسی سرویس‌های نشان (reverse / route / matrix)
// ═══════════════════════════════════════════════════════════════

// src/http/routes/geo.routes.ts
import { Elysia, t } from 'elysia'

import type { GeoGateVerdict } from '@sinshin/shared'
import type { GeoService } from '#/domain/geo/geo.service'
import type { SessionService } from '#/domain/auth/session.service'
import type { RedisService } from '#/infra/redis/redis'
import type { NeshanService } from '#/infra/maps/neshan.service'
import { requireAdmin, requireAuth } from '#/http/hooks/require-auth'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'

export interface GeoRoutesDeps {
  geo: GeoService
  sessions: SessionService
  redis: RedisService
  /** فاز-۲ — سرویس‌های REST نشان */
  neshan: NeshanService
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

  // ── فاز-۲ — پروکسی سرویس‌های نشان (requireAuth: سهمیه API محافظت می‌شود) ──
  const COORD_RE = '^-?\\d{1,3}(\\.\\d{1,7})?$'

  const userRoutes = new Elysia({ prefix: '/geo', tags: ['Geo'] })
    .use(requireAuth(deps.sessions))
    .get(
      '/reverse',
      async ({ query }) => {
        const res = await deps.neshan.reverseGeocode(Number(query.lat), Number(query.lng))
        if (!res) return { available: false }
        return {
          available: true,
          address: res.formattedAddress,
          routeName: res.routeName,
          neighbourhood: res.neighbourhood,
          city: res.city,
          municipalityZone: res.municipalityZone,
          inTrafficZone: res.inTrafficZone,
          inOddEvenZone: res.inOddEvenZone,
        }
      },
      {
        query: t.Object({
          lat: t.String({ pattern: COORD_RE }),
          lng: t.String({ pattern: COORD_RE }),
        }),
        beforeHandle: [
          ipRateLimit({ redis: deps.redis, scope: 'geo-reverse', limit: 120, windowSeconds: 60 }),
        ],
        detail: {
          summary: 'Reverse geocode (Neshan) — تبدیل مختصات به آدرس',
          description:
            'فاز-۲ — پروکسی سروریِ /v5/reverse نشان با کلید service (کلید در باندل وب نیست). پاسخ available=false یعنی نشان خاموش/خطا — فرانت فرم دستی را نشان می‌دهد.',
        },
      },
    )
    .get(
      '/route',
      async ({ query }) => {
        const origin = parsePair(query.from)
        const dest = parsePair(query.to)
        if (!origin || !dest) return { available: false }
        const route = await deps.neshan.routeNoTraffic(origin, dest)
        if (!route) {
          // fallback — فاصله‌ی هوایی؛ فرانت خط مستقیم می‌کشد
          return {
            available: false,
            fallback: {
              distanceMeters: deps.neshan.haversineMeters(origin, dest),
              straightLine: true,
            },
          }
        }
        return {
          available: true,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          summary: route.summary,
          polyline: route.overviewPolyline,
        }
      },
      {
        query: t.Object({
          from: t.String({ minLength: 5, maxLength: 40 }),
          to: t.String({ minLength: 5, maxLength: 40 }),
        }),
        beforeHandle: [
          ipRateLimit({ redis: deps.redis, scope: 'geo-route', limit: 60, windowSeconds: 60 }),
        ],
        detail: {
          summary: 'Route (Neshan no-traffic) — مسیر + polyline',
          description:
            'فاز-۲ — پروکسی /v4/direction/no-traffic. available=false + fallback = فاصله‌ی هوایی (هیورساین)؛ نقشه خط مستقیم می‌کشد.',
        },
      },
    )
    .get(
      '/distance-matrix',
      async ({ query }) => {
        const origins = query.origins.split('|').map(parsePair)
        const destinations = query.destinations.split('|').map(parsePair)
        if (origins.some((p) => !p) || destinations.some((p) => !p)) {
          return { available: false }
        }
        const matrix = await deps.neshan.distanceMatrix(
          origins.filter((p): p is { lat: number; lng: number } => p !== null),
          destinations.filter((p): p is { lat: number; lng: number } => p !== null),
          { type: query.type === 'motorcycle' ? 'motorcycle' : 'car', traffic: query.traffic === 'true' },
        )
        if (!matrix) return { available: false }
        return { available: true, rows: matrix }
      },
      {
        query: t.Object({
          origins: t.String({ minLength: 5, maxLength: 500 }),
          destinations: t.String({ minLength: 5, maxLength: 500 }),
          type: t.Optional(t.String()),
          traffic: t.Optional(t.String()),
        }),
        beforeHandle: [
          ipRateLimit({ redis: deps.redis, scope: 'geo-matrix', limit: 30, windowSeconds: 60 }),
        ],
        detail: {
          summary: 'Distance matrix (Neshan) — فاصله/زمان جاده‌ای بین نقاط',
          description:
            'فاز-۲ — پروکسی /v1/distance-matrix (با/بدون ترافیک). سقف ۱۰×۱۰ نقطه در سرویس.',
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

  return new Elysia().use(publicRoutes).use(userRoutes).use(adminRoutes)
}

/** «lat,lng» → {lat,lng} | null — پارسر امن کوئری */
const parsePair = (s: string): { lat: number; lng: number } | null => {
  const parts = s.split(',')
  if (parts.length !== 2) return null
  const la = Number(parts[0])
  const ln = Number(parts[1])
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null
  return { lat: la, lng: ln }
}
