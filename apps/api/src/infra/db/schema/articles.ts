//src/infra/db/schema/articles.ts
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar, integer } from 'drizzle-orm/pg-core'

/** دسته‌ی مقاله — با/بدون ساب‌دسته */
export const articleCategories = pgTable(
  'article_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 60 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
    hasSubCategories: boolean('has_sub_categories').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('article_categories_slug_key').on(t.slug)],
)

export const articleSubCategories = pgTable(
  'article_sub_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => articleCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
  },
  (t) => [
    uniqueIndex('article_sub_slug_key').on(t.slug),
    index('article_sub_category_idx').on(t.categoryId),
  ],
)

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 160 }).notNull(),
    excerpt: text('excerpt').notNull(),
    content: text('content').notNull(),
    author: varchar('author', { length: 120 }).notNull().default('سین شین'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => articleCategories.id, { onDelete: 'restrict' }),
    subCategoryId: uuid('sub_category_id').references(() => articleSubCategories.id, {
      onDelete: 'set null',
    }),
    profileImage: text('profile_image'),
    galleryImages: jsonb('gallery_images').$type<string[]>().default([]),
    /** روند تهیه — [{ title, items[] }] مطابق فرانت */
    processes: jsonb('processes').$type<{ title: string; items: string[] }[]>().default([]),
    views: integer('views').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | INACTIVE
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('articles_category_idx').on(t.categoryId),
    index('articles_status_idx').on(t.status),
    index('articles_created_idx').on(t.createdAt),
  ],
)