// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/infra/db/schema/notifications.ts
// ═══════════════════════════════════════════════════════════════

// src/infra/db/schema/notifications.ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * فاز-۲ — سیستم پوش نوتیفیکیشن کاستوم (به‌جای پیامک برای کوپن‌ها).
 *
 * دو جدول:
 *  • push_subscriptions — اشتراک‌های Web Push مرورگر (endpoint + کلیدهای
 *    رمزنگاری RFC 8291). endpoint یکتاست؛ خطای 404/410 از سرور پوش
 *    یعنی لغو/پاک شدن → disabledAt + حذف دوره‌ای.
 *  • notifications — صندوق درون‌بری هر کاربر (SSE زنده + لیست + خوانده-
 *    شده). «پوش» فقط کانال رسانه است؛ داده‌ی مرکزی همین‌جاست.
 */

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** endpoint سرور پوش مرورگر — یکتا در کل جهان */
    endpoint: text('endpoint').notNull(),
    /** کلید عمومی اشتراک (base64url) — برای رمزنگاری aes128gcm */
    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    /** نمک مخفی اشتراک (base64url) */
    auth: varchar('auth', { length: 255 }).notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    /** شمارنده‌ی خطای پیاپی — بعد از موفقیت صفر می‌شود */
    failures: integer('failures').notNull().default(0),
    /** غیرفعال‌شده (404/410 از سرور پوش یا سقف اشتراک) — دیگر پوش نمی‌رود */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId, t.disabledAt),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** نوع — کوپن / یادآور کوپن / پخش عمومی / سیستم */
    type: varchar('type', { length: 40 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    body: varchar('body', { length: 300 }).notNull(),
    /** مقصد کلیک — مسیر داخلی سایت (مثلاً /products) */
    url: varchar('url', { length: 300 }),
    /** داده‌ی آزاد برای کلاینت (کد کوپن و…) */
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** آمار تحویل پوش (بعد از ارسال آپدیت می‌شود) */
    pushAttempted: integer('push_attempted').notNull().default(0),
    pushDelivered: integer('push_delivered').notNull().default(0),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
    index('notifications_created_idx').on(t.createdAt),
  ],
)

/** انواع مجاز نوتیفیکیشن — قرارداد با کلاینت */
export const NOTIFICATION_TYPES = [
  'coupon', // کوپن جدید به کاربر تعلق گرفت
  'coupon_nudge', // یادآور «یک قدم تا کوپن»
  'broadcast', // پیام عمومی ادمین
  'system', // سیستم (سلامت/به‌روزرسانی)
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
