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
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/about', 'PATCH', input)
}