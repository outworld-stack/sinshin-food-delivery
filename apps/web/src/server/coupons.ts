// src/server/coupons.ts — تماماً API
// phase-9: شکل داده هم‌الگوی قرارداد واقعی سرور (CouponWithConditionsDto) —
// قبلاً تایپ تختِ ساختگی (expiryDate/status/recipientsCount تخت) باعث
// «Invalid Date»، «undefined نفر» و وضعیت همیشگی «منقضی» می‌شد.
import { authJson } from '#/lib/api-fetch'
import type { CouponWithConditionsDto, CouponRule } from '@sinshin/shared'

export async function getAdminCoupons(): Promise<CouponWithConditionsDto[]> {
  return authJson<CouponWithConditionsDto[]>('/admin/coupons', 'GET')
}

/** phase-9: جزئیات یک کوپن — صفحه‌ی اختصاصی */
export async function getAdminCoupon(id: string): Promise<CouponWithConditionsDto> {
  return authJson<CouponWithConditionsDto>(`/admin/coupons/${id}`, 'GET')
}

export async function createCoupon(input: {
  code: string
  title?: string | null
  discountPercentage: number
  maxUses: number
  isPublic: boolean
  expiryDate: string | null
  rules: CouponRule[]
}): Promise<{ success: boolean; id?: string }> {
  return authJson<{ success: boolean; id?: string }>(
    '/admin/coupons',
    'POST',
    {
      code: input.code,
      title: input.title ?? null,
      discountPercentage: input.discountPercentage,
      maxUses: input.maxUses,
      isPublic: input.isPublic,
      expiryDate: input.expiryDate,
      rules: input.rules.map(r => ({ type: r.type, value: String(r.value), quantity: r.quantity })),
    },
  )
}

export async function updateCoupon(input: {
  id: string
  code: string
  title?: string | null
  discountPercentage: number
  maxUses: number
  isPublic: boolean
  expiryDate: string | null
  rules: CouponRule[]
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/coupons/${input.id}`, 'PATCH', {
    code: input.code,
    title: input.title ?? null,
    discountPercentage: input.discountPercentage,
    maxUses: input.maxUses,
    isPublic: input.isPublic,
    expiryDate: input.expiryDate,
    rules: input.rules.map(r => ({ type: r.type, value: String(r.value), quantity: r.quantity })),
  })
}

export async function deleteCoupon(id: string): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/coupons/${id}`, 'DELETE')
}

/** stage-10: فعال/غیرفعال — رفع باگ «برگشتی نداشتن غیرفعال‌سازی» */
export async function setCouponActive(
  id: string,
  active: boolean,
): Promise<{ success: boolean; message: string }> {
  return authJson<{ success: boolean; message: string }>(`/admin/coupons/${id}/status`, 'PATCH', {
    active,
  })
}

export type { CouponRule }
