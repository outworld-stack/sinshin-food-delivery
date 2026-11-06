import { contentSourceFingerprint } from './content-source-fingerprint'

/** Database content provenance. Static UI dictionaries and block documents stay separate. */
export type ContentEntityType =
	| 'product' | 'productSize' | 'mainCategory' | 'category'
	| 'article' | 'articleCategory' | 'articleSubCategory'
	| 'about' | 'gallery' | 'terms' | 'packagingItem' | 'temporaryClose'
export type ContentTranslationStatus = 'missing' | 'translated' | 'needs-retranslation' | 'needs-review'
export type ContentTranslationOrigin = 'manual' | 'automatic' | 'legacy'
export type ContentFieldPath = (string | number)[]
export interface ContentTranslationFieldState {
	fieldId: string
	fieldPath: ContentFieldPath
	sourceText: string
	origin: ContentTranslationOrigin
	status: ContentTranslationStatus
	revision: number
	staleValue?: string
	staleSourceText?: string
	error?: string
}
export interface ContentTranslationState {
	version: 1
	entityType: ContentEntityType
	entityId: string
	fields: ContentTranslationFieldState[]
	/** Recoverable removed/ambiguous drafts, bounded to 1,000 entries and two million text characters. */
	orphanedFields?: (ContentTranslationFieldState & { value: string })[]
}
export interface TranslationEdit {
	fieldId: string
	fieldPath: ContentFieldPath
	sourceText: string
	value: string
	revision: number
	origin: 'manual' | 'automatic'
}
export interface ContentTranslationField extends ContentTranslationFieldState {
	value: string | null
	maxLength: number
}
interface FieldDefinition { fieldId: string; fieldPath: ContentFieldPath; arabicPath: ContentFieldPath; sourceText: string; maxLength: number }
type Row = Record<string, unknown>
const record = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const samePath = (a: ContentFieldPath, b: ContentFieldPath) => JSON.stringify(a) === JSON.stringify(b)
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const filled = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function at(row: unknown, path: ContentFieldPath): unknown {
	let value = row
	for (const key of path) {
		if ((!record(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) return undefined
		value = (value as Row)[key]
	}
	return value
}
function put(row: Row, path: ContentFieldPath, value: string | null): void {
	let target: Row | unknown[] = row
	for (let index = 0; index < path.length - 1; index++) {
		const key = path[index]
		if (key === undefined) return
		let child = (target as Row)[key]
		if (!record(child) && !Array.isArray(child)) {
			child = typeof path[index + 1] === 'number' ? [] : {}
			;(target as Row)[key] = child
		}
		target = child as Row | unknown[]
	}
	const last = path.at(-1)
	if (last !== undefined) (target as Row)[last] = value
}
function states(row: unknown, type?: ContentEntityType): ContentTranslationFieldState[] {
	const state = record(row) ? row.translationState : undefined
	if (!record(state) || state.version !== 1 || !Array.isArray(state.fields)) return []
	if (type && state.entityType !== type) return []
	if (record(row) && row.id !== undefined && state.entityId !== String(row.id)) return []
	return state.fields.filter((field): field is ContentTranslationFieldState => record(field)
		&& typeof field.fieldId === 'string' && typeof field.sourceText === 'string'
		&& Array.isArray(field.fieldPath) && field.fieldPath.length > 0 && field.fieldPath.length <= 5
		&& field.fieldPath.every(key => typeof key === 'string' || Number.isInteger(key) && Number(key) >= 0)
		&& ['manual', 'automatic', 'legacy'].includes(String(field.origin))
		&& ['missing', 'translated', 'needs-retranslation', 'needs-review'].includes(String(field.status))
		&& Number.isSafeInteger(field.revision) && Number(field.revision) >= 0)
}

/** Match exact unique text before positions; ambiguous duplicates never inherit a different item's Arabic. */
function entries(values: string[], old: ContentTranslationFieldState[], prefix: string): string[] {
	const used = new Set<string>()
	const counts = (texts: string[]) => {
		const map = new Map<string, number>()
		for (const text of texts) map.set(text, (map.get(text) ?? 0) + 1)
		return map
	}
	const previousCounts = counts(old.map(field => field.sourceText))
	const nextCounts = counts(values)
	const ids: (string | undefined)[] = values.map(text => {
		if (previousCounts.get(text) !== 1 || nextCounts.get(text) !== 1) return undefined
		const match = old.find(field => field.sourceText === text)
		if (!match) return undefined
		used.add(match.fieldId)
		return match.fieldId
	})
	// An unchanged duplicate slot is safe only if the complete collection keeps its shape.
	const unchanged = old.length === values.length && old.every((field, index) => field.sourceText === values[index])
	for (let index = 0; index < ids.length; index++) {
		if (ids[index]) continue
		const before = old[index]
		const text = values[index] ?? ''
		const canRetain = before && !used.has(before.fieldId) && (unchanged
			|| old.length === values.length && previousCounts.get(before.sourceText) === 1 && nextCounts.get(text) === 1)
		let id = canRetain ? before.fieldId : `${prefix}:${index}`
		if (!canRetain && (used.has(id) || old.some(field => field.fieldId === id))) id = `${prefix}:${crypto.randomUUID()}`
		used.add(id)
		ids[index] = id
	}
	return ids as string[]
}

function definitions(type: ContentEntityType, input: unknown, previous?: unknown): FieldDefinition[] {
	const row = record(input) ? input : {}
	const old = states(previous ?? input, type)
	const result: FieldDefinition[] = []
	const scalar = (path: ContentFieldPath, arabicPath: ContentFieldPath, maxLength: number) => {
		result.push({ fieldId: path.join('.'), fieldPath: path, arabicPath, sourceText: string(at(row, path)), maxLength })
	}
	const list = (path: ContentFieldPath, arabicPath: ContentFieldPath, prefix: string, maxLength: number) => {
		const values = array(at(row, path)).map(string)
		const before = old.filter(field => field.fieldId.startsWith(`${prefix}:`) && field.fieldPath.length === path.length + 1)
			.sort((a, b) => Number(a.fieldPath.at(-1)) - Number(b.fieldPath.at(-1)))
		const ids = entries(values, before, prefix)
		values.forEach((text, index) => {
			result.push({ fieldId: ids[index] ?? `${prefix}:${index}`, fieldPath: [...path, index], arabicPath: [...arabicPath, index], sourceText: text, maxLength })
		})
	}
	const sections = (key: 'sections' | 'processes') => {
		const sections = array(row[key])
		const oldTitles = old.filter(field => field.fieldId.startsWith(`${key}:`) && field.fieldPath.at(-1) === 'title')
			.sort((a, b) => Number(a.fieldPath[1]) - Number(b.fieldPath[1]))
		const titles = sections.map(section => record(section) ? string(section.title) : '')
		const duplicates = new Set([...titles, ...oldTitles.map(field => field.sourceText)].filter(title =>
			titles.filter(text => text === title).length > 1 || oldTitles.filter(field => field.sourceText === title).length > 1))
		const identity = (title: string, section: unknown) => duplicates.has(title)
			? JSON.stringify([title, array(record(section) ? section.items : undefined).map(string)]) : title
		const previousRow = previous ?? input
		const previousSections = record(previousRow) ? array(previousRow[key]) : []
		const identities = oldTitles.map(field => ({ ...field, sourceText: identity(field.sourceText, previousSections[Number(field.fieldPath[1])]) }))
		const ids = entries(sections.map((section, index) => identity(titles[index] ?? '', section)), identities, key)
		sections.forEach((section, index) => {
			const id = ids[index] ?? `${key}:${index}`
			result.push({ fieldId: id, fieldPath: [key, index, 'title'], arabicPath: [`${key}Ar`, index, 'title'], sourceText: record(section) ? string(section.title) : '', maxLength: key === 'sections' ? 200 : 120 })
			list([key, index, 'items'], [`${key}Ar`, index, 'items'], `${id}:items`, key === 'sections' ? 1000 : 300)
		})
	}
	switch (type) {
		case 'product': scalar(['name'], ['nameAr'], 120); scalar(['description'], ['descriptionAr'], 2000); list(['ingredients'], ['ingredientsAr'], 'ingredients', 60); break
		case 'productSize': case 'mainCategory': case 'articleCategory': case 'articleSubCategory': scalar(['name'], ['nameAr'], 60); break
		case 'category': scalar(['name'], ['nameAr'], 60); list(['sizeNames'], ['sizeNamesAr'], 'sizeNames', 40); break
		case 'article': scalar(['title'], ['titleAr'], 160); scalar(['excerpt'], ['excerptAr'], 1000); scalar(['content'], ['contentAr'], 100000); sections('processes'); break
		case 'about': scalar(['heroTitle'], ['heroTitleAr'], 120); scalar(['heroText'], ['heroTextAr'], 2000); scalar(['teamTitle'], ['teamTitleAr'], 120); scalar(['teamAlt'], ['teamAltAr'], 200); if (record(row.location)) scalar(['location', 'address'], ['location', 'addressAr'], 500); break
		case 'terms': sections('sections'); break
		case 'gallery': scalar(['alt'], ['altAr'], 200); break
		case 'packagingItem': scalar(['title'], ['titleAr'], 60); break
		case 'temporaryClose': scalar(['reason'], ['reasonAr'], 120); break
	}
	return result
}

/** Source-only whitelist generated by explicit entity adapters; never traverses arbitrary client paths. */
export function contentTranslationFields(type: ContentEntityType, row: unknown): ContentTranslationField[] {
	const proof = new Map(states(row, type).map(field => [field.fieldId, field]))
	const hasState = record(row) && row.translationState !== undefined && row.translationState !== null
	return definitions(type, row).map(field => {
		const state = proof.get(field.fieldId)
		const raw = at(row, field.arabicPath)
		const changed = state && (state.sourceText !== field.sourceText || !samePath(state.fieldPath, field.fieldPath))
		const origin = state?.origin ?? (filled(raw) ? 'legacy' : 'automatic')
		const status: ContentTranslationStatus = changed ? origin === 'automatic' ? 'needs-retranslation' : 'needs-review'
			: state?.status ?? (filled(raw) ? hasState ? 'needs-review' : 'translated' : 'missing')
		return { ...field, origin, status, revision: state?.revision ?? 0,
			value: status === 'translated' && filled(raw) ? raw : null,
			...(state?.staleValue !== undefined ? { staleValue: state.staleValue } : changed && filled(raw) ? { staleValue: raw } : {}),
			...(state?.staleSourceText !== undefined ? { staleSourceText: state.staleSourceText } : changed && filled(raw) ? { staleSourceText: state.sourceText } : {}),
			...(state?.error ? { error: state.error } : {}) }
	})
}

/** The result never writes Persian/structural properties. Pass the next complete source row under its DB row lock. */
export function reconcileContentTranslation<T extends object>(
	type: ContentEntityType, entityId: string, previous: T | null | undefined, next: T, edits: TranslationEdit[] = [],
): T & { translationState: ContentTranslationState } {
	const out = structuredClone(next) as Row
	// Legacy arrays gain exact source identities before matching a reordered next document.
	// This binding changes no old columns and conservatively treats populated values as legacy/manual.
	const previousState = new Map(states(previous, type).map(field => [field.fieldId, field]))
	const hasPreviousState = record(previous) && previous.translationState !== undefined && previous.translationState !== null
	const boundPrevious = previous ? {
		...previous,
		translationState: {
			version: 1, entityType: type, entityId: record(previous) && previous.id !== undefined ? String(previous.id) : entityId,
			fields: definitions(type, previous).map(field => previousState.get(field.fieldId) ?? {
				fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText,
				origin: filled(at(previous, field.arabicPath)) ? 'legacy' : 'automatic',
				status: filled(at(previous, field.arabicPath)) ? hasPreviousState ? 'needs-review' : 'translated' : 'missing', revision: 0,
			}),
		},
	} : previous
	const oldDefinitions = definitions(type, boundPrevious)
	const oldState = new Map(states(boundPrevious, type).map(field => [field.fieldId, field]))
	const beforeById = new Map(oldDefinitions.map(field => [field.fieldId, field]))
	const proofById = new Map(edits.map(edit => [edit.fieldId, edit]))
	// Database UUIDs are canonicalized by PostgreSQL; bind to the actual row identity.
	// A valid uppercase URL parameter must not invalidate every unrelated field.
	const state: ContentTranslationState = { version: 1, entityType: type, entityId: out.id !== undefined ? String(out.id) : entityId, fields: [] }
	const nextDefinitions = definitions(type, next, boundPrevious ?? next)
	for (const original of nextDefinitions) {
		let field = original
		const collection = field.fieldPath[0]
		const nestedItems = (collection === 'sections' || collection === 'processes') && field.fieldPath[2] === 'items'
		const parent = nestedItems ? state.fields.find(entry => samePath(entry.fieldPath, [collection, field.fieldPath[1] as number, 'title'])) : undefined
		if (parent) {
			const itemMarker = field.fieldId.lastIndexOf(':items:')
			if (itemMarker >= 0) field = { ...field, fieldId: `${parent.fieldId}${field.fieldId.slice(itemMarker)}` }
		}
		if (field.fieldPath.some(key => typeof key === 'number') && !beforeById.has(field.fieldId)) {
			const proposed = edits.find(edit => samePath(edit.fieldPath, field.fieldPath) && edit.sourceText === field.sourceText && !beforeById.has(edit.fieldId))
			const prefix = collection === 'ingredients' ? 'ingredients:' : collection === 'sizeNames' ? 'sizeNames:'
				: nestedItems ? parent ? `${parent.fieldId}:items:` : null
					: collection === 'sections' ? 'sections:' : collection === 'processes' ? 'processes:' : null
			if (proposed && prefix && proposed.fieldId.startsWith(prefix)
				&& !state.fields.some(entry => entry.fieldId === proposed.fieldId)
				&& !nextDefinitions.some(candidate => candidate !== original && candidate.fieldId === proposed.fieldId)) field = { ...field, fieldId: proposed.fieldId }
		}
		original.fieldId = field.fieldId
		if ((collection === 'sections' || collection === 'processes') && field.fieldPath.at(-1) === 'title') {
			// Reserve every child ID in the resolved namespace before accepting an item proof.
			// Otherwise an early item could claim a later sibling's rebased generated identity.
			for (const candidate of nextDefinitions) {
				if (candidate.fieldPath[0] !== collection || candidate.fieldPath[1] !== field.fieldPath[1] || candidate.fieldPath[2] !== 'items') continue
				const itemMarker = candidate.fieldId.lastIndexOf(':items:')
				if (itemMarker >= 0) candidate.fieldId = `${field.fieldId}${candidate.fieldId.slice(itemMarker)}`
			}
		}
		const before = beforeById.get(field.fieldId)
		const saved = oldState.get(field.fieldId)
		const oldValue = before ? at(previous, before.arabicPath) : undefined
		const submitted = at(next, field.arabicPath)
		const sourceChanged = !!previous && (!before || before.sourceText !== field.sourceText)
		const origin = saved?.origin ?? (filled(oldValue) ? 'legacy' : 'automatic')
		const stale = saved?.sourceText !== undefined && saved.sourceText !== field.sourceText
		let value: string | null = before && !sourceChanged && !stale && filled(oldValue) ? oldValue : null
		let entry: ContentTranslationFieldState = {
			fieldId: field.fieldId, fieldPath: [...field.fieldPath], sourceText: field.sourceText,
			origin, status: sourceChanged && !before ? 'missing' : sourceChanged || stale ? origin === 'automatic' ? 'needs-retranslation' : 'needs-review'
				: saved?.status ?? (value ? 'translated' : 'missing'), revision: (saved?.revision ?? 0) + (sourceChanged && before ? 1 : 0),
			...(saved?.staleValue !== undefined ? { staleValue: saved.staleValue } : {}),
			...(saved?.staleSourceText !== undefined ? { staleSourceText: saved.staleSourceText } : {}),
			...(saved?.error && !sourceChanged && !stale ? { error: saved.error } : {}),
		}
		if (entry.status !== 'translated' && filled(oldValue)) {
			entry.staleValue = oldValue
			entry.staleSourceText = saved?.sourceText ?? before?.sourceText
		}
		const proof = proofById.get(field.fieldId)
		const validProof = proof && samePath(proof.fieldPath, field.fieldPath) && proof.sourceText === field.sourceText
			&& proof.revision === (saved?.revision ?? 0) && typeof proof.value === 'string' && proof.value.length <= field.maxLength
			&& (proof.origin === 'manual' || proof.origin === 'automatic')
		const automaticAllowed = origin === 'automatic' && entry.status !== 'translated'
		if (validProof && (proof.origin === 'manual' || automaticAllowed)) {
			value = filled(proof.value) ? proof.value : null
			entry = { ...entry, sourceText: field.sourceText, origin: proof.origin, status: value ? 'translated' : 'missing', revision: entry.revision + 1 }
			delete entry.error
			delete entry.staleValue
			delete entry.staleSourceText
		} else if (!previous && filled(submitted)) {
			value = submitted
			entry.origin = 'manual'; entry.status = 'translated'; entry.revision++
		} else if (previous && !previousState.has(field.fieldId) && !sourceChanged && !filled(oldValue) && filled(submitted)) {
			// First manual translation from a legacy client; existing or invalidated values require proof.
			value = submitted; entry.origin = 'manual'; entry.status = 'translated'; entry.revision++
		}
		if (entry.status !== 'translated') value = null
		put(out, field.arabicPath, typeof field.arabicPath.at(-1) === 'number' || field.arabicPath.length > 1 && field.arabicPath[0] !== 'location' ? value ?? '' : value)
		state.fields.push(entry)
	}
	const archived: (ContentTranslationFieldState & { value: string })[] = []
	const activeIds = new Set(state.fields.map(field => field.fieldId))
	for (const field of oldDefinitions) {
		if (activeIds.has(field.fieldId)) continue
		const saved = oldState.get(field.fieldId)
		const value = at(previous, field.arabicPath)
		const draft = filled(value) ? value : saved?.staleValue
		if (saved && filled(draft)) archived.push({ ...saved, value: draft })
	}
	// Legacy documents may contain Arabic placeholders beyond their source shape.
	// Keep that content recoverable while exposing only fields that actually exist in Persian.
	const legacyInput = previous ?? next
	const legacyRow: Row = record(legacyInput) ? legacyInput : {}
	const unmatched = (sourcePath: ContentFieldPath, arabicPath: ContentFieldPath) => {
		const value = at(legacyRow, arabicPath)
		if (at(legacyRow, sourcePath) === undefined && filled(value)) archived.push({
			fieldId: `orphan:${sourcePath.join('.')}`, fieldPath: sourcePath, sourceText: '', value,
			origin: 'legacy', status: 'needs-review', revision: 0,
		})
	}
	for (const key of type === 'product' ? ['ingredients'] : type === 'category' ? ['sizeNames'] : []) {
		array((legacyRow as Row)[`${key}Ar`]).forEach((_, index) => { unmatched([key, index], [`${key}Ar`, index]) })
	}
	for (const key of type === 'terms' ? ['sections'] : type === 'article' ? ['processes'] : []) {
		array((legacyRow as Row)[`${key}Ar`]).forEach((section, index) => {
			unmatched([key, index, 'title'], [`${key}Ar`, index, 'title'])
			array(record(section) ? section.items : undefined).forEach((_, item) => { unmatched([key, index, 'items', item], [`${key}Ar`, index, 'items', item]) })
		})
	}
	const oldArchive = record(previous) && record(previous.translationState) && Array.isArray(previous.translationState.orphanedFields)
		? previous.translationState.orphanedFields : []
	const seen = new Set<string>()
	let archiveLength = 0
	for (const field of [...archived, ...oldArchive]) {
		if (!record(field) || typeof field.fieldId !== 'string' || typeof field.sourceText !== 'string' || !filled(field.value)) continue
		const identity = JSON.stringify([field.fieldId, field.sourceText, field.value])
		if (seen.has(identity) || archiveLength + field.sourceText.length + field.value.length > 2_000_000) continue
		seen.add(identity)
		archiveLength += field.sourceText.length + field.value.length
		state.orphanedFields ??= []
		state.orphanedFields.push(field as unknown as ContentTranslationFieldState & { value: string })
		if (state.orphanedFields.length >= 1000) break
	}
	// Trim Arabic collection structure to the source; placeholders retain exact index alignment.
	for (const key of type === 'product' ? ['ingredients'] : type === 'category' ? ['sizeNames'] : []) {
		const length = array((next as Row)[key]).length
		const values = array(out[`${key}Ar`]).slice(0, length)
		out[`${key}Ar`] = values.length ? values : null
	}
	for (const key of type === 'terms' ? ['sections'] : type === 'article' ? ['processes'] : []) {
		const source = array((next as Row)[key])
		const translated = array(out[`${key}Ar`])
		out[`${key}Ar`] = source.length ? source.map((section, index) => ({
			title: string(at(translated, [index, 'title'])), items: array(record(section) ? section.items : undefined).map((_, item) => string(at(translated, [index, 'items', item]))),
		})) : null
	}
	out.translationState = state
	return out as T & { translationState: ContentTranslationState }
}

export function contentTranslationValue(type: ContentEntityType, row: unknown, path: ContentFieldPath): string | null {
	return contentTranslationFields(type, row).find(field => samePath(field.fieldPath, path))?.value ?? null
}
/** Filter raw Arabic too: SEO and older clients may still consult the Arabic columns directly. */
export function localizeContentRecord<T extends object>(type: ContentEntityType, row: T): T {
	const out = structuredClone(row) as T & Row
	const fields = contentTranslationFields(type, row)
	for (const field of definitions(type, row)) {
		const value = fields.find(candidate => candidate.fieldId === field.fieldId)?.value ?? null
		put(out, field.arabicPath, typeof field.arabicPath.at(-1) === 'number' || field.arabicPath.length > 1 && field.arabicPath[0] !== 'location' ? value ?? '' : value)
	}
	delete out.translationState
	return out as T
}

export function eligibleContentTranslationFields(type: ContentEntityType, row: unknown): ContentTranslationField[] {
	return contentTranslationFields(type, row).filter(field => field.sourceText.trim() && field.origin === 'automatic'
		&& (field.status === 'missing' || field.status === 'needs-retranslation')
		&& !(type === 'article' && record(row) && row.blocks && field.fieldId === 'content'))
}

/** Only source identity and Arabic revisions participate; structural block edits also fence draft saves. */
function contentSourceRevisionPayload(type: ContentEntityType, row: unknown): string {
	const proof = new Map(states(row, type).map(field => [field.fieldId, field]))
	return JSON.stringify([definitions(type, row).map(field => [field.fieldId, field.fieldPath, field.sourceText, proof.get(field.fieldId)?.revision ?? 0]),
		(type === 'article' || type === 'about') && record(row) ? row.blocks ?? null : null,
		(type === 'article' || type === 'about') && record(row) && record(row.blocksAr) ? row.blocksAr.translation ?? null : null])
}
/** A compact SHA-256 proof avoids duplicating large legacy documents in every admin save. */
export function contentSourceRevision(type: ContentEntityType, row: unknown): string {
	return `sha256:${contentSourceFingerprint(contentSourceRevisionPayload(type, row))}`
}
export function matchesContentSourceRevision(type: ContentEntityType, row: unknown, revision?: string): boolean {
	if (revision === undefined) return true
	return revision.startsWith('sha256:') ? revision === contentSourceRevision(type, row) : revision === contentSourceRevisionPayload(type, row)
}
export function assertContentSourceRevision(type: ContentEntityType, row: unknown, revision?: string): boolean {
	return matchesContentSourceRevision(type, row, revision)
}
