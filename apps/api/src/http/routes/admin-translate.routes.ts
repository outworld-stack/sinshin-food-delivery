// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 14 از 31
// مسیر مقصد: apps/api/src/http/routes/admin-translate.routes.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/http/routes/admin-translate.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { TranslationService } from '#/domain/translation/translation.service'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

/**
 * round-35 — صف و پیش‌نمایش ترجمه‌ی خودکار (مترجم آفلاین NLLB).
 *
 * گارد: requireAdmin2 پایه (ادمین اصلی + هر ادمین۲ فعال) — بدون
 * permission خاص. چرا: این روت‌ها فقط ستون‌های «عربی» محتوای نمایشی
 * را می‌نویسند، نوشتن دستی را هرگز بازنویسی نمی‌کنند (قرارداد
 * «دستی برنده» در سرویس) و فارسیِ سایت را دست نمی‌زنند؛ جایی هم
 * برای permission جدید در مدل فعلی (products/users/couriers/...)
 * نمی‌ماند. preview اصلاً DB نمی‌نویسد.
 */

const EntityTypeSchema = t.Union([
  t.Literal('product'),
  t.Literal('mainCategory'),
  t.Literal('category'),
  t.Literal('article'),
  t.Literal('articleCategory'),
  t.Literal('articleSubCategory'),
  t.Literal('gallery'),
  t.Literal('terms'),
  t.Literal('about'),
])

export interface AdminTranslateRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  translation: TranslationService
}

export const adminTranslateRoutes = (deps: AdminTranslateRoutesDeps) =>
  new Elysia({ prefix: '/admin/translate', tags: ['Admin / Translation'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    // ── پیشنهاد ترجمه — فرم را پر می‌کند؛ هیچ نوشتنی در DB نیست ──
    .post(
      '/preview',
      async ({ body }) => ({ translations: await deps.translation.preview(body.texts) }),
      {
        body: t.Object({
          // سقف ۸ متن × ۳۰k — کافی برای همه‌ی فیلدهای فرم + بدنه‌ی Markdown
          texts: t.Array(t.String({ minLength: 1, maxLength: 30000 }), {
            minItems: 1,
            maxItems: 8,
          }),
        }),
        detail: {
          summary: 'پیشنهاد ترجمه‌ی ماشینی (Markdown-aware؛ بدون نوشتن DB)',
        },
      },
    )

    // ── صف‌کردن یک موجودیت (حذف تکرار با موارد در انتظار) ──
    .post('/', async ({ body }) => deps.translation.enqueue(body.entityType, body.entityId), {
      body: t.Object({
        entityType: EntityTypeSchema,
        // 'terms' مقدار ویژه‌ی 'latest' را هم می‌پذیرد (در سرویس تفسیر می‌شود)
        entityId: t.String({ minLength: 1, maxLength: 64 }),
      }),
      detail: { summary: 'افزودن یک موجودیت به صف ترجمه' },
    })

    // ── صف‌کردن همه‌ی ناقص‌ها (یک نوع یا همه) ──
    .post(
      '/bulk',
      async ({ body }) => deps.translation.enqueueBulkMissing(body.entityType),
      {
        body: t.Object({ entityType: t.Optional(EntityTypeSchema) }),
        detail: {
          summary: 'صف‌کردن رکوردهای فاقد ترجمه (بدون entityType = همه‌ی انواع)',
        },
      },
    )

    // ── وضعیت صف + شمار ناقص‌ها + سلامت مترجم (کارت داشبورد) ──
    .get('/status', () => deps.translation.status(), {
      detail: { summary: 'وضعیت صف ترجمه و سلامت مترجم' },
    })

    // ── کارهای اخیر (جدول کارت) ──
    .get(
      '/jobs',
      async ({ query }) => ({ jobs: await deps.translation.jobs(query.limit ?? 15) }),
      {
        query: t.Object({
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        }),
        detail: { summary: 'jobهای اخیر صف ترجمه' },
      },
    )