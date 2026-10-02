// ═══════════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 9 از 14
// مسیر مقصد: apps/web/src/types/site/checkout.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════════

// src/types/site/checkout.ts

export type DeliveryType = 'DELIVERY' | 'PICKUP' | 'DINE_IN'
export type CouponStatus = 'NONE' | 'HAVE'

// آیتم ۲۲: وضعیت رستوران
export interface RestaurantStatus {
  isOpen: boolean
  nextOpenTime: string
  /** round-13 — علت بسته‌شدن موقت (فقط وقتی موقتاً بسته باشد) */
  closeReason?: string | null
}

// رارد ۴۳ — InvoiceData مرده بود و حذف شد؛ تایپ‌های پیش‌نمایش
// چک‌اوت به قرارداد مشترک منتقل شدند و از @sinshin/shared
// import می‌شوند.

// محاسبات نمایشی — همه از breakdown سرور مشتق می‌شوند
export interface CheckoutCalculation {
  foodTotal: number
  discount: number
  payableFood: number
  walletDeduction: number
  deliveryFee: number
  packagingFee: number // ← phase-3: PICKUP
  total: number
  amountPaidOnline: number
}

// پیلود ثبت سفارش
export interface CheckoutSubmitPayload {
  items: { productId: string; sizeId?: string | null; quantity: number }[]
  deliveryType: DeliveryType
  useWallet: boolean
  addressId: string | null
  customerNote: string
  couponCode: string | null
  gatewayId?: string | null
}

/** phase-3 — پرچم «این سفارش همین‌تب ثبت شده»؛ صفحه‌ی سفارش با SUCCESS سبد را پاک می‌کند */
export const PENDING_CHECKOUT_KEY = 'sinshin:pending-checkout'