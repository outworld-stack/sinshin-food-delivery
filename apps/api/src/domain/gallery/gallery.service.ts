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
import { assertContentSourceRevision, contentSourceRevision, localizeContentRecord, reconcileContentTranslation, type TranslationEdit } from '@sinshin/shared'
import { Err } from '#/domain/shared/errors'

export class GalleryService {
  constructor(private readonly deps: { db: Db }) { }

  /** round-34 — alt در نمای عمومی COALESCE(altAr, alt)؛ فیلدهای ar نگه داشته می‌شوند */
  async listPublic(lang: Lang = 'fa') {
    const rows = await this.deps.db
      .select().from(galleryImages)
      .where(eq(galleryImages.isActive, true))
      .orderBy(asc(galleryImages.sortOrder))
    return rows.map((row) => {
      const { translationState: _state, ...g } = lang === 'ar' ? localizeContentRecord('gallery', row) : row
      return { ...g, alt: pickAr(lang, g.altAr, g.alt) }
    })
  }

  async listAdmin() {
    const rows = await this.deps.db.select().from(galleryImages).orderBy(asc(galleryImages.sortOrder))
    return rows.map(row => ({ ...row, sourceRevision: contentSourceRevision('gallery', row) }))
  }

  async add(input: {
    src: string
    alt: string
    span: 'wide' | 'normal'
    /** round-34 — متن جایگزین عربی (خالی = NULL = پشتیبان فارسی) */
    altAr?: string | null
    translationEdits?: TranslationEdit[]
  }): Promise<{ success: boolean }> {
    const max = await this.deps.db
      .select({ max: sql<number>`coalesce(max(${galleryImages.sortOrder}), 0)::int` })
      .from(galleryImages)
      .then((r) => r[0]?.max ?? 0)
    const id = asGalleryImageId(crypto.randomUUID())
    const next = reconcileContentTranslation('gallery', id, null, {
      id, src: input.src, alt: input.alt, altAr: nullIfEmpty(input.altAr), span: input.span, sortOrder: max + 1,
    }, input.translationEdits)
    await this.deps.db.insert(galleryImages).values(next)
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
      translationEdits?: TranslationEdit[]
      sourceRevision: string
    },
  ): Promise<void> {
    // round-34 — altAr فقط وقتی فرستاده شده دست می‌خورد (PATCH سمانتیک)؛
    // ذخیره‌ی دستی پرچم «خودکار» را برمی‌گرداند
    await this.deps.db.transaction(async (tx) => {
      const [current] = await tx.select().from(galleryImages)
        .where(eq(galleryImages.id, asGalleryImageId(id))).for('update')
      if (!current) throw Err.notFound('تصویر پیدا نشد.')
      if (!assertContentSourceRevision('gallery', current, patch.sourceRevision)) throw Err.validation('متن تصویر تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
      const { translationEdits, sourceRevision: _sourceRevision, ...changes } = patch
      const next = reconcileContentTranslation('gallery', id, current, {
        ...current, ...changes,
        altAr: patch.altAr === undefined ? current.altAr : nullIfEmpty(patch.altAr),
      }, translationEdits)
      await tx.update(galleryImages).set({
        src: next.src, alt: next.alt, altAr: next.altAr, span: next.span, isActive: next.isActive,
        translationState: next.translationState,
        arAuto: next.translationState.fields.some((field) => field.origin === 'automatic' && field.status === 'translated'),
      }).where(eq(galleryImages.id, current.id))
    })
  }

  async remove(id: string): Promise<void> {
    await this.deps.db.delete(galleryImages).where(eq(galleryImages.id, asGalleryImageId(id)))
  }

  async reorder(id: string, direction: 'up' | 'down', sourceRevisions: Record<string, string>): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      const sorted = await tx.select().from(galleryImages).orderBy(asc(galleryImages.sortOrder), asc(galleryImages.id)).for('update')
      const idx = sorted.findIndex(row => row.id === id)
      const a = sorted[idx]
      if (!a) throw Err.notFound('تصویر پیدا نشد.')
      if (!assertContentSourceRevision('gallery', a, sourceRevisions?.[a.id])) throw Err.validation('گالری تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      const b = sorted[swapIdx]
      if (!b) {
        const next = reconcileContentTranslation('gallery', a.id, a, a)
        await tx.update(galleryImages).set({ translationState: next.translationState }).where(eq(galleryImages.id, a.id))
        return
      }
      if (!assertContentSourceRevision('gallery', b, sourceRevisions?.[b.id])) throw Err.validation('تصویر مجاور تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
      const nextA = reconcileContentTranslation('gallery', a.id, a, a)
      const nextB = reconcileContentTranslation('gallery', b.id, b, b)
      await tx.update(galleryImages).set({ sortOrder: b.sortOrder, translationState: nextA.translationState }).where(eq(galleryImages.id, a.id))
      await tx.update(galleryImages).set({ sortOrder: a.sortOrder, translationState: nextB.translationState }).where(eq(galleryImages.id, b.id))
    })
  }
}
