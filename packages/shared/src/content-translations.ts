import { contentSourceFingerprint } from './content-source-fingerprint'

/** Database content provenance. Static UI dictionaries and block documents stay separate. */
export type ContentEntityType =
	| 'product' | 'productSize' | 'mainCategory' | 'category'
	| 'article' | 'articleCategory' | 'articleSubCategory'
	| 'about' | 'gallery' | 'terms' | 'packagingItem' | 'temporaryClose'
export type ContentTranslationStatus = 'missing' | 'translated' | 'needs-retranslation' | 'needs-review'
export type ContentTranslationOrigin = 'manual' | 'automatic' | 'legacy'
export type ContentFieldPath = (string | number)[]
export interface ContentCollectionIdentity {
	collectionPath: ContentFieldPath
	itemIds: string[]
}
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
	/** Ordered source identities, persisted in the existing provenance sidecar. */
	collections?: ContentCollectionIdentity[]
	/** Advances on every accepted write, including metadata-only and empty saves. */
	writeRevision?: number
	/** Removed source identities cannot later be claimed by replacement entries. */
	retiredItemIds?: string[]
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

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pathKey = (path: ContentFieldPath) => JSON.stringify(path)
function collectionPaths(type: ContentEntityType, row: unknown): ContentFieldPath[] {
	if (type === 'product') return [['ingredients']]
	if (type === 'category') return [['sizeNames']]
	const key = type === 'terms' ? 'sections' : type === 'article' ? 'processes' : null
	if (!key) return []
	return [[key], ...array(record(row) ? row[key] : undefined).map((_section, index) => [key, index, 'items'])]
}
function storedCollections(row: unknown): ContentCollectionIdentity[] {
	const state = record(row) ? row.translationState : undefined
	return record(state) && Array.isArray(state.collections) ? state.collections.filter((entry): entry is ContentCollectionIdentity =>
		record(entry) && Array.isArray(entry.collectionPath) && entry.collectionPath.length > 0
		&& entry.collectionPath.every(key => typeof key === 'string' || Number.isInteger(key) && Number(key) >= 0)
		&& Array.isArray(entry.itemIds) && entry.itemIds.every(id => typeof id === 'string')) : []
}
function collectionPrefix(path: ContentFieldPath, collections: ContentCollectionIdentity[]): string {
	if (path.length === 1) return String(path[0])
	return `${collections.find(entry => samePath(entry.collectionPath, [String(path[0])]))?.itemIds[Number(path[1])]}:items`
}
/** New source entries receive an identity before their text can be edited or translated. */
export function createContentCollectionItemId(prefix: string): string {
	return `${prefix}:${crypto.randomUUID()}`
}
/** Safe legacy bootstrap: use a saved path only while its exact source binding still matches. */
export function collectionTranslationIdentities(type: ContentEntityType, row: unknown): ContentCollectionIdentity[] {
	const result: ContentCollectionIdentity[] = []
	const saved = storedCollections(row)
	const fields = states(row, type)
	const used = new Set<string>()
	for (const path of collectionPaths(type, row)) {
		const values = array(at(row, path))
		const prefix = collectionPrefix(path, result)
		const stored = saved.find(entry => samePath(entry.collectionPath, path))
		const itemIds = values.map((value, index) => {
			const fieldPath = path.length === 1 && (path[0] === 'sections' || path[0] === 'processes')
				? [...path, index, 'title'] : [...path, index]
			const sourceText = fieldPath.at(-1) === 'title' ? record(value) ? string(value.title) : '' : string(value)
			const exact = fields.find(field => samePath(field.fieldPath, fieldPath) && field.sourceText === sourceText && field.fieldId.startsWith(`${prefix}:`))
			let id = stored?.itemIds.length === values.length ? stored.itemIds[index] : exact?.fieldId
			if (!id || !id.startsWith(`${prefix}:`) || used.has(id)) {
				const oldAtPath = fields.some(field => samePath(field.fieldPath, fieldPath))
				id = oldAtPath ? `${prefix}:legacy-${contentSourceFingerprint(JSON.stringify([fieldPath, sourceText])).slice(0, 24)}` : `${prefix}:${index}`
			}
			used.add(id)
			return id
		})
		result.push({ collectionPath: [...path], itemIds })
	}
	return result
}
/** Validate the complete ordered projection; unrelated paths, collisions and retired IDs are rejected. */
export function assertContentTranslationIdentities(type: ContentEntityType, row: unknown, input: unknown, previous?: unknown): input is ContentCollectionIdentity[] {
	if (!Array.isArray(input)) return false
	const expected = collectionPaths(type, row)
	if (input.length !== expected.length) return false
	const previousCollections = collectionTranslationIdentities(type, previous)
	const currentIds = new Set(previousCollections.flatMap(entry => entry.itemIds))
	const previousState = record(previous) && record(previous.translationState) ? previous.translationState : undefined
	const retired = new Set([...array(previousState?.retiredItemIds).map(string),
		...array(previousState?.orphanedFields).filter(record).map(field => string(field.fieldId))])
	const used = new Set<string>(), paths = new Set<string>()
	const validated: ContentCollectionIdentity[] = []
	// Parents are validated first so child ownership is tied to the submitted stable parent ID.
	for (const path of expected) {
		const matches = input.filter(entry => record(entry) && Array.isArray(entry.collectionPath) && samePath(entry.collectionPath, path))
		const entry = matches[0]
		if (matches.length !== 1 || !record(entry) || !Array.isArray(entry.itemIds) || entry.itemIds.length !== array(at(row, path)).length) return false
		const prefix = collectionPrefix(path, validated)
		for (const id of entry.itemIds) {
			if (typeof id !== 'string' || id.length > 256 || !id.startsWith(`${prefix}:`) || used.has(id) || retired.has(id)) return false
			if (!currentIds.has(id) && !uuid.test(id.slice(prefix.length + 1))) return false
			used.add(id)
		}
		const key = pathKey(path)
		if (paths.has(key)) return false
		paths.add(key)
		validated.push({ collectionPath: [...path], itemIds: [...entry.itemIds] })
	}
	return true
}
/** Draft-only projection; persisted translation states are always rebuilt by the server. */
export function withContentTranslationIdentities<T extends object>(_type: ContentEntityType, row: T, identities: ContentCollectionIdentity[]): T & { translationIdentities: ContentCollectionIdentity[] } {
	const out = structuredClone(row) as Row
	out.translationIdentities = structuredClone(identities)
	const state = record(out.translationState) ? out.translationState : {}
	out.translationState = { ...state, collections: structuredClone(identities) }
	return out as T & { translationIdentities: ContentCollectionIdentity[] }
}
function resolvedCollections(type: ContentEntityType, next: unknown, previous?: unknown, input?: unknown): ContentCollectionIdentity[] {
	const explicit = input ?? (record(next) ? next.translationIdentities : undefined)
	if (explicit !== undefined) {
		if (!assertContentTranslationIdentities(type, next, explicit, previous)) throw new Error('Invalid translation collection identities')
		return structuredClone(explicit)
	}
	if (!previous) {
		if (states(next, type).length || storedCollections(next).length) return collectionTranslationIdentities(type, next)
		const created: ContentCollectionIdentity[] = []
		for (const path of collectionPaths(type, next)) created.push({ collectionPath: [...path],
			itemIds: array(at(next, path)).map(() => createContentCollectionItemId(collectionPrefix(path, created))) })
		return created
	}
	const old = collectionTranslationIdentities(type, previous), result: ContentCollectionIdentity[] = []
	for (const path of collectionPaths(type, next)) {
		const prefix = collectionPrefix(path, result)
		const parent = path.length > 1 ? result.find(entry => samePath(entry.collectionPath, [String(path[0])]))?.itemIds[Number(path[1])] : undefined
		const priorParent = path.length > 1 ? old.find(entry => samePath(entry.collectionPath, [String(path[0])]))?.itemIds[Number(path[1])] : undefined
		const before = old.find(entry => samePath(entry.collectionPath, path))
		const unchanged = JSON.stringify(at(next, path)) === JSON.stringify(at(previous, path)) && parent === priorParent
		result.push({ collectionPath: [...path], itemIds: unchanged && before ? [...before.itemIds]
			: array(at(next, path)).map(() => createContentCollectionItemId(prefix)) })
	}
	return result
}

function definitions(type: ContentEntityType, input: unknown, previous?: unknown, identities?: ContentCollectionIdentity[]): FieldDefinition[] {
	const row = record(input) ? input : {}
	const collections = identities ?? resolvedCollections(type, input, previous ?? input)
	const result: FieldDefinition[] = []
	const scalar = (path: ContentFieldPath, arabicPath: ContentFieldPath, maxLength: number) => {
		result.push({ fieldId: path.join('.'), fieldPath: path, arabicPath, sourceText: string(at(row, path)), maxLength })
	}
	const list = (path: ContentFieldPath, arabicPath: ContentFieldPath, maxLength: number) => {
		const values = array(at(row, path)).map(string)
		const ids = collections.find(entry => samePath(entry.collectionPath, path))?.itemIds ?? []
		values.forEach((text, index) => {
			result.push({ fieldId: ids[index] ?? `${collectionPrefix(path, collections)}:${index}`, fieldPath: [...path, index], arabicPath: [...arabicPath, index], sourceText: text, maxLength })
		})
	}
	const sections = (key: 'sections' | 'processes') => {
		const sections = array(row[key])
		const ids = collections.find(entry => samePath(entry.collectionPath, [key]))?.itemIds ?? []
		sections.forEach((section, index) => {
			const id = ids[index] ?? `${key}:${index}`
			result.push({ fieldId: id, fieldPath: [key, index, 'title'], arabicPath: [`${key}Ar`, index, 'title'], sourceText: record(section) ? string(section.title) : '', maxLength: key === 'sections' ? 200 : 120 })
			list([key, index, 'items'], [`${key}Ar`, index, 'items'], key === 'sections' ? 1000 : 300)
		})
	}
	switch (type) {
		case 'product': scalar(['name'], ['nameAr'], 120); scalar(['description'], ['descriptionAr'], 2000); list(['ingredients'], ['ingredientsAr'], 60); break
		case 'productSize': case 'mainCategory': case 'articleCategory': case 'articleSubCategory': scalar(['name'], ['nameAr'], 60); break
		case 'category': scalar(['name'], ['nameAr'], 60); list(['sizeNames'], ['sizeNamesAr'], 40); break
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
		const raw = at(row, state ? field.arabicPath.map((key, index) => typeof field.fieldPath[index] === 'number' ? state.fieldPath[index] ?? key : key) : field.arabicPath)
		const changed = state && state.sourceText !== field.sourceText
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
	identities?: ContentCollectionIdentity[],
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
			collections: collectionTranslationIdentities(type, previous),
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
	const previousSidecar = record(previous) && record(previous.translationState) ? previous.translationState : undefined
	const writeRevision = Number.isSafeInteger(previousSidecar?.writeRevision) && Number(previousSidecar?.writeRevision) >= 0 ? Number(previousSidecar?.writeRevision) : 0
	if (writeRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Content write revision exhausted')
	const collections = resolvedCollections(type, next, previous, identities)
	const activeItemIds = new Set(collections.flatMap(entry => entry.itemIds))
	const retiredItemIds = [...new Set([...array(previousSidecar?.retiredItemIds).map(string),
		...collectionTranslationIdentities(type, previous).flatMap(entry => entry.itemIds).filter(id => !activeItemIds.has(id))])].filter(Boolean)
	const state: ContentTranslationState = { version: 1, entityType: type, entityId: out.id !== undefined ? String(out.id) : entityId,
		fields: [], collections, writeRevision: writeRevision + 1, ...(retiredItemIds.length ? { retiredItemIds } : {}) }
	const nextDefinitions = definitions(type, next, undefined, collections)
	for (const field of nextDefinitions) {
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
		if (saved && filled(draft)) archived.push({ ...saved, status: 'needs-review', value: draft })
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
	delete out.translationIdentities
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

function canonicalRevisionValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map(canonicalRevisionValue)
	if (record(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined)
		.map(key => [key, canonicalRevisionValue(value[key])]))
	return value
}
/** Fence the complete saved source structure and every accepted write, including metadata-only changes. */
function contentSourceRevisionPayload(type: ContentEntityType, row: unknown): string {
	const source = record(row) ? { ...row } : row
	if (record(source)) {
		delete source.sourceRevision
		delete source.translationEdits
		delete source.translationIdentities
		// Public counters use their own trusted writes and never replace editable content.
		if (type === 'product' || type === 'article') delete source.views
		if (type === 'product') delete source.sales
	}
	return JSON.stringify(canonicalRevisionValue([type, source]))
}
/** A compact SHA-256 proof avoids duplicating large legacy documents in every admin save. */
export function contentSourceRevision(type: ContentEntityType, row: unknown): string {
	return `sha256:${contentSourceFingerprint(contentSourceRevisionPayload(type, row))}`
}
export function matchesContentSourceRevision(type: ContentEntityType, row: unknown, revision?: unknown): boolean {
	return typeof revision === 'string' && /^sha256:[0-9a-f]{64}$/.test(revision) && revision === contentSourceRevision(type, row)
}
export function assertContentSourceRevision(type: ContentEntityType, row: unknown, revision?: unknown): boolean {
	return matchesContentSourceRevision(type, row, revision)
}
