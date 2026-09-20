//src/infra/db/schema/gallery.ts
import { boolean, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { GalleryImageId } from '#/domain/shared/brand'

export const galleryImages = pgTable(
  'gallery_images',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<GalleryImageId>(),
    src: text('src').notNull(),
    alt: text('alt').notNull(),
    span: varchar('span', { length: 10 }).notNull().default('normal'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gallery_order_idx').on(t.isActive, t.sortOrder)],
)