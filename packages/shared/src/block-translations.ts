import type {
	ArticleBlock,
	ArticleBlocksDoc,
	ArticleBlockType,
	ArticleBlockTranslationState,
	ArticleBlockTranslationStatus,
} from './blocks'

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

const fieldKey = (
	blockId: string,
	blockType: string,
	path: ArticleBlockTextPath,
): string => JSON.stringify([blockId, blockType, path])

/** Closed path whitelist, including numeric list/gallery slots; never accepts structural keys. */
export function isArticleBlockTextPath(
	type: ArticleBlockType,
	path: unknown,
): path is ArticleBlockTextPath {
	if (!Array.isArray(path) || !Object.hasOwn(ARTICLE_BLOCK_TEXT_KEYS, type))
		return false
	if (path.length === 1)
		return (
			typeof path[0] === 'string' &&
			(ARTICLE_BLOCK_TEXT_KEYS[type] ?? []).includes(path[0])
		)
	if (type === 'list')
		return (
			path.length === 2 &&
			path[0] === 'items' &&
			Number.isInteger(path[1]) &&
			path[1] >= 0 &&
			path[1] < 30
		)
	return (
		type === 'gallery' &&
		path.length === 3 &&
		path[0] === 'images' &&
		Number.isInteger(path[1]) &&
		path[1] >= 0 &&
		path[1] < 12 &&
		path[2] === 'alt'
	)
}

function fieldStates(
	source: ArticleBlocksDoc,
	translation: unknown,
): Map<string, ArticleBlockTranslationState> {
	const result = new Map<string, ArticleBlockTranslationState>()
	if (
		!isRecord(translation) ||
		!isRecord(translation.translation) ||
		!Array.isArray(translation.translation.fields)
	)
		return result
	const blocks = new Map(
		source.blocks.filter(Boolean).map((block) => [block.id, block]),
	)
	for (const raw of translation.translation.fields.slice(0, 6000)) {
		if (
			!isRecord(raw) ||
			typeof raw.blockId !== 'string' ||
			typeof raw.sourceText !== 'string' ||
			raw.sourceText.length > 30000
		)
			continue
		const block = blocks.get(raw.blockId)
		if (
			!block ||
			raw.blockType !== block.type ||
			!isArticleBlockTextPath(block.type, raw.fieldPath)
		)
			continue
		if (
			!['translated', 'missing', 'needs-retranslation'].includes(
				String(raw.status),
			)
		)
			continue
		const path = raw.fieldPath
		if (
			!getArticleBlockTextFields(block).some(
				(field) => JSON.stringify(field.path) === JSON.stringify(path),
			)
		)
			continue
		const key = fieldKey(block.id, block.type, path)
		if (!result.has(key))
			result.set(key, {
				blockId: block.id,
				blockType: block.type,
				fieldPath: [...path],
				sourceText: raw.sourceText,
				status: raw.status as ArticleBlockTranslationStatus,
			})
	}
	return result
}

function attachStates(
	doc: ArticleBlocksDoc,
	states: Map<string, ArticleBlockTranslationState>,
): void {
	delete doc.translation
	if (states.size) doc.translation = { fields: [...states.values()] }
}

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
	const keys = Object.hasOwn(ARTICLE_BLOCK_TEXT_KEYS, block.type)
		? ARTICLE_BLOCK_TEXT_KEYS[block.type]
		: []
	const fields = keys.map((key) => ({
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
	delete out.translation
	const byId = translationsById(translation)
	const states = fieldStates(source, translation)
	for (const block of out.blocks) {
		const translated = byId.get(block?.id)
		for (const field of getArticleBlockTextFields(block)) {
			let value =
				translated?.type === block.type
					? readArticleBlockText(translated, field.path)
					: ''
			const state = states.get(fieldKey(block.id, block.type, field.path))
			if (state) {
				if (
					state.sourceText !== field.text ||
					state.status === 'needs-retranslation'
				) {
					value = ''
					state.status = 'needs-retranslation'
				} else state.status = value.trim() ? 'translated' : 'missing'
			}
			if (value.trim())
				writeText(block, field.path, value.slice(0, field.maxLength))
			else if (!fallback) writeText(block, field.path, '')
		}
	}
	if (!fallback) attachStates(out, states)
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
	const states = fieldStates(out, out)
	const incomingStates = fieldStates(out, incoming)
	for (const block of out.blocks) {
		const suggestion = byId.get(block?.id)
		if (suggestion?.type !== block?.type) continue
		for (const field of getArticleBlockTextFields(block)) {
			if (field.text.trim()) continue
			const key = fieldKey(block.id, block.type, field.path)
			const proof = incomingStates.get(key)
			const sourceBlock = source?.blocks.find(
				(item) => item?.id === block.id && item.type === block.type,
			)
			const sourceText = readArticleBlockText(sourceBlock, field.path)
			if (
				proof &&
				(proof.sourceText !== sourceText ||
					proof.status === 'needs-retranslation')
			)
				continue
			if (states.has(key) && !proof) continue
			const value = readArticleBlockText(suggestion, field.path)
			if (value.trim()) {
				writeText(block, field.path, value.slice(0, field.maxLength))
				if (proof) states.set(key, { ...proof, status: 'translated' })
			}
		}
	}
	attachStates(out, states)
	return out
}

export interface ArticleBlockSourceChange {
	blockId: string
	blockType: ArticleBlockType
	fieldPath: ArticleBlockTextPath
	previousText?: string
	text: string
}

/** Compare exact text by identity and field path, independently of every structural property. */
export function getChangedArticleBlockTextFields(
	previous: ArticleBlocksDoc | null | undefined,
	next: ArticleBlocksDoc | null | undefined,
): ArticleBlockSourceChange[] {
	if (!next || !Array.isArray(next.blocks)) return []
	const old = new Map(
		(previous?.blocks ?? []).filter(Boolean).map((block) => [block.id, block]),
	)
	const changes: ArticleBlockSourceChange[] = []
	for (const block of next.blocks.filter(Boolean)) {
		const before = old.get(block.id)
		const fields =
			before?.type === block.type ? getArticleBlockTextFields(before) : []
		for (const field of getArticleBlockTextFields(block)) {
			const former = fields.find(
				(item) => JSON.stringify(item.path) === JSON.stringify(field.path),
			)
			if (!former || former.text !== field.text)
				changes.push({
					blockId: block.id,
					blockType: block.type,
					fieldPath: field.path,
					previousText: former?.text,
					text: field.text,
				})
		}
	}
	return changes
}

/** Bind manually edited or translated values to exactly the Persian text they were reviewed against. */
export function setArticleBlockTranslations(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
	updates: ArticleBlockTextUpdate[],
): ArticleBlocksDoc | null {
	const out = normalizeArticleBlocksTranslation(source, translation)
	if (!out || !source) return out
	const states = fieldStates(source, out)
	const blocks = new Map(
		source.blocks.filter(Boolean).map((block) => [block.id, block]),
	)
	for (const update of updates) {
		const block = blocks.get(update.blockId)
		if (!block) continue
		const field = getArticleBlockTextFields(block).find(
			(item) => JSON.stringify(item.path) === JSON.stringify(update.path),
		)
		const target = out.blocks.find(
			(item) => item?.id === block.id && item.type === block.type,
		)
		if (!field || !target) continue
		writeText(target, field.path, update.text.slice(0, field.maxLength))
		const key = fieldKey(block.id, block.type, field.path)
		states.set(key, {
			blockId: block.id,
			blockType: block.type,
			fieldPath: [...field.path],
			sourceText: field.text,
			status: update.text.trim()
				? 'translated'
				: states.get(key)?.status === 'needs-retranslation'
					? 'needs-retranslation'
					: 'missing',
		})
	}
	attachStates(out, states)
	return out
}

export function setArticleBlockTranslation(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
	blockId: string,
	path: ArticleBlockTextPath,
	text: string,
): ArticleBlocksDoc | null {
	return setArticleBlockTranslations(source, translation, [
		{ blockId, path, text },
	])
}

/** Build once for editor render/bulk actions, instead of rescanning all proof for each field. */
export function createArticleBlockTranslationStatusReader(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
): (
	blockId: string,
	path: ArticleBlockTextPath,
) => ArticleBlockTranslationStatus {
	const blocks = new Map(
		(source?.blocks ?? []).filter(Boolean).map((block) => [block.id, block]),
	)
	const fields = new Map<string, string>()
	for (const block of blocks.values())
		for (const field of getArticleBlockTextFields(block)) {
			fields.set(fieldKey(block.id, block.type, field.path), field.text)
		}
	const states = source
		? fieldStates(source, translation)
		: new Map<string, ArticleBlockTranslationState>()
	const translations = translationsById(translation)
	return (blockId, path) => {
		const block = blocks.get(blockId)
		if (!block) return 'missing'
		const key = fieldKey(block.id, block.type, path)
		const text = fields.get(key)
		if (text === undefined) return 'missing'
		const state = states.get(key)
		if (
			state &&
			(state.status === 'needs-retranslation' || state.sourceText !== text)
		) {
			return 'needs-retranslation'
		}
		const translated = translations.get(block.id)
		return translated?.type === block.type &&
			readArticleBlockText(translated, path).trim()
			? 'translated'
			: 'missing'
	}
}

export function getArticleBlockTranslationStatus(
	source: ArticleBlocksDoc | null | undefined,
	translation: unknown,
	blockId: string,
	path: ArticleBlockTextPath,
): ArticleBlockTranslationStatus {
	return createArticleBlockTranslationStatusReader(source, translation)(
		blockId,
		path,
	)
}

/** Reconcile both editor drafts and server saves. Unproved stale submissions cannot replace current reviewed text. */
export function reconcileArticleBlocksTranslation(
	previous: ArticleBlocksDoc | null | undefined,
	next: ArticleBlocksDoc | null | undefined,
	current: unknown,
	incoming?: unknown,
): ArticleBlocksDoc | null {
	if (incoming === null) return null
	const changes = getChangedArticleBlockTextFields(previous, next)
	if (current == null && incoming === undefined && changes.length === 0)
		return null
	const out = normalizeArticleBlocksTranslation(next, current)
	if (!out || !next) return out
	const changed = new Map(
		changes.map((change) => [
			fieldKey(change.blockId, change.blockType, change.fieldPath),
			change,
		]),
	)
	const states = fieldStates(next, out)
	const candidates = translationsById(incoming)
	const proofs = fieldStates(next, incoming)
	for (const block of next.blocks.filter(Boolean)) {
		const target = out.blocks.find(
			(item) => item?.id === block.id && item.type === block.type,
		)
		const candidate = candidates.get(block.id)
		if (!target) continue
		for (const field of getArticleBlockTextFields(block)) {
			const key = fieldKey(block.id, block.type, field.path)
			const change = changed.get(key)
			const proof = proofs.get(key)
			const validProof =
				proof &&
				proof.sourceText === field.text &&
				proof.status !== 'needs-retranslation'
			const value =
				candidate?.type === block.type
					? readArticleBlockText(candidate, field.path)
					: ''
			if (change) {
				writeText(target, field.path, '')
				states.set(key, {
					blockId: block.id,
					blockType: block.type,
					fieldPath: [...field.path],
					sourceText: change.previousText ?? field.text,
					status:
						change.previousText === undefined
							? 'missing'
							: 'needs-retranslation',
				})
				if (validProof && value.trim()) {
					writeText(target, field.path, value.slice(0, field.maxLength))
					states.set(key, { ...proof, status: 'translated' })
				}
				continue
			}
			// Absent fields in a partial/outdated document are not an instruction to erase saved Arabic.
			if (
				candidate?.type !== block.type ||
				!hasTextField(candidate, field.path)
			)
				continue
			if (proof && !validProof) continue
			// Older reviewed documents have no proof yet. Preserve their populated fields
			// until an explicit edit supplies current-source proof through the Arabic editor.
			if (
				!proof &&
				(states.has(key) || readArticleBlockText(target, field.path).trim())
			)
				continue
			writeText(target, field.path, value.slice(0, field.maxLength))
			if (validProof)
				states.set(key, {
					...proof,
					status: value.trim()
						? 'translated'
						: states.get(key)?.status === 'needs-retranslation'
							? 'needs-retranslation'
							: 'missing',
				})
			else if (states.has(key) && !value.trim()) {
				const state = states.get(key)
				if (state)
					state.status =
						state.status === 'needs-retranslation' ? state.status : 'missing'
			}
		}
	}
	attachStates(out, states)
	return out
}

function hasTextField(block: unknown, path: ArticleBlockTextPath): boolean {
	let value: unknown = isRecord(block) ? block.props : undefined
	for (const key of path) {
		if (
			(!isRecord(value) && !Array.isArray(value)) ||
			!Object.hasOwn(value, key)
		)
			return false
		value = (value as Record<string | number, unknown>)[key]
	}
	return typeof value === 'string'
}
