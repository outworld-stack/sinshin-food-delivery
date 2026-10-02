// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 5 از 49
// مسیر مقصد: apps/api/src/infra/db/schema/gallery.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/gallery.ts
import { boolean, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { GalleryImageId } from '#/domain/shared/brand'

export const galleryImages = pgTable(
  'gallery_images',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<GalleryImageId>(),
    src: text('src').notNull(),
    alt: text('alt').notNull(),
    /** round-34 — متن جایگزین عربی (NULL = پشتیبان فارسی) */
    altAr: text('alt_ar'),
    /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ true می‌گذارد؛ ذخیره‌ی دستی false */
    arAuto: boolean('ar_auto').notNull().default(false),
    span: varchar('span', { length: 10 }).notNull().default('normal'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gallery_order_idx').on(t.isActive, t.sortOrder)],
)