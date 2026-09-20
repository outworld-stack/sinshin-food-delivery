//src/infra/db/schema/wallet.ts
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { OrderId } from '#/domain/shared/brand'
import { users } from './users'
import { orders } from './orders'

export const walletTxTypeEnum = pgEnum('wallet_tx_type', ['DEPOSIT', 'WITHDRAW'])

/**
 * سود معرف — ۱۰٪ فقط از پرداخت آنلاینِ غذاها (بدون ارسال و بدون بخش کیف‌پولی).
 * unique (referrer, order) → ساختاری ضد تکرار.
 */
export const referralProfits = pgTable(
  'referral_profits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => users.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    orderId: uuid('order_id')
      .notNull()
      .$type<OrderId>()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** مبنای محاسبه = amountPaidOnline - deliveryFee (>= 0) */
    baseAmount: integer('base_amount').notNull(),
    percent: integer('percent').notNull().default(10),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_profits_referrer_order_key').on(t.referrerId, t.orderId),
    index('referral_profits_referrer_idx').on(t.referrerId),
    index('referral_profits_buyer_idx').on(t.buyerId),
  ],
)

/**
 * تراکنش‌های کیف پول — append-only ledger؛ منبع حقیقت موجودی (SUM).
 * برداشت فقط با orderId — partial unique: هر سفارش حداکثر یک WITHDRAW.
 */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: walletTxTypeEnum('type').notNull(),
    amount: integer('amount').notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    orderId: uuid('order_id')
      .$type<OrderId>()
      .references(() => orders.id, { onDelete: 'set null' }),
    referralProfitId: uuid('referral_profit_id').references(() => referralProfits.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('wallet_tx_user_idx').on(t.userId),
    index('wallet_tx_order_idx').on(t.orderId),
    index('wallet_tx_created_idx').on(t.createdAt),
    uniqueIndex('wallet_tx_withdraw_once_key')
      .on(t.orderId)
      .where(sql`type = 'WITHDRAW'`),
  ],
)