// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 42 از 49
// مسیر مقصد: apps/web/src/types/site/about.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/site/about.ts
// فیلدهای قابل ویرایش صفحه درباره ما
import type { AboutLocationDto, ArticleBlocksDoc } from '@sinshin/shared'

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
	blocks?: ArticleBlocksDoc | null
	blocksAr?: ArticleBlocksDoc | null
	location?: AboutLocationDto | null
}

export interface AboutContent extends AboutContentInput {
	/** Configured restaurant destination shown when no custom location is saved. */
	defaultLocation?: AboutLocationDto | null
	/** پرچم «ترجمه‌ی خودکار» — رارد ۳۵ */
	arAuto?: boolean
	updatedAt: Date
}
