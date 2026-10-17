// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/packaging.service.ts (فایل جدید)
// اقلام بسته‌بندی با قیمتِ سراسری — CRUD ادمین + خواندنِ فرم محصول.
//
// الگوها:
//  · کشِ ۳۰ثانیه‌ایِ لیست = همان SettingsService (مصرف کم، چند رپلیکا
//    حداکثر ۳۰s کهنگی — قابل قبول برای لیستِ مدیریتی)؛ write-through.
//  · قیمت‌ها integer امن (مثل delivery_zones.fee) — مسیر پول در
//    order.service از loadPricingBases (join روی junction) می‌خواند؛
//    این سرویس فقط مدیریتِ لیست است.
//  · ممیزی: روت برای ادمین اصلی audit.log می‌زند؛ admin2 در
//    activities خودش (الگوی admin-menu).
// ═══════════════════════════════════════════════════════════════

//src/domain/menu/packaging.service.ts
import { and, asc, eq, notInArray } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { packagingItems, productPackagingItems } from '#/infra/db/schema'
import type { ProductId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import type { PackagingItemDto } from '@sinshin/shared'

/** TTL کش لیست — آینه‌ی SettingsService */
const LIST_CACHE_TTL_MS = 30_000

export class PackagingService {
  constructor(private readonly deps: { db: Db }) {}

  private cache: { at: number; items: PackagingItemDto[] } | null = null

  private invalidate(): void {
    this.cache = null
  }

  /** لیست کامل برای پنل ادمین (شامل غیرفعال‌ها) */
  async adminList(): Promise<PackagingItemDto[]> {
    if (this.cache && Date.now() - this.cache.at < LIST_CACHE_TTL_MS) {
      return this.cache.items
    }
    const rows = await this.deps.db
      .select()
      .from(packagingItems)
      .orderBy(asc(packagingItems.sortOrder), asc(packagingItems.createdAt))
    const items = rows.map((r) => this.toDto(r))
    this.cache = { at: Date.now(), items }
    return items
  }

  /** اقلامِ فعال فقط — مصرفِ فرمِ محصول (چیپ‌های انتخاب) */
  async activeList(): Promise<PackagingItemDto[]> {
    return (await this.adminList()).filter((i) => i.isActive)
  }

  async add(input: {
    title: string
    price: number
    titleAr?: string | null
    sortOrder?: number
  }): Promise<PackagingItemDto> {
    const title = input.title.trim().slice(0, 60)
    if (!title) throw Err.validation('عنوان قلم بسته‌بندی را وارد کنید.')
    if (!Number.isSafeInteger(input.price) || input.price < 0 || input.price > 100_000_000) {
      throw Err.validation('قیمت قلم بسته‌بندی نامعتبر است (۰ تا ۱۰۰ میلیون تومان).')
    }
    const [row] = await this.deps.db
      .insert(packagingItems)
      .values({
        title,
        titleAr: input.titleAr?.trim().slice(0, 60) || null,
        price: input.price,
        sortOrder: Number.isSafeInteger(input.sortOrder) ? (input.sortOrder as number) : 0,
      })
      .returning()
    if (!row) throw Err.internal('ذخیره‌ی قلم بسته‌بندی ناموفق بود.')
    this.invalidate()
    return this.toDto(row)
  }

  async update(
    id: string,
    patch: {
      title?: string
      price?: number
      titleAr?: string | null
      isActive?: boolean
      sortOrder?: number
    },
  ): Promise<PackagingItemDto> {
    const values: Partial<typeof packagingItems.$inferInsert> = { updatedAt: new Date() }
    if (patch.title !== undefined) {
      const title = patch.title.trim().slice(0, 60)
      if (!title) throw Err.validation('عنوان قلم بسته‌بندی نمی‌تواند خالی باشد.')
      values.title = title
    }
    if (patch.price !== undefined) {
      if (!Number.isSafeInteger(patch.price) || patch.price < 0 || patch.price > 100_000_000) {
        throw Err.validation('قیمت قلم بسته‌بندی نامعتبر است (۰ تا ۱۰۰ میلیون تومان).')
      }
      values.price = patch.price
    }
    if (patch.titleAr !== undefined) {
      values.titleAr = patch.titleAr?.trim().slice(0, 60) || null
    }
    if (patch.isActive !== undefined) values.isActive = patch.isActive
    if (patch.sortOrder !== undefined && Number.isSafeInteger(patch.sortOrder)) {
      values.sortOrder = patch.sortOrder
    }
    const [row] = await this.deps.db
      .update(packagingItems)
      .set(values)
      .where(eq(packagingItems.id, id))
      .returning()
    if (!row) throw Err.notFound('قلم بسته‌بندی پیدا نشد.')
    this.invalidate()
    return this.toDto(row)
  }

  async remove(id: string): Promise<void> {
    const [row] = await this.deps.db
      .delete(packagingItems)
      .where(eq(packagingItems.id, id))
      .returning()
    if (!row) throw Err.notFound('قلم بسته‌بندی پیدا نشد.')
    this.invalidate()
  }

  /**
   * سینکِ انتخاب‌های یک محصول (الگوی extraCats/productCategories در
   * menu.service): حذفِ خارج از لیست + درجِ جدید — همه در حداقل کوئری.
   */
  async syncProductItems(productId: ProductId, itemIds: string[]): Promise<void> {
    const clean = [...new Set(itemIds)].slice(0, 12)
    if (clean.length > 0) {
      await this.deps.db
        .delete(productPackagingItems)
        .where(
          and(
            eq(productPackagingItems.productId, productId),
            notInArray(productPackagingItems.packagingItemId, clean),
          ),
        )
      await this.deps.db
        .insert(productPackagingItems)
        .values(clean.map((itemId) => ({ productId, packagingItemId: itemId })))
        .onConflictDoNothing()
    } else {
      await this.deps.db
        .delete(productPackagingItems)
        .where(eq(productPackagingItems.productId, productId))
    }
  }

  /** انتخاب‌های فعلی یک محصول — برای جزئیات ادمین */
  async productItemIds(productId: ProductId): Promise<string[]> {
    const rows = await this.deps.db
      .select({ packagingItemId: productPackagingItems.packagingItemId })
      .from(productPackagingItems)
      .where(eq(productPackagingItems.productId, productId))
    return rows.map((r) => r.packagingItemId)
  }

  private toDto(r: typeof packagingItems.$inferSelect): PackagingItemDto {
    return {
      id: r.id,
      title: r.title,
      titleAr: r.titleAr,
      price: r.price,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
    }
  }
}
