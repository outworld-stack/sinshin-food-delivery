// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 43 از 49
// مسیر مقصد: apps/web/src/types/site/gallery.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/site/gallery.ts
export type GallerySpan = 'wide' | 'normal'

export interface GalleryImage {
  id: string
  /** فعلاً موک: کلاس گرادیانت — فاز بک‌اند: آدرس فایل آپلودی */
  src: string
  alt: string
  /** round-34 — متن جایگزین عربی (NULL/خالی = fallback فارسی) */
  altAr?: string | null
  /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ */
  arAuto?: boolean
  span: GallerySpan
  sortOrder: number
  isActive: boolean
}

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