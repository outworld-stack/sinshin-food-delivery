//src/infra/db/schema/registration-permits.ts
import { sql } from 'drizzle-orm'
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

/**
 * stage-79 — مجوز ثبت‌نام ویژه (Registration Permit).
 *
 * ابزارِ دستیِ ادمینِ اصلی برای «استثنای قابل‌ممیزی» روی قواعدِ ضدتقلبِ
 * دستگاه: شماره‌ای که ادمین وارد می‌کند یک‌بار — فقط در پنجره‌ی اعتبار —
 * می‌تواند ثبت‌نام کند، حتی از دستگاهِ سوخته/مسدود. پس از ثبت‌نامِ موفق،
 * دستگاه همان‌جا مسدود می‌شود (دلیلِ `permit-burn`) تا تضمینِ «هر دستگاه
 * در عمرش یک ثبت‌نام» حتی در مسیرِ استثنا هم دست‌نخورده بماند.
 *
 * الگوبرداری (تحقیق عمیقِ stage-79):
 *  - claim اتمیکِ تک‌مصرف با UPDATE شرطی داخل تراکنشِ ثبت‌نام — همان
 *    الگوی ownerr-claim راند ۷۰ و پاترن CWE-367 (توکن‌های دعوتِ تک‌مصرف
 *    باید اتمیک claim شوند؛ رقابتِ check-then-act = باگ).
 *  - «گردش‌کارِ استثنای اپراتور» روی قواعدِ خودکارِ ضدتقلب (الگوی رایجِ
 *    پلتفرم‌های fraud: رول‌ها دست نمی‌خورند، استثنا ممیزی‌شده و محدود است).
 *  - عمداً جزو خانواده‌ی `auto:%` نیست — جاروی یک‌باره‌ی بک‌فیل ۷۳ (و هر
 *    جاروی آینده‌ی مشابه) هرگز نتواند مجوز-سوختن را «آزادسازی» کند.
 *
 * چرخه‌ی وضعیت: pending → used (claim اتمیک در tx ثبت‌نام) یا
 * revoked (ادمین) یا expired (خودکار در consume/list — بدون job).
 *
 * ایندکس یکتایِ جزئی: حداکثر «یک» مجوزِ pending به‌ازای شماره — صدورِ
 * مجدد همان شماره، همان ردیف را تازه می‌کند (not expired = برای همیشه
 * فقط یک pending). تاریخچه (used/revoked/expired) برای ممیزی می‌ماند.
 */
export const registrationPermits = pgTable(
  'registration_permits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** شماره‌ای که مجوز برای صدور شده — نرمال‌شده‌ی 09xxxxxxxxx */
    phone: varchar('phone', { length: 11 }).notNull(),
    /** pending | used | revoked (expired در خواندن محاسبه می‌شود) */
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    /** یادداشت ادمین — چرا این استثنا (ممیزی) */
    note: text('note'),
    /** ادمینِ صادرکننده — users.id */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** انقضای اعتبار — claim بعد از این لحظه رد می‌شود */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** لحظه‌ی claim اتمیک (ثبت‌نامِ مصرف‌کننده) */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /**
     * دستگاهِ مصرف‌کننده — uuid ساده (بدون FK عمدی: این ستون «رکوردِ
     * ممیزی» است؛ حذفِ ردیفِ دستگاه نباید تاریخچه‌ی مجوز را cascade کند.
     * ردیف‌های devices در این سیستم اصلاً حذف نمی‌شوند.)
     */
    usedDeviceId: uuid('used_device_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** ادمینِ لغوکننده — users.id */
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    /** حداکثر یک مجوزِ در انتظار به‌ازای شماره — race-safe صدور */
    uniqueIndex('registration_permits_pending_phone_uidx')
      .on(t.phone)
      .where(sql`status = 'pending'`),
    index('registration_permits_phone_idx').on(t.phone),
    index('registration_permits_status_idx').on(t.status),
    index('registration_permits_created_idx').on(t.createdAt),
  ],
)

export type RegistrationPermitRow = typeof registrationPermits.$inferSelect
export type NewRegistrationPermitRow = typeof registrationPermits.$inferInsert
