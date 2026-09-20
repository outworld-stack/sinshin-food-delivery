//src/http/routes/address.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { AddressService } from '#/domain/address/address.service'
import { Err } from '#/domain/shared/errors'
import { requireAuth } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface AddressRoutesDeps {
  sessions: SessionService
  addresses: AddressService
}

export const addressRoutes = (deps: AddressRoutesDeps) =>
  new Elysia({ prefix: '/addresses', tags: ['Address'] })
    .use(requireAuth(deps.sessions))

    .get('/', ({ user }) => deps.addresses.list(user.id), {
      detail: { summary: 'My addresses' },
    })

    .post(
      '/',
      ({ user, body }) => deps.addresses.create(user.id, body),
      {
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 60 }),
          address: t.String({ minLength: 1, maxLength: 500 }),
          lat: t.Number({ minimum: -90, maximum: 90 }),
          lng: t.Number({ minimum: -180, maximum: 180 }),
        }),
        detail: { summary: 'Create address' },
      },
    )

    .patch(
      '/:id',
      async ({ user, params, body }) => {
        const updated = await deps.addresses.update(user.id, params.id, body)
        if (!updated) throw Err.notFound('آدرسی با این شناسه برای شما پیدا نشد.')
        return updated
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 60 }),
          address: t.String({ minLength: 1, maxLength: 500 }),
          lat: t.Number({ minimum: -90, maximum: 90 }),
          lng: t.Number({ minimum: -180, maximum: 180 }),
        }),
        detail: { summary: 'Update address' },
      },
    )

    .delete(
      '/:id',
      async ({ user, params }) => {
        const ok = await deps.addresses.delete(user.id, params.id)
        if (!ok) throw Err.notFound('آدرسی با این شناسه برای شما پیدا نشد.')
        return { ok: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete address (orders keep address snapshots)' },
      },
    )