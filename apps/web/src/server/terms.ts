// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 48 از 49
// مسیر مقصد: apps/web/src/server/terms.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

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
  /** round-34 — بندهای عربی (ساختار موازی sections؛ خالی = بازگشت به فارسی) */
  sectionsAr?: { title: string; items: string[] }[] | null
}): Promise<{ success: boolean; version: number }> {
  return authJson<{ success: boolean; version: number }>('/admin/terms', 'POST', {
    sections: input.sections,
    sectionsAr:
      input.sectionsAr && input.sectionsAr.length > 0
        ? input.sectionsAr.map((s) => ({
            title: s.title.trim(),
            items: s.items.map((i) => i.trim()).filter(Boolean),
          }))
        : null,
  })
}


export type { TermsSection } from '@sinshin/shared'