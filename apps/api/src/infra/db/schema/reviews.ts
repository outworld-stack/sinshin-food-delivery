//src/infra/db/schema/reviews.ts
import { index, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'
import { products } from './menu'
import type { OrderId, ProductId, ReviewId, UserId } from '#/domain/shared/brand'

/** سه‌حالته — مودریشن ادمین (قرارداد فرانت) */
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected'])

/**
 * نظر روی «محصولِ داخل سفارش» — یک نظر به‌ازای هر محصول در هر سفارش (unique).
 * فقط بعد از DELIVERED. تاییدشده → صفحه‌ی محصول.
 */
export const reviews = pgTable(
    'reviews',
    {
        id: uuid('id').primaryKey().defaultRandom().$type<ReviewId>(),
        orderId: uuid('order_id')
            .notNull()
            .$type<OrderId>()
            .references(() => orders.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .$type<ProductId>()
            .references(() => products.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .$type<UserId>()
            .references(() => users.id, { onDelete: 'cascade' }),
        comment: text('comment').notNull(),
        status: reviewStatusEnum('status').notNull().default('pending'),
        moderatedAt: timestamp('moderated_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        // یک نظر به‌ازای هر (سفارش، محصول) — جلوگیری از تکرار ساختاری
        uniqueIndex('reviews_order_product_key').on(t.orderId, t.productId),
        index('reviews_product_status_idx').on(t.productId, t.status),
        index('reviews_status_idx').on(t.status),
    ],
)