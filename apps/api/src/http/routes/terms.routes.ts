// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 19 از 49
// مسیر مقصد: apps/api/src/http/routes/terms.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/http/routes/terms.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { TermsService } from '#/domain/terms/terms.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { langFromHeaders } from '#/domain/shared/lang'

export interface TermsRoutesDeps {
  sessions: SessionService
  termsService: TermsService
}

export const termsRoutes = (deps: TermsRoutesDeps) => {
  // ── عمومی — مودال لاگین ──
  const publicRoutes = new Elysia({ prefix: '/terms', tags: ['Terms'] })
    .get('/', ({ headers }) => deps.termsService.latest(langFromHeaders(headers)), {
      detail: {
        summary: 'Latest terms version (public)',
        description: 'For the login modal. Acceptance is snapshotted per-version at signup. round-34: x-sinshin-lang: ar returns sectionsAr when present.',
      },
    })
    .get(
      '/:version',
      ({ params, headers }) => deps.termsService.byVersion(Number(params.version), langFromHeaders(headers)),
      {
        params: t.Object({ version: t.Numeric() }),
        detail: { summary: 'Terms by version (public, for reference)' },
      },
    )

  // ── ادمین اصلی — ویرایش ──
  const adminRoutes = new Elysia({ prefix: '/admin/terms', tags: ['Admin / Terms'] })
    .use(requireAdmin(deps.sessions))
    .get('/', () => deps.termsService.latest(), {
      detail: { summary: 'Latest terms (admin editor) — includes raw sectionsAr for the bilingual form' },
    })
    .post(
      '/',
      ({ body }) => deps.termsService.update(body.sections, body.sectionsAr),
      {
        body: t.Object({
        sections: t.Array(
          t.Object({
            title: t.String({ minLength: 1, maxLength: 200 }),
            items: t.Array(t.String({ maxLength: 1000 })),
          }),
        ),
        // round-34 — بندهای عربی (اختیاری؛ ساختار موازی؛ خالی = پشتیبان فارسی)
        sectionsAr: t.Optional(t.Nullable(t.Array(
          t.Object({
            title: t.String({ maxLength: 200 }),
            items: t.Array(t.String({ maxLength: 1000 })),
          }),
        ))),
        }),
        detail: {
          summary: 'Save terms — each save creates a new version',
          description: 'Admin only. Existing acceptances remain bound to their original version.',
        },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}