// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/cart/cart.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: آیتم ناموجود (is_available=false یا INACTIVE) دیگر حذفِ
//        بی‌صدا نمی‌شود — با available=false و lineTotal=0 برمی‌گردد تا
//        فرانت هشدار نارنجی + قفل پرداخت نشان دهد. حالت‌های مؤثر
//        سفارش (پیک/بیرون‌بر/سرو در محل = دسته AND محصول) هم روی هر
//        آیتم می‌آید تا سبد/چک‌اوت محدودیت ارسال را زنده نشان دهند.
// ═══════════════════════════════════════════════════════════════

//src/domain/cart/cart.service.ts
import type { Db } from '#/infra/db/client'
import { asProductId, asSizeId, type ProductId } from '#/domain/shared/brand'
import {
  finalPriceOf,
  loadCategoryModes,
  loadPricingBases,
  sizeFinalPriceOf,
} from '#/domain/menu/menu.service'
import { pickAr, type Lang } from '#/domain/shared/lang'
import type { CartDetails, CartItemInput } from '@sinshin/shared'

// رارد ۴۷ — تایپ‌های سبد از قرارداد مشترک می‌آیند (کپی‌های محلی حذف شدند):
// ورودی شکل خام سیم است (بدون برند) و خروجی در مرز ساخت، برند می‌گیرد.

/**
 * قیمت‌گذاری سبد — سروری، عین قرارداد getCartDetails فرانت:
 *  - نامعتبرها (محصول حذف‌شده از DB) نادیده گرفته می‌شوند (نه خطا)
 *  - stage-48: محصولِ ناموجود (is_available=false / status≠ACTIVE) با
 *    available=false برمی‌گردد — قیمت نمایشی حفظ، جمعیت حساب نمی‌شود.
 *  - originalPrice و finalPrice هر دو «قیمت مؤثر» — مطابق موک فرانت
 *
 * round-28 — دسته‌ای: قبلاً به‌ازای هر آیتم ۳ کوئری متوالی زده می‌شد
 * (effectivePrice + واکشی دوباره‌ی همان محصول) — سبد ۶ آیتمی یعنی ~۱۸
 * رفت‌وبرگشت DB در یک درخواستِ عمومی. حالا کل سبد = ۲ کوئری + ۱ کوئری
 * دسته‌ها (stage-48)، از همان loadPricingBases ای که چک‌اوت هم می‌خواند.
 */
export class CartService {
  constructor(private readonly deps: { db: Db }) {}

  /** round-34 — lang: نام محصول/سایز در سبد هم COALESCE(ar, fa) می‌شود */
  async details(
    items: CartItemInput[],
    lang: Lang = 'fa',
  ): Promise<CartDetails> {
    const { productMap, sizesByProduct } = await loadPricingBases(this.deps.db, items)

    // stage-48 — حالت‌های دسته‌ی همه‌ی محصولات سبد (یک کوئری)
    const categoryIds = [...new Set([...productMap.values()].map((p) => p.categoryId))]
    const catModes = await loadCategoryModes(this.deps.db, categoryIds)

    const out: CartDetails['items'] = []
    let total = 0

    for (const item of items) {
      const product = productMap.get(asProductId(item.productId))
      if (!product) continue // نامعتبر → skip (قرارداد فرانت)

      const modes = catModes.get(product.categoryId)
      const courierAllowed = (modes?.courier ?? true) && product.courierAllowed
      const takeawayAllowed = (modes?.takeaway ?? true) && product.takeawayAllowed
      const dineInAllowed = (modes?.dineIn ?? true) && product.dineInAllowed
      // stage-48 — «فعلاً ناموجود»: فعال در منو ولی فروشش قفل است
      const available = product.status === 'ACTIVE' && product.isAvailable

      // سیاستِ آسان‌گیرِ سبد (عین effectivePrice سابق): سایزِ انتخابی یا
      // اولین سایز — چک‌اوت سخت‌گیر است و سایزِ حذف‌شده را خطا می‌دهد
      //
      // stage-47 — تخفیف زمان‌دار: قیمت واحد حالا «مؤثر» است (محصول یا
      // سایز، هرکدام پنجره‌ی فعال داشته باشند). originalPrice = قیمت خام
      // و finalPrice = قیمت با تخفیف — سطر سبد خط‌خورده را نشان می‌دهد.
      let basePrice: number
      let effectivePrice: number
      let sizeName: string | null = null
      if (product.sizesEnabled) {
        const sizes = sizesByProduct.get(product.id) ?? []
        if (sizes.length > 0) {
          const size =
            (item.sizeId ? sizes.find((s) => s.id === item.sizeId) : undefined) ?? sizes[0]!
          basePrice = size.price
          effectivePrice = sizeFinalPriceOf(size)
          sizeName = pickAr(lang, size.nameAr, size.name)
        } else {
          basePrice = product.originalPrice
          effectivePrice = finalPriceOf(product)
        }
      } else {
        basePrice = product.originalPrice
        effectivePrice = finalPriceOf(product)
      }

      // stage-48 — ناموجود: قیمت برای نمایش می‌ماند ولی در جمع حساب نمی‌شود
      const lineTotal = available ? effectivePrice * item.quantity : 0
      if (available) total += lineTotal
      out.push({
        id: product.id as ProductId,
        sizeId: item.sizeId ? asSizeId(item.sizeId) : null,
        sizeName,
        name: pickAr(lang, product.nameAr, product.name),
        profileImage: product.profileImage,
        originalPrice: basePrice,
        finalPrice: effectivePrice,
        quantity: item.quantity,
        lineTotal,
        available,
        courierAllowed,
        takeawayAllowed,
        dineInAllowed,
      })
    }

    return { items: out, total }
  }
}