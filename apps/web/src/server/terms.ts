// src/server/terms.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { TermsContentDto } from '@sinshin/shared'

// ─── عمومی ───
export async function getTerms(): Promise<TermsContentDto> {
  return getJson<TermsContentDto>('/terms')
}

// ─── ادمین — هر ذخیره نسخه جدید ───
export async function updateTerms(input: {
  sections: { title: string; items: string[] }[]
}): Promise<{ success: boolean; version: number }> {
  return authJson<{ success: boolean; version: number }>('/admin/terms', 'POST', input)
}


export type { TermsSection } from '@sinshin/shared'