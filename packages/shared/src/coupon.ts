/** Use the same coupon spelling for administration and redemption. */
export function normalizeCouponCode(value: string): string {
  return value.trim()
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .toUpperCase()
}
