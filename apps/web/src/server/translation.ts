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
	ArticleBlocksDoc,
	ArticleBlockType,
	ArticleBlockTextPath,
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

export interface ContentFieldTranslationRequest {
	entityType: TranslationEntityType
	entityId: string
	fieldId: string
	fieldPath: (string | number)[]
	sourceText: string
	revision: number
}

/** The server validates this one saved field before contacting the translator. */
export async function translateContentField(input: ContentFieldTranslationRequest): Promise<ContentFieldTranslationRequest & { value: string }> {
	return authJson('/admin/translate/field', 'POST', {
		entityType: input.entityType,
		entityId: input.entityId,
		fieldId: input.fieldId,
		fieldPath: [...input.fieldPath],
		sourceText: input.sourceText,
		revision: input.revision,
	}, { timeoutMs: 180_000 })
}

/** Separate Arabic block document for admin review; does not save the article. */
export async function translateArticleBlocksPreview(input: {
	blocks: ArticleBlocksDoc
	blocksAr?: ArticleBlocksDoc | null
	blockId?: string
}): Promise<ArticleBlocksDoc> {
	const result = await authJson<{ blocksAr: ArticleBlocksDoc }>(
		'/admin/translate/blocks',
		'POST',
		input,
		{ timeoutMs: 180_000 },
	)
	return result.blocksAr
}

export interface ArticleBlockFieldPreview {
	entityType?: 'article' | 'about'
	entityId?: string
	revision?: number
	blockId: string
	blockType: ArticleBlockType
	fieldPath: ArticleBlockTextPath
	sourceText: string
	translation: string
}

/** One source field only; no Arabic document or unrelated article text is transmitted. */
export async function translateArticleBlockField(input: {
	entityType?: 'article' | 'about'
	entityId?: string
	revision?: number
	blockId: string
	blockType: ArticleBlockType
	fieldPath: ArticleBlockTextPath
	text: string
}): Promise<ArticleBlockFieldPreview> {
	return authJson<ArticleBlockFieldPreview>(
		'/admin/translate/block-field',
		'POST',
		{
			...(input.entityType && input.entityId ? { entityType: input.entityType, entityId: input.entityId, revision: input.revision ?? 0 } : {}),
			blockId: input.blockId,
			blockType: input.blockType,
			fieldPath: [...input.fieldPath],
			text: input.text,
		},
		{ timeoutMs: 180_000 },
	)
}

/** وضعیت صف + شمار رکوردهای فاقد ترجمه + سلامت مترجم */
export async function getTranslationStatus(): Promise<TranslationStatusDto> {
	return authJson<TranslationStatusDto>('/admin/translate/status', 'GET')
}

/** آخرین کارهای صف — جدیدترین اول */
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
 * بدون entityType → بدنه‌ی {} = همه‌ی انواع؛ سرور تکراری‌ها را حذف می‌کند.
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
