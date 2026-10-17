// src/domain/shared/wallet-sql.ts
import { sql } from 'drizzle-orm'

import { walletTransactions } from '#/infra/db/schema'
import type { DbOrTx } from '#/infra/db/client'

/** Serialize spending and reward reversals without locking foreign-key reads.
 * Call before user/order/payment row locks, inside the money transaction.
 * Deposits may arrive concurrently: missing a new credit can only reduce spend.
 */
export async function lockWalletAccounts(tx: DbOrTx, userIds: string[]): Promise<void> {
  for (const id of [...new Set(userIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wallet:${id}`}, 0))`)
  }
}

/**
 * عبارت SQL «مبلغ امضادار» تراکنش کیف پول — واریز مثبت، برداشت منفی.
 *
 * قرارداد: DEPOSIT تنها نوع مثبت است؛ هر نوع دیگر (WITHDRAW/…) منفی.
 * قبل از راند ۱۷ همین عبارت در شش جای جداگانه کپی شده بود — یک تعریف،
 * یک معنا؛ اگر روزی نوع تراکنش جدیدی اضافه شود فقط همین‌جا عوض می‌شود.
 *
 * مصرف‌کنندگان: order.service (موجودی) · admin.service (داشبورد/گزارش) ·
 * report-query.service (گزارش کاربران) — همیشه داخل sum()/coalesce.
 */
export const signedWalletAmount = sql<number>`case when ${walletTransactions.type} = 'DEPOSIT' then ${walletTransactions.amount} else -${walletTransactions.amount} end`
