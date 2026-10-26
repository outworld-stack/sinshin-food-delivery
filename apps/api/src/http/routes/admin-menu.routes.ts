// ═══════════════════════════════════════════════════════════════
// stage-63 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/admin-menu.routes.ts
// تغییر:
//   ۱) DELETE /admin/menu/products/:id — حذف کامل محصول (cascade
//        سایزها/لینک‌های M2M/نقدی‌ها؛ سفارش‌ها snapshot) + ممیزی
//        PRODUCT_DELETE برای ادمین اصلی
//   ۲) DELETE /admin/menu/categories/:id — از این پس آبشاری: محصولاتِ
//        دسته هم حذف می‌شوند (منطق در menu.service؛ مستندات detail به‌روز شد)
//
// stage-60 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/admin-menu.routes.ts
// تغییر:
//   ۱) دسته‌ها: mainCategoryIds[] (چند-والدی؛ اول = والدِ اولیه) —
//        mainCategoryId تک‌مقداری برای سازگاری باقی می‌ماند (اختیاری)
//   ۲) محصولات: categoryIds[] (M2M؛ اول = دسته‌ی اولیه) در POST و
//        PATCH (دیگر immutable نیست) + isFeatured (پرچم سنجاق)
//
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/admin-menu.routes.ts
// تغییر:
//   ۱) slug اختیاری محصول در create/patch (a-z0-9-؛ خالی = بدون slug)
//   ۲) image اختیاری هر سایز (آپلود؛ خالی = تصویر مشترک محصول)
//   ۳) PATCH نتیجه‌ی سرویس را برمی‌گرداند (پیام دوستانه‌ی slug تکراری)
// ═══════════════════════════════════════════════════════════════

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
import type { PackagingService } from '#/domain/menu/packaging.service'
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
  // stage-56 — تصویر مستقل این variant (آپلودی؛ خالی = تصویر مشترک محصول)
  image: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
})

/**
 * stage-101 — اتحادیه‌ی سفیدِ انیمیشن پس‌زمینه‌ی صفحه‌ی اختصاصیِ
 * محصول ویژه (همان قرارداد settings.featured_animation استیج-۱۰۰):
 *   • shader — شیدر موج‌دار WebGL (پیش‌فرض/انیمیشن فعلی)
 *   • sonar  — شبکه‌ی نقطه‌ای با حلقه‌های پخش‌شونده
 *   • sparks — جرقه‌های پخش‌شونده از دو گوشه
 * مقدار خارجِ اتحادیه ⇒ 422 (دستکاری‌شده ذخیره نمی‌شود).
 */
const featuredAnimationInput = t.Union([
  t.Literal('shader'),
  t.Literal('sonar'),
  t.Literal('sparks'),
])

export interface AdminMenuRoutesDeps {
  sessions: SessionService
  menu: MenuService
  admin2: Admin2Service // ← phase-1: برای سیم‌کیری permission
  /** stage-10: لاگ ممیزی — فقط عملیات ادمین اصلی (admin2 در activities خودش) */
  audit: AuditService
  /** stage-84 — اقلام بسته‌بندی (CRUD سراسری) */
  packaging: PackagingService
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
          // stage-60 — چند-والدی: آرایه مبناست؛ کلاینت قدیمی = تک‌مقداری
          mainCategoryIds: body.mainCategoryIds,
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
          // stage-60 — چند-والدی: همه‌ی والدها (اول = والدِ اولیه؛ ≤۸)
          mainCategoryIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { minItems: 1, maxItems: 8 }),
          ),
          // سازگاری با کلاینت قدیمی (تک‌والد) — سرویس آرایه را ترجیح می‌دهد
          mainCategoryId: t.Optional(t.String({ pattern: UUID_PATTERN })),
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
          // stage-60 — چند-والدی: آرایه مبناست (نیامد = دست‌نخورده)
          mainCategoryIds: body.mainCategoryIds,
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
          // stage-60 — چند-والدی: همه‌ی والدها (اول = والدِ اولیه؛ ≤۸)
          mainCategoryIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { minItems: 1, maxItems: 8 }),
          ),
          // سازگاری با کلاینت قدیمی (تک‌والد) — نیامد = دست‌نخورده
          mainCategoryId: t.Optional(t.String({ pattern: UUID_PATTERN })),
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
        detail: {
          summary:
            'Delete category — stage-63: cascade deletes its products (sizes/M2M/reviews; orders keep snapshots)',
        },
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
    // stage-84 — اقلام بسته‌بندی: خواندن با productsRead (فرم محصول + کارت مدیر)
    .get('/packaging-items', () => deps.packaging.adminList(), {
      detail: { summary: 'Packaging items (global list incl. inactive)' },
    })
    // stage-86 — وضعیت خریدِ دسته‌ها (والد + زیردسته) برای پنل محصولات.
    // productsRead کافی است (مشاهده‌ی وضعیت)؛ تغییر = productsWrite.
    .get('/purchase-state', () => deps.menu.adminPurchaseState(), {
      detail: {
        summary: 'Category purchase state (mains + categories) for products panel',
      },
    })

  const productsWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'productsWrite'))
    .post(
      '/products',
      async ({ body, user, admin2: admin2Perms }) => {
        // stage-78 — «ویژه» فقط به دست ادمین اصلی: پرچم از بدنه‌ی درخواستِ
        // ادمین۲ حذف می‌شود → create ⇒ پیش‌فرض خاموش؛ ویرایش ⇒ دست‌نخورده.
        // ادمین۲ هم محصولِ ویژه‌ی ادمین اصلی را خراب نمی‌کند و هم نمی‌تواند
        // خودش محصولی را ویژه کند (بج/Aura/صفحه‌ی متحرک = تصمیم برند).
        // stage-101 — انیمیشن اختصاصیِ همان محصول هم تازه‌سازی برند است؛
        // مثل خودِ پرچم فقط برای ادمین اصلی.
        if (user.role !== 'admin') {
          if (body.isFeatured !== undefined) delete body.isFeatured
          if (body.featuredAnimation !== undefined) delete body.featuredAnimation
        }
        // ترمیم اسکنِ استیج-۸۴ — انتخابِ اقلامِ بسته‌بندی «هزینه‌ی پولی» را تعیین
        // می‌کند (جمعِ اقلام) → مثل ویژه‌سازی فقط با مجوزِ canEditPackagingFee
        // یا ادمین اصلی؛ create بدون مجوز ⇒ بدون قلم (پشتیبانِ packaging_cost)
        if (
          user.role !== 'admin' &&
          !admin2Perms?.canEditPackagingFee
        ) {
          delete body.packagingItemIds
          delete body.packagingCost
        }
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
          // stage-84 — اقلام بسته‌بندیِ انتخابی (id های packaging_items؛ ≤۱۲)
          packagingItemIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { maxItems: 12 }),
          ),
          // stage-60 — M2M: همه‌ی دسته‌ها (اول = دسته‌ی اولیه؛ ≤۸).
          // سازگاری: categoryId تک‌مقداری قدیمی هنوز پذیرفته می‌شود.
          categoryIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { minItems: 1, maxItems: 8 }),
          ),
          categoryId: t.Optional(t.String({ pattern: UUID_PATTERN })),
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
          // stage-56 — slug انگلیسی سئوپسند (اختیاری؛ خالی = URL با UUID).
          // نرمال‌سازی + پیام دوستانه‌ی تکرار در سرویس انجام می‌شود.
          slug: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
          // stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول + Aurora در فرانت)
          isFeatured: t.Optional(t.Boolean()),
          // stage-101 — انیمیشن اختصاصی صفحه‌ی همین محصولِ ویژه
          // (NULL = ارث از تنظیم سراسری) — فقط ادمین اصلی (گارد بالا)
          featuredAnimation: t.Optional(t.Nullable(featuredAnimationInput)),
        }),
        detail: { summary: 'Create product (sizes replace-all on update)' },
      },
    )
    .patch(
      '/products/:id',
      async ({ params, body, user, admin2: admin2Perms }) => {
        // stage-78 — همان گاردِ ویژه‌سازی POST: ادمین۲ پرچم را تغییر نمی‌دهد
        // (undefined ⇒ دست‌نخورده — مقدار فعلی در دیتابیس می‌ماند)
        // stage-101 — انیمیشن اختصاصی هم دستِ ادمین اصلی است
        if (user.role !== 'admin') {
          if (body.isFeatured !== undefined) delete body.isFeatured
          if (body.featuredAnimation !== undefined) delete body.featuredAnimation
        }
        // ترمیم اسکنِ استیج-۸۴ — مثل POST: بدونِ canEditPackagingFee انتخابِ
        // اقلام حذف می‌شود ⇒ undefined ⇒ انتخابِ ذخیره‌شده دست‌نخورده می‌ماند
        if (
          user.role !== 'admin' &&
          !admin2Perms?.canEditPackagingFee
        ) {
          delete body.packagingItemIds
          delete body.packagingCost
        }
        // stage-56 — نتیجه‌ی پیام‌دار (clashِ slug → پیام دوستانه در پاسخ)
        const res = await deps.menu.updateProduct({ id: params.id, ...body })
        if (res.success && user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PRODUCT_UPDATE',
            entity: 'product',
            entityId: params.id,
            metadata: { name: body.name, packagingCost: body.packagingCost ?? 0 },
          })
        }
        return res
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
          // stage-84 — اقلام بسته‌بندی: نیامد = دست‌نخورده؛ آرایه = همگام‌سازی کامل
          packagingItemIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { maxItems: 12 }),
          ),
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
          // stage-56 — slug سئو (نیامد = دست‌نخورده؛ رشته/خالی = تنظیم/پاک‌سازی)
          slug: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
          // stage-60 — M2M: همه‌ی دسته‌ها (اول = دسته‌ی اولیه؛ ≤۸).
          // نیامد = دست‌نخورده؛ آرایه = همگام‌سازی کامل (دسته دیگر immutable نیست)
          categoryIds: t.Optional(
            t.Array(t.String({ pattern: UUID_PATTERN }), { minItems: 1, maxItems: 8 }),
          ),
          // stage-60 — پرچم ویژه/سنجاق (نیامد = دست‌نخورده)
          isFeatured: t.Optional(t.Boolean()),
          // stage-101 — انیمیشن اختصاصیِ همین محصولِ ویژه:
          // undefined = دست‌نخورده | NULL = پاک‌سازی (ارث از سراسری) | مقدار
          featuredAnimation: t.Optional(t.Nullable(featuredAnimationInput)),
        }),
        detail: {
          summary:
            'Update product — categoryIds optional (undefined = untouched; array = full M2M sync)',
        },
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
    // stage-63 — حذف کامل محصول (سایزها/لینک‌های M2M/نقدی‌ها با cascade DB)
    .delete(
      '/products/:id',
      async ({ params, user }) => {
        const res = await deps.menu.deleteProduct(params.id)
        if (res.success && user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PRODUCT_DELETE',
            entity: 'product',
            entityId: params.id,
          })
        }
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary: 'Delete product (sizes/M2M links/reviews cascade; orders keep snapshots)',
        },
      },
    )

  // ── stage-84 — اقلام بسته‌بندی (قیمتِ سراسری) ──
  // گارد: ادمین اصلی همیشه؛ ادمین۲ فقط با canEditPackagingFee — یعنی
  // همان پرچمی که از round-34 در قرارداد/پنل بود و روت فعالی نداشت (سرانجام
  // wired شد). قیمتِ سراسری روی پولِ چک‌اوت اثر می‌گذارد؛ خواندن با productsRead.
  const packagingWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'canEditPackagingFee'))
    .post(
      '/packaging-items',
      async ({ body, user }) => {
        const item = await deps.packaging.add(body)
        await deps.menu.notifyPackagingChanged()
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PACKAGING_ITEM_ADD',
            entity: 'packaging_item',
            entityId: item.id,
            metadata: { title: item.title, price: item.price },
          })
        }
        return item
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 60 }),
          titleAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
          price: t.Number({ minimum: 0, maximum: 100000000 }),
          sortOrder: t.Optional(t.Numeric({ minimum: 0, maximum: 999 })),
        }),
        detail: { summary: 'Add packaging item (global price)' },
      },
    )
    .patch(
      '/packaging-items/:id',
      async ({ params, body, user }) => {
        const item = await deps.packaging.update(params.id, {
          title: body.title,
          titleAr: body.titleAr,
          price: body.price,
          isActive: body.isActive,
          sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
        })
        await deps.menu.notifyPackagingChanged()
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PACKAGING_ITEM_UPDATE',
            entity: 'packaging_item',
            entityId: item.id,
            metadata: { title: item.title, price: item.price, isActive: item.isActive },
          })
        }
        return item
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({
          title: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          titleAr: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
          price: t.Optional(t.Number({ minimum: 0, maximum: 100000000 })),
          isActive: t.Optional(t.Boolean()),
          sortOrder: t.Optional(t.Numeric({ minimum: 0, maximum: 999 })),
        }),
        detail: {
          summary: 'Update packaging item (price is global — applies to every product that includes it)',
        },
      },
    )
    .delete(
      '/packaging-items/:id',
      async ({ params, user }) => {
        await deps.packaging.remove(params.id)
        await deps.menu.notifyPackagingChanged()
        if (user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: 'PACKAGING_ITEM_REMOVE',
            entity: 'packaging_item',
            entityId: params.id,
          })
        }
        return { success: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary: 'Delete packaging item (product links cascade; products fall back to legacy packagingCost)',
        },
      },
    )

  // ── stage-86 — غیرفعال‌سازی خریدِ دسته‌ها ──
  // گارد عمدی: productsWrite (نه mainCategoriesWrite) — درخواستِ صریحِ کارفرما:
  // «ادمین سطح ۲ هم با مجوز دسترسی و ویرایش محصولات بتونه این کارو انجام بده».
  // ادمین اصلی همیشه رد می‌شود؛ خواندن با productsRead (بالای فایل).
  const purchaseWrite = new Elysia({ prefix: '/admin/menu', tags: ['Admin / Menu'] })
    .use(requireAdmin2Permission(admin2, 'productsWrite'))
    .post(
      '/mains/:id/purchase',
      async ({ params, body, user }) => {
        const res = await deps.menu.setMainPurchase(params.id, body.purchaseEnabled)
        if (res.success && user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: body.purchaseEnabled ? 'MAIN_PURCHASE_ON' : 'MAIN_PURCHASE_OFF',
            entity: 'main_category',
            entityId: params.id,
          })
        }
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ purchaseEnabled: t.Boolean() }),
        detail: {
          summary: 'Enable/disable purchase of a main category (productsWrite)',
          description:
            'stage-86: خاموش = تب و محصولات می‌مانند ولی «افزودن به سبد خرید» قفل می‌شود ' +
            '(کارت/صفحه‌ی محصول + گارد سبد/چک‌اوت). جداست از isActive (نمایش تب).',
        },
      },
    )
    .post(
      '/categories/:id/purchase',
      async ({ params, body, user }) => {
        const res = await deps.menu.setCategoryPurchase(params.id, body.purchaseEnabled)
        if (res.success && user.role === 'admin') {
          await deps.audit.log({
            actorId: user.id,
            action: body.purchaseEnabled ? 'CATEGORY_PURCHASE_ON' : 'CATEGORY_PURCHASE_OFF',
            entity: 'category',
            entityId: params.id,
          })
        }
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ purchaseEnabled: t.Boolean() }),
        detail: {
          summary: 'Enable/disable purchase of a category (productsWrite)',
          description:
            'stage-86: مؤثر = این پرچم AND پرچمِ والدِ اولیه — خریدِ زنجیره‌ی اولیه قفل می‌شود.',
        },
      },
    )

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
    .use(purchaseWrite)
    .use(packagingWrite)
    .use(availabilityWrite)
}
