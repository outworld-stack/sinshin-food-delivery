// src/http/routes/admin-menu.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { MenuService } from '#/domain/menu/menu.service'
import { requireAdmin2Permission } from '#/http/hooks/require-admin2'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const sizeInput = t.Object({ name: t.String({ minLength: 1, maxLength: 60 }), price: t.Number({ minimum: 0 }) })

export interface AdminMenuRoutesDeps {
  sessions: SessionService
  menu: MenuService
  admin2: Admin2Service // ← phase-1: برای سیم‌کیری permission
}

export const adminMenuRoutes = (deps: AdminMenuRoutesDeps) => {
  // ══ phase-1: سیم‌کیری permission — قبلاً کل منو فقط requireAdmin بود ══
  // ساختار منو (mains + دسته‌ها) → mainCategoriesRead/Write
  // محصولات → productsRead/Write
  // چهار instance جدا چون .use به روت‌های «بعدی» نشت می‌کند.
  const admin2 = { sessions: deps.sessions, admin2: deps.admin2 }

  const mainsRead = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'mainCategoriesRead'))
    .get('/mains', () => deps.menu.adminMainCategories(), {
      detail: { summary: 'All main categories (incl. inactive)' },
    })

  const structureWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'mainCategoriesWrite'))

    .post(
      '/mains',
      ({ body }) => deps.menu.createMainCategory(body.name, body.slug),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          slug: t.String({ minLength: 1, maxLength: 60 }),
        }),
        detail: { summary: 'Create main category (inactive by default)' },
      },
    )
    .post('/mains/:id/toggle', ({ params }) => deps.menu.toggleMainCategory(params.id), {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Toggle main category visibility' },
    })
    .post(
      '/mains/:id/default',
      ({ params }) => deps.menu.setDefaultMainCategory(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Set default main (must be active)' },
      },
    )
    .post(
      '/mains/:id/reorder',
      ({ params, body }) => deps.menu.reorderMainCategory(params.id, body.direction),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ direction: t.Union([t.Literal('up'), t.Literal('down')]) }),
        detail: { summary: 'Swap sortOrder with neighbor' },
      },
    )
    .delete(
      '/mains/:id',
      ({ params }) => deps.menu.deleteMainCategory(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete main (rejected while child categories exist)' },
      },
    )
    .post(
      '/categories',
      ({ body }) =>
        deps.menu.createCategory({
          name: body.name,
          mainCategoryId: body.mainCategoryId,
          hasSizes: body.hasSizes ?? false,
          sizeNames: body.sizeNames ?? [],
        }),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          mainCategoryId: t.String({ pattern: UUID_PATTERN }),
          hasSizes: t.Optional(t.Boolean()),
          sizeNames: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 })),
        }),
        detail: { summary: 'Create category (slug auto-generated, unique)' },
      },
    )
    .patch(
      '/categories/:id',
      ({ params, body }) =>
        deps.menu.updateCategory({
          id: params.id,
          name: body.name,
          mainCategoryId: body.mainCategoryId,
          hasSizes: body.hasSizes ?? false,
          sizeNames: body.sizeNames ?? [],
        }),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          mainCategoryId: t.String({ pattern: UUID_PATTERN }),
          hasSizes: t.Optional(t.Boolean()),
          sizeNames: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 })),
        }),
        detail: { summary: 'Update category' },
      },
    )
    .delete(
      '/categories/:id',
      ({ params }) => deps.menu.deleteCategory(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete category (rejected while products exist)' },
      },
    )

  const productsRead = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'productsRead'))
    .get(
      '/products',
      ({ query }) =>
        deps.menu.adminProducts({
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          status: query.status || undefined,
          categoryId: query.categoryId || undefined,
        }),
      {
        query: t.Object({
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
          search: t.Optional(t.String({ maxLength: 60 })),
          status: t.Optional(t.String({ maxLength: 20 })),
          categoryId: t.Optional(t.String({ maxLength: 40 })),
        }),
        detail: { summary: 'Products list (paginated, filtered)' },
      },
    )
    .get(
      '/products/:id',
      ({ params }) => deps.menu.adminProductDetails(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Product details for edit form' },
      },
    )

  const productsWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'productsWrite'))
    .post(
      '/products',
      ({ body }) => deps.menu.createProduct(body),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          description: t.String({ maxLength: 2000 }),
          originalPrice: t.Number({ minimum: 0 }),
          discountPercentage: t.Number({ minimum: 0, maximum: 100 }),
          prepTime: t.Number({ minimum: 1, maximum: 600 }),
          categoryId: t.String({ pattern: UUID_PATTERN }),
          profileImage: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
          galleryImages: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 12 })),
          sizesEnabled: t.Optional(t.Boolean()),
          sizes: t.Optional(t.Array(sizeInput, { maxItems: 8 })),
          ingredients: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 })),
        }),
        detail: { summary: 'Create product (sizes replace-all on update)' },
      },
    )
    .patch(
      '/products/:id',
      ({ params, body }) => deps.menu.updateProduct({ id: params.id, ...body }),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          description: t.String({ maxLength: 2000 }),
          originalPrice: t.Number({ minimum: 0 }),
          discountPercentage: t.Number({ minimum: 0, maximum: 100 }),
          prepTime: t.Number({ minimum: 1, maximum: 600 }),
          profileImage: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
          galleryImages: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 12 })),
          sizesEnabled: t.Optional(t.Boolean()),
          sizes: t.Optional(t.Array(sizeInput, { maxItems: 8 })),
          ingredients: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 })),
        }),
        detail: { summary: 'Update product — categoryId immutable (frontend contract)' },
      },
    )
    .post('/products/:id/toggle', ({ params }) => deps.menu.toggleProductStatus(params.id), {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Toggle product ACTIVE / INACTIVE' },
    })

  return new Elysia().use(mainsRead).use(structureWrite).use(productsRead).use(productsWrite)
}