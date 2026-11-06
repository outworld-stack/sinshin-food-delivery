/** Deterministic shared safety checks; no database, network or translation engine. */
import assert from 'node:assert/strict'
import {
	assertContentSourceRevision, assertContentTranslationIdentities, collectionTranslationIdentities,
	articleBlocksContentForLimit, bindArticleBlockItemIdentities, getArticleBlockTextFields,
	contentSourceRevision, contentTranslationFields, createContentCollectionItemId,
	localizeContentRecord, reconcileContentTranslation, withContentTranslationIdentities,
	setArticleBlockTranslations,
	type ContentCollectionIdentity, type ContentEntityType, type ContentFieldPath,
	type ArticleBlocksDoc,
} from '@sinshin/shared'

let checks = 0
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`) }
function required<T>(value: T | undefined | null): T { assert(value != null, 'Required identity fixture exists'); return value }
function collection(type: ContentEntityType, row: unknown, path: ContentFieldPath) {
	return required(collectionTranslationIdentities(type, row).find(entry => JSON.stringify(entry.collectionPath) === JSON.stringify(path)))
}

for (const type of ['product', 'category'] as const) {
	const key = type === 'product' ? 'ingredients' : 'sizeNames'
	const legacy = { id: 'one', name: 'نام', nameAr: 'اسم يدوي', [key]: ['الف', 'ب', 'ج'], [`${key}Ar`]: ['عربي أ', 'عربي ب', 'عربي ج'] }
	test(`${type}: two simultaneous source edits plus reorder retain the right identities`, () => {
		const before = reconcileContentTranslation(type, 'one', null, legacy)
		const ids = collection(type, before, [key]).itemIds
		const identities = [{ collectionPath: [key], itemIds: [required(ids[1]), required(ids[2]), required(ids[0])] }]
		const next = reconcileContentTranslation(type, 'one', before, { ...before, [key]: ['ب تازه', 'ج', 'الف تازه'] }, [], identities)
		assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], ['', 'عربي ج', ''])
		assert.equal(next.nameAr, legacy.nameAr)
		const changed = contentTranslationFields(type, next).filter(field => field.status === 'needs-review')
		assert.deepEqual(changed.map(field => [field.fieldId, field.staleValue]), [[ids[1], 'عربي ب'], [ids[0], 'عربي أ']])
		assert.deepEqual(collection(type, next, [key]).itemIds, required(identities[0]).itemIds)
		const field = required(changed[0])
		const reviewed = reconcileContentTranslation(type, 'one', next, next, [{ fieldId: field.fieldId, fieldPath: field.fieldPath,
			sourceText: field.sourceText, revision: field.revision, value: 'عربي ب جديد', origin: 'manual' }])
		assert.deepEqual((reviewed as Record<string, unknown>)[`${key}Ar`], ['عربي ب جديد', 'عربي ج', ''])
	})
	test(`${type}: source replacement with missing identity proof cannot inherit old positional Arabic`, () => {
		const before = reconcileContentTranslation(type, 'one', null, legacy)
		const next = reconcileContentTranslation(type, 'one', before, { ...before, [key]: ['ب تازه', 'الف تازه', 'ج'] })
		assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], ['', '', ''])
		assert.equal(next.translationState.orphanedFields?.length, 3)
		assert(next.translationState.orphanedFields?.every(field => field.status === 'needs-review'))
	})
	test(`${type}: delete then same-text replacement gets a new ID and cannot reclaim a retired ID`, () => {
		const before = reconcileContentTranslation(type, 'one', null, legacy)
		const ids = collection(type, before, [key]).itemIds
		const kept: [string, string] = [required(ids[0]), required(ids[2])]
		const deleted = reconcileContentTranslation(type, 'one', before, { ...before, [key]: ['الف', 'ج'] }, [], [{ collectionPath: [key], itemIds: kept }])
		const replacementId = createContentCollectionItemId(key)
		const replacement = { ...deleted, [key]: ['الف', 'ب', 'ج'] }
		const restored = reconcileContentTranslation(type, 'one', deleted, replacement, [], [{ collectionPath: [key], itemIds: [kept[0], replacementId, kept[1]] }])
		assert.deepEqual((restored as Record<string, unknown>)[`${key}Ar`], ['عربي أ', '', 'عربي ج'])
		assert(restored.translationState.orphanedFields?.some(field => field.value === 'عربي ب'))
		assert.equal(assertContentTranslationIdentities(type, replacement, [{ collectionPath: [key], itemIds: [kept[0], required(ids[1]), kept[1]] }], deleted), false)
	})
	test(`${type}: duplicate text follows explicit IDs independently`, () => {
		const before = reconcileContentTranslation(type, 'one', null, { ...legacy, [key]: ['یک', 'یک'], [`${key}Ar`]: ['الأول', 'الثاني'] })
		const ids = collection(type, before, [key]).itemIds
		const next = reconcileContentTranslation(type, 'one', before, before, [], [{ collectionPath: [key], itemIds: [required(ids[1]), required(ids[0])] }])
		assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], ['الثاني', 'الأول'])
		assert(contentTranslationFields(type, next).every(field => field.status === 'translated' || !field.sourceText))
	})
	test(`${type}: unchanged legacy bootstrap preserves Arabic and becomes persistent on save`, () => {
		const first = collectionTranslationIdentities(type, legacy)
		assert.deepEqual(first, collectionTranslationIdentities(type, structuredClone(legacy)))
		const saved = reconcileContentTranslation(type, 'one', legacy, legacy, [], first)
		assert.deepEqual(collectionTranslationIdentities(type, saved), first)
		assert.deepEqual((saved as Record<string, unknown>)[`${key}Ar`], legacy[`${key}Ar`])
		const unmapped = reconcileContentTranslation(type, 'one', legacy, { ...legacy, [key]: ['ب', 'الف', 'ج'] })
		assert.deepEqual((unmapped as Record<string, unknown>)[`${key}Ar`], ['', '', ''])
		assert.equal(unmapped.translationState.orphanedFields?.length, 3)
	})
}

for (const type of ['terms', 'article'] as const) {
	const key = type === 'terms' ? 'sections' : 'processes'
	test(`${type}: simultaneous section titles/items edits plus nested reorder stay bound to stable IDs`, () => {
		const before = reconcileContentTranslation(type, 'one', null, { id: 'one', title: 'مقاله', [key]: [
			{ title: 'اول', items: ['الف', 'ب'] }, { title: 'دوم', items: ['ج', 'د'] },
		], [`${key}Ar`]: [{ title: 'أول', items: ['أ', 'ب'] }, { title: 'ثاني', items: ['ج', 'د'] }] })
		const parents = collection(type, before, [key]).itemIds
		const firstItems = collection(type, before, [key, 0, 'items']).itemIds
		const secondItems = collection(type, before, [key, 1, 'items']).itemIds
		const identities: ContentCollectionIdentity[] = [
			{ collectionPath: [key], itemIds: [required(parents[1]), required(parents[0])] },
			{ collectionPath: [key, 0, 'items'], itemIds: [required(secondItems[1]), required(secondItems[0])] },
			{ collectionPath: [key, 1, 'items'], itemIds: [required(firstItems[1]), required(firstItems[0])] },
		]
		const next = reconcileContentTranslation(type, 'one', before, { ...before, [key]: [
			{ title: 'دوم تازه', items: ['د تازه', 'ج'] }, { title: 'اول تازه', items: ['ب', 'الف تازه'] },
		] }, [], identities)
		assert.deepEqual((next as Record<string, unknown>)[`${key}Ar`], [{ title: '', items: ['', 'ج'] }, { title: '', items: ['ب', ''] }])
		assert.equal(contentTranslationFields(type, next).filter(field => field.status === 'needs-review').length, 4)
		assert.deepEqual(collectionTranslationIdentities(type, next), identities)
		assert.equal(assertContentTranslationIdentities(type, next, identities.slice(0, 2), before), false, 'complete nested mappings are mandatory')
		const stolen = structuredClone(identities)
		stolen[1] = { collectionPath: [key, 0, 'items'], itemIds: [required(firstItems[1]), required(firstItems[0])] }
		assert.equal(assertContentTranslationIdentities(type, next, stolen, before), false, 'a child cannot claim another parent namespace')
	})
}

test('identity validation rejects arbitrary structural paths, malformed payloads and duplicate IDs', () => {
	const row = reconcileContentTranslation('product', 'one', null, { id: 'one', ingredients: ['الف', 'ب'] })
	const ids = collection('product', row, ['ingredients']).itemIds
	for (const input of [undefined, null, {}, [], [{ collectionPath: ['lat'], itemIds: ids }],
		[{ collectionPath: ['ingredients'], itemIds: [ids[0], ids[0]] }], [{ collectionPath: ['ingredients'], itemIds: ['ingredients:not-a-uuid', ids[1]] }]]) {
		assert.equal(assertContentTranslationIdentities('product', row, input, row), false)
	}
	assert.equal(assertContentTranslationIdentities('product', row, collectionTranslationIdentities('product', row), row), true)
})
test('draft projections are honored explicitly and never persist transient identity payloads', () => {
	const before = reconcileContentTranslation('product', 'one', null, { id: 'one', ingredients: ['الف', 'ب'], ingredientsAr: ['أ', 'ب'] })
	const ids = collection('product', before, ['ingredients']).itemIds
	const identities = [{ collectionPath: ['ingredients'], itemIds: [required(ids[1]), required(ids[0])] }]
	const draft = withContentTranslationIdentities('product', { ...before, ingredients: ['ب', 'الف'] }, identities)
	const saved = reconcileContentTranslation('product', 'one', before, draft)
	assert.deepEqual(saved.ingredientsAr, ['ب', 'أ'])
	assert.equal('translationIdentities' in saved, false)
	assert.equal('translationState' in localizeContentRecord('product', saved), false)
})
test('removed untranslated identities are retired too', () => {
	const before = reconcileContentTranslation('product', 'one', null, { id: 'one', ingredients: ['الف'] })
	const id = required(collection('product', before, ['ingredients']).itemIds[0])
	const deleted = reconcileContentTranslation('product', 'one', before, { ...before, ingredients: [] }, [], [{ collectionPath: ['ingredients'], itemIds: [] }])
	assert(deleted.translationState.retiredItemIds?.includes(id))
	assert.equal(assertContentTranslationIdentities('product', before, [{ collectionPath: ['ingredients'], itemIds: [id] }], deleted), false)
})
test('missing, null, malformed and noncompact source proofs never pass', () => {
	const row = { id: 'one', alt: 'تصویر' }
	for (const value of [undefined, null, false, 0, {}, [], '', 'sha256:', `sha256:${'f'.repeat(63)}`, `sha256:${'G'.repeat(64)}`, JSON.stringify(row)]) {
		assert.equal(assertContentSourceRevision('gallery', row, value), false)
	}
	assert.equal(assertContentSourceRevision('gallery', row, contentSourceRevision('gallery', row)), true)
})
test('every accepted no-op or metadata write changes the token without invalidating text', () => {
	const before = reconcileContentTranslation('gallery', 'one', null, { id: 'one', alt: 'تصویر', altAr: 'صورة', src: '/old.png' })
	const token = contentSourceRevision('gallery', before)
	const noOp = reconcileContentTranslation('gallery', 'one', before, before)
	assert.equal(noOp.altAr, before.altAr)
	assert.notEqual(contentSourceRevision('gallery', noOp), token)
	assert.equal(assertContentSourceRevision('gallery', noOp, token), false, 'a second writer cannot reuse the first writer token')
	const metadata = reconcileContentTranslation('gallery', 'one', noOp, { ...noOp, src: '/new.png' })
	assert.equal(metadata.altAr, before.altAr)
	assert.notEqual(contentSourceRevision('gallery', metadata), contentSourceRevision('gallery', noOp))
	assert.equal(metadata.translationState.writeRevision, required(noOp.translationState.writeRevision) + 1)
})
test('trusted read-only counters do not make unrelated editor drafts stale', () => {
	const product = { id: 'one', name: 'نام', views: 1, sales: 2 }
	assert.equal(contentSourceRevision('product', product), contentSourceRevision('product', { ...product, views: 5, sales: 9 }))
	const article = { id: 'one', title: 'عنوان', views: 1 }
	assert.equal(contentSourceRevision('article', article), contentSourceRevision('article', { ...article, views: 99 }))
})
test('canonical tokens preserve Date serialization and key order while fencing source structure and Arabic state', () => {
	const before = { id: 'one', name: 'نام', ingredients: ['الف', 'ب'], createdAt: new Date('2026-01-01T00:00:00Z') }
	const reorderedKeys = { createdAt: before.createdAt.toISOString(), ingredients: before.ingredients, name: before.name, id: before.id }
	const token = contentSourceRevision('product', before)
	assert.equal(contentSourceRevision('product', reorderedKeys), token)
	assert.notEqual(contentSourceRevision('product', { ...before, ingredients: ['ب', 'الف'] }), token)
	assert.notEqual(contentSourceRevision('product', { ...before, nameAr: 'اسم' }), token)
	assert.equal(contentSourceRevision('product', { ...before, sourceRevision: token, translationEdits: [], translationIdentities: [] }), token)
})
test('legal legacy maximum block documents retain byte allowances while all original text and proof values remain counted', () => {
	const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
	const legacy: ArticleBlocksDoc = { version: 1, blocks: Array.from({ length: 200 }, (_, block) => ({
		id: `block${block}`.padEnd(64, 'x'), type: 'list', props: { items: Array.from({ length: 30 }, () => 'فار') },
	})) }
	const source = bindArticleBlockItemIdentities(legacy)
	const translated = required(setArticleBlockTranslations(source, null, source.blocks.flatMap(block =>
		getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: 'عرب' }))), 'manual'))
	assert(bytes(legacy) < 262_144)
	assert(bytes(translated) > 2_097_152, 'new identity bytes alone cross the existing provenance cap')
	const legacyTranslation = {
		version: translated.version,
		blocks: translated.blocks.map(block => ({ ...block, props: { items: block.type === 'list' ? block.props.items : [] } })),
		translation: { fields: required(translated.translation).fields.map(({ itemId: _itemId, ...proof }) => proof) },
	}
	const projected = articleBlocksContentForLimit(translated)
	assert.deepEqual(projected, legacyTranslation, 'only new bookkeeping is excluded from the original document shape')
	assert(bytes(projected) < 2_097_152)
	assert.deepEqual(articleBlocksContentForLimit(source), legacy)
	const failed = structuredClone(translated)
	const failedFields = required(failed.translation).fields
	for (const field of failedFields) { field.error = 'e'.repeat(500); field.staleValue = 'نسخه قدیمی'; field.sourceText += ' تغییر' }
	const projectedFailure = articleBlocksContentForLimit(failed) as ArticleBlocksDoc
	assert(bytes(projectedFailure) > 2_097_152, 'original error, source and stale translation proof content still obeys the cap')
	assert.deepEqual(required(projectedFailure.translation).fields[0], (({ itemId: _itemId, ...proof }) => proof)(required(failedFields[0])))
	assert.deepEqual(translated.blocks[0]?.type === 'list' ? translated.blocks[0].props.items : [], Array.from({ length: 30 }, () => 'عرب'))
})
console.log(`${checks} content identity and mandatory revision regression groups passed`)
