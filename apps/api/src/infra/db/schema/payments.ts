//src/infra/db/schema/payments.ts
import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, jsonb, pgSequence, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import type { OrderId, PaymentId } from '#/domain/shared/brand'
import { users } from './users'
import { orders } from './orders'

/** Reserve every historical 48-bit Mellat hash; new IDs are never recycled. */
export const mellatOrderIdSequence = pgSequence('mellat_order_id_seq', {
  increment: 1,
  minValue: '281474976710656',
  maxValue: '9223372036854775807',
  startWith: '281474976710656',
  cache: 1,
  cycle: false,
})

/** هر تلاش پرداخت یک ردیف — ممیزی کامل */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<PaymentId>(),
    orderId: uuid('order_id')
      .notNull()
      .$type<OrderId>()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** ZARINPAL | SEP | MELLAT | MOCK (stage-58: PAYIR حذف شد — فقط ردیف‌های تاریخی) */
    gateway: varchar('gateway', { length: 30 }).notNull(),
    /** direct | indirect | mock */
    mode: varchar('mode', { length: 20 }).notNull(),
    amount: integer('amount').notNull(),
    /** PENDING | SUCCESS | FAILED */
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    /** شناسه‌ی خارجی درگاه — authority/token (string خارجی، نه id داخلی) */
    gatewayRef: varchar('gateway_ref', { length: 128 }),
    /** Allocated and committed before Mellat dispatch; null preserves legacy associations. */
    mellatOrderId: bigint('mellat_order_id', { mode: 'bigint' }),
    callbackUrl: text('callback_url'),
    webhookSignature: varchar('webhook_signature', { length: 64 }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    index('payments_user_idx').on(t.userId),
    index('payments_status_idx').on(t.status),
    index('payments_ref_idx').on(t.gatewayRef),
    unique('payments_mellat_order_id_unique').on(t.mellatOrderId),
    check('payments_mellat_order_id_range', sql`${t.mellatOrderId} >= 281474976710656 and ${t.mellatOrderId} <= 9223372036854775807`),
  ],
)

export type PaymentRow = typeof payments.$inferSelect
