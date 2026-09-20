//src/infra/db/schema/addresses.ts
import { doublePrecision, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { AddressId } from '#/domain/shared/brand'
import { users } from './users'

/** آدرس‌های کاربر — مختصات برای محاسبه‌ی فاصله‌ی ناحیه‌ای (haversine) */
export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AddressId>(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 60 }).notNull(),
    address: text('address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
)

export type AddressRow = typeof addresses.$inferSelect
export type { AddressId }