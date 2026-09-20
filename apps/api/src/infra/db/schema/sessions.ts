//src/infra/db/schema/sessions.ts
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { devices } from './devices'


import type { DeviceId, SessionId, UserId } from '#/domain/shared/brand'

/**
 * نشست‌ها — یک نشست به ازای هر «ورود دستگاه» (خانواده‌ی refresh token).
 *
 * refresh_hash: sha256 توکن refresh «فعلی» — با هر چرخش به‌روز می‌شود.
 * previous_refresh_hash: هشِ توکنِ قبلاً-چرخیده —
 *   ارائه‌ی دوباره‌ی همان توکن قدیمی = «استفاده‌ی مجدد» (نشانه‌ی سرقت)
 *   → کل نشست فوراً باطل می‌شود (reuse detection / ابطال خانواده).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<SessionId>(),
    userId: uuid('user_id')
      .notNull()
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .$type<DeviceId>()
      .references(() => devices.id, { onDelete: 'cascade' }),
    refreshHash: varchar('refresh_hash', { length: 64 }).notNull(),
    previousRefreshHash: varchar('previous_refresh_hash', { length: 64 }),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 30 }),
  },
  (t) => [
    uniqueIndex('sessions_refresh_hash_key').on(t.refreshHash),
    index('sessions_prev_hash_idx').on(t.previousRefreshHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_device_idx').on(t.deviceId),
  ],
)

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert