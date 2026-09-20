//src/http/routes/terms.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { TermsService } from '#/domain/terms/terms.service'
import { requireAdmin } from '#/http/hooks/require-auth'

export interface TermsRoutesDeps {
  sessions: SessionService
  termsService: TermsService
}

export const termsRoutes = (deps: TermsRoutesDeps) => {
  // ── عمومی — مودال لاگین ──
  const publicRoutes = new Elysia({ prefix: '/terms', tags: ['Terms'] })
    .get('/', () => deps.termsService.latest(), {
      detail: {
        summary: 'Latest terms version (public)',
        description: 'For the login modal. Acceptance is snapshotted per-version at signup.',
      },
    })
    .get(
      '/:version',
      ({ params }) => deps.termsService.byVersion(Number(params.version)),
      {
        params: t.Object({ version: t.Numeric() }),
        detail: { summary: 'Terms by version (public, for reference)' },
      },
    )

  // ── ادمین اصلی — ویرایش ──
  const adminRoutes = new Elysia({ prefix: '/admin/terms', tags: ['Admin / Terms'] })
    .use(requireAdmin(deps.sessions))
    .get('/', () => deps.termsService.latest(), {
      detail: { summary: 'Latest terms (admin editor)' },
    })
    .post(
      '/',
      ({ body }) => deps.termsService.update(body.sections),
      {
        body: t.Object({
        sections: t.Array(
          t.Object({
            title: t.String({ minLength: 1, maxLength: 200 }),
            items: t.Array(t.String({ maxLength: 1000 })),
          }),
        ),
        }),
        detail: {
          summary: 'Save terms — each save creates a new version',
          description: 'Admin only. Existing acceptances remain bound to their original version.',
        },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}