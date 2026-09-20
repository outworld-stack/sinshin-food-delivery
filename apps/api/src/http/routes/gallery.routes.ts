import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { GalleryService } from '#/domain/gallery/gallery.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface GalleryRoutesDeps {
  sessions: SessionService
  gallery: GalleryService
}

export const galleryRoutes = (deps: GalleryRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/gallery', tags: ['Gallery'] })
    .get('/', () => deps.gallery.listPublic(), {
      detail: { summary: 'Active gallery images (public, sorted)' },
    })

  const adminRoutes = new Elysia({ prefix: '/admin/gallery', tags: ['Admin / Gallery'] })
    .use(requireAdmin(deps.sessions))
    .get('/', () => deps.gallery.listAdmin(), { detail: { summary: 'All images' } })
    .post(
      '/',
      ({ body }) => deps.gallery.add(body),
      {
        body: t.Object({
          src: t.String({ minLength: 1, maxLength: 500 }),
          alt: t.String({ maxLength: 200 }),
          span: t.Union([t.Literal('wide'), t.Literal('normal')]),
        }),
        detail: { summary: 'Add image (sortOrder = last)' },
      },
    )
    .patch(
      '/:id',
      ({ params, body }) => deps.gallery.update(params.id, body),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          src: t.Optional(t.String({ maxLength: 500 })),
          alt: t.Optional(t.String({ maxLength: 200 })),
          span: t.Optional(t.Union([t.Literal('wide'), t.Literal('normal')])),
          isActive: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Patch image' },
      },
    )
    .delete(
      '/:id',
      ({ params }) => deps.gallery.remove(params.id),
      { params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }), detail: { summary: 'Delete image' } },
    )
    .post(
      '/:id/reorder',
      ({ params, body }) => deps.gallery.reorder(params.id, body.direction),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ direction: t.Union([t.Literal('up'), t.Literal('down')]) }),
        detail: { summary: 'Swap sortOrder with neighbor' },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}