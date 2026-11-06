// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 48 از 49
// مسیر مقصد: apps/web/src/server/terms.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/server/terms.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { TermsContentDto, TranslationEdit } from '@sinshin/shared'

// ─── عمومی ───
export async function getTerms(): Promise<TermsContentDto> {
  return getJson<TermsContentDto>('/terms')
}

export async function getAdminTerms(): Promise<TermsContentDto> {
  return authJson<TermsContentDto>('/admin/terms', 'GET')
}

// ─── ادمین — هر ذخیره نسخه جدید ───
export async function updateTerms(input: {
  sourceRevision?: string
  translationEdits?: TranslationEdit[]
  sections: { title: string; items: string[] }[]
  /** round-34 — بندهای عربی (ساختار موازی sections؛ خالی = بازگشت به فارسی) */
  sectionsAr?: { title: string; items: string[] }[] | null
}): Promise<{ success: boolean; version: number }> {
  return authJson<{ success: boolean; version: number }>('/admin/terms', 'POST', {
    sourceRevision: input.sourceRevision,
    translationEdits: input.translationEdits,
    sections: input.sections,
    sectionsAr:
      input.sectionsAr && input.sectionsAr.length > 0
        ? input.sectionsAr.map((s) => ({
            title: s.title.trim(),
            items: s.items.map((i) => i.trim()),
          }))
        : null,
  })
}


export type { TermsSection } from '@sinshin/shared'
