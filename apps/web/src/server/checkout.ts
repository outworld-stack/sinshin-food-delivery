// src/server/checkout.ts — تماماً API + auth
import { getJson, authJson } from '#/lib/api-fetch'
import { asAddressId, asProductId, asSizeId } from '@sinshin/shared'
import type {
  RestaurantStatusDto,
  CheckoutResponse,
  CheckoutRequest,
  PaymentStatus,
} from '@sinshin/shared'
import type { RestaurantStatus, CheckoutPreviewData } from '#/types/site/checkout'

// ─── وضعیت رستوران ───
export async function getRestaurantStatus(): Promise<RestaurantStatus> {
  const s = await getJson<RestaurantStatusDto>('/orders/restaurant-status')
  // round-13 — علت بسته‌شدن موقت برای نمایش در باکس خلاصه سفارش
  return {
    isOpen: s.isOpen && !s.temporarilyClosed,
    nextOpenTime: s.nextOpenTime,
    closeReason: s.temporarilyClosed ? s.temporaryCloseReason : null,
  }
}

// ─── پیش‌نمایش چک‌اوت (phase-3) — قیمت‌گذاری ۱۰۰٪ سروری ───
// جایگزین getCheckoutDetails — deliveryFee قبلاً همین‌جا «۳۵,۰۰۰ فلت» هاردکد بود!
export async function getCheckoutPreview(input: {
  items: { productId: string; sizeId?: string | null; quantity: number }[]
  deliveryType: 'DELIVERY' | 'PICKUP' | 'DINE_IN'
  useWallet: boolean
  addressId?: string | null
  couponCode?: string | null
}): Promise<CheckoutPreviewData> {
  return authJson<CheckoutPreviewData>('/orders/checkout/preview', 'POST', {
    items: input.items.map(i => ({
      productId: asProductId(i.productId),
      sizeId: i.sizeId ? asSizeId(i.sizeId) : null,
      quantity: i.quantity,
    })),
    deliveryType: input.deliveryType,
    useWallet: input.useWallet,
    addressId: input.addressId ? asAddressId(input.addressId) : null,
    couponCode: input.couponCode ?? null,
  })
}

// ─── ثبت سفارش — idempotent (phase-3) ───
export async function processCheckout(
  input: {
    items: { productId: string; sizeId?: string | null; quantity: number }[]
    deliveryType: 'DELIVERY' | 'PICKUP' | 'DINE_IN'
    useWallet: boolean
    addressId?: string | null
    customerNote?: string | null
    couponCode?: string | null
    gatewayId?: string | null
  },
  idempotencyKey: string,
): Promise<{
  orderCompleted: boolean
  paymentStatus: PaymentStatus
  orderId?: string
  paymentUrl?: string
}> {
  const body: CheckoutRequest = {
    items: input.items.map(i => ({
      productId: asProductId(i.productId),
      sizeId: i.sizeId ? asSizeId(i.sizeId) : null,
      quantity: i.quantity,
    })),
    deliveryType: input.deliveryType,
    useWallet: input.useWallet,
    addressId: input.addressId ? asAddressId(input.addressId) : null,
    customerNote: input.customerNote ?? null,
    couponCode: input.couponCode ?? null,
    gatewayId: input.gatewayId ?? null,
  }

  // ⚠️ تنها وابستگیِ باز: authJson باید پارامتر چهارم (headers) بپذیرد.
  // اگر tsc اینجا خطا داد: آرگومان چهارم را موقتاً حذف کن (idempotency
  // خاموش می‌شود) و src/lib/api-fetch.ts را بفرست تا امضاش را دقیق بچینم.
  const res = await authJson<CheckoutResponse>('/orders/checkout', 'POST', body, {
    headers: { 'idempotency-key': idempotencyKey },
  })

  if (res.orderCompleted) {
    return { orderCompleted: true, paymentStatus: 'SUCCESS', orderId: res.orderId }
  }

  if (res.paymentUrl) {
    // PENDING — نتیجه‌ی واقعی از mock/callback می‌آید
    return {
      orderCompleted: false,
      paymentStatus: 'PENDING',
      orderId: res.orderId,
      paymentUrl: res.paymentUrl,
    }
  }

  return { orderCompleted: false, paymentStatus: 'FAILED', orderId: res.orderId }
}

// ─── mock-pay (فقط dev) — paymentUrl نسبی از بک‌اند ───
export async function mockPay(
  paymentUrl: string,
  success: boolean,
): Promise<{ orderDisplayId: string; paymentStatus: 'SUCCESS' | 'FAILED' }> {
  // paymentUrl از بک‌اند relative است (/api/payments/mock/...) — به بک‌اند بزن
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