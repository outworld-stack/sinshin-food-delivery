// src/types/site/gallery.ts
export type GallerySpan = 'wide' | 'normal'

export interface GalleryImage {
  id: string
  /** فعلاً موک: کلاس گرادیانت — فاز بک‌اند: آدرس فایل آپلودی */
  src: string
  alt: string
  span: GallerySpan
  sortOrder: number
  isActive: boolean
}

// ورودی‌های ادمین — جدا از مدل تا قرارداد API شفاف بماند
export interface AddGalleryImageInput {
  src: string
  alt: string
  span: GallerySpan
}

export interface UpdateGalleryImageInput {
  id: string
  src?: string
  alt?: string
  span?: GallerySpan
  isActive?: boolean
}

export interface ReorderGalleryImageInput {
  id: string
  direction: 'up' | 'down'
}