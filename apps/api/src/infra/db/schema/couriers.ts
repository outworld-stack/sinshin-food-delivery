//src/infra/db/schema/couriers.ts
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { CourierId, OrderId } from '#/domain/shared/brand'

/** پیک‌ها — نه لزوماً کاربر سیستم؛ توسط ادمین اضافه می‌شوند */
export const couriers = pgTable(
  'couriers',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<CourierId>(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 11 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('couriers_phone_key').on(t.phone),
    index('couriers_active_idx').on(t.isActive),
  ],
)

/** سفر پیک — یک خروج از مغازه با یک یا چند سفارش */
export const courierTrips = pgTable(
  'courier_trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courierId: uuid('courier_id')
      .notNull()
      .$type<CourierId>()
      .references(() => couriers.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('courier_trips_courier_idx').on(t.courierId),
    index('courier_trips_started_idx').on(t.startedAt),
  ],
)

/** تحویل‌های هر سفر — رکورد تاریخی؛ بدون FK (سفارش‌ها هرگز حذف نمی‌شوند) */
export const courierDeliveries = pgTable(
  'courier_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => courierTrips.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').$type<OrderId>().notNull(),
    addressSnapshot: text('address_snapshot').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [
    index('courier_deliveries_trip_idx').on(t.tripId),
    index('courier_deliveries_order_idx').on(t.orderId),
  ],
)