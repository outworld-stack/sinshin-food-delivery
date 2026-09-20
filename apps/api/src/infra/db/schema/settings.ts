//src/infra/db/schema/settings.ts
import { uuid, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

/**
 * تنظیمات کلید-مقدار.
 *
 * دو نوع بسته‌بودن:
 *  restaurant_open       → ساعتی (باز/بسته روزانه) — فقط ادمین اصلی؛ بسته = لاگین ادمین۲ رد
 *  temporarily_closed    → موقت (قطع گاز/برق/...) — ادمین اصلی + ادمین۲ با permission؛
 *                          قوانین کاربر مثل ساعتی است (سفارش آزاد) ولی ادمین۲ می‌تواند لاگین/بماند
 */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const SETTING_KEYS = {
  /** ساعتی — نوع ۱ */
  restaurantOpen: 'restaurant_open', // boolean
  nextOpenTime: 'next_open_time', // string
  /** موقت — نوع ۲ */
  temporarilyClosed: 'temporarily_closed', // boolean
  temporaryCloseReason: 'temporary_close_reason', // string — نمایش به کاربر
  /** ردیابی زنده پیک */
  liveTrackingEnabled: 'live_tracking_enabled', // boolean
  /** مختصات مبدأ ارسال */
  restaurantLocation: 'restaurant_location', // { lat, lng }
  /** هزینه بسته‌بندی PICKUP — پایه توسط ادمین اصلی؛ ادمین۲ با permission ویرایش می‌کند */
  packagingFee: 'packaging_fee', // number (تومان)
} as const

export const contentAbout = pgTable('content_about', {
  id: integer('id').primaryKey().default(1),
  heroTitle: text('hero_title').notNull(),
  heroText: text('hero_text').notNull(),
  heroGradient: text('hero_gradient').notNull(),
  teamTitle: text('team_title').notNull(),
  teamGradient: text('team_gradient').notNull(),
  teamAlt: text('team_alt').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})


export const terms = pgTable(
  'terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull(),
    sections: jsonb('sections').$type<{ title: string; items: string[] }[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('terms_version_key').on(t.version)],
)