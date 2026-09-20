//src/infra/db/schema/admin2.ts
import { boolean, index, pgEnum, jsonb, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import type { UserId } from '#/domain/shared/brand'

/**
 * دسته‌ی ادمین سطح ۲ — scope سفارشاتی که می‌بیند/تایید می‌کند:
 *  hall     → فقط DINE_IN (سرو در سالن)
 *  takeaway → DELIVERY (پیک) + PICKUP (بسته‌بندی، بردن با خود)
 * هر دو = هردو scope.
 */
export const admin2ScopeEnum = pgEnum('admin2_scope', ['hall', 'takeaway'])

export const admin2Profiles = pgTable(
  'admin2_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    isActive: boolean('is_active').notNull().default(true),
    ordersConfirmed: integer('orders_confirmed').notNull().default(0),

    /** دسته — توسط ادمین اصلی تعیین/تغییر می‌یابد */
    scopeHall: boolean('scope_hall').notNull().default(false),
    scopeTakeaway: boolean('scope_takeaway').notNull().default(false),

    // ── permissions — ۹ پرچم فرانت + ۲ جدید ──
    productsRead: boolean('products_read').notNull().default(false),
    productsWrite: boolean('products_write').notNull().default(false),
    usersRead: boolean('users_read').notNull().default(false),
    usersWrite: boolean('users_write').notNull().default(false),
    couriersRead: boolean('couriers_read').notNull().default(false),
    couriersWrite: boolean('couriers_write').notNull().default(false),
    mainCategoriesRead: boolean('main_categories_read').notNull().default(false),
    mainCategoriesWrite: boolean('main_categories_write').notNull().default(false),
    orderDetailsRead: boolean('order_details_read').notNull().default(false),
    /** اعلام بسته/باز موقت رستوران */
    canToggleTemporaryClose: boolean('can_toggle_temporary_close').notNull().default(false),
    /** ویرایش/به‌روزرسانی هزینه بسته‌بندی */
    canEditPackagingFee: boolean('can_edit_packaging_fee').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin2_active_idx').on(t.isActive)],
)

/**
 * سابقه‌ی سشن‌های ادمین۲ — گسترش «گزارش حضور» به گزارش کامل فعالیت.
 * wasActive با اولین فعالیت معنادار true می‌شود؛ activities جزئی‌تر در جدول پایین.
 */
export const admin2Sessions = pgTable(
  'admin2_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'cascade' }),
    loginAt: timestamp('login_at', { withTimezone: true }).notNull().defaultNow(),
    logoutAt: timestamp('logout_at', { withTimezone: true }),
    wasActive: boolean('was_active').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  },
  (t) => [
    index('admin2_sessions_admin_idx').on(t.adminUserId),
    index('admin2_sessions_login_idx').on(t.loginAt),
  ],
)

/**
 * فعالیت‌های ادمین۲ — append-only audit.
 * هر کاری که ادمین۲ می‌کند یک ردیف؛ صفحه‌ی او در پنل ادمین اصلی با فیلتر.
 */
export const admin2Activities = pgTable(
  'admin2_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** LOGIN | LOGOUT | ORDER_CONFIRM | COURIER_ASSIGN | COURIER_REASSIGN | NOTE_SEEN | TEMP_CLOSE | TEMP_OPEN | PACKAGING_FEE_CHANGE | SECURITY_TOGGLE */
    action: varchar('action', { length: 30 }).notNull(),
    /** سفارشِ درگیر — displayId برای خوانایی گزارش */
    orderDisplayId: varchar('order_display_id', { length: 20 }),
    /** جزئیات JSON — قبل/بعد و ... */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admin2_activities_admin_idx').on(t.adminUserId, t.createdAt),
    index('admin2_activities_action_idx').on(t.action),
  ],
)