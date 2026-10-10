// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/menu.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: سقف نرخ IP روی cart/details عمومی + ETag/304 و Cache-Control
//        برای پنج GET عمومی منو (کاهش راندترِپ DB و پهنای باند)
// ═══════════════════════════════════════════════════════════════

//src/http/routes/menu.routes.ts
import { Elysia, t } from 'elysia'

import type { MenuService } from '#/domain/menu/menu.service'
import type { CartService } from '#/domain/cart/cart.service'
import type { RedisService } from '#/infra/redis/redis'
import { langFromHeaders } from '#/domain/shared/lang'
import { sha256 } from '#/domain/shared/crypto'
import { UUID_PATTERN } from '#/domain/shared/ids'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'
import { cartItemSchema } from '#/http/schemas'


export interface MenuRoutesDeps {
  menu: MenuService
  cart: CartService
  /** stage-55 — سقف نرخ IP برای اندپوینت عمومیِ بدون-احرازِ cart/details */
  redis: RedisService
}

/** stage-55 — ETag/304 + Cache-Control برای GETهای عمومی منو.
 * max-age=30 هم‌ارز TTL کشِ ردیس منو است؛ stale-while-revalidate=60.
 * سرور خودش با bustCache نسخه را عوض می‌کند — کش مشتری همیشه تازه می‌ماند. */
const withMenuCache = async <T>(
  ctx: {
    headers: Record<string, string | null | undefined>
    set: { status?: number | string; headers: Record<string, string | number> }
  },
  load: () => Promise<T>,
): Promise<T | null> => {
  const data = await load()
  const etag = `"m-${sha256(JSON.stringify(data)).slice(0, 40)}"`
  ctx.set.headers.etag = etag
  ctx.set.headers['cache-control'] = 'public, max-age=30, stale-while-revalidate=60'
  if (ctx.headers['if-none-match'] === etag) {
    // 304 — بدنه ندارد؛ ETag تازه در هدر می‌رود تا کش کلاینت معتبر بماند
    ctx.set.status = 304
    return null
  }
  return data
}

export const menuRoutes = (deps: MenuRoutesDeps) =>
  new Elysia({ prefix: '/menu', tags: ['Menu'] })

    // round-34 — x-sinshin-lang: ar → محتوای عربی (COALESCE(ar, fa))، بدون هدر = فارسی
    .get(
      '/mains',
      (ctx) => withMenuCache(ctx, () => deps.menu.activeMainCategories(langFromHeaders(ctx.headers))),
      {
        detail: {
          summary: 'Active main categories (default first, then sortOrder)',
          description: 'round-34: send `x-sinshin-lang: ar` for Arabic content (COALESCE(ar, fa) per field).',
        },
      },
    )

    .get(
      '/categories',
      (ctx) => withMenuCache(ctx, () => deps.menu.allCategories(langFromHeaders(ctx.headers))),
      { detail: { summary: 'All categories (public — used by coupon/product forms)' } },
    )

    .get(
      '/mains/:slug/products',
      (ctx) =>
        withMenuCache(ctx, () =>
          deps.menu.productsByMain(ctx.params.slug, langFromHeaders(ctx.headers)),
        ),
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
      (ctx) =>
        withMenuCache(ctx, () => deps.menu.categoriesByMain(ctx.params.slug, langFromHeaders(ctx.headers))),
      {
        params: t.Object({ slug: t.String({ maxLength: 60 }) }),
        detail: { summary: 'Categories of an active main' },
      },
    )

    .get(
      '/products/:id',
      (ctx) => withMenuCache(ctx, () => deps.menu.productById(ctx.params.id, langFromHeaders(ctx.headers))),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Single product with sizes (null when not found)' },
      },
    )

    .post(
      '/cart/details',
      ({ body, headers }) => deps.cart.details(body.items, langFromHeaders(headers)),
      {
        // stage-55 — این اندپوینت بدون احراز هویت است و هر راندترِپ DB دارد —
        // بدون سقف، vector DoS سبک.
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'menu-cart-details',
          limit: 60,
          windowSeconds: 60,
        }),
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