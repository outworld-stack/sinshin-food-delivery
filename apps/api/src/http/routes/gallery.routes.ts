// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 44 از 97
// مسیر مقصد: apps/api/src/http/routes/gallery.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { GalleryService } from '#/domain/gallery/gallery.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { langFromHeaders } from '#/domain/shared/lang'
import { UUID_PATTERN } from '#/domain/shared/ids'
import { contentSourceRevisionSchema, translationEditsSchema } from './content-translation.schemas'


export interface GalleryRoutesDeps {
  sessions: SessionService
  gallery: GalleryService
}

export const galleryRoutes = (deps: GalleryRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/gallery', tags: ['Gallery'] })
    .get('/', ({ headers }) => deps.gallery.listPublic(langFromHeaders(headers)), {
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
          // round-34 — متن جایگزین عربی (خالی = پشتیبان فارسی)
          altAr: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
          translationEdits: t.Optional(translationEditsSchema),
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
          // round-34 — متن جایگزین عربی (خالی = حذف ترجمه = پشتیبان فارسی)
          altAr: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
          translationEdits: t.Optional(translationEditsSchema),
          span: t.Optional(t.Union([t.Literal('wide'), t.Literal('normal')])),
          isActive: t.Optional(t.Boolean()),
          sourceRevision: contentSourceRevisionSchema,
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
      ({ params, body }) => deps.gallery.reorder(params.id, body.direction, body.sourceRevisions),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ direction: t.Union([t.Literal('up'), t.Literal('down')]),
          sourceRevisions: t.Record(t.String({ pattern: UUID_PATTERN }), contentSourceRevisionSchema, { maxProperties: 1000 }),
        }),
        detail: { summary: 'Swap sortOrder with neighbor' },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}
