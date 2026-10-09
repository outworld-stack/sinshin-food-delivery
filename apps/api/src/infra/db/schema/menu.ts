// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/menu.ts
// وضعیت: جایگزینی کامل فایل موجود
// stage-48 — حالت‌های سفارش (پیک/بیرون‌بر/سرو در محل):
//        categories سه سوئیچ پایه + products سه پرچم ارث‌بری
//        (مؤثر = دسته AND محصول) + is_available محصولات.
// round-47 — تخفیف زمان‌دار: ستون‌های products (discount_starts_at/discount_ends_at)
//        و product_sizes (discount_percentage + پنجره). NULL = بدون محدودیت (رفتار قبلی).
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/menu.ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { CategoryId, MainCategoryId, ProductId, SizeId } from '#/domain/shared/brand'



/** دسته‌های سطح بالا — تب‌های منو (رستوران / فست‌فود / ...) */
export const mainCategories = pgTable(
  'main_categories',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<MainCategoryId>(), name: varchar('name', { length: 60 }).notNull(),
    /** round-34 — نام عربی (NULL = پشتیبان فارسی) */
    nameAr: varchar('name_ar', { length: 60 }),
    /** انگلیسی — در URL: /products?tab=restaurant */
    slug: varchar('slug', { length: 60 }).notNull(),
    isActive: boolean('is_active').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('main_categories_slug_key').on(t.slug),
    index('main_categories_order_idx').on(t.isActive, t.sortOrder),
  ],
)

/** دسته‌ی محصولات — فرزند یک Main */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<CategoryId>(),
    mainCategoryId: uuid('main_category_id')
      .notNull()
      .$type<MainCategoryId>()
      .references(() => mainCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
    /** round-34 — نام عربی دسته (NULL = پشتیبان فارسی) */
    nameAr: varchar('name_ar', { length: 60 }),
    /** سایزبندی برای این دسته فعال است؟ (پیتزا) — stage-48: از مودال دسته حذف شد؛ ستون برای سازگاری مانده */
    hasSizes: boolean('has_sizes').notNull().default(false),
    /** قالب نام سایزها — کوچک/متوسط/بزرگ/خانوادگی */
    sizeNames: jsonb('size_names').$type<string[]>().default([]),
    /** round-34 — قالب نام سایزها به عربی (موازی با sizeNames) */
    sizeNamesAr: jsonb('size_names_ar').$type<string[]>(),
    /**
     * stage-48 — حالت‌های سفارشِ مجاز برای «محصولاتِ این دسته» (پایه‌ی ارث‌بری).
     * محصول = دسته AND پرچم خود محصول؛ یعنی اگر دسته خاموش باشد، محصولِ روشن هم
     * مؤثراً خاموش است (قفل سلسله‌مراتبی). هر سه به‌طور پیش‌فرض روشن‌اند.
     */
    courierEnabled: boolean('courier_enabled').notNull().default(true),
    /** تحویل در محل — بیرون‌بر (PICKUP) */
    takeawayEnabled: boolean('takeaway_enabled').notNull().default(true),
    /** تحویل در محل با سرو (DINE_IN) */
    dineInEnabled: boolean('dine_in_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('categories_slug_key').on(t.slug),
    index('categories_main_idx').on(t.mainCategoryId),
  ],
)

/**
 * محصول — قیمت پایه + درصد تخفیف (بدون سایز) یا قیمت‌های مستقل سایز (با سایز).
 * sizesEnabled=true → original_price/discount نادیده گرفته می‌شود (قرارداد فرانت).
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<ProductId>(),
    categoryId: uuid('category_id')
      .notNull()
      .$type<CategoryId>()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    /** round-34 — محتوای عربی (NULL = پشتیبان فارسی) */
    nameAr: varchar('name_ar', { length: 120 }),
    descriptionAr: text('description_ar'),
    /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ true می‌گذارد؛ ذخیره‌ی دستی false */
    arAuto: boolean('ar_auto').notNull().default(false),
    originalPrice: integer('original_price').notNull().default(0),
    discountPercentage: integer('discount_percentage').notNull().default(0),
    /**
     * stage-47 — تخفیف زمان‌دار محصول (بدون سایز):
     * NULL = بدون محدودیت زمانی (همیشه فعال — رفتار قبلی)
     * پنجره = [discount_starts_at, discount_ends_at]؛ خارج از پنجره → تخفیف
     * غیرفعال و قیمت = قیمت پایه. شمارنده‌ی معکوس سایت تا پایان پنجره می‌شمارد.
     */
    discountStartsAt: timestamp('discount_starts_at', { withTimezone: true }),
    discountEndsAt: timestamp('discount_ends_at', { withTimezone: true }),
    prepTime: integer('prep_time').notNull().default(15),
    sizesEnabled: boolean('sizes_enabled').notNull().default(false),
    /**
     * stage-10: هزینه بسته‌بندی هر محصول (تومان) — به‌ازای هر واحد.
     * فقط در تحویل پیک (DELIVERY) و بیرون‌بر (PICKUP) جمع می‌شود؛
     * سرو در محل (DINE_IN) بسته‌بندی ندارد. مثل هزینه ارسال،
     * مشمول سود معرفی هم نیست (در تسویه از پایه کسر می‌شود).
     */
    packagingCost: integer('packaging_cost').notNull().default(0),
    ingredients: jsonb('ingredients').$type<string[]>().default([]),
    /** round-34 — مواد اولیه به عربی (موازی با ingredients) */
    ingredientsAr: jsonb('ingredients_ar').$type<string[]>(),
    /** آپلود واقعی فاز ۳ — فعلاً مسیر/گرادیانت */
    profileImage: text('profile_image'),
    galleryImages: jsonb('gallery_images').$type<string[]>().default([]),
    views: integer('views').notNull().default(0),
    sales: integer('sales').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | INACTIVE
    /**
     * stage-48 — موجودیِ فروشِ محصول (موجود = true). جدا از status است:
     * status=INACTIVE یعنی «از منو حذف»؛ is_available=false یعنی «فعلاً ناموجود»
     * (کارت تار + قفل خرید؛ سفارش/سبد باید هشدار نارنجی بگیرند).
     */
    isAvailable: boolean('is_available').notNull().default(true),
    /**
     * stage-48 — پرچم‌های حالت سفارش محصول (مؤثر = دسته AND این پرچم‌ها).
     * پیش‌فرض true = ارث کامل از دسته؛ ادمین فقط می‌تواند محدودترش کند.
     */
    courierAllowed: boolean('courier_allowed').notNull().default(true),
    takeawayAllowed: boolean('takeaway_allowed').notNull().default(true),
    dineInAllowed: boolean('dine_in_allowed').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
  ],
)

/** سایزهای محصول — فقط وقتی sizes_enabled
 *  stage-47 — تخفیف مستقل هر سایز: درصد + پنجره‌ی زمانی اختیاری.
 *  0/NULL = بدون تخفیف یا بدون محدودیت (رفتار قبلی). */
export const productSizes = pgTable(
  'product_sizes',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<SizeId>(),
    productId: uuid('product_id')
      .notNull()
      .$type<ProductId>()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    /** round-34 — نام عربی سایز (NULL = پشتیبان فارسی) */
    nameAr: varchar('name_ar', { length: 60 }),
    price: integer('price').notNull(),
    /** stage-47 — درصد تخفیف این سایز (۰ = بدون تخفیف) */
    discountPercentage: integer('discount_percentage').notNull().default(0),
    /** stage-47 — پنجره‌ی زمانی تخفیف این سایز (NULL = بدون محدودیت) */
    discountStartsAt: timestamp('discount_starts_at', { withTimezone: true }),
    discountEndsAt: timestamp('discount_ends_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('product_sizes_product_idx').on(t.productId),
    uniqueIndex('product_sizes_product_name_key').on(t.productId, t.name),
  ],
)