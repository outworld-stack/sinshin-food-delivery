// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 9 از 49
// مسیر مقصد: apps/api/src/domain/cart/cart.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

//src/domain/cart/cart.service.ts
import type { Db } from '#/infra/db/client'
import { asProductId } from '#/domain/shared/brand'
import { finalPriceOf, loadPricingBases } from '#/domain/menu/menu.service'
import { pickAr, type Lang } from '#/domain/shared/lang'

export interface CartItemInput {
  productId: string
  sizeId?: string | null
  quantity: number
}

export interface CartItemDto {
  id: string
  sizeId: string | null
  sizeName: string | null
  name: string
  profileImage: string | null
  originalPrice: number
  finalPrice: number
  quantity: number
  lineTotal: number
}

/**
 * قیمت‌گذاری سبد — سروری، عین قرارداد getCartDetails فرانت:
 *  - نامعتبرها skip می‌شوند (نه خطا)
 *  - originalPrice و finalPrice هر دو «قیمت مؤثر» — مطابق موک فرانت
 *
 * round-28 — batch: قبلاً به‌ازای هر آیتم ۳ کوئری متوالی زده می‌شد
 * (effectivePrice + واکشی دوباره‌ی همان محصول) — سبد ۶ آیتمی یعنی ~۱۸
 * رفت‌وبرگشت DB در یک درخواستِ عمومی. حالا کل سبد = ۲ کوئری، از همان
 * loadPricingBases ای که checkout هم می‌خواند (DRY — menu.service).
 */
export class CartService {
  constructor(private readonly deps: { db: Db }) {}

  /** round-34 — lang: نام محصول/سایز در سبد هم COALESCE(ar, fa) می‌شود */
  async details(
    items: CartItemInput[],
    lang: Lang = 'fa',
  ): Promise<{ items: CartItemDto[]; total: number }> {
    const { productMap, sizesByProduct } = await loadPricingBases(this.deps.db, items)

    const out: CartItemDto[] = []
    let total = 0

    for (const item of items) {
      const product = productMap.get(asProductId(item.productId))
      if (!product) continue // نامعتبر → skip (قرارداد فرانت)

      // سیاستِ آسان‌گیرِ سبد (عین effectivePrice سابق): سایزِ انتخابی یا
      // اولین سایز — چک‌اوت سخت‌گیر است و سایزِ حذف‌شده را خطا می‌دهد
      let price = finalPriceOf(product)
      let sizeName: string | null = null
      if (product.sizesEnabled) {
        const sizes = sizesByProduct.get(product.id) ?? []
        if (sizes.length > 0) {
          const size =
            (item.sizeId ? sizes.find((s) => s.id === item.sizeId) : undefined) ?? sizes[0]!
          price = size.price
          sizeName = pickAr(lang, size.nameAr, size.name)
        }
      }

      const lineTotal = price * item.quantity
      total += lineTotal
      out.push({
        id: product.id,
        sizeId: item.sizeId ?? null,
        sizeName,
        name: pickAr(lang, product.nameAr, product.name),
        profileImage: product.profileImage,
        originalPrice: price,
        finalPrice: price,
        quantity: item.quantity,
        lineTotal,
      })
    }

    return { items: out, total }
  }
}
