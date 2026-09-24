// src/domain/shared/wallet-sql.ts
import { sql } from 'drizzle-orm'

import { walletTransactions } from '#/infra/db/schema'

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
