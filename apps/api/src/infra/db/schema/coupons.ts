//src/infra/db/schema/coupons.ts
import { sql } from 'drizzle-orm'
import {
  bigint,
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
    /**
     * stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (اسکن شایستگی + nudge).
     * پیش‌فرض خاموش: کوپن فقط لحظه‌ی تسویه سفارش اعطا می‌شود.
     * روشن = کوپن وارد بررسی دوره‌ای cron هم می‌شود.
     */
    cronEnabled: boolean('cron_enabled').notNull().default(false),
    /**
     * stage-65 — ممنوعیت اعلان انتشارِ ساخت (سوییچ فرم؛ پیش‌فرض خاموش).
     * true = کوپن «بی‌صدا» ساخته می‌شود: broadcast ساخت برای کاربران
     * ارسال نمی‌شود. فقط لحظه‌ی ساخت معنا دارد — ویرایش/فعال‌سازی مجدد
     * طبق سیاست stage-64 به‌هرحال اعلان نمی‌گیرد.
     */
    announceSuppressed: boolean('announce_suppressed').notNull().default(false),
    /**
     * stage-66 — سقف مصرف به‌ازای هر کاربر برای کوپن «عمومی» (سیاست
     * کارفرما: هنگام ساخت توسط ادمین اصلی قابل‌تنظیم).
     * ۰ = نامحدود (رفتار قبلی — کوپن‌های موجود دست‌نخورده می‌مانند).
     * شمارش = redemptionهای فعال + سفارش‌های PENDING_PAYMENT با همین
     * کوپن (رزروِ در جریان). برای کوپن خصوصی بی‌معناست — گرنت یکتا
     * (grants_coupon_user_key) ذاتاً یک مصرف به‌ازای کاربر است؛ ستون
     * ذخیره می‌شود ولی فقط مسیر عمومی آن را می‌خواند.
     */
    maxPerUser: integer('max_per_user').notNull().default(0),
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

/** مصرف کوپن روی سفارش — در تسویه ثبت می‌شود؛ در شکست رزرو آزاد می‌شود */
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
    // رارد L11 — یک کوپن روی یک سفارش فقط یک بار ثبت مصرف می‌شود؛
    // onConflictDoNothing در order.service حالا قید واقعی پشتش است.
    uniqueIndex('redemptions_coupon_order_key')
      .on(t.couponId, t.orderId)
      .where(sql`order_id is not null`),
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

/** کرون شبانه — نامزدهای nudge (کوپن‌های خصوصی فعال)
 *  stage-67 — FK شرطِ ناقص از cascade به set-null تغییر کرد: ویرایشِ
 *  کوپن شرط‌ها را حذف+بازسازی می‌کند؛ قبلاً همین cascade همه‌ی nudgeهای
 *  آن کوپن را پاک می‌کرد و «سقف ۲ یادآور به‌ازای کاربر» با هر ویرایش
 *  صفر می‌شد (کاربر دوباره ۲ یادآورِ تازه می‌گرفت). حالا ردیف‌ها با
 *  missingConditionId=null زنده می‌مانند — شمارشِ سقف در
 *  findNudgeCandidates مستقل از join شرط است و سرجایش می‌ماند؛ ردیف‌های
 *  set-null دیگر قابل ارسال هم نیستند (innerJoin در جاب ارسال). */
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
    /**
     * stage-67 — nullable + ON DELETE SET NULL: ویرایش شرط‌ها ردیف را
     * نمی‌کشد (حفظ سقف ۲)؛ null = «شرطِ مرجع در ویرایش جایگزین شده» —
     * قابل ارسال نیست ولی در شمارش سقف می‌ماند.
     */
    missingConditionId: uuid('missing_condition_id')
      .$type<ConditionId>()
      .references(() => couponConditions.id, { onDelete: 'set null' }),
    /** تعداد «شرط‌های» ناقص — با مخاطب همه-به-جز-یکی همیشه ۱ است */
    missingCount: integer('missing_count'),
    /**
     * stage-66 — فاصله‌ی واقعی تا شرطِ ناقص در واحد خودِ آن شرط
     * (مثلا «۳ سفارش دیگر» / «۵۰۰ هزار تومان دیگر») — سیاست کارفرما:
     * پیام یادآور باید پیشرفت واقعی را بگوید نه «یک قدم».
     * در اسکنِ شبانه = سقف شرط منهای مقدار فعلی کاربر (بالا گرد شده).
     * null = ردیف‌های قدیمی پیش از مهاجرت → متن جایگزین «یک قدم».
     */
    remainingCount: bigint('remaining_count', { mode: 'number' }),
    scanDate: date('scan_date').notNull(),
    smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('nudges_once_per_day').on(t.userId, t.couponId, t.scanDate),
    index('nudges_pending_idx').on(t.scanDate, t.smsSentAt),
  ],
)
