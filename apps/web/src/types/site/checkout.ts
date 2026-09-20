// src/types/site/checkout.ts

export type DeliveryType = 'DELIVERY' | 'PICKUP' | 'DINE_IN'
export type CouponStatus = 'NONE' | 'HAVE'

// آیتم ۲۲: وضعیت رستوران
export interface RestaurantStatus {
  isOpen: boolean
  nextOpenTime: string
}

// فاکتور (خروجی سرور) — صفحه‌ی چاپ فاکتور
export interface InvoiceData {
  orderId: string
  items: { name: string; sizeName?: string | null; quantity: number; price: number }[]
  foodTotal: number
  discount: number
  walletDeduction: number
  deliveryFee: number
  totalAmount: number
  amountPaidOnline: number
  deliveryType: DeliveryType
  customerNote?: string | null
}

// ── phase-3: پیش‌نمایش چک‌اوت — قیمت‌گذاری ۱۰۰٪ سروری ──
export interface CheckoutPreviewCoupon {
  code: string
  valid: boolean
  discount: number
  message?: string
}

export interface CheckoutPreviewData {
  breakdown: {
    foodTotal: number
    discount: number
    walletDeduction: number
    deliveryFee: number
    packagingFee: number
    totalAmount: number
    amountPaidOnline: number
  }
  items: { name: string; sizeName: string | null; unitPrice: number; quantity: number }[]
  coupon: CheckoutPreviewCoupon | null
}

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