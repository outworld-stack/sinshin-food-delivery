//src/domain/cart/cart.service.ts
import { eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { products } from '#/infra/db/schema'
import { asProductId } from '#/domain/shared/brand'
import type { MenuService } from '#/domain/menu/menu.service'

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
 */
export class CartService {
  constructor(private readonly deps: { db: Db; menu: MenuService }) {}

  async details(items: CartItemInput[]): Promise<{ items: CartItemDto[]; total: number }> {
    const out: CartItemDto[] = []
    let total = 0

    for (const item of items) {
      const eff = await this.deps.menu.effectivePrice(item.productId, item.sizeId ?? null)
      if (!eff) continue // نامعتبر → skip (قرارداد فرانت)

      const product = await this.deps.db.query.products.findFirst({
        where: eq(products.id, asProductId(item.productId)),
      })
      if (!product) continue

      const lineTotal = eff.price * item.quantity
      total += lineTotal
      out.push({
        id: product.id,
        sizeId: item.sizeId ?? null,
        sizeName: eff.sizeName,
        name: product.name,
        profileImage: product.profileImage,
        originalPrice: eff.price,
        finalPrice: eff.price,
        quantity: item.quantity,
        lineTotal,
      })
    }

    return { items: out, total }
  }
}