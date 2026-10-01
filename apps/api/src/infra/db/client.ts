// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 3 از 14
// مسیر مقصد: apps/api/src/infra/db/client.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

//src/infra/db/client.ts
/**
 * Database — Drizzle روی کلاینت بومی Bun (Bun.sql).
 * بدون pg، بدون پکیج postgres — pooling خودِ Bun.
 */
import { SQL } from 'bun'
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql'
import { PgJsonb } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * round-36 — رفع انکد دوباره‌ی ستون‌های jsonb (باگ درایور drizzle/bun-sql).
 *
 * پیشینه (کشف در تست عمیق روندهای ۳۱-۳۵): mapToDriverValue پیش‌فرضِ
 * jsonb در drizzle مقدار را JSON.stringify می‌کند و «رشته» را به‌عنوان
 * پارامتر می‌دهد؛ Bun.sql هم پارامتر رشته‌ای را برای ستون jsonb به
 * «رشته‌ی jsonb» تبدیل می‌کند — نتیجه: هر نوشتنِ آرایه/شیء، دوبار انکد
 * می‌شود (jsonb_typeof = 'string' به‌جای 'array'). خواندن به‌طور تصادفی
 * متقارن بود (پارس دوباره در Bun.sql + mapFromDriverValue) و برنامه کار
 * می‌کرد؛ اما هر تابع SQL-سطحی روی ستون (jsonb_array_length در کوئری‌های
 * اسکن ترجمه‌ی رارد ۳۵) با «cannot get array length of a scalar» می‌شکست.
 *
 * رفع: برای درایور Bun.sql پارامتر را «خام» بدهیم — Bun.sql خودش آرایه/
 * شیء را به jsonb درست انکد می‌کند. این وصله روی prototype، همه‌ی ستون‌های
 * jsonb اسکیمای موجود را یک‌جا پوشش می‌دهد (بدون بازنویسی اسکیما).
 * خواندن دست‌نخورده می‌ماند: mapFromDriverValue هر دو حالت (رشته یا
 * مقدار پارس‌شده) را درست برمی‌گرداند — داده‌های قدیمیِ دوبار-انکد هم
 * خوانده می‌شوند؛ برای یکدست‌سازی، اسکریپت scripts/normalize-jsonb.ts.
 */
const jsonbProto = PgJsonb.prototype as {
  mapToDriverValue: (value: unknown) => unknown
}
jsonbProto.mapToDriverValue = (value: unknown) => value

/** نمونه‌ی drizzle — این چیزی است که به سرویس‌های دامنه تزریق می‌شود */
export type Db = BunSQLDatabase<typeof schema>

/** تراکنش drizzle — برای متدهایی که داخل tx اجرا می‌شوند */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export interface DatabaseOptions {
  /**
   * حداکثر اتصال‌های pool (پیش‌فرض ۱۰).
   * هر نمونه‌ی SQL یک pool کامل باز می‌کند — در اسکریپت‌های یک‌بارمصرف ۲ کافی است.
   */
  max?: number
}

export class Database {
  private readonly client: SQL
  readonly db: Db

  constructor(url: string, opts: DatabaseOptions = {}) {
    // round-28 — تایم‌اوت‌های کوئری روی «هر اتصالِ» pool:
    // بدون این‌ها، یک قفل/کندی پستگرس (بکاپ روزانه، autovacuum سنگین، قفل
    // FOR UPDATE) کوئری‌ها را بی‌نهایت معطل نگه می‌دارد؛ ۱۰ اتصالِ pool پر
    // می‌شود و «همه‌ی» روت‌ها از جمله /api/health بدون پاسخ می‌مانند (نه
    // ۵۰۳، نه کرش — فقط سکوت). با تایم‌اوت، همان کوئری خطا (۵۰۰) می‌شود و
    // اتصال آزاد می‌ماند — هم‌قرارداد بقیه‌ی سیستم: degrade، نه deadlock.
    this.client = new SQL(url, {
      max: opts.max ?? 10,
      connection: {
        statement_timeout: '15s',
        lock_timeout: '10s',
        idle_in_transaction_session_timeout: '60s',
      },
    })
    this.db = drizzle(this.client, { schema })
  }

  /** گرم‌کردن + probe اتصال. هرگز throw نمی‌کند (health گزارش می‌دهد). */
  async connect(): Promise<boolean> {
    try {
      await this.client`select 1`
      return true
    } catch {
      return false
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client`select 1`
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    // round-28 — timeout (ثانیه): کوئری گیرکرده نتواند shutdown را تا ابد
    // معطل کند؛ وگرنه compose بعد از grace-period به SIGKILL می‌رسد و لاگ
    // آخرین لحظه گم می‌شود
    await this.client.close({ timeout: 10 })
  }
}
