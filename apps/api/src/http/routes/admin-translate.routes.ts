// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 14 از 31
// مسیر مقصد: apps/api/src/http/routes/admin-translate.routes.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/http/routes/admin-translate.routes.ts
import { Elysia, t } from 'elysia'
import type { TranslationEntityType } from '@sinshin/shared'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service, Admin2Permissions } from '#/domain/admin2/admin2.service'
import type { TranslationService } from '#/domain/translation/translation.service'
import { Err } from '#/domain/shared/errors'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

/**
 * round-35 — صف و پیش‌نمایش ترجمه‌ی خودکار (مترجم آفلاین NLLB).
 *
 * Active staff may preview translations and read queue status. Enqueuing
 * jobs writes published content through the worker, so it requires the same
 * edit permission as the entity's normal administration routes.
 */

const ENTITY_WRITE_PERMISSION: Record<TranslationEntityType, keyof Admin2Permissions | null> = {
  product: 'productsWrite',
  mainCategory: 'mainCategoriesWrite',
  category: 'mainCategoriesWrite',
  article: 'articlesWrite',
  articleCategory: 'articlesWrite',
  articleSubCategory: 'articlesWrite',
  gallery: null,
  terms: null,
  about: null,
}

function assertCanEnqueue(role: string, permissions: Admin2Permissions | null, entityType?: TranslationEntityType): void {
  if (role === 'admin') return
  const permission = entityType ? ENTITY_WRITE_PERMISSION[entityType] : null
  if (!permission || !permissions?.[permission]) {
    throw Err.forbidden('اجازه‌ی ویرایش ترجمه‌ی این محتوا را ندارید.')
  }
}

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
    .post('/', async ({ body, user, admin2 }) => {
      assertCanEnqueue(user.role, admin2, body.entityType)
      return deps.translation.enqueue(body.entityType, body.entityId)
    }, {
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
      async ({ body, user, admin2 }) => {
        assertCanEnqueue(user.role, admin2, body.entityType)
        return deps.translation.enqueueBulkMissing(body.entityType)
      },
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
