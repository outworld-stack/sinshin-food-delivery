//src/infra/db/schema/users.ts
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * نقش‌ها:
 *  user    — کاربر عادی (قید دستگاه + قوانین)
 *  admin   — ادمین اصلی (SUPER_ADMIN_PHONES) — از همه‌ی قیدها معاف
 *  admin2  — ادمین سطح ۲ — فقط در ساعات باز بودن رستوران + تک‌نشست
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 11 }).notNull(),
    /** نام کامل نمایشی — فرانت با firstName/lastName کار می‌کند؛ در پنل وصل می‌شوند */
    name: text('name'),
    email: text('email'),
    role: varchar('role', { length: 20 }).notNull().default('user'),
    tokenVersion: integer('token_version').notNull().default(0),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }), // status نمایشی پنل (toggle)
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    referralCode: varchar('referral_code', { length: 16 }),
    referredBy: uuid('referred_by').references((): AnyPgColumn => users.id),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: varchar('terms_version', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_phone_key').on(t.phone),
    index('users_token_version_idx').on(t.tokenVersion),
    uniqueIndex('users_referral_code_key').on(t.referralCode),
    index('users_referred_by_idx').on(t.referredBy),
    index('users_role_idx').on(t.role),
  ],
)

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert