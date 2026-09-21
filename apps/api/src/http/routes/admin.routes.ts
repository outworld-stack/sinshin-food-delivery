// src/http/routes/admin.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { DeviceService } from '#/domain/device/device.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { requireAdmin2, requireAdmin2Permission } from '#/http/hooks/require-admin2'
import type { AdminService } from '#/domain/admin/admin.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { Err } from '#/domain/shared/errors'
import { asUserId } from '#/domain/shared/brand'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface AdminRoutesDeps {
  sessions: SessionService
  devices: DeviceService
  admin: AdminService
  admin2: Admin2Service
  /** stage-10: لاگ ممیزی — عملیات حساس ادمین */
  audit: AuditService
}

export const adminRoutes = (deps: AdminRoutesDeps) => {
  const guards = { sessions: deps.sessions, admin2: deps.admin2 }

  // ═══ core — فقط ادمین اصلی: devices / stats ═══
  const core = new Elysia({ prefix: '/admin', tags: ['Admin'] })
    .use(requireAdmin(deps.sessions))

    .get(
      '/devices',
      ({ query }) =>
        deps.devices.listDevices({
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          blocked: query.blocked === undefined ? undefined : query.blocked === 'true',
          minRisk: query.minRisk ?? undefined,
        }),
      {
        query: t.Object({
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
          search: t.Optional(t.String({ maxLength: 40 })),
          blocked: t.Optional(t.String()),
          minRisk: t.Optional(t.Numeric({ minimum: 0, maximum: 100 })),
        }),
        detail: { summary: 'List devices (anti-fraud dashboard)' },
      },
    )
    .get(
      '/devices/:id',
      ({ params }) => deps.devices.getDeviceDetail(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Device detail — identities, events, similarity links' },
      },
    )
    .post(
      '/devices/:id/block',
      ({ params, body, user }) =>
        deps.devices.setBlocked(params.id, body.blocked, body.reason ?? null, user.phone),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ blocked: t.Boolean(), reason: t.Optional(t.String({ maxLength: 120 })) }),
        detail: { summary: 'Block / unblock a device (revokes its sessions)' },
      },
    )
    .get(
      '/stats',
      () => deps.admin.getAdminStats(),
      { detail: { summary: 'Admin dashboard stats — users, revenue, chart, recent' } },
    )

  // ═══ phase-3.5: کاربران — خواندن (usersRead) ═══
  const usersRead = new Elysia({ prefix: '/admin', tags: ['Admin'] })
    .use(requireAdmin2Permission(guards, 'usersRead'))
    .get(
      '/users',
      ({ query }) =>
        deps.admin.getAdminUsers({
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          device: query.device || undefined,
          status: query.status || undefined,
          sorts: query.sorts ? JSON.parse(query.sorts) : undefined,
        }),
      {
        query: t.Object({
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
          search: t.Optional(t.String({ maxLength: 40 })),
          device: t.Optional(t.String()),
          status: t.Optional(t.String()),
          sorts: t.Optional(t.String()),
        }),
        detail: { summary: 'Admin users — paginated, filterable, sortable (usersRead)' },
      },
    )
    .get(
      '/users/:id',
      ({ params }) => deps.admin.getAdminUserDetails(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'User details (usersRead)' },
      },
    )

  // ═══ phase-3.5: کاربران — نوشتن (usersWrite) ═══
  const usersWrite = new Elysia({ prefix: '/admin', tags: ['Admin'] })
    .use(requireAdmin2Permission(guards, 'usersWrite'))
    .post(
      '/users/:id/toggle',
      async ({ params, user }) => {
        // stage-10: ادمین اصلی خودش را غیرفعال نکند — گارد سروری
        // (آیکون فرانت هم disable می‌شود؛ این لایه‌ی دوم است)
        if (user.role === 'admin' && user.id === params.id) {
          throw Err.forbidden('ادمین اصلی نمی‌تواند حساب خودش را غیرفعال کند.')
        }
        await deps.admin.toggleUserStatus(params.id, user.role)
        await deps.audit.log({
          actorId: user.id,
          action: 'USER_TOGGLE',
          entity: 'user',
          entityId: params.id,
          userId: params.id,
        })
        return { success: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary: 'Toggle user active/suspended (usersWrite)',
          description: 'Main admin self-toggle rejected (403). Main-admin accounts cannot be suspended at all.',
        },
      },
    )
    .patch(
      '/users/:id',
      ({ params, body, user }) => deps.admin.updateAdminUser(params.id, body, user.role),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          firstName: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          lastName: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          email: t.Optional(t.Nullable(t.String({ maxLength: 120, format: 'email' }))),
          phone: t.Optional(t.String({ maxLength: 15 })),
          referralCode: t.Optional(t.String({ maxLength: 16 })),
        }),
        detail: { summary: 'Update user name/email/phone/referralCode (phone+referral: main admin only)' },
      },
    )
    .delete(
      '/users/:id/devices/:deviceId',
      async ({ params }) => {
        // revokeIdentity مالکیت را با phone چک می‌کند — همان موتور self-service
        const phone = await deps.admin.getUserPhone(params.id)
        if (!phone) throw Err.notFound('کاربر پیدا نشد.')
        const ok = await deps.devices.revokeIdentity(
          asUserId(params.id),
          phone,
          params.deviceId,
        )
        if (!ok) throw Err.notFound('دستگاهی با این شناسه برای این کاربر پیدا نشد.')
        return { ok: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }), deviceId: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Terminate one of user devices (usersWrite)' },
      },
    )
    .delete(
      '/users/:id/addresses/:addressId',
      ({ params }) => deps.admin.deleteUserAddress(params.id, params.addressId),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }), addressId: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete user address (usersWrite) — orders keep snapshot' },
      },
    )

  // ═══ سفارشات — ادمین اصلی + ادمین۲ (scope خودکار) ═══
  const ordersRoutes = new Elysia({ prefix: '/admin', tags: ['Admin'] })
    .use(requireAdmin2(guards))
    .get(
      '/orders',
      ({ query, user }) =>
        deps.admin.getAdminOrders({
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          status: query.status || undefined,
          sortDate: query.sortDate || undefined,
          sortAmount: query.sortAmount || undefined,
          confirmedBy:
            user.role === 'admin2' ? user.id : query.confirmedBy || undefined,
          courierId: query.courierId || undefined,
        }),
      {
        query: t.Object({
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
          search: t.Optional(t.String({ maxLength: 40 })),
          status: t.Optional(t.String()),
          sortDate: t.Optional(t.String({ maxLength: 10 })),
          sortAmount: t.Optional(t.String({ maxLength: 10 })),
          confirmedBy: t.Optional(t.String({ maxLength: 40 })),
          courierId: t.Optional(t.String({ maxLength: 40 })),
        }),
        detail: { summary: 'Admin orders — sortable/filterable; admin2 auto-scoped to own' },
      },
    )

  return new Elysia().use(core).use(usersRead).use(usersWrite).use(ordersRoutes)
}