// ═══════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 10 از 14
// مسیر مقصد: apps/web/src/server/checkout.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════

// src/server/checkout.ts — تماماً API + auth
import { getJson, authJson } from '#/lib/api-fetch'
import type {
  RestaurantStatusDto,
  CheckoutInput,
  CheckoutResponse,
  CheckoutPreviewData,
  PaymentStatus,
} from '@sinshin/shared'
import type { RestaurantStatus } from '#/types/site/checkout'

// رارد ۴۶ — دو یونیون درون‌خطی «DELIVERY | PICKUP | DINE_IN» در امضاهای
// پیش‌نمایش/ثبت با DeliveryType قراردادی جایگزین شدند (شکل بدون تغییر).
// رارد ۴۷ — ورودی‌های درون‌خطی هم به CheckoutInput قراردادی وصل شدند و
// تبدیل‌های نوعِ برنددار (asProductId و دوستان) حذف شدند — تایپ درخواست حالا
// شکل خام سیم است و برند لازم ندارد.

// ─── وضعیت رستوران ───
export async function getRestaurantStatus(): Promise<RestaurantStatus> {
  const s = await getJson<RestaurantStatusDto>('/orders/restaurant-status')
  // round-13 — علت بسته‌شدن موقت برای نمایش در باکس خلاصه سفارش
  // round-29 — بسته‌ی موقت: زمانِ باز شدن مجددِ موقت (اگر ثبت شده) بر ساعتِ کاری
  // اصلی مقدم است؛ قبلاً چک‌اوت در بسته‌شدن موقت هم ساعت اصلی را نشان می‌داد.
  return {
    isOpen: s.isOpen && !s.temporarilyClosed,
    nextOpenTime:
      s.temporarilyClosed && s.temporaryReopenTime
        ? s.temporaryReopenTime
        : s.nextOpenTime,
    closeReason: s.temporarilyClosed ? s.temporaryCloseReason : null,
  }
}

// ─── پیش‌نمایش چک‌اوت (phase-3) — قیمت‌گذاری ۱۰۰٪ سروری ───
// جایگزین getCheckoutDetails — deliveryFee قبلاً همین‌جا «۳۵,۰۰۰ فلت» هاردکد بود!
export async function getCheckoutPreview(
  input: Omit<CheckoutInput, 'customerNote' | 'gatewayId'>,
): Promise<CheckoutPreviewData> {
  return authJson<CheckoutPreviewData>('/orders/checkout/preview', 'POST', {
    items: input.items.map(i => ({
      productId: i.productId,
      sizeId: i.sizeId ?? null,
      quantity: i.quantity,
    })),
    deliveryType: input.deliveryType,
    useWallet: input.useWallet,
    addressId: input.addressId ?? null,
    couponCode: input.couponCode ?? null,
  })
}

// ─── ثبت سفارش — تکرارناپذیر (phase-3) ───
export async function processCheckout(
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<{
  orderCompleted: boolean
  paymentStatus: PaymentStatus
  orderId?: string
  paymentUrl?: string
}> {
  const body: CheckoutInput = {
    items: input.items.map(i => ({
      productId: i.productId,
      sizeId: i.sizeId ?? null,
      quantity: i.quantity,
    })),
    deliveryType: input.deliveryType,
    useWallet: input.useWallet,
    addressId: input.addressId ?? null,
    customerNote: input.customerNote ?? null,
    couponCode: input.couponCode ?? null,
    gatewayId: input.gatewayId ?? null,
  }

  // ⚠️ تنها وابستگیِ باز: authJson باید پارامتر چهارم (headers) بپذیرد.
  // اگر tsc اینجا خطا داد: آرگومان چهارم را موقتاً حذف کن (تکرارناپذیری
  // خاموش می‌شود) و src/lib/api-fetch.ts را بفرست تا امضاش را دقیق بچینم.
  const res = await authJson<CheckoutResponse>('/orders/checkout', 'POST', body, {
    headers: { 'idempotency-key': idempotencyKey },
  })

  if (res.orderCompleted) {
    return { orderCompleted: true, paymentStatus: 'SUCCESS', orderId: res.orderId }
  }

  if (res.paymentUrl) {
    // PENDING — نتیجه‌ی واقعی از درگاه ساختگی/کال‌بک می‌آید
    return {
      orderCompleted: false,
      paymentStatus: 'PENDING',
      orderId: res.orderId,
      paymentUrl: res.paymentUrl,
    }
  }

  return { orderCompleted: false, paymentStatus: 'FAILED', orderId: res.orderId }
}

// ─── mock-pay (فقط محیط توسعه) — paymentUrl نسبی از بک‌اند ───
export async function mockPay(
  paymentUrl: string,
  success: boolean,
): Promise<{ orderDisplayId: string; paymentStatus: 'SUCCESS' | 'FAILED' }> {
  // paymentUrl مسیرِ نسبیِ بک‌اند است (/api/payments/mock/...) — به بک‌اند بزن
  const base = import.meta.env.VITE_API_URL || window.location.origin
  const fullUrl = paymentUrl.startsWith('http') ? paymentUrl : base + paymentUrl

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ success }),
    credentials: 'include',
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(b?.error?.message ?? `خطای ${res.status}`)
  }
  return res.json() as Promise<{ orderDisplayId: string; paymentStatus: 'SUCCESS' | 'FAILED' }>
}