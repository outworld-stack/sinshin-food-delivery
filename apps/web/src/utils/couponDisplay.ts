// src/utils/couponDisplay.ts
// phase-9: منطق نمایش کوپن — یک منبع واحد برای لیست و صفحه‌ی جزئیات.
// قبلاً هر مصرف‌کننده فیلدهای تختِ ساختگی می‌خواند (expiryDate/status) که
// در قرارداد واقعی سرور وجود ندارند → «Invalid Date» و وضعیت همیشگی «منقضی».
import type { CouponWithConditionsDto } from '@sinshin/shared'

export type CouponRow = CouponWithConditionsDto['coupon']

export type CouponStatus = 'ACTIVE' | 'EXPIRED' | 'DISABLED'

/** وضعیت واقعی — از isActive + endsAt مشتق می‌شود (سرور فیلد status ندارد) */
export function couponStatus(c: CouponRow): CouponStatus {
  if (!c.isActive) return 'DISABLED'
  if (c.endsAt !== null && new Date(c.endsAt).getTime() <= Date.now()) return 'EXPIRED'
  return 'ACTIVE'
}

export function couponStatusLabel(s: CouponStatus): string {
  switch (s) {
    case 'ACTIVE':
      return 'فعال'
    case 'EXPIRED':
      return 'منقضی'
    case 'DISABLED':
      return 'غیرفعال'
  }
}

/** کلاس‌های badge وضعیت — سبز/قرمز/خاکستری */
export function couponStatusBadgeClass(s: CouponStatus): string {
  switch (s) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
    case 'EXPIRED':
      return 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
    case 'DISABLED':
      return 'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400'
  }
}

/** انقضا — null یعنی بدون انقضا؛ تاریخ خراب هرگز «Invalid Date» نشان نمی‌دهد */
export function formatCouponExpiry(endsAt: string | null): string {
  if (!endsAt) return 'بدون انقضا'
  const t = new Date(endsAt).getTime()
  if (Number.isNaN(t)) return '—'
  return new Date(endsAt).toLocaleDateString('fa-IR')
}

/** مخاطب — عمومی همه؛ خصوصی فقط هدف‌یابی‌شده‌ها (grants) */
export function couponAudienceLabel(isPublic: boolean): string {
  return isPublic ? 'همه' : 'گروه خاص'
}

/** مصرف — «۲ / ۱۰» یا «۲ / ∞» یا فقط تعداد وقتی نامحدود */
export function formatCouponUsage(usedCount: number, maxUses: number): string {
  return maxUses === 0 ? `${usedCount} / ∞` : `${usedCount} / ${maxUses}`
}
