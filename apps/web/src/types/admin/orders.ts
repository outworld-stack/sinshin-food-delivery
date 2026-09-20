// src/types/admin/orders.ts

// ردیف سفارش — فیلدهای مشترک UI (هم AdminOrder هم LiveOrder سرور)
export interface OrderRow {
  id: string
  userPhone: string
  userName: string
  amount: number
  date: Date
  status: string
  customerNote?: string | null
  confirmedByName?: string | null
  courierName?: string | null
}

// گزینه فیلتر
export interface FilterOption {
  id: string
  name: string
}