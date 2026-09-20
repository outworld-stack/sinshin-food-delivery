//src/infra/db/schema/coupons.ts
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { CampaignId, ConditionId, OrderId } from '#/domain/shared/brand'
import { users } from './users'
import { orders } from './orders'

/**
 * کوپن — موجودیت واحد بر اساس قرارداد فرانت.
 * عمومی (isPublic=true): بدون شرط — هر کاربری با «کد» در چک‌اوت مصرف می‌کند.
 * خصوصی (isPublic=false): با N شرط — فقط به هدف‌یابی‌شده‌ها اعطا می‌شود (coupon_grants).
 */
export const couponConditionTypeEnum = pgEnum('coupon_condition_type', [
  'MIN_ORDERS_COUNT', // { count }
  'MIN_TOTAL_SPEND', // { amount }
  'MIN_PRODUCT_ORDERS', // { productId, count }
  'MIN_CATEGORY_ORDERS', // { categoryId, count }
  'REGISTERED_DAYS_AGO', // { days }
  'MIN_REFERRALS', // { count }
  'MIN_REFERRAL_ORDERS', // { count }
  'MIN_REFERRAL_SPEND', // { amount }
  'ORDERS_IN_LAST_DAYS', // { days, count } — اختصاصی موتور کمپین
])

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').defaultRandom().primaryKey().$type<CampaignId>(),
    /** کد قابل‌تایپ — برای عمومی اجباری؛ برای خصوصی شناسه‌ی نمایشی */
    code: varchar('code', { length: 32 }).notNull(),
    title: varchar('title', { length: 120 }),
    discountPercentage: integer('discount_percentage').notNull(),
    /** ۰ = نامحدود */
    maxUses: integer('max_uses').notNull().default(0),
    usedCount: integer('used_count').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coupons_code_key').on(t.code),
    index('coupons_active_idx').on(t.isActive, t.startsAt, t.endsAt),
  ],
)

export const couponConditions = pgTable(
  'coupon_conditions',
  {
    id: uuid('id').defaultRandom().primaryKey().$type<ConditionId>(),
    couponId: uuid('coupon_id')
      .notNull()
      .$type<CampaignId>()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    type: couponConditionTypeEnum('type').notNull(),
    params: jsonb('params').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conditions_coupon_idx').on(t.couponId)],
)

/** مصرف کوپن روی سفارش — در settle ثبت می‌شود؛ در fail رزرو آزاد می‌شود */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    couponId: uuid('coupon_id')
      .notNull()
      .$type<CampaignId>()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .$type<OrderId>()
      .references(() => orders.id, { onDelete: 'cascade' }),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('redemptions_coupon_idx').on(t.couponId),
    index('redemptions_user_idx').on(t.userId),
  ],
)

/** اعطای خصوصی — خروجی موتور کمپین (فاز ۵) */
export const couponGrants = pgTable(
  'coupon_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    couponId: uuid('coupon_id')
      .notNull()
      .$type<CampaignId>()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('grants_coupon_user_key').on(t.couponId, t.userId),
    index('grants_user_idx').on(t.userId),
  ],
)

/** کرون شبانه — نامزدهای nudge (کوپن‌های خصوصی فعال) */
export const couponNudges = pgTable(
  'coupon_nudges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    couponId: uuid('coupon_id')
      .notNull()
      .$type<CampaignId>()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    missingConditionId: uuid('missing_condition_id')
      .notNull()
      .$type<ConditionId>()
      .references(() => couponConditions.id, { onDelete: 'cascade' }),
    missingCount: integer('missing_count'),
    scanDate: date('scan_date').notNull(),
    smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('nudges_once_per_day').on(t.userId, t.couponId, t.scanDate),
    index('nudges_pending_idx').on(t.scanDate, t.smsSentAt),
  ],
)