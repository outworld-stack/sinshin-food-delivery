import { Err } from '#/domain/shared/errors'
import { UUID_RE } from '#/domain/shared/ids'

const whole = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum

export function validCouponRule(type: string, params: Record<string, unknown>): boolean {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return false
  switch (type) {
    case 'FIRST_PURCHASE': return Object.keys(params).length === 0
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

/** FIRST_PURCHASE and positive purchase-history requirements cannot both hold. */
export function hasContradictoryCouponRules(
  rules: Array<{ type: string; params: Record<string, unknown> }>,
  mode: 'AND' | 'OR' = 'AND',
): boolean {
  if (mode !== 'AND' || !rules.some(rule => rule.type === 'FIRST_PURCHASE')) return false
  return rules.some(rule =>
    rule.type === 'MIN_ORDERS_COUNT' || rule.type === 'MIN_TOTAL_SPEND' ||
    rule.type === 'ORDERS_IN_LAST_DAYS' ||
    ((rule.type === 'MIN_PRODUCT_ORDERS' || rule.type === 'MIN_CATEGORY_ORDERS') &&
      typeof rule.params.count === 'number' && rule.params.count > 0))
}

export function validateCouponConfiguration(input: {
  conditionMode?: string
  discountScope?: string
  discountCategoryId?: string | null
  discountProductId?: string | null
  rules: Array<{ type: string; params: Record<string, unknown> }>
}): void {
  const mode = input.conditionMode ?? 'AND'
  if (mode !== 'AND' && mode !== 'OR') throw Err.validation('شیوه ترکیب شرط‌های کوپن معتبر نیست')
  if (hasContradictoryCouponRules(input.rules, mode)) {
    throw Err.validation('شرط اولین خرید با شرط داشتن خرید موفق قبلی در حالت «همه شرط‌ها» سازگار نیست')
  }
  const scope = input.discountScope ?? 'ALL_PRODUCTS'
  const categoryId = input.discountCategoryId ?? null
  const productId = input.discountProductId ?? null
  if ((scope === 'ALL_PRODUCTS' && (categoryId !== null || productId !== null)) ||
      (scope === 'CATEGORY' && (categoryId === null || !UUID_RE.test(categoryId) || productId !== null)) ||
      (scope === 'PRODUCT' && (productId === null || !UUID_RE.test(productId) || categoryId !== null)) ||
      !['ALL_PRODUCTS', 'CATEGORY', 'PRODUCT'].includes(scope)) {
    throw Err.validation('محدوده تخفیف و محصول یا دسته انتخاب‌شده معتبر نیست')
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
