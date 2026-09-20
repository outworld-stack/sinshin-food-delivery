//src/infra/db/schema/reconcile.ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * یافته‌های مغایرت‌گیری — append + mutate status.
 *
 * قرارداد unique: (check_id, entity_id) — یک finding زنده per entity per check؛
 * status در همان ردیف آپدیت می‌شود (نه ردیف جدید) — وگرنه finding
 * هم‌زمان open و acknowledged می‌شود و dedup می‌شکند.
 *
 * resolved_at: هم برای دستی (acknowledged) هم auto_fixed پر می‌شود.
 */
export const reconcileFindings = pgTable(
  'reconcile_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** R1..R10 */
    checkId: varchar('check_id', { length: 10 }).notNull(),
    /** info | warning | critical */
    severity: varchar('severity', { length: 12 }).notNull(),
    /** open | auto_fixed | acknowledged | resolved_external */
    status: varchar('status', { length: 20 }).notNull().default('open'),
    /** order | payment | wallet_tx | user */
    entityType: varchar('entity_type', { length: 16 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** تعداد دفعاتی که این finding در اجراهای متوالی دیده شده */
    occurrences: integer('occurrences').notNull().default(1),
  },
  (t) => [
    uniqueIndex('reconcile_finding_key').on(t.checkId, t.entityId),
    index('reconcile_finding_status_idx').on(t.status, t.severity, t.firstSeenAt),
  ],
)

export type ReconcileFindingRow = typeof reconcileFindings.$inferSelect