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
	itemId?: string
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

const validItemId = (value: unknown): value is string => typeof value === 'string'
	&& value.length > 0 && value.length <= 180 && /^[a-zA-Z0-9:_-]+$/.test(value)
const canonicalValue = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalValue)
	: isRecord(value) ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonicalValue(value[key])])) : value

/** Apply existing content limits without counting the newly added identity/recovery bookkeeping. */
export function articleBlocksContentForLimit(input: unknown): unknown {
	if (!isRecord(input)) return input
	const out = { ...input }
	if (Array.isArray(input.blocks)) out.blocks = input.blocks.map(raw => {
		if (!isRecord(raw) || !isRecord(raw.props)) return raw
		const props = { ...raw.props }
		if (raw.type === 'list') delete props.itemIds
		if (raw.type === 'gallery' && Array.isArray(props.images)) props.images = props.images.map(image => {
			if (!isRecord(image)) return image
			const value = { ...image }; delete value.id; return value
		})
		return { ...raw, props }
	})
	if (isRecord(input.translation)) {
		const translation = { ...input.translation }
		delete translation.orphanedFields
		delete translation.retiredItemIds
		if (Array.isArray(translation.fields)) translation.fields = translation.fields.map(field => {
			if (!isRecord(field)) return field
			const value = { ...field }; delete value.itemId; return value
		})
		out.translation = translation
	}
	return out
}

/** Positional legacy IDs bind only an unchanged persisted snapshot, never a mutated collection. */
export function getArticleBlockItemId(block: ArticleBlock, path: ArticleBlockTextPath): string | undefined {
	if (!isRecord(block) || !isRecord(block.props)) return undefined
	const index = path[1]
	if (typeof index !== 'number') return undefined
	if (block.type === 'list' && Array.isArray(block.props.items) && path[0] === 'items' && index < block.props.items.length)
		return validItemId(block.props.itemIds?.[index]) ? block.props.itemIds[index] : `legacy:${block.id}:items:${index}`
	if (block.type === 'gallery' && Array.isArray(block.props.images) && path[0] === 'images' && index < block.props.images.length)
		return validItemId(block.props.images[index]?.id) ? block.props.images[index]?.id : `legacy:${block.id}:images:${index}`
	return undefined
}

export function articleBlockTextPathForIdentity(block: ArticleBlock | undefined, path: ArticleBlockTextPath, itemId?: string): ArticleBlockTextPath | undefined {
	if (!block) return undefined
	if (!itemId) return getArticleBlockTextFields(block).some(field => JSON.stringify(field.path) === JSON.stringify(path)) ? path : undefined
	return getArticleBlockTextFields(block).find(field => field.itemId === itemId)?.path
}

/** Initialize editor identities once. IDs subsequently travel with rows through edits and moves. */
export function bindArticleBlockItemIdentities(source: ArticleBlocksDoc): ArticleBlocksDoc {
	const out = structuredClone(source)
	let changed = false
	const seen = new Set<string>()
	const bind = (id: string | undefined) => {
		const value = id && !seen.has(id) ? id : crypto.randomUUID()
		seen.add(value)
		return value
	}
	for (const block of out.blocks) {
		if (block.type === 'list') {
			const ids = block.props.items.map((_, index) => bind(getArticleBlockItemId(block, ['items', index])))
			if (JSON.stringify(block.props.itemIds) !== JSON.stringify(ids)) changed = true
			block.props.itemIds = ids
		}
		if (block.type === 'gallery') block.props.images = block.props.images.map((image, index) => {
			const id = bind(getArticleBlockItemId(block, ['images', index, 'alt']))
			if (image.id !== id) changed = true
			return { ...image, id }
		})
	}
	return changed ? out : source
}

/** A changed legacy array must supply identities; neither text nor its new index proves ownership. */
export function validateArticleBlockItemIdentities(previous: ArticleBlocksDoc | null | undefined, input: unknown, translation?: unknown): boolean {
	if (!isRecord(input) || !Array.isArray(input.blocks)) return true // Normalizer validates the document shape.
	const old = new Map((previous?.blocks ?? []).filter(Boolean).map(block => [block.id, block]))
	const owners = new Map<string, string>()
	for (const block of old.values()) for (const field of getArticleBlockTextFields(block)) if (field.itemId) owners.set(field.itemId, block.id)
	const seen = new Set<string>()
	const retired = new Set(isRecord(translation) && isRecord(translation.translation) && Array.isArray(translation.translation.retiredItemIds)
		? translation.translation.retiredItemIds.filter(validItemId) : [])
	for (const raw of input.blocks) {
		if (!isRecord(raw) || !isRecord(raw.props) || typeof raw.id !== 'string') continue
		if (raw.type !== 'list' && raw.type !== 'gallery') continue
		const before = old.get(raw.id)
		const values = raw.type === 'list' ? raw.props.items : raw.props.images
		if (!Array.isArray(values)) continue
		const ids = raw.type === 'list' ? raw.props.itemIds : values.map(image => isRecord(image) ? image.id : undefined)
		const complete = Array.isArray(ids) && ids.length === values.length && ids.every(validItemId)
		if (!complete) {
			const oldValues = before?.type === raw.type ? raw.type === 'list' && before.type === 'list' ? before.props.items : before.type === 'gallery' ? before.props.images : undefined : undefined
			if (before && JSON.stringify(canonicalValue(oldValues)) !== JSON.stringify(canonicalValue(values))) return false
			// Newly created blocks and unchanged legacy snapshots can bind fresh IDs in normalization.
			continue
		}
		for (const id of ids) {
			if (!validItemId(id) || seen.has(id) || retired.has(id) || owners.has(id) && owners.get(id) !== raw.id) return false
			if (id.startsWith('legacy:') && owners.get(id) !== raw.id && before) return false
			seen.add(id)
		}
	}
	return true
}

function matchingText(block: ArticleBlock | undefined, field: ArticleBlockTextField): string {
	const path = articleBlockTextPathForIdentity(block, field.path, field.itemId)
	return path ? readArticleBlockText(block, path) : ''
}

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
		const translated = translationsById(translation).get(block.id) as unknown as ArticleBlock | undefined
		const itemId = validItemId(raw.itemId) ? raw.itemId : translated ? getArticleBlockItemId(translated, raw.fieldPath) : undefined
		const path = articleBlockTextPathForIdentity(block, raw.fieldPath, itemId)
		if (!path) continue
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
				...(itemId ? { itemId } : {}),
				sourceText: raw.sourceText,
				status: raw.status as ArticleBlockTranslationStatus,
				...(['manual', 'automatic', 'legacy'].includes(String(raw.origin)) ? { origin: raw.origin as 'manual' | 'automatic' | 'legacy' } : {}),
				...(typeof raw.staleValue === 'string' && raw.staleValue.length <= 30000 ? { staleValue: raw.staleValue } : {}),
				...(Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0 ? { revision: Number(raw.revision) } : {}),
				...(typeof raw.error === 'string' && raw.error.length <= 500 ? { error: raw.error } : {}),
			})
	}
	return result
}

function attachStates(
	doc: ArticleBlocksDoc,
	states: Map<string, ArticleBlockTranslationState>,
	orphanedFields: ArticleBlockTranslationState[] = doc.translation?.orphanedFields ?? [],
	retiredItemIds: string[] = doc.translation?.retiredItemIds ?? [],
): void {
	delete doc.translation
	if (states.size || orphanedFields.length || retiredItemIds.length) doc.translation = { fields: [...states.values()],
		...(orphanedFields.length ? { orphanedFields: orphanedFields.slice(-1000) } : {}),
		...(retiredItemIds.length ? { retiredItemIds: [...new Set(retiredItemIds)] } : {}) }
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
	const fields: ArticleBlockTextField[] = keys.map((key) => ({
		path: [key] as ArticleBlockTextPath,
		text: readArticleBlockText(block, [key]),
		label: labels[key] ?? key,
		maxLength: maxLength(block.type, key),
	}))
	if (block.type === 'list' && Array.isArray(block.props.items)) {
		block.props.items.forEach((_, index) => {
			fields.push({
				path: ['items', index],
				itemId: getArticleBlockItemId(block, ['items', index]),
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
					itemId: getArticleBlockItemId(block, ['images', index, 'alt']),
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
					? matchingText(translated as unknown as ArticleBlock, field)
					: ''
			const state = states.get(fieldKey(block.id, block.type, field.path))
			if (state) {
				if (
					state.sourceText !== field.text ||
					state.status === 'needs-retranslation'
				) {
					if (value.trim() && state.staleValue === undefined) state.staleValue = value
					value = ''
					state.status = 'needs-retranslation'
				} else state.status = value.trim() ? 'translated' : 'missing'
			}
			if (value.trim())
				writeText(block, field.path, value.slice(0, field.maxLength))
			else if (!fallback) writeText(block, field.path, '')
		}
	}
	if (!fallback) {
		const orphaned = isRecord(translation) && isRecord(translation.translation) && Array.isArray(translation.translation.orphanedFields)
			? translation.translation.orphanedFields.filter((field): field is ArticleBlockTranslationState => isRecord(field)
				&& typeof field.blockId === 'string' && typeof field.sourceText === 'string' && Array.isArray(field.fieldPath)
				&& typeof field.staleValue === 'string' && field.staleValue.length <= 30000) : []
		for (const rawBlock of byId.values()) {
			const oldBlock = rawBlock as unknown as ArticleBlock
			const currentBlock = source.blocks.find(block => block?.id === oldBlock.id && block.type === oldBlock.type)
			for (const field of getArticleBlockTextFields(oldBlock)) {
				if (!field.itemId || currentBlock && articleBlockTextPathForIdentity(currentBlock, field.path, field.itemId)) continue
				const rawProof = isRecord(translation) && isRecord(translation.translation) && Array.isArray(translation.translation.fields)
					? translation.translation.fields.find(proof => isRecord(proof) && proof.blockId === oldBlock.id && JSON.stringify(proof.fieldPath) === JSON.stringify(field.path)) : undefined
				const value = field.text.trim() ? field.text : isRecord(rawProof) && typeof rawProof.staleValue === 'string' ? rawProof.staleValue : ''
				if (value.trim()) orphaned.push({ blockId: oldBlock.id, blockType: oldBlock.type, fieldPath: [...field.path], itemId: field.itemId,
					sourceText: isRecord(rawProof) && typeof rawProof.sourceText === 'string' ? rawProof.sourceText : '',
					origin: isRecord(rawProof) && rawProof.origin === 'automatic' ? 'automatic' : 'legacy', status: 'needs-retranslation', staleValue: value })
			}
		}
		const retired = isRecord(translation) && isRecord(translation.translation) && Array.isArray(translation.translation.retiredItemIds)
			? translation.translation.retiredItemIds.filter(validItemId) : []
		attachStates(out, states, orphaned, retired)
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
	const states = fieldStates(out, out)
	const incomingStates = fieldStates(out, incoming)
	for (const block of out.blocks) {
		const suggestion = byId.get(block?.id)
		if (suggestion?.type !== block?.type) continue
		for (const field of getArticleBlockTextFields(block)) {
			if (field.text.trim()) continue
			const key = fieldKey(block.id, block.type, field.path)
			const saved = states.get(key)
			if (saved?.origin === 'manual' || saved?.origin === 'legacy') continue
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
			const value = matchingText(suggestion as unknown as ArticleBlock, field)
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
	itemId?: string
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
			const former = fields.find(item => field.itemId ? item.itemId === field.itemId : JSON.stringify(item.path) === JSON.stringify(field.path))
			if (!former || former.text !== field.text)
				changes.push({
					blockId: block.id,
					blockType: block.type,
					fieldPath: field.path,
					...(field.itemId ? { itemId: field.itemId } : {}),
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
	origin: 'manual' | 'automatic' = 'manual',
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
			...(field.itemId ? { itemId: field.itemId } : {}),
			sourceText: field.text,
			origin,
			revision: (states.get(key)?.revision ?? 0) + 1,
			...(states.get(key)?.staleValue !== undefined ? { staleValue: states.get(key)?.staleValue } : {}),
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
	origin: 'manual' | 'automatic' = 'manual',
): ArticleBlocksDoc | null {
	return setArticleBlockTranslations(source, translation, [
		{ blockId, path, text },
	], origin)
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
			matchingText(translated as unknown as ArticleBlock, { path, itemId: getArticleBlockItemId(block, path), text: '', label: '', maxLength: 30000 }).trim()
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
	if (!validateArticleBlockItemIdentities(previous, next, current))
		throw new Error('Changed block collections require stable item identities. Reload the content before saving.')
	if (incoming === null) return null
	const changes = getChangedArticleBlockTextFields(previous, next)
	const nextIds = new Set((next?.blocks ?? []).filter(Boolean).flatMap(block => getArticleBlockTextFields(block).flatMap(field => field.itemId ? [field.itemId] : [])))
	const newlyRetired = (previous?.blocks ?? []).filter(Boolean).flatMap(block => getArticleBlockTextFields(block).flatMap(field => field.itemId && !nextIds.has(field.itemId) ? [field.itemId] : []))
	if (current == null && incoming === undefined && changes.length === 0 && newlyRetired.length === 0)
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
	const savedTranslations = translationsById(current)
	const previousBlocks = new Map((previous?.blocks ?? []).filter(Boolean).map((block) => [block.id, block]))
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
			const saved = states.get(key)
			const priorBlock = previousBlocks.get(block.id)
			const previousBlock = priorBlock?.type === block.type ? priorBlock : undefined
			const priorTranslation = savedTranslations.get(block.id)
			const priorValue = priorTranslation?.type === block.type ? matchingText(priorTranslation as unknown as ArticleBlock, field) : ''
			const validProof =
				proof &&
				proof.sourceText === field.text &&
				proof.status !== 'needs-retranslation' &&
				(proof.origin !== 'automatic' ||
					(saved?.origin !== 'manual' && saved?.origin !== 'legacy' &&
						(saved?.origin === 'automatic' || !priorValue.trim()) &&
						(!priorValue.trim() || change || saved?.status === 'needs-retranslation'))) &&
				(saved?.revision === undefined ||
					proof.revision === saved.revision + 1 + (change && previousBlock ? 1 : 0))
			const value =
				candidate?.type === block.type
					? matchingText(candidate as unknown as ArticleBlock, field)
					: ''
			if (change) {
				writeText(target, field.path, '')
				states.set(key, {
					...saved,
					blockId: block.id,
					blockType: block.type,
					fieldPath: [...field.path],
					...(field.itemId ? { itemId: field.itemId } : {}),
					sourceText: change.previousText ?? field.text,
					origin: saved?.origin ?? (priorValue.trim() ? 'legacy' : 'automatic'),
					revision: (saved?.revision ?? 0) + 1,
					...(priorValue.trim() ? { staleValue: priorValue } : {}),
					status:
						change.previousText === undefined
							? 'missing'
							: 'needs-retranslation',
				})
				const invalidatedState = states.get(key)
				if (invalidatedState) delete invalidatedState.error
				if (validProof && (value.trim() || proof.origin === 'manual' && proof.status === 'missing')) {
					writeText(target, field.path, value.slice(0, field.maxLength))
					states.set(key, { ...proof, status: value.trim() ? 'translated' : 'missing' })
				}
				continue
			}
			// Absent fields in a partial/outdated document are not an instruction to erase saved Arabic.
			if (
				candidate?.type !== block.type ||
				!hasTextField(candidate, articleBlockTextPathForIdentity(candidate as unknown as ArticleBlock, field.path, field.itemId) ?? [])
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
	attachStates(out, states, out.translation?.orphanedFields, [...(out.translation?.retiredItemIds ?? []), ...newlyRetired])
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
