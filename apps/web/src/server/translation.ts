// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 24 از 31
// مسیر مقصد: apps/web/src/server/translation.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/server/translation.ts — تماماً API
// round-35 — صف ترجمه‌ی خودکار (مترجم آفلاین NLLB)؛
// همه‌ی اندپوینت‌ها گارد requireAdmin2 پایه دارند (ترجمه فقط ستون ar را می‌نویسد).
import type {
	TranslationEntityType,
	TranslationJobDto,
	TranslationPreviewResult,
	TranslationStatusDto,
} from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

/**
 * پیشنهاد ماشینی برای پر کردن فرم — بدون نوشتن DB.
 * markdown-safe است؛ خروجی را ادمین بازبینی و خودش ذخیره می‌کند (→ دستی).
 */
export async function translatePreview(texts: string[]): Promise<string[]> {
	const res = await authJson<TranslationPreviewResult>(
		'/admin/translate/preview',
		'POST',
		{ texts },
	)
	return res.translations
}

/** وضعیت صف + شمار رکوردهای فاقد ترجمه + سلامت مترجم */
export async function getTranslationStatus(): Promise<TranslationStatusDto> {
	return authJson<TranslationStatusDto>('/admin/translate/status', 'GET')
}

/** آخرین jobهای صف — جدیدترین اول */
export async function getTranslationJobs(
	limit = 15,
): Promise<{ jobs: TranslationJobDto[] }> {
	return authJson<{ jobs: TranslationJobDto[] }>(
		`/admin/translate/jobs?limit=${limit}`,
		'GET',
	)
}

/**
 * صف‌کردن همه‌ی رکوردهای ناقص (همه‌ی انواع یا یک نوع خاص).
 * بدون entityType → بدنه‌ی {} = همه‌ی انواع؛ سرور dedupe می‌کند.
 */
export async function enqueueBulkTranslation(
	entityType?: TranslationEntityType,
): Promise<{ queued: number }> {
	return authJson<{ queued: number }>(
		'/admin/translate/bulk',
		'POST',
		entityType === undefined ? {} : { entityType },
	)
}
