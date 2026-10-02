// src/types/dashboard/wallet.ts

// رارد ۴۶ — ReferralRow و TransactionRowData به قرارداد مشترک
// (@sinshin/shared: ReferralRowDto/WalletTransactionDto) وصل شدند —
// قبلاً کپی موازی با همان فیلدها بودند. WalletStats و TransactionSort
// فقط UI هستند و این‌جا می‌مانند.
import type { ReferralRowDto, WalletTransactionDto } from '@sinshin/shared'

export type TransactionSort = 'newest' | 'oldest' | 'highest' | 'lowest' | 'income' | 'expense'

export interface WalletStats {
  totalReferralProfit: number
  referralsCount: number
}

export type ReferralRow = ReferralRowDto

export type TransactionRowData = WalletTransactionDto