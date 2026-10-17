import { Err } from '#/domain/shared/errors'
import { UUID_RE } from '#/domain/shared/ids'

const whole = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum

export function validCouponRule(type: string, params: Record<string, unknown>): boolean {
  switch (type) {
    case 'MIN_TOTAL_SPEND':
    case 'MIN_REFERRAL_SPEND': return whole(params.amount, 1)
    case 'REGISTERED_DAYS_AGO': return whole(params.days, 1, 1_000_000)
    case 'ORDERS_IN_LAST_DAYS': return whole(params.days, 1, 1_000_000) && whole(params.count, 1, 100_000)
    case 'MIN_PRODUCT_ORDERS':
    case 'MIN_CATEGORY_ORDERS': {
      const id = params[type === 'MIN_PRODUCT_ORDERS' ? 'productId' : 'categoryId']
      // An explicitly configured zero purchase threshold is supported.
      return typeof id === 'string' && UUID_RE.test(id) && whole(params.count, 0, 100_000)
    }
    case 'MIN_ORDERS_COUNT':
    case 'MIN_REFERRALS':
    case 'MIN_REFERRAL_ORDERS': return whole(params.count, 1)
    default: return false
  }
}

export function validateCouponNumbers(input: {
  discountPercentage: number
  maxUses: number
  maxPerUser?: number
  rules: Array<{ type: string; params: Record<string, unknown> }>
}): void {
  if (!whole(input.discountPercentage, 1, 99)) {
    throw Err.validation('درصد تخفیف باید یک عدد صحیح بین ۱ تا ۹۹ باشد')
  }
  if (!whole(input.maxUses, 0, 1_000_000) ||
      (input.maxPerUser !== undefined && !whole(input.maxPerUser, 0, 1_000_000))) {
    throw Err.validation('سقف مصرف باید یک عدد صحیح بین صفر و یک میلیون باشد')
  }
  if (input.rules.length > 10 || input.rules.some(rule => !validCouponRule(rule.type, rule.params))) {
    throw Err.validation('شرط کوپن معتبر نیست؛ نوع شرط، مقدار عددی و شناسه محصول یا دسته را بررسی کنید')
  }
}

export function assertFutureCouponExpiry(expiryDate: string | null | undefined, now = Date.now()): void {
  if (!expiryDate) return
  const expiresAt = new Date(expiryDate).getTime()
  if (!Number.isFinite(expiresAt)) throw Err.validation('تاریخ انقضا معتبر نیست')
  if (expiresAt <= now) throw Err.validation('تاریخ و ساعت انقضا باید در آینده باشد')
}
