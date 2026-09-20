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
    /** سایزبندی برای این دسته فعال است؟ (پیتزا) */
    hasSizes: boolean('has_sizes').notNull().default(false),
    /** قالب نام سایزها — کوچک/متوسط/بزرگ/خانوادگی */
    sizeNames: jsonb('size_names').$type<string[]>().default([]),
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
    originalPrice: integer('original_price').notNull().default(0),
    discountPercentage: integer('discount_percentage').notNull().default(0),
    prepTime: integer('prep_time').notNull().default(15),
    sizesEnabled: boolean('sizes_enabled').notNull().default(false),
    ingredients: jsonb('ingredients').$type<string[]>().default([]),
    /** آپلود واقعی فاز ۳ — فعلاً مسیر/گرادیانت */
    profileImage: text('profile_image'),
    galleryImages: jsonb('gallery_images').$type<string[]>().default([]),
    views: integer('views').notNull().default(0),
    sales: integer('sales').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | INACTIVE
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
  ],
)

/** سایزهای محصول — فقط وقتی sizes_enabled */
export const productSizes = pgTable(
  'product_sizes',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<SizeId>(),
    productId: uuid('product_id')
      .notNull()
      .$type<ProductId>()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    price: integer('price').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('product_sizes_product_idx').on(t.productId),
    uniqueIndex('product_sizes_product_name_key').on(t.productId, t.name),
  ],
)