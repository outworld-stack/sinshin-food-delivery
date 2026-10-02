// ═══════════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 9 از 14
// مسیر مقصد: apps/web/src/types/site/checkout.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════════

// src/types/site/checkout.ts

// رارد ۴۶ — DeliveryType از قرارداد مشترک می‌آید (قبلاً کپی محلی بود)؛
// re-export برای پایداری مسیر درون‌ریزیِ مصرف‌کننده‌های فعلی است.
import type {
  CheckoutInput,
  DeliveryType,
  OrderBreakdown,
  RestaurantStatusDisplay,
} from '@sinshin/shared'

export type { DeliveryType }

export type CouponStatus = 'NONE' | 'HAVE'

// رارد ۴۷ — وضعیت نمایشی رستوران = قرارداد مشترک (view-model عمدی چک‌اوت:
// ادغام بسته‌ی ساعتی/موقت — مبدل در server/checkout). قبلاً کپی محلی بود
// و closeReason را اختیاری می‌خواند در حالی که همیشه ارسال می‌شود.
export type RestaurantStatus = RestaurantStatusDisplay

// رارد ۴۳ — InvoiceData مرده بود و حذف شد؛ تایپ‌های پیش‌نمایش
// چک‌اوت به قرارداد مشترک منتقل شدند و از @sinshin/shared
// درون‌ریزی می‌شوند.

// رارد ۴۷ — محاسبات نمایشی مشتقِ OrderBreakdown قرارداد است (نه کپی):
// payableFood فقط سمت فرانت می‌سازد و total همان totalAmount با نام نمایشی.
export type CheckoutCalculation = Omit<OrderBreakdown, 'totalAmount'> & {
  payableFood: number
  total: number
}

// رارد ۴۷ — پیلود ثبت سفارش = شکل خام سیم (قرارداد مشترک). قبلاً
// addressId/customerNote/couponCode را الزامی می‌خواند که «دروغ سفید»
// بود — PICKUP/DINE_IN آدرس نمی‌فرستند و پیلود همیشه کامل می‌سازد.
export type CheckoutSubmitPayload = CheckoutInput

/** phase-3 — پرچم «این سفارش همین‌تب ثبت شده»؛ صفحه‌ی سفارش با SUCCESS سبد را پاک می‌کند */
export const PENDING_CHECKOUT_KEY = 'sinshin:pending-checkout'