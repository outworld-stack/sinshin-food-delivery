// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 42 از 49
// مسیر مقصد: apps/web/src/types/site/about.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/site/about.ts
// فیلدهای قابل ویرایش صفحه درباره ما
export interface AboutContentInput {
  heroTitle: string
  heroText: string
  heroGradient: string
  teamTitle: string
  teamGradient: string
  teamAlt: string
  // ═══ round-34 — محتوای عربی (خالی = حذف ترجمه = بازگشت به فارسی) ═══
  heroTitleAr: string
  heroTextAr: string
  teamTitleAr: string
  teamAltAr: string
}

export interface AboutContent extends AboutContentInput {
  /** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ */
  arAuto?: boolean
  updatedAt: Date
}