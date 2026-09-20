// src/types/admin/coupons.ts
import type { CouponRule } from '#/server/coupons'

// اینترفیس Coupon — هم‌شکل خروجی getAdminCoupons
export interface AdminCoupon {
  id: string
  code: string
  discountPercentage: number
  expiryDate: Date | string
  maxUses: number
  isPublic: boolean
  recipientsCount: number
  status: 'ACTIVE' | 'EXPIRED' | string
  rules: CouponRule[]
}