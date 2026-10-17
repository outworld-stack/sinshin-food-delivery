// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 40 از 97
// مسیر مقصد: apps/api/src/http/routes/articles.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// stage-63 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/articles.routes.ts
// تغییر: DELETE /admin/articles/categories/:id از این پس آبشاری —
//        مقالاتِ دسته هم حذف می‌شوند (منطق در article.service)
//
// stage-60 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/articles.routes.ts
// تغییر: articleBody += isFeatured (پرچم سنجاق ویژه — create/patch)
//
// src/http/routes/articles.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { ArticleService } from '#/domain/article/article.service'
import { requireAdmin2Permission } from '#/http/hooks/require-admin2'
import { langFromHeaders } from '#/domain/shared/lang'
import { UUID_PATTERN } from '#/domain/shared/ids'

const HEX_COLOR = '^#[0-9a-fA-F]{6}$'


const processSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 120 }),
  items: t.Array(t.String({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
})

// Blank Arabic entries keep the same indexes as Persian and fall back field by field.
const processArSchema = t.Object({
  title: t.String({ maxLength: 120 }),
  items: t.Array(t.String({ maxLength: 300 }), { maxItems: 20 }),
})

// ═══ stage-82 — پاکتِ سندِ بلوکی (لایه ۱ از ۳) ═══
// enum ها و سقف‌های کلی این‌جا؛ اعتبارسنجیِ سخت‌گیرِ per-type در
// blocks-normalize سرویس انجام می‌شود (لایه ۲). props عمداً باز است —
// normalizer فقط whitelist را نگه می‌دارد و باقی را حذف می‌کند.
const blockStyleSchema = t.Object({
  bg: t.Optional(t.String({ pattern: HEX_COLOR, maxLength: 7 })),
  fg: t.Optional(t.String({ pattern: HEX_COLOR, maxLength: 7 })),
  align: t.Optional(t.Union([t.Literal('start'), t.Literal('center')])),
  pad: t.Optional(t.Union([t.Literal('sm'), t.Literal('md'), t.Literal('lg')])),
})
const blockSchema = t.Object({
  id: t.Optional(t.String({ maxLength: 64 })),
  type: t.Union([
    t.Literal('hero'),
    t.Literal('heading'),
    t.Literal('paragraph'),
    t.Literal('image'),
    t.Literal('gallery'),
    t.Literal('quote'),
    t.Literal('callout'),
    t.Literal('list'),
    t.Literal('cta'),
    t.Literal('divider'),
  ]),
  width: t.Optional(t.Union([t.Literal('sm'), t.Literal('md'), t.Literal('lg'), t.Literal('full')])),
  anim: t.Optional(
    t.Union([
      t.Literal('none'),
      t.Literal('fade'),
      t.Literal('fade-up'),
      t.Literal('slide'),
      t.Literal('zoom'),
      t.Literal('blur'),
    ]),
  ),
  style: t.Optional(blockStyleSchema),
  props: t.Optional(t.Record(t.String(), t.Unknown())),
})
const blocksDocSchema = t.Nullable(
  t.Object({
    version: t.Literal(1),
    blocks: t.Array(blockSchema, { maxItems: 200 }),
  }),
)

const articleBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 160 }),
  excerpt: t.String({ minLength: 1, maxLength: 1000 }),
  content: t.String({ minLength: 1 }),
  author: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  profileImage: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  galleryImages: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 12 })),
  categoryId: t.String({ pattern: UUID_PATTERN }),
  subCategoryId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
  processes: t.Optional(t.Array(processSchema, { maxItems: 10 })),
  // round-34 — محتوای عربی (اختیاری؛ خالی = حذف ترجمه = پشتیبان فارسی)
  titleAr: t.Optional(t.Nullable(t.String({ maxLength: 160 }))),
  excerptAr: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
  contentAr: t.Optional(t.Nullable(t.String({ maxLength: 100000 }))),
  processesAr: t.Optional(t.Nullable(t.Array(processArSchema, { maxItems: 10 }))),
  // stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول لیست + Aurora؛ نیامد = false/دست‌نخورده)
  isFeatured: t.Optional(t.Boolean()),
  // stage-82 — سندِ بلوکیِ صفحه‌ساز (null = پاک‌کردن → مقاله‌ی متنی)
  blocks: t.Optional(blocksDocSchema),
})

const categoryBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 60 }),
  hasSubCategories: t.Boolean(),
  subCategories: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 60 }), { maxItems: 12 })),
  // round-34 — نام عربی دسته + ساب‌دسته‌ها (موازی با subCategories)
  nameAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  subCategoriesAr: t.Optional(t.Nullable(t.Array(t.String({ maxLength: 60 }), { maxItems: 12 }))),
})

export interface ArticlesRoutesDeps {
  sessions: SessionService
  articles: ArticleService
  /** stage-82 — ادمین۲ با articlesRead/Write هم وارد می‌شود (ادمین اصلی همیشه) */
  admin2: Admin2Service
}

export const articlesRoutes = (deps: ArticlesRoutesDeps) => {
  // ═══ عمومی — بدون auth (SSR/SEO: کرالر محتوای واقعی می‌گیرد) ═══
  const publicRoutes = new Elysia({ prefix: '/articles', tags: ['Articles'] })
    .get(
      '/categories',
      ({ headers }) => deps.articles.categories(langFromHeaders(headers)),
      { detail: { summary: 'Article categories with sub-categories (public)' } },
    )
    .get(
      '/',
      ({ query, headers }) => deps.articles.listPublic(query.category, query.sub, langFromHeaders(headers)),
      {
        query: t.Object({
          category: t.Optional(t.String({ maxLength: 60 })),
          sub: t.Optional(t.String({ maxLength: 60 })),
        }),
        detail: { summary: 'Published articles — filter by category/sub slug' },
      },
    )
    .get(
      '/:id',
      ({ params, headers }) => deps.articles.byId(params.id, langFromHeaders(headers)),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Article detail (public) — increments view counter' },
      },
    )

  // ═══ ادمین — stage-82: ادمین اصلی + ادمین۲ با مجوز (پیش‌تر فقط ادمین اصلی).
  // requireAdmin2Permission نقش admin را همیشه رد می‌کند؛ ادمین۲ فقط با
  // پرچمِ متناظر — خواندن با articlesRead، نوشتن با articlesWrite. ═══
  const adminRead = new Elysia({ prefix: '/admin/articles', tags: ['Admin / Articles'] })
    .use(requireAdmin2Permission({ sessions: deps.sessions, admin2: deps.admin2 }, 'articlesRead'))

    .get('/', () => deps.articles.listAdmin(), {
      detail: { summary: 'All articles incl. INACTIVE' },
    })
    .get('/categories', () => deps.articles.categories('fa'), {
      detail: { summary: 'Article categories in the editing language, with raw Arabic translations' },
    })
    .get(
      '/:id',
      ({ params }) => deps.articles.adminDetail(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Article detail for edit form (any status)' },
      },
    )

  const adminWrite = new Elysia({ prefix: '/admin/articles', tags: ['Admin / Articles'] })
    .use(requireAdmin2Permission({ sessions: deps.sessions, admin2: deps.admin2 }, 'articlesWrite'))

    .post('/', ({ body }) => deps.articles.create(body), {
      body: articleBody,
      detail: { summary: 'Create article' },
    })
    .patch(
      '/:id',
      ({ params, body }) => deps.articles.update(params.id, body),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: articleBody,
        detail: { summary: 'Update article — author optional (untouched = preserved)' },
      },
    )
    .delete(
      '/:id',
      ({ params }) => deps.articles.remove(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete article' },
      },
    )
    .post('/:id/toggle', ({ params }) => deps.articles.toggle(params.id), {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Toggle ACTIVE / INACTIVE' },
    })

    // ── دسته‌ها ──
    .post(
      '/categories',
      ({ body }) => deps.articles.createCategory(body),
      { body: categoryBody, detail: { summary: 'Create category + subs' } },
    )
    .patch(
      '/categories/:id',
      ({ params, body }) => deps.articles.updateCategory(params.id, body),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: categoryBody,
        detail: { summary: 'Update category — subs synced by name; slug immutable' },
      },
    )
    .delete(
      '/categories/:id',
      ({ params }) => deps.articles.deleteCategory(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary:
            'Delete category — stage-63: cascade deletes its articles (sub-categories cascade)',
        },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRead).use(adminWrite)
}
