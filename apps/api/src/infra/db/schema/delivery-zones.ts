//src/infra/db/schema/delivery-zones.ts
import { doublePrecision, index, integer, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * ناحیه‌های ارسال — هزینه‌ی پیک بر اساس فاصله‌ی آدرس از رستوران.
 * بیرون از همه → نرخ ناحیه‌ی بیرونی (بزرگ‌ترین شعاع). مبدأ: settings.
 */
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    radiusKm: doublePrecision('radius_km').notNull(),
    fee: integer('fee').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('delivery_zones_radius_key').on(t.radiusKm),
    index('delivery_zones_radius_idx').on(t.radiusKm),
  ],
)