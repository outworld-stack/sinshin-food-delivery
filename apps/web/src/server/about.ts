// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 47 از 49
// مسیر مقصد: apps/web/src/server/about.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

import type { AboutContentDto } from '@sinshin/shared'
// src/server/about.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { AboutContentInput } from '#/types/site/about'

// ─── عمومی ───
export async function getAboutContent(): Promise<AboutContentDto> {
	return getJson<AboutContentDto>('/about')
}

/** The editor must read original Persian fields regardless of the site language. */
export async function getAdminAboutContent(): Promise<AboutContentDto> {
	return authJson<AboutContentDto>('/admin/about', 'GET')
}

// ─── ادمین ───
export async function updateAboutContent(
	input: AboutContentInput,
): Promise<{ success: boolean }> {
	return authJson<{ success: boolean }>('/admin/about', 'PATCH', {
		...input,
		heroTitleAr: input.heroTitleAr.trim() || null,
		heroTextAr: input.heroTextAr.trim() || null,
		teamTitleAr: input.teamTitleAr.trim() || null,
		teamAltAr: input.teamAltAr.trim() || null,
	})
}
