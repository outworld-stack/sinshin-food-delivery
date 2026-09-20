// src/server/coupons.ts — تماماً API
import { authJson } from '#/lib/api-fetch'
import type { CouponWithConditionsDto, CouponRule } from '@sinshin/shared'

export async function getAdminCoupons(): Promise<CouponWithConditionsDto[]> {
  return authJson<CouponWithConditionsDto[]>('/admin/coupons', 'GET')
}

export async function createCoupon(input: {
  code: string
  title?: string | null
  discountPercentage: number
  maxUses: number
  isPublic: boolean
  expiryDate: string | null
  rules: CouponRule[]
}): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
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

export type { CouponRule }
