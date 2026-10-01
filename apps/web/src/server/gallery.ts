// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 46 از 49
// مسیر مقصد: apps/web/src/server/gallery.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/server/gallery.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { GalleryImageDto } from '@sinshin/shared'

// ─── عمومی ───
export async function getGalleryImages(): Promise<GalleryImageDto[]> {
  return getJson<GalleryImageDto[]>('/gallery')
}

// ─── ادمین ───
export async function getAdminGalleryImages(): Promise<GalleryImageDto[]> {
  return authJson<GalleryImageDto[]>('/admin/gallery', 'GET')
}

export async function addGalleryImage(input: {
  src: string
  alt: string
  /** round-34 — متن جایگزین عربی ('' → null = fallback فارسی) */
  altAr?: string | null
  span: 'wide' | 'normal'
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/gallery', 'POST', {
    ...input,
    altAr: input.altAr?.trim() || null,
  })
}

export async function updateGalleryImage(input: {
  id: string
  src?: string
  alt?: string
  /** round-34 — متن جایگزین عربی (undefined = دست‌نخورده؛ '' = حذف ترجمه) */
  altAr?: string | null
  span?: 'wide' | 'normal'
  isActive?: boolean
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/gallery/${input.id}`, 'PATCH', {
    ...input,
    ...(input.altAr !== undefined ? { altAr: (input.altAr ?? '').trim() || null } : {}),
  })
}

export async function deleteGalleryImage(id: string): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/gallery/${id}`, 'DELETE')
}

export async function reorderGalleryImage(input: {
  id: string
  direction: 'up' | 'down'
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/gallery/${input.id}/reorder`, 'POST', input)
}