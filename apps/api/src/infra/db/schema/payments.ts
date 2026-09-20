//src/infra/db/schema/payments.ts
import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { OrderId, PaymentId } from '#/domain/shared/brand'
import { users } from './users'
import { orders } from './orders'

/** هر تلاش پرداخت یک ردیف — audit کامل */
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
    /** ZARINPAL | PAYIR | SEP | MOCK */
    gateway: varchar('gateway', { length: 30 }).notNull(),
    /** direct | indirect | mock */
    mode: varchar('mode', { length: 20 }).notNull(),
    amount: integer('amount').notNull(),
    /** PENDING | SUCCESS | FAILED */
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    /** شناسه‌ی خارجی درگاه — authority/token (string خارجی، نه id داخلی) */
    gatewayRef: varchar('gateway_ref', { length: 120 }),
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
  ],
)

export type PaymentRow = typeof payments.$inferSelect