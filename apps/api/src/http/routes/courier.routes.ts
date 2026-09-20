// src/http/routes/courier.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { CourierService } from '#/domain/courier/courier.service'
import type { RedisService } from '#/infra/redis/redis'
import { requireAdmin2Permission } from '#/http/hooks/require-admin2'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'

const DISPLAY_PATTERN = '^ord-[a-z0-9]{8}$'
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface CourierRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  couriers: CourierService
  redis: RedisService // ← phase-1: rate-limit روت‌های عمومی پیک
}

export const courierRoutes = (deps: CourierRoutesDeps) => {
  // ══ سمت پیک — عمومی؛ توکن/OTP خودش گارد است — ولی حالا با سقف IP ══
  // phase-1: قبلاً این روت‌ها بدون هیچ rate-limit ای بودند
  const publicCourier = new Elysia({ prefix: '/courier', tags: ['Courier'] })

    .post(
      '/otp/request',
      ({ body }) => deps.couriers.requestOtp(body.phone),
      {
        body: t.Object({ phone: t.String({ pattern: '^09[0-9]{9}$' }) }),
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'courier-otp-request',
          limit: 10,
          windowSeconds: 60,
        }),
        detail: {
          summary: 'Courier OTP (for QR-auth orders)',
          description:
            'Only registered courier phones. IP: 10/min. Per-phone: 60s cooldown, 5/hour. Code TTL 2min, max 5 verify attempts.',
        },
      },
    )

    .post(
      '/otp/verify',
      ({ body }) => deps.couriers.verifyOtp(body.phone, body.code),
      {
        body: t.Object({
          phone: t.String({ pattern: '^09[0-9]{9}$' }),
          code: t.String({ minLength: 4, maxLength: 4 }),
        }),
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'courier-otp-verify',
          limit: 30,
          windowSeconds: 60,
        }),
        detail: { summary: 'Verify courier OTP → 1-hour courier token' },
      },
    )

    .post(
      '/scan/:displayId',
      ({ params, body }) =>
        deps.couriers.scanArrival(params.displayId, body?.courierToken ?? null),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        body: t.Optional(
          t.Object({ courierToken: t.Optional(t.String({ maxLength: 64 })) }),
        ),
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'courier-scan',
          limit: 60,
          windowSeconds: 60,
        }),
        detail: {
          summary: 'Scan QR — arrival → ON_THE_WAY',
          description:
            'Default: no auth (open scan). securityEnabled orders require a courierToken matching the assigned courier.',
        },
      },
    )

    .post(
      '/orders/:displayId/location',
      ({ headers, params, body }) =>
        deps.couriers.updateLocation(
          (headers['x-courier-token'] as string | undefined) ?? body.courierToken ?? '',
          params.displayId,
          body.lat,
          body.lng,
        ),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        body: t.Object({
          courierToken: t.Optional(t.String({ maxLength: 64 })),
          lat: t.Number({ minimum: -90, maximum: 90 }),
          lng: t.Number({ minimum: -180, maximum: 180 }),
        }),
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'courier-loc',
          limit: 60,
          windowSeconds: 60,
        }),
        detail: {
          summary: 'Stream courier location (server-throttled 3s)',
          description:
            'Requires courier token. Only ON_THE_WAY orders with trackingEnabled (snapshotted at checkout).',
        },
      },
    )

  // ══ سمت پنل — phase-1: permission واقعی به‌جای «فقط role» ══
  // (قبلاً هر admin2 می‌توانست پیک اضافه کند — couriersWrite چک نمی‌شد)
  // نکته: read و write در دو instance جداوند چون .use وسط زنجیره به روت‌های
  // «بعدی» نشت می‌کند (همان درسی که تو ip-rate-limit نوشتی) — این‌طوری هر
  // گروه فقط permission خودش را می‌گیرد.
  const adminCourierRead = new Elysia({ prefix: '/admin/couriers', tags: ['Admin / Couriers'] })
    .use(requireAdmin2Permission({ sessions: deps.sessions, admin2: deps.admin2 }, 'couriersRead'))
    .get('/', () => deps.couriers.listCouriers(), {
      detail: { summary: 'List couriers (couriersRead)' },
    })
    .get(
      '/:id',
      ({ params, user }) =>
        deps.couriers.courierDetail(params.id, user.role === 'admin2' ? user.id : undefined),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary: 'Courier detail — trips + deliveries (couriersRead)',
          description:
            'Main admin sees everything. Level-2 admin sees only deliveries of orders they confirmed.',
        },
      },
    )

  const adminCourierWrite = new Elysia({ prefix: '/admin/couriers', tags: ['Admin / Couriers'] })
    .use(requireAdmin2Permission({ sessions: deps.sessions, admin2: deps.admin2 }, 'couriersWrite'))
    .post(
      '/',
      ({ body }) => deps.couriers.addCourier(body),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          phone: t.String({ pattern: '^09[0-9]{9}$' }),
        }),
        detail: { summary: 'Add courier (couriersWrite) — phone becomes the OTP identity' },
      },
    )

  return new Elysia().use(publicCourier).use(adminCourierRead).use(adminCourierWrite)
}