//src/http/routes/review.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { ReviewService } from '#/domain/review/review.service'
import { requireAuth } from '#/http/hooks/require-auth'
import { requireAdmin2 } from '#/http/hooks/require-admin2'
import { UUID_PATTERN } from '#/domain/shared/ids'
import { DISPLAY_PATTERN } from '#/domain/shared/ids'


export interface ReviewRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  reviews: ReviewService
}

export const reviewRoutes = (deps: ReviewRoutesDeps) => {
  // ── مشتری ──
  const user = new Elysia({ prefix: '/reviews', tags: ['Reviews'] })
    .use(requireAuth(deps.sessions))

    .post(
      '/',
      ({ user, body }) =>
        deps.reviews.submit(user.id, body.orderId, body.productId, body.feedback),
      {
        body: t.Object({
          orderId: t.String({ pattern: DISPLAY_PATTERN }),
          productId: t.String({ pattern: UUID_PATTERN }),
          feedback: t.String({ minLength: 1, maxLength: 500 }),
        }),
        detail: { summary: 'Submit review (after DELIVERED, once per product)' },
      },
    )

    .get(
      '/order/:displayId',
      ({ user, params }) => deps.reviews.reviewedProducts(user.id, params.displayId),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        detail: { summary: 'Reviewed product ids of an order' },
      },
    )

  // ── ادمین ──
  const admin = new Elysia({ prefix: '/admin/reviews', tags: ['Admin / Reviews'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get(
      '/',
      ({ query }) => deps.reviews.adminList(query.status || undefined),
      {
        query: t.Object({
          status: t.Optional(t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('rejected')])),
        }),
        detail: { summary: 'All reviews for moderation (filterable)' },
      },
    )

    .post(
      '/:id/moderate',
      ({ params, body }) => deps.reviews.moderate(params.id, body.action),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ action: t.Union([t.Literal('approve'), t.Literal('reject')]) }),
        detail: { summary: 'Moderate review' },
      },
    )

  // ── عمومی — نظرات تاییدشده‌ی محصول (داخل زنجیره /api سوار می‌شود) ──
  const pub = new Elysia({ tags: ['Reviews'] }).get(
    '/products/:id/reviews',
    ({ params }) => deps.reviews.approvedByProduct(params.id),
    {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Approved reviews of a product (public)' },
    },
  )

  return new Elysia().use(user).use(admin).use(pub)
}