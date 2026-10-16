//src/infra/db/backfills.ts
/**
 * بک‌فیل‌های داده‌ی دستگاه — به‌جای مایگریشن SQL دستی (stage-71/0006).
 *
 * چرا این‌جا و نه داخل فایل SQL مایگریشن؟
 * ① drizzle-kit فقط DDL می‌سازد؛ UPDATE/INSERT داده‌ای هرگز با «دستور»
 *    تولید نمی‌شود — هر فایل داده‌ایِ دستی یعنی زنجیره‌ی drizzle-kit
 *    دیگر قابل-تولید نیست (دقیقاً خطایی که به دیتابیس کارفرما کشید).
 * ② ترتیب درست: «خنثی‌سازی clientId تکراری» باید «قبل از» CREATE UNIQUE
 *    INDEX مایگریشن ۰۰۰۵ اجرا شود؛ در زنجیره‌ی خطیِ مایگریشن، فایلِ
 *    بعدی هرگز قبل از فایل قبلی نمی‌رود. گیتِ پیش-مایگریشن (pre) اینجا
 *    حلش می‌کند.
 * ③ ایدمپوتنت: هر بلاک فقط ردیف‌های «هنوز خالی/هنوز قفل‌شده» را می‌گیرد؛
 *    اجرای دوباره = no-op — پس دیتابیسِ ناقص/قدیمی هر جا که باشد،
 *    `bun run db:migrate` همیشه به همان نتیجه‌ی نهایی می‌رسد.
 *
 * نگاشت برند/نوع دقیقاً با deriveLegacyDevice (device-label.ts) هم‌راستا
 * است — CASE ترتیب درست دارد (Mac→macos قابل‌دسترس؛ اندرویدِ ناشناخته
 * برندِ null می‌گیرد نه «linux»).
 */
import { sql } from 'drizzle-orm'

import type { Db } from './client'

/** خروجی گیتِ پیش-مایگریشن — برای لاگ شفاف در migrate.ts */
export interface PreMigrateResult {
  /** جدول devices آماده بود؟ (فresh DB هنوز جدول ندارد) */
  skipped: boolean
  /** تعداد clientIdهای تکراری که خنثی شدند */
  dedupedClientIds: number
}

/** خروجی بک‌فیل‌های پس-مایگریشن — برای لاگ شفاف در migrate.ts */
export interface PostMigrateResult {
  skipped: boolean
  backfilledType: number
  backfilledBrand: number
  backfilledOwner: number
  autoUnblocked: number
}

/** اجرای یک عبارتِ خامِ بدون-پارامتر (فقط رشته‌های ثابتِ داخلی — بدون ورودی کاربر) */
async function exec(db: Db, statement: string): Promise<void> {
  await db.execute(sql.raw(statement))
}

/**
 * شمارش ردیف‌های منطبق — قبل از UPDATE برای لاگ و پرشِ بی‌دردسرِ حالت صفر.
 * نتیجه‌ی execute در درایور bun-sql همان SQLResult خود Bun است (آرایه‌مانند
 * با فیلد rows) — هر دو شکل پشتیبانی می‌شود.
 */
async function count(db: Db, statement: string): Promise<number> {
  const result = (await db.execute(sql.raw(statement))) as unknown as {
    rows?: Array<{ n?: number }>
  } & Array<{ n?: number }>
  const row = result.rows?.[0] ?? result[0]
  return row?.n ?? 0
}

/** آیا جدول devices با ستون موردنظر وجود دارد؟ (هر حالت اسکیمایی امن) */
async function columnExists(db: Db, column: string): Promise<boolean> {
  const result = (await db.execute(sql`
    select to_regclass('public.devices') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'devices'
          and column_name = ${column}
      ) as ok
  `)) as unknown as { rows?: Array<{ ok?: boolean }> } & Array<{ ok?: boolean }>
  const row = result.rows?.[0] ?? result[0]
  return row?.ok === true
}

/**
 * گیتِ پیش-مایگریشن (مرحله‌ی ۱ — قبل از drizzle migrate):
 * خنثی‌سازی clientIdهای تکراریِ ناشی از race قدیمی.
 * ردیفِ با id کوچک‌تر می‌ماند؛ ردیف‌های بعدیِ همان clientId خالی (NULL)
 * می‌شوند — ردیف حذف نمی‌شود (تاریخچه/هویت/رویدادها دست‌نخورده).
 *
 * این گیت «شرط لازمِ» موفقیت CREATE UNIQUE INDEX مایگریشن ۰۰۰۵ روی
 * دیتابیس‌های قدیمیِ با داده‌ی تکراری است — بدون آن، db:migrate روی
 * همان ۰۰۰۵ با خطای duplicate key می‌ایستد.
 */
export async function preMigrateDedupClientIds(db: Db): Promise<PreMigrateResult> {
  if (!(await columnExists(db, 'client_id'))) {
    return { skipped: true, dedupedClientIds: 0 }
  }
  const pending = await count(
    db,
    `select count(*)::int as n from "devices" d
     where d."client_id" is not null
       and exists (
         select 1 from "devices" o
         where o."client_id" = d."client_id" and o."id" < d."id"
       )`,
  )
  if (pending > 0) {
    await exec(
      db,
      `update "devices" d set "client_id" = null
       where d."client_id" is not null
         and exists (
           select 1 from "devices" o
           where o."client_id" = d."client_id" and o."id" < d."id"
         )`,
    )
  }
  return { skipped: false, dedupedClientIds: pending }
}

/**
 * بک‌فیل‌های پس-مایگریشن (مرحله‌ی ۳ — بعد از drizzle migrate):
 *
 * ① نوع/برند ردیف‌های موجود از user_agent — مدل عمداً خالی می‌ماند
 *    (استخراج مدل از UA در SQL کدفر و ناقص است؛ نام کامل با ورود بعدیِ
 *    همان کاربر پر می‌شود).
 * ② مالکِ هر دستگاه از «اولین REGISTER موفقِ همان ردیف» (device_events) —
 *    دقیقاً هم‌معنای claim ران‌تایمِ stage-70 که فقط در ثبت‌نام موفق
 *    اعمال می‌شود (نه از هر LOGIN قدیمی — بلاکِ گذشته‌نگر نمی‌سازد).
 * ③ آزادسازی مسدودی‌های «خودکارِ» قدیمی (auto:%) + رویداد AUTO_UNBLOCK —
 *    سیاست stage-70 مسدودسازیِ خودکار را فقط «پس از ثبت‌نام موفق» اجرا
 *    می‌کند؛ مسدودی «دستیِ» ادمین و auto-cleared قبلی دست‌نخورده می‌ماند.
 */
export async function postMigrateDeviceBackfills(db: Db): Promise<PostMigrateResult> {
  if (!(await columnExists(db, 'device_type'))) {
    return {
      skipped: true,
      backfilledType: 0,
      backfilledBrand: 0,
      backfilledOwner: 0,
      autoUnblocked: 0,
    }
  }

  // ①-الف) نوع — همان ترتیب deriveLegacyDevice
  const typePending = await count(
    db,
    `select count(*)::int as n from "devices"
     where "device_type" is null and "user_agent" is not null`,
  )
  if (typePending > 0) {
    await exec(
      db,
      `update "devices" set "device_type" = case
         when "user_agent" ~* 'iPad' then 'tablet'
         when "user_agent" ~* 'iPhone' then 'mobile'
         when "user_agent" ~* 'Android' and "user_agent" ~* 'Mobile' then 'mobile'
         when "user_agent" ~* 'Android' then 'tablet'
         else 'desktop'
       end
       where "device_type" is null and "user_agent" is not null`,
    )
  }

  // ①-ب) برند — ترتیبِ درست (Apple موبایل → Android → دسکتاپ)؛
  // اندرویدِ ناشناخته = null (نه «linux»)، Mac = macos (قابل‌دسترس)
  const brandPending = await count(
    db,
    `select count(*)::int as n from "devices"
     where "device_brand" is null and "user_agent" is not null
       and "device_type" is not null`,
  )
  if (brandPending > 0) {
    await exec(
      db,
      `update "devices" set "device_brand" = case
         when "user_agent" ~* 'iPhone|iPad' then 'apple'
         when "user_agent" ~* 'Android' then case
             when "user_agent" ~* 'SM-|GT-|SC-|SAMSUNG|Galaxy' then 'samsung'
             when "user_agent" ~* 'Redmi|POCO|Xiaomi|M2[0-9]{3}|HM ?[Nn]ote|Note ?[0-9]' then 'xiaomi'
             when "user_agent" ~* 'Huawei|HUAWEI|ANE-|CLT-|Harmony' then 'huawei'
             when "user_agent" ~* 'Pixel' then 'google'
             else null
           end
         when "user_agent" ~* 'Windows' then 'windows'
         when "user_agent" ~* 'Macintosh|Mac OS' then 'macos'
         when "user_agent" ~* 'Linux|Ubuntu|Fedora|CrOS' then 'linux'
         else null
       end
       where "device_brand" is null and "user_agent" is not null
         and "device_type" is not null`,
    )
  }

  // ②) مالک — اولین REGISTER موفقِ همان ردیف (claim ران‌تایم معکوس‌شده)
  const ownerPending = await count(
    db,
    `select count(*)::int as n from "devices" d
     where d."registered_owner_phone" is null
       and exists (
         select 1 from "device_events" e
         where e."device_id" = d."id" and e."event" = 'REGISTER'
           and e."phone" is not null
       )`,
  )
  if (ownerPending > 0) {
    await exec(
      db,
      `update "devices" d set "registered_owner_phone" = sub.phone
       from (
         select distinct on (device_id) device_id, phone
         from "device_events"
         where "event" = 'REGISTER' and "phone" is not null
         order by device_id, created_at asc, id asc
       ) as sub
       where d."id" = sub.device_id and d."registered_owner_phone" is null`,
    )
  }

  // ③) آزادسازی مسدودی‌های خودکارِ قدیمی — اول رویداد، بعد آپدیت
  //    (بعد از آپدیت، ردیف‌ها دیگر «auto:%» نیستند → اجرای دوباره no-op)
  const blockedPending = await count(
    db,
    `select count(*)::int as n from "devices"
     where "is_blocked" = true and "blocked_reason" like 'auto:%'`,
  )
  if (blockedPending > 0) {
    await exec(
      db,
      `insert into "device_events" ("device_id", "phone", "event", "user_agent", "metadata", "created_at")
       select "id", null, 'AUTO_UNBLOCK', null,
         jsonb_build_object('reason', 'runtime backfill', 'previousReason', "blocked_reason", 'riskScore', "risk_score"),
         now()
       from "devices"
       where "is_blocked" = true and "blocked_reason" like 'auto:%'`,
    )
    await exec(
      db,
      `update "devices"
       set "is_blocked" = false, "blocked_at" = null, "blocked_reason" = 'auto-cleared:backfill'
       where "is_blocked" = true and "blocked_reason" like 'auto:%'`,
    )
  }

  return {
    skipped: false,
    backfilledType: typePending,
    backfilledBrand: brandPending,
    backfilledOwner: ownerPending,
    autoUnblocked: blockedPending,
  }
}
