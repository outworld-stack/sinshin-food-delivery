import assert from 'node:assert/strict'
import {
	bindArticleBlockItemIdentities, getChangedArticleBlockTextFields, getArticleBlockTextFields,
	mergeArticleBlocksTranslation, normalizeArticleBlocksTranslation, readArticleBlockText,
	reconcileArticleBlocksTranslation, setArticleBlockTranslations, validateArticleBlockItemIdentities,
	type ArticleBlocksDoc,
} from '@sinshin/shared'
import { normalizeBlocksDoc } from '../src/domain/article/blocks-normalize'

let checks = 0
const test = (name: string, run: () => void) => { run(); checks++; console.log(`  ✓ ${name}`) }
const source = bindArticleBlockItemIdentities({ version: 1, blocks: [
	{ id: 'list', type: 'list', width: 'md', style: { bg: '#123456' }, props: { items: ['اول', 'دوم', 'سوم'], ordered: true } },
	{ id: 'gallery', type: 'gallery', anim: 'fade', props: { layout: 'grid', images: [{ src: '/one.webp', alt: 'یک' }, { src: '/two.webp', alt: 'دو' }, { src: '/three.webp', alt: 'سه' }] } },
	{ id: 'location', type: 'location', props: { title: 'مکان', address: 'نشانی', lat: 37.1234567890123, lng: 49.9876543210123 } },
] })
const translated = setArticleBlockTranslations(source, null, source.blocks.flatMap(block => getArticleBlockTextFields(block)
	.map(field => ({ blockId: block.id, path: field.path, text: `عربي ${field.text}` }))), 'automatic')
assert.ok(translated)
const reviewed = setArticleBlockTranslations(source, translated, [{ blockId: 'list', path: ['items', 2], text: 'يدوي سوم' }, { blockId: 'gallery', path: ['images', 2, 'alt'], text: 'يدوي سه' }], 'manual')
assert.ok(reviewed)
const reorder = (doc: ArticleBlocksDoc, edit: boolean) => {
	const next = structuredClone(doc)
	const list = next.blocks.find(block => block.type === 'list')
	const gallery = next.blocks.find(block => block.type === 'gallery')
	assert.ok(list?.type === 'list' && gallery?.type === 'gallery')
	const order = [2, 0, 1]
	list.props.items = order.map(index => `${doc.blocks[0]?.type === 'list' ? doc.blocks[0].props.items[index] : ''}${edit && index !== 2 ? ' تازه' : ''}`)
	list.props.itemIds = order.map(index => list.props.itemIds?.[index] ?? '')
	gallery.props.images = order.map(index => ({ ...gallery.props.images[index], src: gallery.props.images[index]?.src ?? '', ...(edit && index !== 2 ? { alt: `${gallery.props.images[index]?.alt} تازه` } : {}) }))
	return next
}

test('order-only saves preserve every nested Arabic value by item ID', () => {
	const next = reorder(source, false)
	assert.deepEqual(getChangedArticleBlockTextFields(source, next), [])
	const saved = reconcileArticleBlocksTranslation(source, next, reviewed)
	assert.ok(saved)
	assert.deepEqual((saved.blocks[0]?.type === 'list' ? saved.blocks[0].props.items : []), ['يدوي سوم', 'عربي اول', 'عربي دوم'])
	assert.deepEqual((saved.blocks[1]?.type === 'gallery' ? saved.blocks[1].props.images.map(image => image.alt) : []), ['يدوي سه', 'عربي یک', 'عربي دو'])
})
test('multiple Persian edits and reorder invalidate only those identities and preserve manual siblings', () => {
	const next = reorder(source, true)
	const changes = getChangedArticleBlockTextFields(source, next)
	assert.equal(changes.length, 4)
	assert.ok(changes.every(change => !!change.itemId))
	const saved = reconcileArticleBlocksTranslation(source, next, reviewed)
	assert.ok(saved)
	assert.deepEqual(saved.blocks[0]?.type === 'list' ? saved.blocks[0].props.items : [], ['يدوي سوم', '', ''])
	assert.deepEqual(saved.blocks[1]?.type === 'gallery' ? saved.blocks[1].props.images.map(image => image.alt) : [], ['يدوي سه', '', ''])
	assert.deepEqual(saved.blocks[2]?.props, reviewed.blocks[2]?.props)
	assert.deepEqual(saved.translation?.fields.filter(field => field.status === 'needs-retranslation').map(field => field.staleValue), ['عربي اول', 'عربي دوم', 'عربي یک', 'عربي دو'])
	const publicDoc = mergeArticleBlocksTranslation(next, saved)
	assert.ok(publicDoc)
	assert.deepEqual(publicDoc.blocks[0]?.type === 'list' ? publicDoc.blocks[0].props.items : [], ['يدوي سوم', 'اول تازه', 'دوم تازه'])
})
test('normalization persists IDs together with the exact source rows and coordinates', () => {
	const next = reorder(source, true)
	assert.deepEqual(normalizeBlocksDoc(next), next)
	const list = next.blocks.find(block => block.type === 'list')
	assert.ok(list?.type === 'list')
	list.props.items.splice(1, 0, '')
	list.props.itemIds?.splice(1, 0, crypto.randomUUID())
	const normalized = normalizeBlocksDoc(next)
	assert.ok(normalized)
	assert.deepEqual(normalized.blocks[0]?.type === 'list' ? normalized.blocks[0].props.itemIds : [], source.blocks[0]?.type === 'list' ? [source.blocks[0].props.itemIds?.[2], source.blocks[0].props.itemIds?.[0], source.blocks[0].props.itemIds?.[1]] : [])
})
test('identity bookkeeping does not lower the existing content limit for legacy list-heavy articles', () => {
	const legacy: ArticleBlocksDoc = { version: 1, blocks: Array.from({ length: 200 }, (_, index) => ({
		id: crypto.randomUUID(), type: 'list', props: { items: Array.from({ length: 30 }, (_, item) => `متن ${index} ${item}`) },
	})) }
	assert.ok(Buffer.byteLength(JSON.stringify(legacy)) < 262144)
	const normalized = normalizeBlocksDoc(legacy)
	assert.ok(normalized)
	assert.equal(normalized.blocks.flatMap(block => getArticleBlockTextFields(block)).length, 6000)
	assert.deepEqual(normalized.blocks.map(block => block.type === 'list' ? block.props.items : []), legacy.blocks.map(block => block.type === 'list' ? block.props.items : []))
})
test('deleted entries remain orphaned and new entries cannot inherit their Arabic or drafts', () => {
	const next = structuredClone(source)
	const list = next.blocks[0]
	assert.ok(list?.type === 'list')
	list.props.items = ['جدید', list.props.items[2] ?? '']
	list.props.itemIds = [crypto.randomUUID(), list.props.itemIds?.[2] ?? '']
	const saved = reconcileArticleBlocksTranslation(source, next, reviewed)
	assert.ok(saved)
	assert.deepEqual(saved.blocks[0]?.type === 'list' ? saved.blocks[0].props.items : [], ['', 'يدوي سوم'])
	assert.deepEqual(saved.translation?.orphanedFields?.filter(field => field.blockId === 'list').map(field => field.staleValue), ['عربي اول', 'عربي دوم'])
})
test('changed legacy arrays without identities are rejected instead of using positional fallback', () => {
	const legacy = structuredClone(source)
	const list = legacy.blocks[0]
	assert.ok(list?.type === 'list')
	delete list.props.itemIds
	assert.equal(validateArticleBlockItemIdentities(legacy, legacy), true)
	const changed = structuredClone(legacy)
	const changedList = changed.blocks[0]
	assert.ok(changedList?.type === 'list')
	changedList.props.items = ['دوم تازه', 'اول تازه', 'سوم']
	assert.equal(validateArticleBlockItemIdentities(legacy, changed), false)
	assert.throws(() => reconcileArticleBlocksTranslation(legacy, changed, reviewed), /stable item identities/)
	const gallery = legacy.blocks[1]
	assert.ok(gallery?.type === 'gallery')
	gallery.props.images = gallery.props.images.map(({ src, alt }) => ({ src, alt }))
	const pgOrdering = structuredClone(legacy)
	const pgGallery = pgOrdering.blocks[1]
	assert.ok(pgGallery?.type === 'gallery')
	pgGallery.props.images = pgGallery.props.images.map(({ src, alt }) => ({ alt, src }))
	assert.equal(validateArticleBlockItemIdentities(legacy, pgOrdering), true, 'JSONB object key order is structural equality, not a source mutation')
})
test('persisted deletion tombstones prevent reuse even when the deleted item has no Arabic', () => {
	const next = structuredClone(source)
	const list = next.blocks[0]
	assert.ok(list?.type === 'list')
	const removedId = list.props.itemIds?.shift()
	list.props.items.shift()
	assert.ok(removedId)
	const saved = reconcileArticleBlocksTranslation(source, next, null)
	assert.ok(saved?.translation?.retiredItemIds?.includes(removedId))
	const replaced = structuredClone(next)
	const replacedList = replaced.blocks[0]
	assert.ok(replacedList?.type === 'list')
	replacedList.props.items.push('متن کاملاً دیگر')
	replacedList.props.itemIds?.push(removedId)
	assert.equal(validateArticleBlockItemIdentities(next, replaced, saved), false)
	assert.throws(() => reconcileArticleBlocksTranslation(next, replaced, saved), /stable item identities/)
})
test('duplicate item identities and cross-block ID reuse cannot be saved', () => {
	const invalid = structuredClone(source)
	const list = invalid.blocks[0]
	assert.ok(list?.type === 'list')
	list.props.itemIds = [list.props.itemIds?.[0] ?? '', list.props.itemIds?.[0] ?? '', list.props.itemIds?.[2] ?? '']
	assert.equal(validateArticleBlockItemIdentities(source, invalid), false)
	const sourceList = source.blocks[0]
	assert.ok(sourceList?.type === 'list')
	const duplicated: ArticleBlocksDoc = { ...source, blocks: [sourceList, { ...structuredClone(sourceList), id: 'new-list' }, ...source.blocks.slice(1)] }
	assert.equal(validateArticleBlockItemIdentities(source, duplicated), false, 'a copied block must not reuse the original child IDs')
	const copied = duplicated.blocks[1]
	assert.ok(copied?.type === 'list')
	copied.props.itemIds = copied.props.items.map(() => crypto.randomUUID())
	assert.equal(validateArticleBlockItemIdentities(source, duplicated), true)
	const copy = duplicated.blocks[1]
	assert.ok(copy?.type === 'list')
	assert.ok(copy.props.itemIds?.every(id => !list.props.itemIds?.includes(id)))
	const saved = reconcileArticleBlocksTranslation(source, duplicated, reviewed)
	assert.ok(saved)
	assert.deepEqual(saved.blocks[1]?.type === 'list' ? saved.blocks[1].props.items : [], ['', '', ''])
})
test('save reload and retranslation fill exactly changed item paths without resending siblings', () => {
	const next = reorder(source, true)
	const saved = reconcileArticleBlocksTranslation(source, next, reviewed)
	assert.ok(saved)
	const reload = normalizeArticleBlocksTranslation(next, JSON.parse(JSON.stringify(saved)))
	assert.ok(reload)
	const calls: string[] = []
	const updates = next.blocks.flatMap(block => getArticleBlockTextFields(block).flatMap(field => {
		const state = reload.translation?.fields.find(proof => proof.blockId === block.id && proof.itemId === field.itemId && JSON.stringify(proof.fieldPath) === JSON.stringify(field.path))
		if (state?.status !== 'needs-retranslation' || state.origin !== 'automatic') return []
		calls.push(field.text)
		return [{ blockId: block.id, path: field.path, text: `جديد ${field.text}` }]
	}))
	assert.deepEqual(calls, ['اول تازه', 'دوم تازه', 'یک تازه', 'دو تازه'])
	const result = setArticleBlockTranslations(next, reload, updates, 'automatic')
	assert.ok(result)
	assert.equal(readArticleBlockText(result.blocks[0], ['items', 0]), 'يدوي سوم')
	assert.equal(readArticleBlockText(result.blocks[0], ['items', 1]), 'جديد اول تازه')
	assert.deepEqual(result.blocks[2]?.props, reviewed.blocks[2]?.props)
})
console.log(`Block item identity regressions: ${checks} passed`)
