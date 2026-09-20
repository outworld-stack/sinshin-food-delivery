// src/types/dashboard/wallet.ts

export type TransactionSort = 'newest' | 'oldest' | 'highest' | 'lowest' | 'income' | 'expense'

export interface WalletStats {
  totalReferralProfit: number
  referralsCount: number
}

export interface ReferralRow {
  id: string
  phone: string
  registerDate: Date
  totalOrders: number
  totalSpent: number
  myProfit: number
}

export interface TransactionRowData {
  id: string
  type: 'DEPOSIT' | 'WITHDRAW'
  amount: number
  date: Date
  description: string
  orderId?: string | null  
}