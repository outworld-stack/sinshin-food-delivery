import { asc, eq, sql } from 'drizzle-orm'
import type { Db } from '#/infra/db/client'
import { galleryImages } from '#/infra/db/schema'
import { asGalleryImageId } from '#/domain/shared/brand'

export class GalleryService {
  constructor(private readonly deps: { db: Db }) { }

  async listPublic() {
    return this.deps.db
      .select().from(galleryImages)
      .where(eq(galleryImages.isActive, true))
      .orderBy(asc(galleryImages.sortOrder))
  }

  async listAdmin() {
    return this.deps.db.select().from(galleryImages).orderBy(asc(galleryImages.sortOrder))
  }

  async add(input: { src: string; alt: string; span: 'wide' | 'normal' }): Promise<{ success: boolean }> {
    const max = await this.deps.db
      .select({ max: sql<number>`coalesce(max(${galleryImages.sortOrder}), 0)::int` })
      .from(galleryImages)
      .then((r) => r[0]?.max ?? 0)
    await this.deps.db.insert(galleryImages).values({
      src: input.src, alt: input.alt, span: input.span, sortOrder: max + 1,
    })
    return { success: true }
  }

  async update(id: string, patch: { src?: string; alt?: string; span?: 'wide' | 'normal'; isActive?: boolean }): Promise<void> {
    await this.deps.db.update(galleryImages).set(patch).where(eq(galleryImages.id, asGalleryImageId(id)))
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