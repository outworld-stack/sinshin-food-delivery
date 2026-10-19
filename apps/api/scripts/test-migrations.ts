//src/../scripts/test-migrations.ts
/**
 * تست E2E مایگریشن — PostgreSQL واقعی (نسخه‌ی خودِ DATABASE_URL).
 *
 *   bun scripts/test-migrations.ts        (یا: bun run db:test:migrations)
 *
 * چه می‌کند؟ روی «دیتابیس‌های موقتیِ» همان سرور (sinshin_e2e_…) پنج
 * سناریو را اجرا می‌کند — به دیتابیسِ خودِ DATABASE_URL دست نمی‌زند:
 *
 *  A) بازتولید دقیقِ خطای کارفرما: دیتابیسِ قدیمیِ روی ۰۰۰۴ با clientIdهای
 *     تکراری → migrator قدیمی (بدون گیتِ pre) → باید روی CREATE UNIQUE
 *     INDEX مایگریشن ۰۰۰۵ خطای duplicate key بدهد و اتمی rollback شود.
 *     سپس «bun run db:migrate» واقعی (spawn) همان دیتابیس را شفا می‌دهد:
 *     خنثی‌سازی تکراری‌ها → اعمال ۰۰۰۵ → بک‌فیل نوع/برند/مالک/آزادسازی.
 *     اجرای دوباره = صفر تغییر (ایدمپوتنت).
 *  B) دیتابیس فریش: زنجیره‌ی کامل تمیز اعمال می‌شود؛ اجرای دوباره no-op.
 *  C) دیتابیسِ «روی ۰۰۰۵» (پروداکشن قبل از stage-71): ردیف‌های legacy
 *     بدون نوع/برند/مالک → بک‌فیل‌های ①/② پر می‌شوند؛ اجرای دوباره no-op.
 *  D) دیتابیسِ با journalِ جلوتر از زنجیره (۰۰۰۶ِ قدیمیِ دستی اعمال‌شده):
 *     db:migrate بدون خطا رد می‌شود و چیزی خراب نمی‌کند.
 *  E) stage-73 — «پاک‌سازیِ auto:% نسخه‌دار» (یافته‌ی ۲ کارفرما):
 *     E1 = دقیقاً دیتابیسِ کاریِ کارفرما: بک‌فیل stage-72 قبلاً اجرا شده
 *          (رویداد AUTO_UNBLOCK موجود) + مسدودیِ خودکارِ «جدید» →
 *          db:migrate فقط مارکر می‌نویسد؛ مسدودیِ جدید زنده می‌ماند.
 *     E2 = ضمانتِ یک‌باره: دیتابیسِ بدون-execution (بازگردانی از بکاپ) →
 *          اجرای اول مسدودی‌های قدیمی را آزاد می‌کند؛ مسدودیِ ساخته‌شده
 *          «بعد از» آن، در db:migrate بعدی آزاد «نمی‌شود» (باگ اصلی).
 *     E3 = پرچم اپراتور: DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK=1 → آزادسازی
 *          رد؛ بندهای بی‌ضرر اجرا؛ مارکر ثبت.
 *     E4 = جدول backfill_runs نباشد (db:generate اجرا نشده) → db:migrate
 *          بدون خطا + راهنمای صریح؛ بندهای ①/② همچنان اجرا.
 *
 * پیش‌نیاز: کاربر دیتابیس اختیار CREATE DATABASE داشته باشد (برای
 * ساخت/حذف دیتابیس‌های موقتی). در پایان همه‌ی موقتی‌ها drop می‌شوند.
 */
import { SQL } from 'bun'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

// ── ابزار ─────────────────────────────────────────────────────────

interface UrlParts {
  admin: string
  target: string
  targetDb: string
}

function parseUrl(): UrlParts {
  const raw = process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin'
  const url = new URL(raw)
  const targetDb = url.pathname.replace(/^\//, '')
  if (!targetDb) throw new Error('DATABASE_URL باید نام دیتابیس داشته باشد')
  const admin = new URL(raw)
  admin.pathname = '/postgres'
  return { admin: admin.toString(), target: raw, targetDb }
}

const { admin, target, targetDb } = parseUrl()

/** تعداد ورودی‌های زنجیره‌ی روی دیسک — داینامیک (قبل/بعد از db:generate کار می‌کند) */
const DRIZZLE_DIR = join(import.meta.dir, '..', 'drizzle')
const DISK_JOURNAL = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ tag: string }>
}
const CHAIN_COUNT = DISK_JOURNAL.entries.length
/** stage-81 — آیا زنجیره‌ی روی دیسک ورودیِ ۰۰۰۸ را دارد؟ (کارفرما فایل‌های drizzle این‌جا کپی نمی‌کند و خودش db:generate می‌زند؛ این پرچم فقط پیامِ خطای بندِ A2 را راهنمایی می‌کند) */
const CHAIN_HAS_0008 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0008'))
/** stage-82 — همان الگو برای ۰۰۰۹ (blocks + مجوزهای مقالات ادمین۲) */
const CHAIN_HAS_0009 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0009'))
/** stage-84 — همان الگو برای ۰۰۱۳ (اقلام بسته‌بندی + مجوز شلوغی) */
const CHAIN_HAS_0013 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0013'))
/** stage-86 — همان الگو برای ۰۰۱۴ (امکان خریدِ دسته‌بندی‌ها) */
const CHAIN_HAS_0014 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0014'))
/** stage-88 — همان الگو برای ۰۰۱۵ (رجیستری چاپگرهای شبکه) */
const CHAIN_HAS_0015 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0015'))
/** stage-89 — همان الگو برای ۰۰۱۶ (مجوزِ printingManage ادمین۲) */
const CHAIN_HAS_0016 = DISK_JOURNAL.entries.some((e) => e.tag.startsWith('0016'))

const scratches: string[] = []
let pass = 0
let fail = 0

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function withScratch(name: string, fn: (url: string) => Promise<void>): Promise<void> {
  const safe = (s: string) => s.replace(/[^a-z0-9_]/gi, '')
  const scratch = `sinshin_e2e_${safe(name)}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  if (scratch === targetDb) throw new Error('نام موقتی با دیتابیس هدف یکی شد — توقف')
  scratches.push(scratch)
  const adminClient = new SQL(admin, { max: 1 })
  try {
    await adminClient.unsafe(`drop database if exists "${scratch}" with (force)`)
    await adminClient.unsafe(`create database "${scratch}"`)
  } finally {
    await adminClient.close({ timeout: 5 })
  }
  const url = new URL(target)
  url.pathname = `/${scratch}`
  console.log(`\n══ سناریو ${name.toUpperCase()} — دیتابیس موقتی: ${scratch} ══`)
  try {
    await fn(url.toString())
  } finally {
    const cleaner = new SQL(admin, { max: 1 })
    try {
      await cleaner.unsafe(`drop database if exists "${scratch}" with (force)`)
    } catch (error) {
      console.log(`  ⚠ حذف ${scratch} ناموفق: ${String(error)}`)
    } finally {
      await cleaner.close({ timeout: 5 })
    }
  }
}

/** اجرای db:migrate واقعی (همان اسکریپت deploy) روی URL داده‌شده */
async function runRealMigrate(
  url: string,
  env: Record<string, string> = {},
  cwd = join(import.meta.dir, '..'),
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'src', 'infra', 'db', 'migrate.ts')], {
    cwd,
    env: { ...process.env, DATABASE_URL: url, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) console.log(out + err)
  return { code, out: out + err }
}

async function q<T>(url: string, statement: string): Promise<T[]> {
  const client = new SQL(url, { max: 1 })
  try {
    const res = (await client.unsafe(statement)) as unknown as { rows?: T[] } & T[]
    return res.rows ?? res
  } finally {
    await client.close({ timeout: 5 })
  }
}

async function scalar(url: string, statement: string): Promise<string | number | null> {
  const rows = await q<Record<string, unknown>>(url, statement)
  const row = rows[0]
  if (!row) return null
  const first = Object.values(row)[0]
  return first as string | number | null
}

/** ردیف‌های clientId تکراری (فقط برای سناریوی A — قبل از ایندکس یکتا) */
const DUP_SQL = `
insert into "devices" ("id","client_id","fingerprint_hash","canvas_hash","webgl_hash","audio_hash","fonts_hash") values
  ('10000000-0000-0000-0000-000000000001','dup-client-1','f-dup1','c1','w1','a1','fo1'),
  ('10000000-0000-0000-0000-000000000002','dup-client-1','f-dup2','c2','w2','a2','fo2'),
  ('10000000-0000-0000-0000-000000000003','dup-client-1','f-dup3','c3','w3','a3','fo3');
`

/** ردیف‌های دستگاهِ legacy با ماتریس UA + مسدودی‌ها + هویت/رویدادها */
const LEGACY_SQL = `
insert into "devices" ("id","fingerprint_hash","canvas_hash","webgl_hash","audio_hash","fonts_hash","user_agent","is_blocked","blocked_reason","blocked_at","risk_score") values
  ('10000000-0000-0000-0000-000000000004','f-ip','ci','wi','ai','foi','Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',false,null,null,0),
  ('10000000-0000-0000-0000-000000000005','f-sam','cs','ws','as','fos','Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',false,null,null,0),
  ('10000000-0000-0000-0000-000000000006','f-x','cx','wx','ax','fox','Mozilla/5.0 (Linux; Android 13; Redmi Note 10) Mobile Safari/537.36',false,null,null,0),
  ('10000000-0000-0000-0000-000000000007','f-op','co','wo','ao','foo','Mozilla/5.0 (Linux; Android 13; ONEPLUS A6013) Mobile Safari/537.36',false,null,null,0),
  ('10000000-0000-0000-0000-000000000008','f-win','cwin','wwin','awin','fowin','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',false,null,null,0),
  ('10000000-0000-0000-0000-000000000009','f-mac','cmac','wmac','amac','fomac','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',false,null,null,0),
  ('10000000-0000-0000-0000-000000000010','f-l','cl','wl','al','fol','Mozilla/5.0 (X11; Linux x86_64) Firefox/125.0',false,null,null,0),
  ('10000000-0000-0000-0000-000000000011','f-null','cn','wn','an','fon',null,false,null,null,0),
  ('10000000-0000-0000-0000-000000000012','f-b12','cb','wb','ab','fob',null,true,'auto:cluster-risk',now(),70),
  ('10000000-0000-0000-0000-000000000013','f-b13','cb2','wb2','ab2','fob2',null,true,'auto:canvas-drift',now(),65),
  ('10000000-0000-0000-0000-000000000014','f-b14','cb3','wb3','ab3','fob3',null,true,'admin',now(),10);

insert into "devices" ("id","fingerprint_hash","canvas_hash","webgl_hash","audio_hash","fonts_hash") values
  ('10000000-0000-0000-0000-000000000015','f-d15','cd','wd','ad','fod'),
  ('10000000-0000-0000-0000-000000000016','f-d16','cd2','wd2','ad2','fod2');

insert into "device_identities" ("device_id","phone","relation","first_login_at") values
  ('10000000-0000-0000-0000-000000000015','09150000015','OWNER', now() - interval '30 days'),
  ('10000000-0000-0000-0000-000000000016','09150000016','OWNER', now() - interval '20 days');

insert into "device_events" ("device_id","phone","event","created_at") values
  ('10000000-0000-0000-0000-000000000015','09150000015','LOGIN', now() - interval '30 days'),
  ('10000000-0000-0000-0000-000000000015','09150000015','LOGIN', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000016','09150000016','REGISTER', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000016','09150000017','REGISTER', now() - interval '5 days');
`

/** یک مسدودیِ خودکارِ «جدید» (با منطق stage-70+ ساخته‌شده) */
const NEW_AUTO_BLOCK_SQL = (suffix: string) => `
insert into "devices" ("id","fingerprint_hash","canvas_hash","webgl_hash","audio_hash","fonts_hash","is_blocked","blocked_reason","blocked_at","risk_score") values
  ('20000000-0000-0000-0000-0000000000${suffix}','f-new${suffix}','cn${suffix}','wn${suffix}','an${suffix}','fon${suffix}',true,'auto: crowded-cluster,canvas-drift',now(),95);
`

/** بازگرداندن دیتابیسِ تازه به حالتِ «۰۰۰۴ + دیتای کثیف» (شبیه‌سازی پروداکشن)
 *
 * stage-81 — درسِ بازتولید خطای کارفرما: این تابع نخست زنجیره‌ی «کاملِ روی
 * دیسک» را اجرا می‌کند (پس هر شیءِ تازه در مایگریشن‌های جدید ساخته می‌شود)
 * و بعد حالتِ ۰۰۰۴ را باز می‌سازد. هر استیجی که شیءِ DDL تازه می‌آورد باید
 * «همان شیء» را اینجا هم برگرداند — وگرنه replay در A1 روی همان شیء
 * «already exists» می‌خوابد. نمونه: چهار ایندکسِ ۰۰۰۸ که در stage-80 به
 * بندِ A2 اضافه شدند اما اینجا drop نشدند (خطای 42P07 کارفرما).
 */
async function buildLegacyAt0004(url: string): Promise<void> {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه برای ساخت legacy ناموفق بود')
  await q(url, `
    drop table if exists "registration_permits";
    drop table if exists "backfill_runs";
    drop index if exists "devices_client_id_uidx";
    drop index if exists "devices_type_idx";
    drop index if exists "devices_canvas_hash_idx";
    drop index if exists "devices_webgl_hash_idx";
    drop index if exists "devices_audio_hash_idx";
    drop index if exists "devices_fonts_hash_idx";
    -- stage-82 — اشیاءِ ۰۰۰۹: ستونِ blocks مقاله + مجوزهای articlesRead/Write
    -- ادمین۲ (درسِ استیج-۸۱: هر شیءِ تازه باید همین‌جا برگردد)
    alter table "articles" drop column if exists "blocks";
    alter table "admin2_profiles"
      drop column if exists "articles_read",
      drop column if exists "articles_write";
    -- stage-84 — اشیاءِ ۰۰۱۳: اقلام بسته‌بندی + junction + مجوز شلوغی
    drop table if exists "product_packaging_items";
    drop table if exists "packaging_items";
    alter table "admin2_profiles" drop column if exists "can_announce_busy";
    -- stage-86 — اشیاءِ ۰۰۱۴: امکان خریدِ دسته‌بندی‌ها (والد + زیردسته)
    alter table "main_categories" drop column if exists "purchase_enabled";
    alter table "categories" drop column if exists "purchase_enabled";
    -- stage-88 — اشیاءِ ۰۰۱۵: رجیستری چاپگرهای شبکه (پل چاپ سرور)
    drop table if exists "printers";
    -- stage-89 — اشیاءِ ۰۰۱۶: مجوزِ printingManage ادمین۲
    alter table "admin2_profiles" drop column if exists "printing_manage";
    alter table "devices"
      drop column if exists "device_type",
      drop column if exists "device_brand",
      drop column if exists "device_model",
      drop column if exists "registered_owner_phone",
      drop column if exists "prev_canvas_hash";
    alter table "devices" alter column "device_memory" type integer using "device_memory"::integer;
    -- Restore 0011 objects before replaying the legacy chain.
    alter table "checkout_idempotency"
      drop column if exists "request_hash",
      drop column if exists "claim_token";
    alter table "orders" drop constraint if exists "orders_coupon_id_coupons_id_fk";
    alter table "coupon_nudges" alter column "remaining_count" type integer using "remaining_count"::integer;
    -- Restore 0012 ledger indexes before replaying the legacy chain.
    drop index if exists "wallet_tx_referral_credit_once_key";
    drop index if exists "wallet_tx_refund_once_key";
    create unique index "wallet_tx_refund_once_key" on "wallet_transactions" ("order_id")
      where type = 'DEPOSIT' and order_id is not null;
    delete from "drizzle"."__drizzle_migrations" where created_at >= 1792104230349;
  `)
  await q(url, DUP_SQL)
  await q(url, LEGACY_SQL)
  await q(url, `update "devices" set "device_memory" = 8 where "fingerprint_hash" = 'f-ip'`)
}

/** مقادیر (device_type, device_brand) یک ردیف */
async function typeBrand(url: string, suffix: string): Promise<[string | null, string | null]> {
  const v = await scalar(
    url,
    `select "device_type" || '|' || coalesce("device_brand", '∅') as v from "devices"
     where "id" = '10000000-0000-0000-0000-0000000000${suffix}'`,
  )
  const s = String(v ?? '∅|∅')
  const [type = '', brand = ''] = s.split('|')
  return [type === '∅' || type === '' ? null : type, brand === '∅' || brand === '' ? null : brand]
}

/** حذف مارکرِ پاک‌سازی نسخه‌دار (شبیه‌سازیِ دیتابیسِ بدون backfill_runs قبلی) */
async function clearVersionedMarker(url: string): Promise<void> {
  await q(url, `delete from "backfill_runs"`)
}

// ── سناریو A — خطای کارفرما + شفا ────────────────────────────────

await withScratch('a', async (url) => {
  await buildLegacyAt0004(url)

  // A0 — قدیمی: migrator خالص (بدون گیت pre) باید روی ۰۰۰۵ بخوابد
  const legacyClient = new SQL(url, { max: 1 })
  let legacyError = ''
  try {
    const drizzle = (await import('drizzle-orm/bun-sql')).drizzle
    await migrate(drizzle(legacyClient), { migrationsFolder: './drizzle' })
  } catch (error) {
    legacyError = String(error)
  } finally {
    await legacyClient.close({ timeout: 5 })
  }
  ok(
    'A0: migrator قدیمی روی clientId تکراری خطا می‌دهد (بازتولید خطای پروداکشن)',
    /devices_client_id_uidx|duplicate key/i.test(legacyError),
    legacyError.slice(0, 160),
  )
  const stillDirty = await scalar(url, `select count(*)::int as n from "devices" where "client_id" = 'dup-client-1'`)
  ok('A0: رولبکِ اتمی — سه ردیفِ تکراری هنوز سر جایشان', stillDirty === 3)
  const colGone = await scalar(url, `select count(*)::int as n from information_schema.columns where table_name='devices' and column_name='device_type'`)
  ok('A0: ستون‌های ۰۰۰۵ هنوز اعمال نشده‌اند', colGone === 0)

  // A1 — migrate واقعی شفا می‌دهد
  const res = await runRealMigrate(url)
  ok('A1: db:migrate جدید با موفقیت اجرا شد', res.code === 0)
  ok(
    'A1: گیتِ pre clientIdهای تکراری را خنثی کرد (۲ ردیف)',
    /2 clientId/.test(res.out),
    res.out.split('\n').find((l) => l.includes('pre-migrate')),
  )
  const kept = await q<{ client_id: string | null }>(url, `select "client_id" from "devices" where "id" = '10000000-0000-0000-0000-000000000001'`)
  ok('A1: برنده‌ی گروهِ تکراری (id کوچک‌تر) clientId را نگه داشت', kept[0]?.client_id === 'dup-client-1')
  const losers = await scalar(url, `select count(*)::int as n from "devices" where "client_id" is null and "fingerprint_hash" in ('f-dup2','f-dup3')`)
  ok('A1: دو ردیف بازنده clientId=null شدند (حذف نشدند)', losers === 2)

  // A2 — شِمای ۰۰۰۵ کامل
  const uidx = await scalar(url, `select count(*)::int as n from pg_indexes where indexname = 'devices_client_id_uidx'`)
  ok('A2: ایندکس یکتای ۰۰۰۵ ساخته شد', uidx === 1)
  const journalRows = await scalar(url, `select count(*)::int as n from "drizzle"."__drizzle_migrations"`)
  ok(`A2: زنجیره‌ی journal (${CHAIN_COUNT} ورودی) اعمال شد`, journalRows === CHAIN_COUNT)
  const memoryType = await scalar(url, `select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'devices' and column_name = 'device_memory'`)
  ok('A2: device memory upgrades from integer to double precision', memoryType === 'double precision')
  const legacyMemory = await scalar(url, `select device_memory from devices where fingerprint_hash = 'f-ip'`)
  ok('A2: the memory upgrade preserves existing whole GB values', legacyMemory === 8)
  await q(url, `update devices set device_memory = 0.25 where fingerprint_hash = 'f-sam'`)
  const fractionalMemory = await scalar(url, `select device_memory from devices where fingerprint_hash = 'f-sam'`)
  ok('A2: the upgraded device column accepts fractional GB values', fractionalMemory === 0.25)
  const runsTable = await scalar(url, `select to_regclass('public.backfill_runs') is not null as v`)
  ok('A2: جدول backfill_runs (DDL خالص ۰۰۰۶) ساخته شد', String(runsTable) === 'true')
  const permitsTable = await scalar(url, `select to_regclass('public.registration_permits') is not null as v`)
  ok('A2: جدول registration_permits (۰۰۰۷ stage-79) ساخته شد', String(permitsTable) === 'true')
  const hashIdx = await scalar(
    url,
    `select count(*)::int as n from pg_indexes where indexname in ('devices_canvas_hash_idx','devices_webgl_hash_idx','devices_audio_hash_idx','devices_fonts_hash_idx')`,
  )
  ok(
    'A2: چهار ایندکسِ جمعیتِ هش (۰۰۰۸ stage-80) ساخته شد',
    hashIdx === 4,
    hashIdx === 0 && !CHAIN_HAS_0008
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۰۸ ندارد — اول: bun run db:generate'
      : `count=${hashIdx}`,
  )

  // A2 — stage-82: اشیاءِ ۰۰۰۹ (ستونِ بلوکیِ مقالات + مجوزهای ادمین۲)
  const blocksCol = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where table_name='articles' and column_name='blocks'`,
  )
  ok(
    'A2: ستون blocks مقالات (۰۰۰۹ stage-82) ساخته شد',
    blocksCol === 1,
    blocksCol === 0 && !CHAIN_HAS_0009
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۰۹ ندارد — اول: bun run db:generate'
      : `count=${blocksCol}`,
  )
  const articlePerms = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where table_name='admin2_profiles' and column_name in ('articles_read','articles_write')`,
  )
  ok(
    'A2: مجوزهای articlesRead/Write ادمین۲ (۰۰۰۹ stage-82) ساخته شدند',
    articlePerms === 2,
    (articlePerms === null || Number(articlePerms) < 2) && !CHAIN_HAS_0009
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۰۹ ندارد — اول: bun run db:generate'
      : `count=${articlePerms}`,
  )
  // A2 — stage-84: اشیاءِ ۰۰۱۳ (اقلام بسته‌بندی + junction + مجوز شلوغی)
  const packagingTables = await scalar(
    url,
    `select count(*)::int as n from information_schema.tables where table_name in ('packaging_items','product_packaging_items')`,
  )
  ok(
    'A2: جدول‌های اقلام بسته‌بندی (۰۰۱۳ stage-84) ساخته شدند',
    packagingTables === 2,
    packagingTables === 0 && !CHAIN_HAS_0013
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۳ ندارد — اول: bun run db:generate'
      : `count=${packagingTables}`,
  )
  const busyCol = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where table_name='admin2_profiles' and column_name='can_announce_busy'`,
  )
  ok(
    'A2: مجوز canAnnounceBusy ادمین۲ (۰۰۱۳ stage-84) ساخته شد',
    busyCol === 1,
    busyCol === 0 && !CHAIN_HAS_0013
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۳ ندارد — اول: bun run db:generate'
      : `count=${busyCol}`,
  )
  // A2 — stage-86: اشیاءِ ۰۰۱۴ (امکان خریدِ دسته‌ها: والد + زیردسته)
  const purchaseCols = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where column_name='purchase_enabled' and table_name in ('main_categories','categories')`,
  )
  ok(
    'A2: ستون‌های purchase_enabled دسته‌ها (۰۰۱۴ stage-86) ساخته شدند',
    purchaseCols === 2,
    Number(purchaseCols) < 2 && !CHAIN_HAS_0014
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۴ ندارد — اول: bun run db:generate'
      : `count=${purchaseCols}`,
  )
  const purchaseDefault = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where column_name='purchase_enabled' and table_name in ('main_categories','categories') and column_default = 'true'`,
  )
  ok(
    'A2: پیش‌فرضِ purchase_enabled = true (رفتارِ قبلِ stage-86 حفظ شد)',
    purchaseDefault === 2,
    Number(purchaseDefault) < 2 && !CHAIN_HAS_0014
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۴ ندارد — اول: bun run db:generate'
      : `count=${purchaseDefault}`,
  )
  // A2 — stage-88: اشیاءِ ۰۰۱۵ (جدولِ printers + ایندکسِ یکتای host,port)
  const printersTable = await scalar(
    url,
    `select count(*)::int as n from information_schema.tables where table_name='printers'`,
  )
  ok(
    'A2: جدول printers رجیستری چاپگرها (۰۰۱۵ stage-88) ساخته شد',
    printersTable === 1,
    printersTable === 0 && !CHAIN_HAS_0015
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۵ ندارد — اول: bun run db:generate'
      : `count=${printersTable}`,
  )
  const printersWidthDefault = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where table_name='printers' and column_name='width_dots' and column_default = '576'`,
  )
  ok(
    'A2: پیش‌فرضِ width_dots = 576 (کاغذ ۸۰mm — رفتارِ POS)',
    printersWidthDefault === 1,
    printersWidthDefault === 0 && !CHAIN_HAS_0015
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۵ ندارد'
      : `count=${printersWidthDefault}`,
  )
  const printersUnique = await scalar(
    url,
    `select count(*)::int as n from pg_indexes where indexname='printers_host_port_key'`,
  )
  ok(
    'A2: ایندکسِ یکتای (host,port) چاپگرها ساخته شد',
    printersUnique === 1,
    printersUnique === 0 && !CHAIN_HAS_0015
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۵ ندارد'
      : `count=${printersUnique}`,
  )
  // A2 — stage-89: اشیاءِ ۰۰۱۶ (مجوزِ printingManage ادمین۲ — چاپ مستقیم/تخصیص)
  const printingManageCol = await scalar(
    url,
    `select count(*)::int as n from information_schema.columns where table_name='admin2_profiles' and column_name='printing_manage' and column_default = 'false'`,
  )
  ok(
    'A2: ستونِ printing_manage ادمین۲ (۰۰۱۶ stage-89) با پیش‌فرضِ false',
    printingManageCol === 1,
    printingManageCol === 0 && !CHAIN_HAS_0016
      ? 'زنجیره‌ی روی دیسک هنوز ۰۰۱۶ ندارد — اول: bun run db:generate'
      : `count=${printingManageCol}`,
  )

  // A3 — بک‌فیل نوع/برند (ماتریس UA)
  const expects: Array<[string, string | null, string | null]> = [
    ['04', 'mobile', 'apple'],
    ['05', 'mobile', 'samsung'],
    ['06', 'mobile', 'xiaomi'],
    ['07', 'mobile', null],
    ['08', 'desktop', 'windows'],
    ['09', 'desktop', 'macos'],
    ['10', 'desktop', 'linux'],
    ['11', null, null],
  ]
  for (const [suffix, wantType, wantBrand] of expects) {
    const [t, b] = await typeBrand(url, suffix)
    ok(`A3: ${suffix} → ${wantType ?? 'null'}/${wantBrand ?? 'null'}`, t === wantType && b === wantBrand, `got ${t ?? 'null'}/${b ?? 'null'}`)
  }

  // A4 — بک‌فیل مالک (فقط REGISTER، فقط اولین)
  const owner16 = await scalar(url, `select "registered_owner_phone" as v from "devices" where "id" = '10000000-0000-0000-0000-000000000016'`)
  ok('A4: مالک از «اولین REGISTER» پر شد', owner16 === '09150000016', `got ${owner16}`)
  const owner15 = await scalar(url, `select "registered_owner_phone" as v from "devices" where "id" = '10000000-0000-0000-0000-000000000015'`)
  ok('A4: دستگاهِ فقط-LOGIN مالک نگرفت (بدون بلاکِ گذشته‌نگر)', owner15 === null)

  // A5 — آزادسازی مسدودی‌های خودکار (نسخه‌دار — اجرای نخست)
  const unblocked = await scalar(url, `select count(*)::int as n from "devices" where "is_blocked" = false and "blocked_reason" = 'auto-cleared:backfill'`)
  ok('A5: دو مسدودیِ auto:% آزاد شدند (پاک‌سازیِ یک‌باره‌ی v1)', unblocked === 2)
  const manual = await scalar(url, `select "is_blocked" as v from "devices" where "id" = '10000000-0000-0000-0000-000000000014'`)
  ok('A5: مسدودی دستیِ ادمین دست‌نخورده ماند', String(manual) === 'true')
  const events = await scalar(url, `select count(*)::int as n from "device_events" where "event" = 'AUTO_UNBLOCK'`)
  ok('A5: رویداد AUTO_UNBLOCK برای هر آزادسازی ثبت شد', events === 2)
  const marker = await scalar(url, `select count(*)::int as n from "backfill_runs" where "name" = 'device-auto-unblock'`)
  ok('A5: مارکرِ نسخه‌دار در backfill_runs ثبت شد', marker === 1)

  // A6 — ایدمپوتنت: اجرای دوباره = صفر تغییر + مسدودیِ «جدید» زنده می‌ماند
  await q(url, NEW_AUTO_BLOCK_SQL('21'))
  const before = await scalar(url, `select md5(jsonb_agg(to_jsonb(d) order by d.id)::text) as v from "devices" d`)
  const res2 = await runRealMigrate(url)
  ok('A6: اجرای دوباره موفق', res2.code === 0)
  ok('A6: اجرای دوباره = رد شدِ پاک‌سازی (مارکر)', /قبلاً اعمال شده/.test(res2.out))
  const after = await scalar(url, `select md5(jsonb_agg(to_jsonb(d) order by d.id)::text) as v from "devices" d`)
  ok('A6: ردیف‌های devices (شامل مسدودیِ جدید) بی‌تغییر ماندند', before === after)
  const repeatedMemory = await scalar(url, `select device_memory from devices where fingerprint_hash = 'f-sam'`)
  ok('A6: repeated migration preserves fractional device memory', repeatedMemory === 0.25)
  const newBlock = await scalar(url, `select "is_blocked" as v from "devices" where "id" = '20000000-0000-0000-0000-000000000021'`)
  ok('A6: مسدودیِ خودکارِ «بعد از اجرای اول» آزاد «نشد» (باگ اصلی بسته شد)', String(newBlock) === 'true')
})

// ── سناریو B — دیتابیس فریش ──────────────────────────────────────

await withScratch('b', async (url) => {
  const res = await runRealMigrate(url)
  ok('B1: زنجیره‌ی کامل روی DB فریش اعمال شد', res.code === 0)
  const journalRows = await scalar(url, `select count(*)::int as n from "drizzle"."__drizzle_migrations"`)
  ok(`B1: journal = ${CHAIN_COUNT} ورودی`, journalRows === CHAIN_COUNT)
  const devices = await scalar(url, `select count(*)::int as n from "devices"`)
  ok('B1: بک‌فیل‌ها روی جدولِ خالی no-op بودند', devices === 0)
  const marker = await scalar(url, `select count(*)::int as n from "backfill_runs"`)
  ok('B1: مارکر نسخه‌دار روی DB فریش ثبت شد', marker === 1)
  const res2 = await runRealMigrate(url)
  ok('B2: اجرای دوباره no-op موفق', res2.code === 0 && /بک‌فیل جدیدی لازم نبود/.test(res2.out))
})

// ── سناریو C — پروداکشنِ روی ۰۰۰۵ (ردیف‌های legacy بعد از ستون‌ها) ──

await withScratch('c', async (url) => {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه C ناموفق')
  await q(url, LEGACY_SQL)
  const res2 = await runRealMigrate(url)
  ok('C1: db:migrate روی DBِ اعمال‌شده + ردیف‌های legacy موفق', res2.code === 0)
  const [t, b] = await typeBrand(url, '05')
  ok('C1: ردیف legacy بعد از ۰۰۰۵ هم بک‌فیل شد (mobile/samsung)', t === 'mobile' && b === 'samsung')
  const owner16 = await scalar(url, `select "registered_owner_phone" as v from "devices" where "id" = '10000000-0000-0000-0000-000000000016'`)
  ok('C1: مالکِ REGISTER بک‌فیل شد', owner16 === '09150000016')
  const before = await scalar(url, `select md5(jsonb_agg(to_jsonb(d) order by d.id)::text) as v from "devices" d`)
  await runRealMigrate(url)
  const after = await scalar(url, `select md5(jsonb_agg(to_jsonb(d) order by d.id)::text) as v from "devices" d`)
  ok('C2: اجرای سوم = صفر تغییر', before === after)
})

// ── سناریو D — journal جلوتر از زنجیره (۰۰۰۶ِ قدیمی اعمال‌شده) ────

await withScratch('d', async (url) => {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه D ناموفق')
  // شبیه‌سازی: کارفرما ۰۰۰۶ِ قدیمیِ دستی را قبلاً اعمال کرده (timestamp
  // بزرگ‌تر از آخرین ورودی زنجیره) و دیتایش بک‌فیل شده
  const maxTs = await scalar(url, `select max(created_at)::bigint as v from "drizzle"."__drizzle_migrations"`)
  await q(url, `
    insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
    values ('legacy-0006-hash', ${Number(maxTs) + 1});
  `)
  await q(url, LEGACY_SQL)
  await q(url, `
    update "devices" set "device_type" = 'mobile', "device_brand" = 'samsung'
    where "fingerprint_hash" = 'f-sam';
  `)
  const res2 = await runRealMigrate(url)
  ok('D1: روی DBِ با journal جلوتر، db:migrate بدون خطا رد شد', res2.code === 0)
  const journalRows = await scalar(url, `select count(*)::int as n from "drizzle"."__drizzle_migrations"`)
  ok(`D2: زنجیره دوباره اعمال نشد (${CHAIN_COUNT + 1} ردیف می‌ماند)`, journalRows === CHAIN_COUNT + 1)
})

// ── سناریو E — stage-73: پاک‌سازی auto:% نسخه‌دار (یافته‌ی ۲) ──────

// E1 — دیتابیسِ کاریِ کارفرما: شواهدِ اجرای stage-72 + مسدودیِ جدید
await withScratch('e1', async (url) => {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه E1 ناموفق')
  // شبیه‌سازی: بک‌فیل stage-72 «قبلاً» اجرا شده (رویداد AUTO_UNBLOCK موجود
  // — دیتابیسِ کاریِ کارفرما جدول backfill_runs نداشت → مارکر هم نیست)
  await clearVersionedMarker(url)
  await q(url, `insert into "devices" ("id","fingerprint_hash","canvas_hash","webgl_hash","audio_hash","fonts_hash") values ('10000000-0000-0000-0000-000000000012','f-b12','cb','wb','ab','fob')`)
  await q(url, `insert into "device_events" ("device_id","phone","event") values ('10000000-0000-0000-0000-000000000012', null, 'AUTO_UNBLOCK')`)
  await q(url, `update "devices" set "is_blocked" = false, "blocked_reason" = 'auto-cleared:backfill' where "id" = '10000000-0000-0000-0000-000000000012'`)
  await q(url, NEW_AUTO_BLOCK_SQL('31'))
  const res2 = await runRealMigrate(url)
  ok('E1: db:migrate بعد از stage-72 موفق', res2.code === 0)
  ok(
    'E1: شواهدِ اجرای قبلی تشخیص شد — فقط مارکر (بدون اجرای پاک‌سازی)',
    /اجرای قبلیِ stage-72 شناسایی شد/.test(res2.out),
    res2.out.split('\n').find((l) => l.includes('stage-72')) ?? '(no match)',
  )
  const newBlock = await scalar(url, `select "is_blocked" as v from "devices" where "id" = '20000000-0000-0000-0000-000000000031'`)
  ok('E1: مسدودیِ خودکارِ جدید (post-stage-72) زنده ماند — باگِ کارفرما بسته شد', String(newBlock) === 'true')
  const marker = await scalar(url, `select count(*)::int as n from "backfill_runs" where "name" = 'device-auto-unblock'`)
  ok('E1: مارکر از روی شواهد ثبت شد (از این به بعد همیشه رد)', marker === 1)
  // سومین اجرا: already-applied
  const res3 = await runRealMigrate(url)
  ok('E1: اجرای سوم = already-applied', res3.code === 0 && /قبلاً اعمال شده/.test(res3.out))
})

// E2 — ضمانتِ یک‌باره: دیتابیسِ بدون-execution (بازگردانی از بکاپ)
await withScratch('e2', async (url) => {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه E2 ناموفق')
  // شبیه‌سازیِ restore از بکاپِ قبل از stage-72: مارکر نیست، شواهد نیست،
  // مسدودی‌های خودکارِ قدیمی هست
  await clearVersionedMarker(url)
  await q(url, LEGACY_SQL) // شامل دو مسدودیِ auto:% قدیمی (f-b12/f-b13)
  const res2 = await runRealMigrate(url)
  ok('E2: db:migrate روی DBِ بازگردانده‌شده موفق', res2.code === 0)
  const unblocked = await scalar(url, `select count(*)::int as n from "devices" where "is_blocked" = false and "blocked_reason" = 'auto-cleared:backfill'`)
  ok('E2: پاک‌سازیِ v1 مسدودی‌های «قدیمی» را آزاد کرد (دقیقاً یک‌بار)', unblocked === 2)
  const marker = await scalar(url, `select count(*)::int as n from "backfill_runs" where "name" = 'device-auto-unblock'`)
  ok('E2: مارکر ثبت شد', marker === 1)
  // مسدودیِ «جدید» بعد از پاک‌سازی — باید در deploy بعدی زنده بماند
  await q(url, NEW_AUTO_BLOCK_SQL('41'))
  const res3 = await runRealMigrate(url)
  ok('E3: اجرای بعدی موفق', res3.code === 0)
  const newBlock = await scalar(url, `select "is_blocked" as v from "devices" where "id" = '20000000-0000-0000-0000-000000000041'`)
  ok('E2: مسدودیِ ساخته‌شده بعد از پاک‌سازی، در deploy بعدی آزاد «نشد»', String(newBlock) === 'true')
})

// E3 — پرچم اپراتور: DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK=1
await withScratch('e3', async (url) => {
  const res = await runRealMigrate(url)
  if (res.code !== 0) throw new Error('migrate اولیه E3 ناموفق')
  await clearVersionedMarker(url)
  await q(url, LEGACY_SQL)
  const res2 = await runRealMigrate(url, { DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK: '1' })
  ok('E3: db:migrate با پرچم skip موفق', res2.code === 0)
  ok('E3: پیامِ رد شدنِ آزادسازی لاگ شد', /پرچم DEVICE_BACKFILL_SKIP_AUTO_UNBLOCK رد شد/.test(res2.out))
  const stillBlocked = await scalar(url, `select count(*)::int as n from "devices" where "is_blocked" = true and "blocked_reason" like 'auto:%'`)
  ok('E3: هر دو مسدودی auto:% حفظ شدند', stillBlocked === 2)
  const marker = await scalar(url, `select count(*)::int as n from "backfill_runs"`)
  ok('E3: مارکر ثبت شد (برای همیشه «اجراشده»)', marker === 1)
  const [t, b] = await typeBrand(url, '05')
  ok('E3: بندهای بی‌ضرر (①/②) با پرچم هم اجرا شدند', t === 'mobile' && b === 'samsung')
})

// E4 — جدول backfill_runs نباشد (db:generate اجرا نشده)
await withScratch('e4', async (url) => {
  // Run the pre-0006 chain from an isolated cwd. Rewriting the working tree's
  // journal and removing migrations would race other tests and risk user edits.
  const journalPath = join(DRIZZLE_DIR, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; idx: number }>
  }
  const cutIdx = journal.entries.findIndex((e) => e.tag.startsWith('0006'))
  if (cutIdx < 1) throw new Error('ورودی ۰۰۰۶ در زنجیره پیدا نشد — E4 بی‌معنا')
  const workDir = mkdtempSync(join(tmpdir(), 'sinshin-e4-chain-'))
  const partialChain = join(workDir, 'drizzle')
  try {
    mkdirSync(join(partialChain, 'meta'), { recursive: true })
    for (const e of journal.entries.slice(0, cutIdx)) {
      copyFileSync(join(DRIZZLE_DIR, `${e.tag}.sql`), join(partialChain, `${e.tag}.sql`))
    }
    writeFileSync(
      join(partialChain, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, cutIdx) }, null, 2),
    )

    const res = await runRealMigrate(url, {}, workDir)
    ok('E4: db:migrate بدون ۰۰۰۶ (جدول backfill_runs نیست) بدون خطا', res.code === 0)
    ok(
      'E4: راهنمای db:generate لاگ شد',
      /جدول backfill_runs هنوز ساخته نشده/.test(res.out),
      res.out.split('\n').find((l) => l.includes('backfill_runs')) ?? '(no match)',
    )
    const runsTable = await scalar(url, `select to_regclass('public.backfill_runs') is not null as v`)
    ok('E4: جدول backfill_runs ساخته نشد (زنجیره‌ای نبود)', String(runsTable) === 'false')
  } finally {
    if (dirname(resolve(workDir)) !== resolve(tmpdir()) || !basename(workDir).startsWith('sinshin-e4-chain-')) {
      throw new Error('Refusing to remove a temporary migration folder outside the expected location')
    }
    rmSync(workDir, { recursive: true, force: true })
  }
})

// ── جمع‌بندی ──────────────────────────────────────────────────────

console.log(`\n══ نتیجه: ${pass} پاس / ${fail} خطا ══`)
if (fail > 0) {
  process.exitCode = 1
}
