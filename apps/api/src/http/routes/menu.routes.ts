//src/http/routes/menu.routes.ts
import { Elysia, t } from 'elysia'

import type { MenuService } from '#/domain/menu/menu.service'
import type { CartService } from '#/domain/cart/cart.service'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface MenuRoutesDeps {
  menu: MenuService
  cart: CartService
}

export const menuRoutes = (deps: MenuRoutesDeps) =>
  new Elysia({ prefix: '/menu', tags: ['Menu'] })

    .get(
      '/mains',
      () => deps.menu.activeMainCategories(),
      { detail: { summary: 'Active main categories (default first, then sortOrder)' } },
    )

    .get(
      '/categories',
      () => deps.menu.allCategories(),
      { detail: { summary: 'All categories (public — used by coupon/product forms)' } },
    )

    .get(
      '/mains/:slug/products',
      ({ params }) => deps.menu.productsByMain(params.slug),
      {
        params: t.Object({ slug: t.String({ maxLength: 60 }) }),
        detail: {
          summary: 'Products + categories of an active main',
          description: 'SSR-friendly: returns both lists in one call (frontend MainData contract).',
        },
      },
    )

    .get(
      '/mains/:slug/categories',
      ({ params }) => deps.menu.categoriesByMain(params.slug),
      {
        params: t.Object({ slug: t.String({ maxLength: 60 }) }),
        detail: { summary: 'Categories of an active main' },
      },
    )

    .get(
      '/products/:id',
      ({ params }) => deps.menu.productById(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Single product with sizes (null when not found)' },
      },
    )

    .post(
      '/cart/details',
      ({ body }) => deps.cart.details(body.items),
      {
        body: t.Object({
          items: t.Array(
            t.Object({
              productId: t.String({ pattern: UUID_PATTERN }),
              sizeId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
              quantity: t.Number({ minimum: 1, maximum: 99 }),
            }),
            { maxItems: 100 },
          ),
        }),
        detail: {
          summary: 'Server-side cart pricing',
          description:
            'Effective price per item (size-aware, discount-aware). Invalid items are skipped, never error — frontend contract.',
        },
      },
    )