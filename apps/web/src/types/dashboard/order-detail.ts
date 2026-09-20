// src/types/dashboard/order-detail.ts

export interface LiveTrackingStatus {
  isEnabled: boolean
}

export interface CourierPosition {
  lat: number
  lng: number
}

// وضعیت‌هایی که کاربر هنوز تحویل نگرفته
export type ActiveOrderStatus = 'PAID' | 'CONFIRMED' | 'ON_THE_WAY'

export function isAwaitingDelivery(status: string): boolean {
  return status === 'PAID' || status === 'CONFIRMED' || status === 'ON_THE_WAY'
}