// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 8 از 31
// مسیر مقصد: apps/api/src/infra/db/schema/translation.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/translation.ts
import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * round-35 — صف ترجمه‌ی خودکار (مترجم آفلاین NLLB).
 *
 * یک رکورد = «کل» فیلدهای عربیِ یک موجودیت محتوا (محصول، مقاله، ...).
 * تصرف اتمیک بین رپلیکاها:
 *   UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED)
 * ایندکس جزئیِ یکتا فقط روی وضعیتِ در انتظار → حذف تکرارِ صف بدون تداخل با تاریخ
 * done/failed (همان موجودیت می‌تواند بعداً دوباره صف شود).
 *
 * تلاش مجدد: attempts/max_attempts + next_attempt_at (عقب‌افتادگی در سرویس)؛
 * خطای نهایی = ستون‌های ar همان‌طور NULL می‌مانند → کاربر عربی
 * پشتیبان فارسی می‌بیند (COALESCE رارد ۳۴) — سایت هرگز نمی‌ایستد.
 */
export const translationJobs = pgTable(
  'translation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** نوع موجودیت — کلیدهای قرارداد shared (TranslationEntityType) */
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    /** شناسه‌ی رکورد (uuid برای اکثر انواع؛ '1' برای about) */
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    /** pending | running | done | failed */
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** تلاش بعدی — برای عقب‌افتادگی و جلوگیری از حلقه‌ی مشغول */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('translation_jobs_claim_idx').on(t.status, t.nextAttemptAt),
    uniqueIndex('translation_jobs_pending_key')
      .on(t.entityType, t.entityId)
      .where(sql`${t.status} = 'pending'`),
  ],
)