// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 43 از 49
// مسیر مقصد: apps/web/src/types/site/gallery.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/site/gallery.ts
// رارد ۴۶ — GallerySpan و GalleryImage از قرارداد مشترک (@sinshin/shared)
// می‌آیند (قبلاً کپی موازی بودند)؛ ورودی‌های فرم ادمین این‌جا می‌مانند.
import type { GalleryImageDto, GallerySpan } from '@sinshin/shared'

export type { GallerySpan }

/** همان GalleryImageDto قرارداد — نام قدیمی فرانت حفظ شد */
export type GalleryImage = GalleryImageDto

// ورودی‌های ادمین — جدا از مدل تا قرارداد API شفاف بماند
export interface AddGalleryImageInput {
  src: string
  alt: string
  /** round-34 — متن جایگزین عربی */
  altAr?: string | null
  span: GallerySpan
}

export interface UpdateGalleryImageInput {
  id: string
  src?: string
  alt?: string
  /** round-34 — متن جایگزین عربی (undefined = دست‌نخورده؛ '' = حذف ترجمه) */
  altAr?: string | null
  span?: GallerySpan
  isActive?: boolean
}

export interface ReorderGalleryImageInput {
  id: string
  direction: 'up' | 'down'
}