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
    this.client = new SQL(url, { max: opts.max ?? 10 })
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
    await this.client.close()
  }
}