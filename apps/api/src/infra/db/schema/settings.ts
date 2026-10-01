// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 6 از 49
// مسیر مقصد: apps/api/src/infra/db/schema/settings.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/settings.ts
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

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
  /** round-29 — زمان باز شدن مجددِ بسته‌ی موقت (مثلاً «۱۹:۰۰») — جدا از next_open_time ساعتی */
  temporaryReopenTime: 'temporary_reopen_time', // string
  /** round-34 — علت بسته‌بودن موقت به عربی (نمایش در چک‌اوت حالت عربی؛ NULL/خالی = همان فارسی) */
  temporaryCloseReasonAr: 'temporary_close_reason_ar', // string
  /** ردیابی زنده پیک */
  liveTrackingEnabled: 'live_tracking_enabled', // boolean
  /** مختصات مبدأ ارسال */
  restaurantLocation: 'restaurant_location', // { lat, lng }
  // round-11: کلید packagingFee حذف شد — stage-10 هزینهٔ بسته‌بندی
  // per-product (ستون products.packaging_cost) شد و این کلید مرده بود.

  iranOnlyAccess: 'iran_only_access', // boolean
} as const

export const contentAbout = pgTable('content_about', {
  id: integer('id').primaryKey().default(1),
  heroTitle: text('hero_title').notNull(),
  heroText: text('hero_text').notNull(),
  heroGradient: text('hero_gradient').notNull(),
  teamTitle: text('team_title').notNull(),
  teamGradient: text('team_gradient').notNull(),
  teamAlt: text('team_alt').notNull(),
  /** round-34 — محتوای عربی (NULL = fallback فارسی؛ گرادیانت‌ها ترجمه نمی‌شوند) */
  heroTitleAr: text('hero_title_ar'),
  heroTextAr: text('hero_text_ar'),
  teamTitleAr: text('team_title_ar'),
  teamAltAr: text('team_alt_ar'),
  /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ true می‌گذارد؛ ذخیره‌ی دستی false */
  arAuto: boolean('ar_auto').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})


export const terms = pgTable(
  'terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull(),
    sections: jsonb('sections').$type<{ title: string; items: string[] }[]>().notNull(),
    /** round-34 — بندهای عربی (NULL = fallback فارسی؛ ساختار موازی sections) */
    sectionsAr: jsonb('sections_ar').$type<{ title: string; items: string[] }[]>(),
    /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ true می‌گذارد؛ ذخیره‌ی دستی false */
    arAuto: boolean('ar_auto').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('terms_version_key').on(t.version)],
)