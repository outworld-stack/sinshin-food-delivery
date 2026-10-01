// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 18 از 49
// مسیر مقصد: apps/api/src/http/routes/about.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import type { Db } from '#/infra/db/client'
import { contentAbout } from '#/infra/db/schema'
import type { SessionService } from '#/domain/auth/session.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { langFromHeaders, pickAr } from '#/domain/shared/lang'

export interface AboutRoutesDeps {
  db: Db
  sessions: SessionService
}

export const aboutRoutes = (deps: AboutRoutesDeps) => {
  const publicRoutes = new Elysia({ prefix: '/about', tags: ['About'] })
    .get('/', async ({ headers }) => {
      // round-34 — COALESCE(ar, fa) روی فیلدهای متنی؛ گرادیانت‌ها ترجمه نمی‌شوند.
      // فیلدهای *_ar خام هم می‌مانند (قرارداد shared اختیاری — ادمین می‌خواندش).
      const lang = langFromHeaders(headers)
      const row = (await deps.db.select().from(contentAbout).limit(1))[0]
      if (!row) return null
      return {
        ...row,
        heroTitle: pickAr(lang, row.heroTitleAr, row.heroTitle),
        heroText: pickAr(lang, row.heroTextAr, row.heroText),
        teamTitle: pickAr(lang, row.teamTitleAr, row.teamTitle),
        teamAlt: pickAr(lang, row.teamAltAr, row.teamAlt),
      }
    }, { detail: { summary: 'About content (seeded, single row) — round-34: x-sinshin-lang header' } })

  const adminRoutes = new Elysia({ prefix: '/admin/about', tags: ['Admin / About'] })
    .use(requireAdmin(deps.sessions))
    .patch(
      '/',
      async ({ body }) => {
        const existing = (await deps.db.select().from(contentAbout).limit(1))[0]
        // round-34 — فیلدهای عربی اختیاری؛ '' → NULL (حذف ترجمه = fallback فارسی)؛
        // ذخیره‌ی دستی پرچم «خودکار» را خاموش می‌کند
        const trim = (v: string | null | undefined) => {
          const s = (v ?? '').trim()
          return s === '' ? null : s
        }
        const patch = {
          heroTitle: body.heroTitle,
          heroText: body.heroText,
          heroGradient: body.heroGradient,
          teamTitle: body.teamTitle,
          teamGradient: body.teamGradient,
          teamAlt: body.teamAlt,
          heroTitleAr: trim(body.heroTitleAr),
          heroTextAr: trim(body.heroTextAr),
          teamTitleAr: trim(body.teamTitleAr),
          teamAltAr: trim(body.teamAltAr),
          arAuto: false,
          updatedAt: new Date(),
        }
        if (existing) {
          await deps.db.update(contentAbout).set(patch).where(eq(contentAbout.id, existing.id))
        } else {
          await deps.db.insert(contentAbout).values(patch)
        }
        return { success: true }
      },
      {
        body: t.Object({
          heroTitle: t.String({ minLength: 1, maxLength: 120 }),
          heroText: t.String({ maxLength: 2000 }),
          heroGradient: t.String({ maxLength: 200 }),
          teamTitle: t.String({ maxLength: 120 }),
          teamGradient: t.String({ maxLength: 200 }),
          teamAlt: t.String({ maxLength: 200 }),
          // round-34 — محتوای عربی (اختیاری؛ خالی = حذف ترجمه)
          heroTitleAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
          heroTextAr: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
          teamTitleAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
          teamAltAr: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        }),
        detail: { summary: 'Update about content (main admin)' },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}