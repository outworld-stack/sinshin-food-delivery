// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 11 از 49
// مسیر مقصد: apps/api/src/domain/gallery/gallery.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

import { asc, eq, sql } from 'drizzle-orm'
import type { Db } from '#/infra/db/client'
import { galleryImages } from '#/infra/db/schema'
import { asGalleryImageId } from '#/domain/shared/brand'
import { nullIfEmpty, pickAr, type Lang } from '#/domain/shared/lang'

export class GalleryService {
  constructor(private readonly deps: { db: Db }) { }

  /** round-34 — alt در نمای عمومی COALESCE(altAr, alt)؛ فیلدهای ar نگه داشته می‌شوند */
  async listPublic(lang: Lang = 'fa') {
    const rows = await this.deps.db
      .select().from(galleryImages)
      .where(eq(galleryImages.isActive, true))
      .orderBy(asc(galleryImages.sortOrder))
    return rows.map((g) => ({ ...g, alt: pickAr(lang, g.altAr, g.alt) }))
  }

  async listAdmin() {
    return this.deps.db.select().from(galleryImages).orderBy(asc(galleryImages.sortOrder))
  }

  async add(input: {
    src: string
    alt: string
    span: 'wide' | 'normal'
    /** round-34 — متن جایگزین عربی (خالی = NULL = پشتیبان فارسی) */
    altAr?: string | null
  }): Promise<{ success: boolean }> {
    const max = await this.deps.db
      .select({ max: sql<number>`coalesce(max(${galleryImages.sortOrder}), 0)::int` })
      .from(galleryImages)
      .then((r) => r[0]?.max ?? 0)
    await this.deps.db.insert(galleryImages).values({
      src: input.src, alt: input.alt, altAr: nullIfEmpty(input.altAr), span: input.span, sortOrder: max + 1,
    })
    return { success: true }
  }

  async update(
    id: string,
    patch: {
      src?: string
      alt?: string
      span?: 'wide' | 'normal'
      isActive?: boolean
      /** round-34 — متن جایگزین عربی (خالی = NULL = پشتیبان فارسی) */
      altAr?: string | null
    },
  ): Promise<void> {
    // round-34 — altAr فقط وقتی فرستاده شده دست می‌خورد (PATCH سمانتیک)؛
    // ذخیره‌ی دستی پرچم «خودکار» را برمی‌گرداند
    const set: Record<string, unknown> = { ...patch }
    if (patch.altAr !== undefined) {
      set.altAr = nullIfEmpty(patch.altAr)
      set.arAuto = false
    }
    await this.deps.db.update(galleryImages).set(set).where(eq(galleryImages.id, asGalleryImageId(id)))
  }

  async remove(id: string): Promise<void> {
    await this.deps.db.delete(galleryImages).where(eq(galleryImages.id, asGalleryImageId(id)))
  }

  async reorder(id: string, direction: 'up' | 'down'): Promise<void> {
    const sorted = await this.listAdmin()
    const idx = sorted.findIndex((g) => g.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]!
    const b = sorted[swapIdx]!
    await this.deps.db.transaction(async (tx) => {
      await tx.update(galleryImages).set({ sortOrder: b.sortOrder }).where(eq(galleryImages.id, a.id))
      await tx.update(galleryImages).set({ sortOrder: a.sortOrder }).where(eq(galleryImages.id, b.id))
    })
  }
}