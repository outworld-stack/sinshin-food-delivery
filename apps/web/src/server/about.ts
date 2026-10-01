// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 47 از 49
// مسیر مقصد: apps/web/src/server/about.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/server/about.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { AboutContentDto } from '@sinshin/shared'

// ─── عمومی ───
export async function getAboutContent(): Promise<AboutContentDto> {
  return getJson<AboutContentDto>('/about')
}

// ─── ادمین ───
export async function updateAboutContent(input: {
  heroTitle: string
  heroText: string
  heroGradient: string
  teamTitle: string
  teamGradient: string
  teamAlt: string
  /** round-34 — محتوای عربی ('' → null = حذف ترجمه = fallback فارسی) */
  heroTitleAr: string
  heroTextAr: string
  teamTitleAr: string
  teamAltAr: string
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/about', 'PATCH', {
    ...input,
    heroTitleAr: input.heroTitleAr.trim() || null,
    heroTextAr: input.heroTextAr.trim() || null,
    teamTitleAr: input.teamTitleAr.trim() || null,
    teamAltAr: input.teamAltAr.trim() || null,
  })
}