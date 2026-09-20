// src/http/routes/articles.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { ArticleService } from '#/domain/article/article.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const processSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 120 }),
  items: t.Array(t.String({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
})

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
})

const categoryBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 60 }),
  hasSubCategories: t.Boolean(),
  subCategories: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 60 }), { maxItems: 12 })),
})

export interface ArticlesRoutesDeps {
  sessions: SessionService
  articles: ArticleService
}

export const articlesRoutes = (deps: ArticlesRoutesDeps) => {
  // ═══ عمومی — بدون auth (SSR/SEO: کرالر محتوای واقعی می‌گیرد) ═══
  const publicRoutes = new Elysia({ prefix: '/articles', tags: ['Articles'] })
    .get(
      '/categories',
      () => deps.articles.categories(),
      { detail: { summary: 'Article categories with sub-categories (public)' } },
    )
    .get(
      '/',
      ({ query }) => deps.articles.listPublic(query.category, query.sub),
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
      ({ params }) => deps.articles.byId(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Article detail (public) — increments view counter' },
      },
    )

  // ═══ ادمین — فقط ادمین اصلی (منوی ادمین۲ آیتم مقالات ندارد) ═══
  const adminRoutes = new Elysia({ prefix: '/admin/articles', tags: ['Admin / Articles'] })
    .use(requireAdmin(deps.sessions))

    .get('/', () => deps.articles.listAdmin(), {
      detail: { summary: 'All articles incl. INACTIVE' },
    })
    .get(
      '/:id',
      ({ params }) => deps.articles.adminDetail(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Article detail for edit form (any status)' },
      },
    )
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
        detail: { summary: 'Delete category (rejected while articles exist)' },
      },
    )

  return new Elysia().use(publicRoutes).use(adminRoutes)
}