//src/infra/db/migrate.ts
/**
 * اجراکننده‌ی مهاجرت‌ها — همان درایورِ خود اپ (Bun.sql)، بدون ابزار اضافه.
 *
 *   bun run db:generate  # drizzle-kit (محلی): اسکیما → ./drizzle
 *   bun run db:migrate   # همین اسکریپت: اعمال روی دیتابیس
 *
 * stage-72 — معماری سه‌مرحله‌ای:
 *   مرحله ۱ (گیت داده): خنثی‌سازی clientIdهای تکراری — «قبل» از drizzle
 *     migrate تا CREATE UNIQUE INDEX مایگریشن ۰۰۰۵ روی دیتابیس‌های قدیمی
 *     با داده‌ی تکراری موفق شود (خطای duplicate key که migrate را روی
 *     ۰۰۰۵ متوقف می‌کرد).
 *   مرحله ۲ (DDL): drizzle migrate — فقط زنجیره‌ی drizzle-kit-generated؛
 *     هرگز SQL داده‌ای دستی داخل زنجیره نیست (بک‌فیل‌ها اینجا آمدند).
 *   مرحله ۳ (بک‌فیل داده): ایدمپوتنت — نوع/برند از UA، مالک از اولین
 *     REGISTER موفق، آزادسازی مسدودی‌های خودکارِ قدیمی (auto:%).
 *
 * ═══ stage-73 — مرحله ۳ «نسخه‌دار» شد (یافته‌ی ۲ کارفرما) ═══
 * مرحله ۳ قبلاً در هر اجرا تکرار می‌شد و مسدودی‌های auto:% «جدید» را در
 * deploy بعدی آزاد می‌کرد. حالا از طریق backfill_runs (جدول DDL خالص که
 * با همان db:generate ساخته می‌شود) فقط یک‌بار در عمر دیتابیس اجرا
 * می‌شود؛ روی دیتابیسِ کاریِ کارفرما شواهدِ اجرای stage-72 به‌طور خودکار
 * تشخیص و فقط مارکر ثبت می‌شود. جزئیات: REFERENCE بخش ۲-۱۰-۵.
 *
 * مراحل ۱ و ۲ همچنان ایدمپوتنت‌اند — `db:migrate` روی هر دیتابیسِ هر
 * وضعیتی (فریش / قدیمی / نیمه-اعمال‌شده) بی‌خطر و تکرارپذیر است.
 */
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

import { AppConfig } from '#/infra/config/env'
import { preMigrateDedupClientIds, runDeviceBackfillsVersioned } from '#/infra/db/backfills'
import { Database } from '#/infra/db/client'

const config = new AppConfig()
// max:1 — اسکریپتِ ترتیبی؛ همه‌ی مراحل روی یک اتصال می‌روند تا `set` های
// session-level (تایم‌اوتِ بلندتر برای بک‌فیلِ جدول‌های بزرگ) پایدار بمانند
const database = new Database(config.databaseUrl, { max: 1 })

// پرچم یک‌بارمصرفِ اپراتور (stage-73): با 1، بندِ آزادسازیِ auto:% در
// نخستین اجرای نسخه‌دار رد می‌شود — برای دیتابیس‌هایی که می‌خواهند
// مسدودی‌های خودکارشان قطعاً حفظ شود. بندهای بی‌ضرر (نوع/برند/مالک)
// اجرا می‌شوند و مارکر ثبت می‌گردد (یعنی برای همیشه «اجرا شده» است).
const SKIP_AUTO_UNBLOCK =
  (process.env.DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK ?? '').trim() === '1'

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

  // ── مرحله ۳ — بک‌فیل داده (①/② همیشه؛ ③ آزادسازیِ نسخه‌دار — فقط یک‌بار) ──
  const post = await runDeviceBackfillsVersioned(database.db, {
    skipAutoUnblock: SKIP_AUTO_UNBLOCK,
  })
  const sums =
    post.applied.backfilledType + post.applied.backfilledBrand + post.applied.backfilledOwner + post.applied.autoUnblocked
  if (post.applied.skipped) {
    console.log('[db] post-migrate: ستون‌های stage-70 هنوز نیستند — بک‌فیل رد شد')
  } else if (sums > 0) {
    console.log(
      `[db] post-migrate: نوع=${post.applied.backfilledType} برند=${post.applied.backfilledBrand} ` +
        `مالک=${post.applied.backfilledOwner} آزادسازی=${post.applied.autoUnblocked} ردیف بک‌فیل شد`,
    )
  } else {
    console.log('[db] post-migrate: بک‌فیل جدیدی لازم نبود')
  }
  switch (post.status) {
    case 'table-missing':
      console.log(
        '[db] پاک‌سازیِ نسخه‌دار auto:% رد شد: جدول backfill_runs هنوز ساخته نشده. ' +
          'اگر اسکیمای stage-73 را جای‌گذاری کرده‌ای: bun run db:generate (DDL خالص) سپس دوباره db:migrate',
      )
      break
    case 'already-applied':
      console.log('[db] پاک‌سازیِ auto:% v1 قبلاً اعمال شده — رد شد (دیگر هرگز در deploy تکرار نمی‌شود)')
      break
    case 'seeded-from-evidence':
      console.log(
        `[db] اجرای قبلیِ stage-72 شناسایی شد (${post.evidence}) — فقط مارکر backfill_runs ثبت شد؛ ` +
        'هیچ آزادسازی‌ای تکرار نمی‌شود و مسدودی‌های auto:% جدید دست‌نخورده می‌مانند',
      )
      break
    case 'ran-skip-auto-unblock':
      console.log('[db] پاک‌سازیِ auto:% v1 با پرچم DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK رد شد — مارکر ثبت شد')
      break
    case 'ran':
      break
  }

  console.log(`[db] migrations applied in ${(performance.now() - t0).toFixed(0)}ms`)
} finally {
  await database.close()
}
