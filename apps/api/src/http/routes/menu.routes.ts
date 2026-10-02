// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 46 از 97
// مسیر مقصد: apps/api/src/http/routes/menu.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

//src/http/routes/menu.routes.ts
import { Elysia, t } from 'elysia'

import type { MenuService } from '#/domain/menu/menu.service'
import type { CartService } from '#/domain/cart/cart.service'
import { langFromHeaders } from '#/domain/shared/lang'
import { UUID_PATTERN } from '#/domain/shared/ids'
import { cartItemSchema } from '#/http/schemas'


export interface MenuRoutesDeps {
  menu: MenuService
  cart: CartService
}

export const menuRoutes = (deps: MenuRoutesDeps) =>
  new Elysia({ prefix: '/menu', tags: ['Menu'] })

    // round-34 — x-sinshin-lang: ar → محتوای عربی (COALESCE(ar, fa))، بدون هدر = فارسی
    .get(
      '/mains',
      ({ headers }) => deps.menu.activeMainCategories(langFromHeaders(headers)),
      {
        detail: {
          summary: 'Active main categories (default first, then sortOrder)',
          description: 'round-34: send `x-sinshin-lang: ar` for Arabic content (COALESCE(ar, fa) per field).',
        },
      },
    )

    .get(
      '/categories',
      ({ headers }) => deps.menu.allCategories(langFromHeaders(headers)),
      { detail: { summary: 'All categories (public — used by coupon/product forms)' } },
    )

    .get(
      '/mains/:slug/products',
      ({ params, headers }) => deps.menu.productsByMain(params.slug, langFromHeaders(headers)),
      {
        params: t.Object({ slug: t.String({ maxLength: 60 }) }),
        detail: {
          summary: 'Products + categories of an active main',
          description: 'SSR-friendly: returns both lists in one call (frontend MainData contract). round-34: x-sinshin-lang header.',
        },
      },
    )

    .get(
      '/mains/:slug/categories',
      ({ params, headers }) => deps.menu.categoriesByMain(params.slug, langFromHeaders(headers)),
      {
        params: t.Object({ slug: t.String({ maxLength: 60 }) }),
        detail: { summary: 'Categories of an active main' },
      },
    )

    .get(
      '/products/:id',
      ({ params, headers }) => deps.menu.productById(params.id, langFromHeaders(headers)),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Single product with sizes (null when not found)' },
      },
    )

    .post(
      '/cart/details',
      ({ body, headers }) => deps.cart.details(body.items, langFromHeaders(headers)),
      {
        body: t.Object({
          // رارد ۴۸ — آیتم از اسکیمای مشترک؛ quantity حالا Integer است
          // (قبلاً t.Number بود و اعشار می‌پذیرفت — دریفت خاموش با چک‌اوت)
          items: t.Array(cartItemSchema, { maxItems: 100 }),
        }),
        detail: {
          summary: 'Server-side cart pricing',
          description:
            'Effective price per item (size-aware, discount-aware). Invalid items are skipped, never error — frontend contract.',
        },
      },
    )