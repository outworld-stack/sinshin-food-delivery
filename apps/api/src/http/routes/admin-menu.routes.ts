// ═══════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/admin-menu.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر:
//   • دسته‌ها: سه سوئیچ حالت سفارش (پیک/بیرون‌بر/سرو در محل)
//   • محصولات: is_available + سه پرچم حالت سفارش (ارث از دسته)
//   • POST /products/:id/availability — موجود/ناموجود سریع
//     (ادمین اصلی یا ادمین۲ با productsAvailability)
// ═══════════════════════════════════════════════════════════

// src/http/routes/admin-menu.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { MenuService } from '#/domain/menu/menu.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { requireAdmin2Permission } from '#/http/hooks/require-admin2'
import { UUID_PATTERN } from '#/domain/shared/ids'


/**
 * stage-47 — ورودی سایز: قیمت + تخفیف مستقل (درصد + پنجره‌ی ISO).
 * discountStartsAt/EndsAt: null یا خالی = بدون محدودیت زمانی.
 */
const sizeInput = t.Object({
  name: t.String({ minLength: 1, maxLength: 60 }),
  // round-34 — نام عربی سایز (اختیاری؛ خالی = پشتیبان فارسی)
  nameAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  price: t.Number({ minimum: 0 }),
  // stage-47 — تخفیف مستقِ این سایز
  discountPercentage: t.Optional(t.Numeric({ minimum: 0, maximum: 100 })),
  discountStartsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  discountEndsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
})

export interface AdminMenuRoutesDeps {
  sessions: SessionService
  menu: MenuService
  admin2: Admin2Service // ← phase-1: برای سیم‌کیری permission
  /** stage-10: لاگ ممیزی — فقط عملیات ادمین اصلی (admin2 در activities خودش) */
  audit: AuditService
}

export const adminMenuRoutes = (deps: AdminMenuRoutesDeps) => {
  // ══ phase-1: سیم‌کیریِ مجوز — قبلاً کل منو فقط requireAdmin بود ══
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
      ({ body }) => deps.menu.createMainCategory(body.name, body.slug, body.nameAr),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          slug: t.String({ minLength: 1, maxLength: 60 }),
          // round-34 — نام عربی (اختیاری؛ خالی = پشتیبان فارسی)
          nameAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
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
          nameAr: body.nameAr,
          sizeNamesAr: body.sizeNamesAr ?? null,
          // stage-48 — حالت‌های سفارش پایه (پیش‌فرض روشن)
          courierEnabled: body.courierEnabled ?? true,
          takeawayEnabled: body.takeawayEnabled ?? true,
          dineInEnabled: body.dineInEnabled ?? true,
        }),
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          mainCategoryId: t.String({ pattern: UUID_PATTERN }),
          hasSizes: t.Optional(t.Boolean()),
          sizeNames: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 })),
          // round-34 — نام عربی + قالب سایزهای عربی (موازی با sizeNames)
          nameAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
          sizeNamesAr: t.Optional(t.Nullable(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 }))),
          // stage-48 — حالت‌های سفارش محصولاتِ این دسته
          courierEnabled: t.Optional(t.Boolean()),
          takeawayEnabled: t.Optional(t.Boolean()),
          dineInEnabled: t.Optional(t.Boolean()),
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
          nameAr: body.nameAr,
          sizeNamesAr: body.sizeNamesAr ?? null,
          // stage-48 — حالت‌های سفارش (undefined = دست‌نخورده)
          courierEnabled: body.courierEnabled,
          takeawayEnabled: body.takeawayEnabled,
          dineInEnabled: body.dineInEnabled,
        }),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          mainCategoryId: t.String({ pattern: UUID_PATTERN }),
          hasSizes: t.Optional(t.Boolean()),
          sizeNames: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 })),
          // round-34 — نام عربی + قالب سایزهای عربی (موازی با sizeNames)
          nameAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
          sizeNamesAr: t.Optional(t.Nullable(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 }))),
          // stage-48 — حالت‌های سفارش (اختیاری — نیامد = دست‌نخورده)
          courierEnabled: t.Optional(t.Boolean()),
          takeawayEnabled: t.Optional(t.Boolean()),
          dineInEnabled: t.Optional(t.Boolean()),
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
      async ({ body, user }) => {
        const res = await deps.menu.createProduct(body)
        // stage-10: ممیزی فقط برای ادمین اصلی — ادمین۲ activities خودش را دارد
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PRODUCT_CREATE',
            entity: 'product',
            entityId: res.id ?? null,
            metadata: { name: body.name, packagingCost: body.packagingCost ?? 0 },
          })
        }
        return res
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          description: t.String({ maxLength: 2000 }),
          // round-34 — محتوای عربی (اختیاری؛ خالی = پشتیبان فارسی)
          nameAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
          descriptionAr: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
          ingredientsAr: t.Optional(t.Nullable(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 }))),
          originalPrice: t.Number({ minimum: 0 }),
          discountPercentage: t.Number({ minimum: 0, maximum: 100 }),
          // stage-47 — پنجره‌ی زمانی تخفیف محصول (ISO | null = بدون محدودیت)
          discountStartsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          discountEndsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          prepTime: t.Number({ minimum: 1, maximum: 600 }),
          packagingCost: t.Optional(t.Number({ minimum: 0, maximum: 1000000 })),
          categoryId: t.String({ pattern: UUID_PATTERN }),
          profileImage: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
          galleryImages: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 12 })),
          sizesEnabled: t.Optional(t.Boolean()),
          sizes: t.Optional(t.Array(sizeInput, { maxItems: 8 })),
          ingredients: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 })),
          // stage-48 — موجودی فروش (پیش‌فرض true)
          isAvailable: t.Optional(t.Boolean()),
          // stage-48 — پرچم‌های حالت سفارش (پیش‌فرض true = ارث از دسته)
          courierAllowed: t.Optional(t.Boolean()),
          takeawayAllowed: t.Optional(t.Boolean()),
          dineInAllowed: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Create product (sizes replace-all on update)' },
      },
    )
    .patch(
      '/products/:id',
      async ({ params, body, user }) => {
        await deps.menu.updateProduct({ id: params.id, ...body })
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PRODUCT_UPDATE',
            entity: 'product',
            entityId: params.id,
            metadata: { name: body.name, packagingCost: body.packagingCost ?? 0 },
          })
        }
        return { success: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          description: t.String({ maxLength: 2000 }),
          // round-34 — محتوای عربی (اختیاری؛ خالی = پشتیبان فارسی)
          nameAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
          descriptionAr: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
          ingredientsAr: t.Optional(t.Nullable(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 }))),
          originalPrice: t.Number({ minimum: 0 }),
          discountPercentage: t.Number({ minimum: 0, maximum: 100 }),
          // stage-47 — پنجره‌ی زمانی تخفیف محصول (ISO | null = بدون محدودیت)
          discountStartsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          discountEndsAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          prepTime: t.Number({ minimum: 1, maximum: 600 }),
          packagingCost: t.Optional(t.Number({ minimum: 0, maximum: 1000000 })),
          profileImage: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
          galleryImages: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 12 })),
          sizesEnabled: t.Optional(t.Boolean()),
          sizes: t.Optional(t.Array(sizeInput, { maxItems: 8 })),
          ingredients: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 30 })),
          // stage-48 — موجودی فروش (نیامد = دست‌نخورده)
          isAvailable: t.Optional(t.Boolean()),
          // stage-48 — پرچم‌های حالت سفارش (نیامد = دست‌نخورده)
          courierAllowed: t.Optional(t.Boolean()),
          takeawayAllowed: t.Optional(t.Boolean()),
          dineInAllowed: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Update product — categoryId immutable (frontend contract)' },
      },
    )
    .post(
      '/products/:id/toggle',
      async ({ params, user }) => {
        await deps.menu.toggleProductStatus(params.id)
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PRODUCT_TOGGLE',
            entity: 'product',
            entityId: params.id,
          })
        }
        return { success: true }
      }, {
      params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
      detail: { summary: 'Toggle product ACTIVE / INACTIVE' },
    })

  // ── stage-48 — موجود/ناموجود سریع ──
  // گارد: ادمین اصلی همیشه؛ ادمین۲ فقط با productsAvailability
  // (requireAdmin2Permission نقش admin را بدون چک مجوز رد می‌کند).
  // عملیات ادمین۲ در activities خودش ثبت می‌شود (الگوی بقیه‌ی روت‌های ادمین۲).
  const availabilityWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'productsAvailability'))
    .post(
      '/products/:id/availability',
      async ({ params, body, user }) => {
        const res = await deps.menu.setProductAvailability(params.id, body.available)
        if (!res.success) {
          return res
        }
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: body.available ? 'PRODUCT_AVAILABLE' : 'PRODUCT_UNAVAILABLE',
            entity: 'product',
            entityId: params.id,
          })
        }
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ available: t.Boolean() }),
        detail: {
          summary: 'Set product availability (main admin or admin2 with productsAvailability)',
          description:
            'stage-48: ناموجود = کارت تار + هشدار نارنجی + قفل خرید + خطای چک‌اوت؛ ' +
            'سفارش‌های باز از طریق SSE (menu:live) درجا مطلع می‌شوند.',
        },
      },
    )

  return new Elysia()
    .use(mainsRead)
    .use(structureWrite)
    .use(productsRead)
    .use(productsWrite)
    .use(availabilityWrite)
}