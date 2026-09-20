//src/http/routes/admin2.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface Admin2RoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  settings: SettingsService
}

export const admin2Routes = (deps: Admin2RoutesDeps) =>
  new Elysia({ prefix: '/admin/admins', tags: ['Admin / Admin2'] })
    .use(requireAdmin(deps.sessions))

    // ── لیست/جزئیات (پنل ادمین اصلی) ──
    .get('/', () => deps.admin2.list(), {
      detail: { summary: 'List level-2 admins (with scopes + permissions)' },
    })

    .get(
      '/:id',
      ({ params }) => deps.admin2.detail(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Level-2 admin detail' },
      },
    )

    .get(
      '/:id/activities',
      ({ params, query }) =>
        deps.admin2.activities({
          adminUserId: params.id,
          action: query.action || undefined,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
          page: query.page,
          limit: query.limit,
        }),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        query: t.Object({
          action: t.Optional(t.String({ maxLength: 30 })),
          from: t.Optional(t.String({ maxLength: 30 })),
          to: t.Optional(t.String({ maxLength: 30 })),
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
        }),
        detail: { summary: 'Activity log — full audit with filters' },
      },
    )

    .get(
      '/:id/sessions',
      ({ params }) => deps.admin2.sessions(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Login sessions (presence report)' },
      },
    )

    // ── افزودن ──
    .post(
      '/',
      ({ body }) =>
        deps.admin2.add({
          phone: body.phone,
          firstName: body.firstName,
          lastName: body.lastName,
          scopeHall: body.scope === 'hall' || body.scope === 'both',
          scopeTakeaway: body.scope === 'takeaway' || body.scope === 'both',
        }),
      {
        body: t.Object({
          phone: t.String({ pattern: '^09[0-9]{9}$' }),
          firstName: t.String({ minLength: 1, maxLength: 60 }),
          lastName: t.String({ minLength: 1, maxLength: 60 }),
          /** hall | takeaway | both */
          scope: t.Union([t.Literal('hall'), t.Literal('takeaway'), t.Literal('both')]),
        }),
        detail: {
          summary: 'Add level-2 admin with scope',
          description:
            'Scope: hall = DINE_IN only, takeaway = DELIVERY+PICKUP only, both = all. Upgrade path: existing plain users are promoted.',
        },
      },
    )

    // ── permissions ──
    .patch(
      '/:id/permissions',
      ({ params, body }) => deps.admin2.setPermissions(params.id, body),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          scopeHall: t.Optional(t.Boolean()),
          scopeTakeaway: t.Optional(t.Boolean()),
          productsRead: t.Optional(t.Boolean()),
          productsWrite: t.Optional(t.Boolean()),
          usersRead: t.Optional(t.Boolean()),
          usersWrite: t.Optional(t.Boolean()),
          couriersRead: t.Optional(t.Boolean()),
          couriersWrite: t.Optional(t.Boolean()),
          mainCategoriesRead: t.Optional(t.Boolean()),
          mainCategoriesWrite: t.Optional(t.Boolean()),
          orderDetailsRead: t.Optional(t.Boolean()),
          canToggleTemporaryClose: t.Optional(t.Boolean()),
          canEditPackagingFee: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Update scopes and permissions' },
      },
    )

    .post('/:id/toggle', ({ params }) => deps.admin2.toggleActive(params.id), {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Enable/disable level-2 admin' },
    })