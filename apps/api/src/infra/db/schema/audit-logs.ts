//src/infra/db/schema/audit-logs.ts
import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import type { UserId } from '@sinshin/shared'


/** گزارش تغییرات — append-only؛ پشتیبان صفحه‌ی لاگ‌های کاربر در پنل */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').$type<UserId>().references(() => users.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').$type<UserId>().references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 60 }).notNull(),
    entity: varchar('entity', { length: 40 }),        // user / order / product / ...
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    ip: varchar('ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_user_idx').on(t.userId),
    index('audit_created_idx').on(t.createdAt),
    index('audit_action_idx').on(t.action),
  ],
)