// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/menu.ts
// تغییر: ۱) products.slug (varchar 80 اختیاری + ایندکس یکتا — slug انگلیسی
//        سئوپسند برای URL؛ NULL = همان UUID قبلی)  ۲) product_sizes.image
//        (تصویر مستقل هر variant — NULL = تصویر مشترک محصول)
// ═══════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════
// stage-60 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/menu.ts
// تغییر (راند ۲ — سه قابلیت):
//   ۱) category_mains — اشتراک یک دسته بین چند دسته‌ی اصلی (دسته‌ی
//        «نوشیدنی» زیر هم «رستوران» و «فست‌فود»). mainCategoryId
//        می‌ماند = والد اولیه (primary)؛ جدول فقط لینک‌های اضافه را
//        نگه می‌دارد تا کوئری‌های FK قدیمی دست‌نخورده بمانند.
//   ۲) product_categories — چند-دسته‌ای شدن محصول (M2M). categoryId
//        می‌ماند = دسته‌ی اولیه (primary؛ مسیر پول/کوپن/SSE همان
//        می‌ماند)؛ جدول فقط دسته‌های اضافه را نگه می‌دارد.
//   ۳) products.is_featured — پرچم «همیشه جزو ۴ آیتم اول» با فیلتر/دسته
//        هرچه باشد (UI فرانت پس‌زمینه Aurora می‌گیرد).
// ═════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// stage-86 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/menu.ts
// تغییر: «غیرفعال‌سازی خرید» دسته‌بندی‌ها — ستون purchase_enabled روی
//        main_categories و categories (پیش‌فرض true). غیرفعال = محصولاتِ
//        زنجیره‌ی اولیه (دسته + والدِ دسته) دیده می‌شوند ولی «افزودن به
//        سبد خرید»شان قفل است (کارت/صفحه‌ی محصول + گارد سبد/چک‌اوت).
//        جدا از main_categories.is_active است (آن = نمایش/پنهان‌شدن تب).
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/menu.ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
    /**
     * stage-86 — امکان خریدِ محصولاتِ این والد (پیش‌فرض روشن). خاموش = تب و
     * محصولات می‌مانند ولی دکمه‌ی سبد قفل + سبد/چک‌اوت خطا می‌گیرند.
     * جدا از isActive (نمایش تب) — مستقل از هم کار می‌کنند.
     */
    purchaseEnabled: boolean('purchase_enabled').notNull().default(true),
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
    /**
     * stage-86 — امکان خریدِ محصولاتِ این دسته (پیش‌فرض روشن). خاموش = محصولات
     * در منو می‌مانند ولی دکمه‌ی «افزودن به سبد خرید» (کارت + صفحه‌ی محصول)
     * قفل + سبد/چک‌اوت گارد خطا. مؤثر = این پرچم AND پرچمِ والدِ اولیه.
     */
    purchaseEnabled: boolean('purchase_enabled').notNull().default(true),
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
    /**
     * stage-56 — slug انگلیسیِ سئوپسند (a-z0-9 و خط تیره). NULL = بدون slug →
     * URL همان UUID است (لینک‌های قدیمی/سبد/جزئیات سفارش دست‌نخورده می‌مانند).
     * canonical/sitemap/cardها به‌محض تعیین slug از آن استفاده می‌کنند.
     */
    slug: varchar('slug', { length: 80 }),
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
    /**
     * stage-60 — پرچم «ویژه/سنجاق» محصول: آیتم علامت‌خورده در فرانت
     * فارغ از فیلتر/مرتب‌سازی/دسته‌ی انتخابی کاربر، همیشه در ۴ خانه‌ی
     * اول لیست (جای دقیق تصادفی) می‌نشیند و کارتش پس‌زمینه Aurora
     * می‌گیرد. صرفاً پرچم داده است — منطق چینش کامل سمت فرانت است.
     */
    isFeatured: boolean('is_featured').notNull().default(false),
    /**
     * stage-101 — انیمیشن پس‌زمینه‌ی «صفحه‌ی اختصاصی این محصول ویژه»:
     * 'shader' | 'sonar' | 'sparks'. NULL = ارث از تنظیمِ سراسری
     * (settings.featured_animation — کارت تنظیمات) — تا هر محصولِ ویژه
     * بتواند انیمیشن مخصوص خودش را داشته باشد (انتخاب در فرم محصول،
     * همان‌جا که ویژه می‌شود). فقط وقتی isFeatured معنا دارد.
     */
    featuredAnimation: varchar('featured_animation', { length: 12 }),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
    /** stage-56 — یکتاییِ slug (NULLهای تکراری مجازند — محصولات بدون slug) */
    uniqueIndex('products_slug_key').on(t.slug),
    /** stage-60 — جست‌وجوی سریع آیتم‌های سنجاق‌شده (لیست عمومی/ادمین) */
    index('products_featured_idx').on(t.isFeatured),
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
    /**
     * stage-56 — تصویر مستقل این سایز/variant (آدرس آپلودشده؛ NULL = بدون تصویر
     * → گالری محصول همان تصاویر مشترک را نشان می‌دهد). با انتخاب سایز، تصویرِ
     * variant به‌عنوان اسلاید نخست گالری + بندانگشتی چیپ سایز ظاهر می‌شود.
     */
    image: text('image'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('product_sizes_product_idx').on(t.productId),
    uniqueIndex('product_sizes_product_name_key').on(t.productId, t.name),
  ],
)

/**
 * stage-60 — اشتراک دسته بین چند دسته‌ی اصلی (رستوران + فست‌فود).
 * ⚠️ فقط «لینک‌های اضافه» را نگه می‌دارد؛ والدِ اولیه همان
 * categories.mainCategoryId است و هرگز در این جدول تکرار نمی‌شود
 * (کوئری‌های خواندن = FK اصلی ∪ این جدول؛ بدون ریسک تکرار ردیف).
 * حذف دسته/والد → cascade لینک‌ها؛ ردیف دسته یکی می‌ماند.
 */
export const categoryMains = pgTable(
  'category_mains',
  {
    categoryId: uuid('category_id')
      .notNull()
      .$type<CategoryId>()
      .references(() => categories.id, { onDelete: 'cascade' }),
    mainId: uuid('main_id')
      .notNull()
      .$type<MainCategoryId>()
      .references(() => mainCategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.mainId] }),
    index('category_mains_main_idx').on(t.mainId),
  ],
)

/**
 * stage-60 — چند-دسته‌ای شدن محصول (M2M): یک محصول با دسته‌ی اولیه‌ی
 * «کباب‌ها» می‌تواند در «خوش‌مزه‌ها» هم دیده شود.
 * ⚠️ فقط «دسته‌های اضافه» را نگه می‌دارد؛ دسته‌ی اولیه همان
 * products.categoryId است و هرگز در این جدول تکرار نمی‌شود:
 *   • مسیر پول (سبد/چک‌اوت/کوپن با p.category_id خام) دست‌نخورده
 *   • SSE/حالت‌های سفارش از دسته‌ی اولیه ارث می‌برند (سازگار با قبل)
 *   • کوئری‌ها = FK اصلی ∪ این جدول (بدون join → بدون تکرار محصول)
 */
export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .$type<ProductId>()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .$type<CategoryId>()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index('product_categories_category_idx').on(t.categoryId),
  ],
)

/**
 * stage-84 — اقلام بسته‌بندی با قیمتِ سراسری. ادمین‌ها لیستِ سراسری را یک‌بار
 * قیمت‌گذاری می‌کنند (مثل ناحیه‌های ارسال)؛ در فرمِ محصول، اقلامِ موردنیازِ
 * آن محصول انتخاب می‌شوند و «هزینه بسته‌بندی مؤثر» = جمعِ قیمتِ اقلامِ فعالِ
 * همان محصول (بدون قلم → پشتیبانِ ستونِ legacy یعنی packaging_cost).
 * مشتری فقط جمعِ کل را در چک‌اوت/فاکتور می‌بیند — ریزِ اقلام هرگز عمومی نیست.
 */
export const packagingItems = pgTable(
  'packaging_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 60 }).notNull(),
    /** round-34 — عنوان عربی (NULL = پشتیبان فارسی؛ فقط پنل ادمین) */
    titleAr: varchar('title_ar', { length: 60 }),
    /** قیمت سراسری قلم (تومان) — مثل delivery_zones.fee فقط integer امن */
    price: integer('price').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('packaging_items_active_idx').on(t.isActive, t.sortOrder)],
)

/**
 * stage-84 — اقلامِ بسته‌بندیِ هر محصول (M2M؛ الگوی productCategories):
 * فقط «انتخاب‌ها» را نگه می‌دارد؛ قیمت همیشه از جدولِ سراسری خوانده می‌شود
 * (تغییرِ قیمتِ سراسری همان لحظه روی همه‌ی محصولاتِ دارایِ آن قلم اعمال می‌شود).
 * حذف قلم/محصول → cascade لینک‌ها؛ مسیر پول (checkout/preview) جمعِ لحظه‌ای
 * می‌خواند و در breakdown همان جمعِ کل snapshot می‌شود — مثل قبل.
 */
export const productPackagingItems = pgTable(
  'product_packaging_items',
  {
    productId: uuid('product_id')
      .notNull()
      .$type<ProductId>()
      .references(() => products.id, { onDelete: 'cascade' }),
    packagingItemId: uuid('packaging_item_id')
      .notNull()
      .references(() => packagingItems.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.packagingItemId] }),
    index('product_packaging_items_item_idx').on(t.packagingItemId),
  ],
)