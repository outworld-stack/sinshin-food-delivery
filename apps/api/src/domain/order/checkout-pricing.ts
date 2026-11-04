import { and, eq, inArray } from 'drizzle-orm'
import type { CheckoutInput, CheckoutPreviewItem, OrderBreakdown } from '@sinshin/shared'
import type { DbOrTx } from '#/infra/db/client'
import { productCategories } from '#/infra/db/schema'
import { asProductId, type ProductId, type SizeId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import {
  finalPriceOf, loadCategoryModes, loadCategoryPurchaseStates, loadPricingBases, sizeFinalPriceOf,
} from '#/domain/menu/menu.service'

export interface PricedCheckoutItem extends CheckoutPreviewItem {
  productId: ProductId
  categoryId: string
  sizeId: SizeId | null
  packagingCost: number
  couponDiscountAmount: number
  blockedCategoryName?: string
}

export function assertMoneyAmounts(...amounts: number[]): void {
  if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647)) {
    throw Err.validation('مبلغ سفارش معتبر نیست یا از سقف مجاز بیشتر است.')
  }
}

/** One server-side price snapshot for both the read-only preview and checkout. */
export async function priceCheckoutItems(db: DbOrTx, input: CheckoutInput) {
  if (input.items.length === 0) throw Err.validation('سبد خرید خالی است.')
  if (input.items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    throw Err.validation('تعداد محصول معتبر نیست.')
  }
  const { productMap, sizesByProduct, packagingByProduct } = await loadPricingBases(db, input.items)
  const categoryIds = [...new Set([...productMap.values()].map(product => product.categoryId))]
  const catModes = await loadCategoryModes(db, categoryIds)
  const catPurchase = await loadCategoryPurchaseStates(db, categoryIds)
  const now = new Date()
  const items: PricedCheckoutItem[] = input.items.map(item => {
    const product = productMap.get(asProductId(item.productId))
    if (!product) throw Err.validation('یکی از محصولات سبد دیگر موجود نیست — سبد خرید را به‌روز کنید.')
    const modes = catModes.get(product.categoryId)
    const purchase = catPurchase.get(product.categoryId)
    const purchaseBlocked = !(purchase?.categoryPurchase ?? true) || !(purchase?.mainPurchase ?? true)
    const unavailable = product.status !== 'ACTIVE' || !product.isAvailable
    const available = !unavailable && !purchaseBlocked
    let unitPrice = finalPriceOf(product, now)
    let sizeId: SizeId | null = null
    let sizeName: string | null = null
    if (item.sizeId && !product.sizesEnabled) {
      throw Err.validation(`سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`)
    }
    if (product.sizesEnabled) {
      const sizes = sizesByProduct.get(product.id) ?? []
      if (sizes.length === 0) throw Err.validation(`سایزهای «${product.name}» در دسترس نیست — سبد خرید را به‌روز کنید.`)
      const size = item.sizeId ? sizes.find(size => size.id === item.sizeId) : sizes[0]
      if (!size) throw Err.validation(`سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`)
      unitPrice = sizeFinalPriceOf(size, now)
      sizeId = size.id
      sizeName = size.name
    }
    const packagingCost = packagingByProduct.get(product.id) ?? product.packagingCost
    assertMoneyAmounts(unitPrice, packagingCost, unitPrice * item.quantity, packagingCost * item.quantity)
    return {
      productId: product.id, categoryId: product.categoryId, name: product.name, sizeId, sizeName,
      unitPrice: available ? unitPrice : 0, quantity: item.quantity, packagingCost,
      available, couponDiscountAmount: 0,
      ...(available ? {} : { blockedReason: unavailable ? 'unavailable' as const : 'category' as const }),
      blockedCategoryName: purchase?.categoryPurchase === false ? purchase.categoryName : purchase?.mainName ?? product.name,
      courierAllowed: (modes?.courier ?? true) && product.courierAllowed,
      takeawayAllowed: (modes?.takeaway ?? true) && product.takeawayAllowed,
      dineInAllowed: (modes?.dineIn ?? true) && product.dineInAllowed,
    }
  })
  const foodTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const packagingTotal = items.reduce((sum, item) => sum + (item.available ? item.packagingCost * item.quantity : 0), 0)
  assertMoneyAmounts(foodTotal, packagingTotal)
  return { items, foodTotal, packagingTotal }
}

/** Preview reports availability; final checkout rejects every blocked cart. */
export function assertCheckoutItemsAvailable(items: PricedCheckoutItem[], deliveryType: CheckoutInput['deliveryType']) {
  const unavailable = items.find(item => item.blockedReason === 'unavailable')
  if (unavailable) throw Err.validation(`محصول «${unavailable.name}» فعلاً ناموجود است — سبد خرید را به‌روز کنید.`)
  const category = items.find(item => item.blockedReason === 'category')
  if (category) throw Err.validation(`خرید «${category.blockedCategoryName}» فعلاً غیرفعال شده است — این محصول را از سبد حذف کنید.`)
  const blocked = items.find(item => deliveryType === 'DELIVERY' ? !item.courierAllowed : deliveryType === 'PICKUP' ? !item.takeawayAllowed : !item.dineInAllowed)
  if (blocked) {
    const label = deliveryType === 'DELIVERY' ? 'ارسال با پیک' : deliveryType === 'PICKUP' ? 'تحویل حضوری بیرون‌بر' : 'سرو در محل'
    throw Err.validation(`${label} برای «${blocked.name}» امکان ندارد — حالت تحویل را عوض کنید یا آن را از سبد حذف کنید.`)
  }
}

export const NO_COUPON_PRODUCTS = 'هیچ محصول مشمول این کد تخفیف در سبد خرید وجود ندارد.'

/** Eligibility history never determines which cart lines receive a discount. */
export async function priceCouponDiscount(db: DbOrTx, items: PricedCheckoutItem[], coupon: {
  discountPercentage: number
  discountScope: 'ALL_PRODUCTS' | 'CATEGORY' | 'PRODUCT'
  discountCategoryId: string | null
  discountProductId: string | null
}) {
  const secondary = coupon.discountScope === 'CATEGORY' && coupon.discountCategoryId
    ? await db.select({ productId: productCategories.productId }).from(productCategories).where(and(
      eq(productCategories.categoryId, coupon.discountCategoryId as typeof productCategories.$inferSelect.categoryId),
      inArray(productCategories.productId, items.map(item => item.productId)),
    )) : []
  const secondaryIds = new Set(secondary.map(row => row.productId))
  const eligible = items.filter(item => item.available && (
    coupon.discountScope === 'ALL_PRODUCTS' ||
    (coupon.discountScope === 'PRODUCT' && item.productId === coupon.discountProductId) ||
    (coupon.discountScope === 'CATEGORY' && (item.categoryId === coupon.discountCategoryId || secondaryIds.has(item.productId)))
  ))
  const eligibleSubtotal = eligible.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  assertMoneyAmounts(eligibleSubtotal)
  if (!Number.isInteger(coupon.discountPercentage) || coupon.discountPercentage < 1 || coupon.discountPercentage > 99) {
    throw Err.validation('درصد تخفیف کوپن معتبر نیست.')
  }
  // Cumulative rounding preserves the existing whole-cart rounded percentage,
  // while every persisted line adds up exactly to the order discount.
  let cumulative = 0
  let discount = 0
  for (const item of eligible) {
    cumulative += item.unitPrice * item.quantity
    const rounded = Math.round(cumulative * coupon.discountPercentage / 100)
    item.couponDiscountAmount = rounded - discount
    discount = rounded
  }
  return { eligibleSubtotal, discount, hasEligibleProduct: eligible.length > 0 }
}

export function priceCheckoutTotals(input: {
  foodTotal: number; couponEligibleSubtotal: number; discount: number; balance: number;
  useWallet: boolean; deliveryFee: number; packagingTotal: number; deliveryType: CheckoutInput['deliveryType'];
}): OrderBreakdown {
  const { foodTotal, couponEligibleSubtotal, discount, deliveryFee } = input
  const payableFood = foodTotal - discount
  const walletDeduction = input.useWallet ? Math.min(Math.max(0, input.balance), payableFood) : 0
  const packagingFee = input.deliveryType === 'DINE_IN' ? 0 : input.packagingTotal
  const totalAmount = payableFood + deliveryFee + packagingFee
  const amountPaidOnline = totalAmount - walletDeduction
  assertMoneyAmounts(foodTotal, couponEligibleSubtotal, discount, payableFood, walletDeduction, deliveryFee, packagingFee, totalAmount, amountPaidOnline)
  return { foodTotal, couponEligibleSubtotal, discount, walletDeduction, deliveryFee, packagingFee, totalAmount, amountPaidOnline }
}

export function couponRejectionMessage(reason: string): string {
  if (reason === 'per_user_exhausted') return 'سهم شما از این کد تخفیف به پایان رسیده است — این کد برای هر کاربر سقف مصرف دارد.'
  if (reason === 'first_purchase_reserved') return 'تخفیف اولین خرید برای سفارش در انتظار پرداخت شما رزرو شده است؛ ابتدا وضعیت پرداخت آن سفارش را مشخص کنید.'
  if (reason === 'not_eligible') return 'شرایط استفاده از این کد تخفیف برای شما برقرار نیست.'
  if (reason === 'exhausted') return 'ظرفیت این کد تخفیف تکمیل شده است.'
  return 'کد تخفیف نامعتبر است یا برای شما فعال نیست.'
}
