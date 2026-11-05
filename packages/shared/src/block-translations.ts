import type { ArticleBlock, ArticleBlocksDoc, ArticleBlockType } from './blocks'

export type ArticleBlockTextPath = (string | number)[]
export interface ArticleBlockTextField {
	path: ArticleBlockTextPath
	text: string
	label: string
	maxLength: number
}

/** Only these properties are translatable. Structure always comes from blocks. */
export const ARTICLE_BLOCK_TEXT_KEYS: Record<
	ArticleBlockType,
	readonly string[]
> = {
	hero: ['title', 'text'],
	heading: ['text'],
	paragraph: ['text'],
	image: ['alt', 'caption'],
	gallery: [],
	quote: ['text', 'author'],
	callout: ['title', 'text'],
	list: [],
	cta: ['title', 'text', 'label'],
	link: ['title', 'text', 'label'],
	location: ['title', 'address'],
	divider: [],
}

const labels: Record<string, string> = {
	title: 'عنوان',
	text: 'متن',
	alt: 'متن جایگزین تصویر',
	caption: 'زیرنویس تصویر',
	author: 'نویسنده',
	label: 'متن دکمه',
	address: 'آدرس',
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

export function readArticleBlockText(
	block: unknown,
	path: ArticleBlockTextPath,
): string {
	let value: unknown = isRecord(block) ? block.props : undefined
	for (const key of path) {
		if (!isRecord(value) && !Array.isArray(value)) return ''
		value = (value as Record<string | number, unknown>)[key]
	}
	return typeof value === 'string' ? value : ''
}

function maxLength(type: ArticleBlockType, key: string): number {
	if (key === 'alt') return 200
	if (key === 'author') return 120
	if (key === 'label') return 60
	if (key === 'address') return 300
	if (key === 'caption') return 160
	if (key === 'title') return type === 'hero' ? 200 : 160
	if (type === 'heading') return 200
	if (type === 'hero' || type === 'cta' || type === 'link') return 500
	if (type === 'quote' || type === 'callout') return 1000
	return 5000
}

/** Includes empty optional fields so admins can supply captions and addresses. */
export function getArticleBlockTextFields(
	block: ArticleBlock,
): ArticleBlockTextField[] {
	if (!isRecord(block) || !isRecord(block.props)) return []
	const fields = (ARTICLE_BLOCK_TEXT_KEYS[block.type] ?? []).map((key) => ({
		path: [key] as ArticleBlockTextPath,
		text: readArticleBlockText(block, [key]),
		label: labels[key] ?? key,
		maxLength: maxLength(block.type, key),
	}))
	if (block.type === 'list' && Array.isArray(block.props.items)) {
		block.props.items.forEach((_, index) => {
			fields.push({
				path: ['items', index],
				text: readArticleBlockText(block, ['items', index]),
				label: `مورد ${index + 1}`,
				maxLength: 300,
			})
		})
	}
	if (block.type === 'gallery' && Array.isArray(block.props.images)) {
		block.props.images.forEach((im, index) => {
			if (isRecord(im))
				fields.push({
					path: ['images', index, 'alt'],
					text: readArticleBlockText(block, ['images', index, 'alt']),
					label: `متن جایگزین تصویر ${index + 1}`,
					maxLength: 200,
				})
		})
	}
	return fields
}

function writeText(
	block: ArticleBlock,
	path: ArticleBlockTextPath,
	text: string,
): void {
	let parent = block.props as unknown as Record<string | number, unknown>
	for (const key of path.slice(0, -1))
		parent = parent[key] as Record<string | number, unknown>
	const key = path[path.length - 1]
	if (key !== undefined) parent[key] = text
}

export function setArticleBlockText(
	doc: ArticleBlocksDoc,
	blockId: string,
	path: ArticleBlockTextPath,
	text: string,
): ArticleBlocksDoc {
	return setArticleBlockTexts(doc, [{ blockId, path, text }])
}

export interface ArticleBlockTextUpdate {
	blockId: string
	path: ArticleBlockTextPath
	text: string
}

/** Apply a full translation batch with one clone, even for long list-heavy articles. */
export function setArticleBlockTexts(
	doc: ArticleBlocksDoc,
	updates: ArticleBlockTextUpdate[],
): ArticleBlocksDoc {
	const out = structuredClone(doc)
	const blocks = new Map(
		out.blocks.filter(Boolean).map((block) => [block.id, block]),
	)
	const fields = new Map<string, Map<string, ArticleBlockTextField>>()
	for (const update of updates) {
		const block = blocks.get(update.blockId)
		if (!block) continue
		let allowed = fields.get(block.id)
		if (!allowed) {
			allowed = new Map(
				getArticleBlockTextFields(block).map((field) => [
					JSON.stringify(field.path),
					field,
				]),
			)
			fields.set(block.id, allowed)
		}
		const field = allowed.get(JSON.stringify(update.path))
		if (field)
			writeText(block, field.path, update.text.slice(0, field.maxLength))
	}
	return out
}

function translationsById(
	translation: unknown,
): Map<string, Record<string, unknown>> {
	const result = new Map<string, Record<string, unknown>>()
	if (
		!isRecord(translation) ||
		translation.version !== 1 ||
		!Array.isArray(translation.blocks)
	)
		return result
	for (const block of translation.blocks) {
		if (
			isRecord(block) &&
			typeof block.id === 'string' &&
			!result.has(block.id)
		)
			result.set(block.id, block)
	}
	return result
}

function rebase(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
	fallback: boolean,
): ArticleBlocksDoc | null {
	if (!source || source.version !== 1 || !Array.isArray(source.blocks))
		return null
	const out = structuredClone(source)
	const byId = translationsById(translation)
	for (const block of out.blocks) {
		const translated = byId.get(block?.id)
		for (const field of getArticleBlockTextFields(block)) {
			const value =
				translated?.type === block.type
					? readArticleBlockText(translated, field.path)
					: ''
			if (value.trim())
				writeText(block, field.path, value.slice(0, field.maxLength))
			else if (!fallback) writeText(block, field.path, '')
		}
	}
	return out
}

/** Source structure with only translated text; empty strings mark untranslated fields. */
export function normalizeArticleBlocksTranslation(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
): ArticleBlocksDoc | null {
	return rebase(source, translation, false)
}

/** Public document: each missing Arabic field falls back independently to Persian. */
export function mergeArticleBlocksTranslation(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
): ArticleBlocksDoc | null {
	return rebase(source, translation, true)
}

/** Fill suggestions without replacing manual text, including edits made during a request. */
export function fillMissingArticleBlocksTranslation(
	source: ArticleBlocksDoc | null | undefined,
	current: unknown,
	incoming: unknown,
): ArticleBlocksDoc | null {
	const out = normalizeArticleBlocksTranslation(source, current)
	if (!out) return null
	const byId = translationsById(incoming)
	for (const block of out.blocks) {
		const suggestion = byId.get(block?.id)
		if (suggestion?.type !== block?.type) continue
		for (const field of getArticleBlockTextFields(block)) {
			if (field.text.trim()) continue
			const value = readArticleBlockText(suggestion, field.path)
			if (value.trim())
				writeText(block, field.path, value.slice(0, field.maxLength))
		}
	}
	return out
}
