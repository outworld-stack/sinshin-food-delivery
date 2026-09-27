//src/infra/db/client.ts
/**
 * Database — Drizzle روی کلاینت بومی Bun (Bun.sql).
 * بدون pg، بدون پکیج postgres — pooling خودِ Bun.
 */
import { SQL } from 'bun'
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

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