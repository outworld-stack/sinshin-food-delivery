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
  span: 'wide' | 'normal'
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/gallery', 'POST', input)
}

export async function updateGalleryImage(input: {
  id: string
  src?: string
  alt?: string
  span?: 'wide' | 'normal'
  isActive?: boolean
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/gallery/${input.id}`, 'PATCH', input)
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