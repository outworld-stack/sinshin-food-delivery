//src/infra/db/migrate.ts
/**
 * اجراکننده‌ی مهاجرت‌ها — همان درایورِ خود اپ (Bun.sql)، بدون ابزار اضافه.
 *
 *   bun run db:generate  # drizzle-kit (محلی): اسکیما → ./drizzle
 *   bun run db:migrate   # همین اسکریپت: اعمال روی دیتابیس
 *
 * stage-72 — معماری سه‌مرحله‌ای (بازطراحی):
 *   مرحله ۱ (گیت داده): خنثی‌سازی clientIdهای تکراری — «قبل» از drizzle
 *     migrate تا CREATE UNIQUE INDEX مایگریشن ۰۰۰۵ روی دیتابیس‌های قدیمی
 *     با داده‌ی تکراری موفق شود (خطای duplicate key که migrate را روی
 *     ۰۰۰۵ متوقف می‌کرد).
 *   مرحله ۲ (DDL): drizzle migrate — فقط زنجیره‌ی drizzle-kit-generated؛
 *     هرگز SQL داده‌ای دستی داخل زنجیره نیست (بک‌فیل‌ها اینجا آمدند).
 *   مرحله ۳ (بک‌فیل داده): ایدمپوتنت — نوع/برند از UA، مالک از اولین
 *     REGISTER موفق، آزادسازی مسدودی‌های خودکارِ قدیمی (auto:%).
 *
 * هر سه مرحله ایدمپوتنت‌اند — `db:migrate` روی هر دیتابیسِ هر وضعیتی
 * (فریش / قدیمی / نیمه-اعمال‌شده) بی‌خطر و تکرارپذیر است.
 */
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

import { AppConfig } from '#/infra/config/env'
import { postMigrateDeviceBackfills, preMigrateDedupClientIds } from '#/infra/db/backfills'
import { Database } from '#/infra/db/client'

const config = new AppConfig()
// max:1 — اسکریپتِ ترتیبی؛ همه‌ی مراحل روی یک اتصال می‌روند تا `set` های
// session-level (تایم‌اوتِ بلندتر برای بک‌فیلِ جدول‌های بزرگ) پایدار بمانند
const database = new Database(config.databaseUrl, { max: 1 })

const t0 = performance.now()
try {
  // اسکریپتِ بک‌فیل ممکن است روی جدول‌های بزرگ سنگین شود — ۱۵ ثانیه‌ی
  // پیش‌فرضِ client برای اینجا کم است؛ آپدیتِ session-level روی همان یک اتصال
  await database.db.execute(sql`set statement_timeout = '300s'`)

  // ── مرحله ۱ — گیت داده (قبل از DDL) ──
  const pre = await preMigrateDedupClientIds(database.db)
  if (pre.skipped) {
    console.log('[db] pre-migrate: جدول devices هنوز نیست — رد شد (دیتابیس تازه)')
  } else if (pre.dedupedClientIds > 0) {
    console.log(`[db] pre-migrate: ${pre.dedupedClientIds} clientId تکراری خنثی شد (ردیف قدیمی‌تر ماند)`)
  } else {
    console.log('[db] pre-migrate: clientId تکراری نداریم')
  }

  // ── مرحله ۲ — زنجیره‌ی DDL ──
  await migrate(database.db, { migrationsFolder: './drizzle' })

  // ── مرحله ۳ — بک‌فیل‌های داده (بعد از DDL) ──
  const post = await postMigrateDeviceBackfills(database.db)
  if (post.skipped) {
    console.log('[db] post-migrate: ستون‌های stage-70 هنوز نیستند — بک‌فیل رد شد')
  } else if (post.backfilledType + post.backfilledBrand + post.backfilledOwner + post.autoUnblocked > 0) {
    console.log(
      `[db] post-migrate: نوع=${post.backfilledType} برند=${post.backfilledBrand} ` +
        `مالک=${post.backfilledOwner} آزادسازی=${post.autoUnblocked} ردیف بک‌فیل شد`,
    )
  } else {
    console.log('[db] post-migrate: بک‌فیل جدیدی لازم نبود')
  }

  console.log(`[db] migrations applied in ${(performance.now() - t0).toFixed(0)}ms`)
} finally {
  await database.close()
}
