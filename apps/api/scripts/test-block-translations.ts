import assert from 'node:assert/strict'
import {
	fillMissingArticleBlocksTranslation, getArticleBlockTextFields,
	mergeArticleBlocksTranslation, normalizeArticleBlocksTranslation,
	setArticleBlockText, type ArticleBlocksDoc,
	getChangedArticleBlockTextFields, getArticleBlockTranslationStatus, isArticleBlockTextPath,
	reconcileArticleBlocksTranslation, setArticleBlockTranslation, setArticleBlockTranslations,
	createArticleBlockTranslationStatusReader,
} from '@sinshin/shared'
import { normalizeBlocksDoc } from '../src/domain/article/blocks-normalize'

const source: ArticleBlocksDoc = {
	version: 1,
	blocks: [
		{ id: 'hero', type: 'hero', props: { src: '/hero.webp', title: 'سرآغاز', text: 'خوش آمدید' } },
		{ id: 'heading', type: 'heading', props: { text: 'بخش اول', level: 3 } },
		{ id: 'paragraph', type: 'paragraph', props: { text: 'متن فارسی' } },
		{ id: 'image', type: 'image', props: { src: 'https://example.com/photo.webp', alt: 'تصویر', caption: 'شرح تصویر' } },
		{ id: 'gallery', type: 'gallery', props: { layout: 'slider', images: [{ src: '/a.webp', alt: 'اول' }, { src: '/b.webp', alt: 'دوم' }] } },
		{ id: 'quote', type: 'quote', props: { text: 'نقل قول', author: 'نویسنده' } },
		{ id: 'callout', type: 'callout', props: { title: 'نکته', text: 'توضیح' } },
		{ id: 'list', type: 'list', props: { ordered: true, items: ['اول', 'دوم', 'سوم'] } },
		{ id: 'cta', type: 'cta', props: { title: 'سفارش', text: 'همین حالا', label: 'منو', to: 'url', href: '/products?x=fa#menu' } },
		{ id: 'link', type: 'link', props: { title: 'مطالعه', text: 'مقاله دیگر', label: 'پیوند', href: 'https://example.com/article', variant: 'card' } },
		{ id: 'location-a', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, title: 'رستوران', address: 'آدرس اول' } },
		{ id: 'location-b', type: 'location', props: { lat: -12.987654321, lng: 0, title: 'شعبه', address: 'آدرس دوم' } },
		{ id: 'location-c', type: 'location', props: { lat: 0, lng: 180 } },
		{ id: 'divider', type: 'divider', props: { variant: 'dots' } },
	].map((block, i) => ({
		...block, width: (['sm', 'md', 'lg', 'full'] as const)[i % 4],
		anim: (['none', 'fade', 'fade-up', 'slide', 'zoom', 'blur'] as const)[i % 6],
		style: { bg: '#123456', fg: '#FEDCBA', align: 'center', pad: 'lg' },
	})) as ArticleBlocksDoc['blocks'],
}
const arabicProps: Record<string, Record<string, unknown>> = {
	hero: { title: 'البداية', text: 'أهلاً' },
	heading: { text: 'القسم الأول' }, paragraph: { text: 'نص عربي' },
	image: { alt: 'صورة', caption: 'وصف الصورة' },
	gallery: { images: [{ alt: 'الأولى' }, { alt: 'الثانية' }] },
	quote: { text: 'اقتباس', author: 'الكاتب' }, callout: { title: 'ملاحظة', text: 'توضيح' },
	list: { items: ['الأول', 'الثاني', 'الثالث'] },
	cta: { title: 'اطلب', text: 'الآن', label: 'القائمة' },
	link: { title: 'اقرأ', text: 'مقال آخر', label: 'رابط' },
	'location-a': { title: 'المطعم', address: 'العنوان الأول' },
	'location-b': { title: 'الفرع', address: 'العنوان الثاني' },
	'location-c': {}, divider: {},
}
const snapshot = structuredClone(source)
const malicious = {
	version: 1,
	blocks: source.blocks.toReversed().map(block => ({
		id: block.id, type: block.type, width: 'full', anim: 'none', style: { bg: '#000000' },
		props: {
			...arabicProps[block.id], lat: 90, lng: -180, src: 'https://attacker.test/image',
			href: 'javascript:alert(1)', level: 2, variant: 'line', layout: 'grid', ordered: false,
			...(block.type === 'gallery' ? { images: [{ src: '/changed.webp', alt: 'الأولى' }, { src: '/changed2.webp', alt: 'الثانية' }, { src: '/extra.webp', alt: 'إضافة' }] } : {}),
		},
	})),
}
const expected: ArticleBlocksDoc = {
	...source,
	blocks: source.blocks.map(block => ({
		...block,
		props: block.type === 'gallery'
			? { ...block.props, images: block.props.images.map((im, i) => ({ ...im, alt: ['الأولى', 'الثانية'][i] })) }
			: { ...block.props, ...arabicProps[block.id] },
	})) as ArticleBlocksDoc['blocks'],
}
assert.deepEqual(mergeArticleBlocksTranslation(source, malicious), expected,
	'all block types translate only textual properties and retain source IDs/order/structure')
assert.deepEqual(source, snapshot, 'translation never mutates Persian source')
assert.deepEqual(mergeArticleBlocksTranslation(source, null), source, 'untranslated Arabic retains the entire Persian document')
assert.deepEqual(mergeArticleBlocksTranslation(source, { version: 2, blocks: [] }), source, 'unsupported translation version retains Persian fallback')
assert.equal(mergeArticleBlocksTranslation(null, malicious), null)
assert.deepEqual(normalizeBlocksDoc({ version: 1, blocks: source.blocks.filter(b => b.type === 'location') })?.blocks.map(b => b.props),
	source.blocks.filter(b => b.type === 'location').map(b => b.props), 'normalization preserves multiple exact coordinates, zero and boundary values')

const partial = { version: 1, blocks: [
	{ id: 'list', type: 'list', props: { items: ['الأول', '', 'الثالث', 'ignored extra'] } },
	{ id: 'gallery', type: 'gallery', props: { images: [{ alt: '' }, { alt: 'الثانية' }] } },
	{ id: 'location-b', type: 'location', props: { title: 'الفرع', address: '  ' } },
	{ id: 'location-a', type: 'location', props: { address: 'العنوان الأول' } },
	{ id: 'heading', type: 'paragraph', props: { text: 'Wrong block type' } },
] }
const fallback = mergeArticleBlocksTranslation(source, partial)!
assert.deepEqual(fallback.blocks.find(b => b.type === 'list')?.props, { ordered: true, items: ['الأول', 'دوم', 'الثالث'] })
assert.deepEqual(fallback.blocks.find(b => b.type === 'gallery')?.props,
	{ layout: 'slider', images: [{ src: '/a.webp', alt: 'اول' }, { src: '/b.webp', alt: 'الثانية' }] })
assert.deepEqual(fallback.blocks.filter(b => b.type === 'location').map(b => b.props), [
	{ lat: 37.4822056789, lng: 49.4418273456, title: 'رستوران', address: 'العنوان الأول' },
	{ lat: -12.987654321, lng: 0, title: 'الفرع', address: 'آدرس دوم' },
	{ lat: 0, lng: 180 },
])
assert.deepEqual(fallback.blocks.find(b => b.id === 'heading')?.props, source.blocks[1]!.props, 'wrong type cannot attach text to a reused ID')

let current = normalizeArticleBlocksTranslation(source, partial)!
assert.equal((current.blocks.find(b => b.id === 'paragraph')?.props as {text: string}).text, '', 'storage keeps untranslated text empty instead of copying Persian')
current = setArticleBlockText(current, 'location-a', ['title'], 'عنوان يدوي')
const filled = fillMissingArticleBlocksTranslation(source, current, malicious)!
assert.deepEqual(filled.blocks.find(b => b.id === 'location-a')?.props,
	{ lat: 37.4822056789, lng: 49.4418273456, title: 'عنوان يدوي', address: 'العنوان الأول' }, 'manual Arabic wins while missing fields are filled')
assert.deepEqual(setArticleBlockText(filled, 'location-a', ['lat'], '55'), filled, 'manual text setter refuses coordinate paths')
assert.deepEqual(setArticleBlockText(filled, 'cta', ['href'], '/changed'), filled, 'manual text setter refuses link paths')
assert.equal(getArticleBlockTextFields(source.blocks.find(b => b.id === 'location-c')!).length, 2, 'admins can translate absent optional title and address')
assert.equal(getArticleBlockTextFields(source.blocks.find(b => b.id === 'divider')!).length, 0)
const reordered = { ...source, blocks: source.blocks.toReversed().filter(b => b.id !== 'location-b') }
assert.deepEqual(fillMissingArticleBlocksTranslation(reordered, filled, malicious)?.blocks.map(b => b.id), reordered.blocks.map(b => b.id), 'source additions/deletions/reordering govern translation structure')
assert.deepEqual(source, snapshot)
const reviewed = setArticleBlockTranslations(source, expected, [
	{ blockId: 'heading', path: ['text'], text: 'عنوان يدوي' },
	{ blockId: 'location-a', path: ['address'], text: 'عنوان موقع يدوي' },
	{ blockId: 'image', path: ['caption'], text: 'تعليق يدوي' },
])!
const newHeading = setArticleBlockText(source, 'heading', ['text'], 'تیتر تغییر کرده')
assert.deepEqual(getChangedArticleBlockTextFields(source, newHeading), [
	{ blockId: 'heading', blockType: 'heading', fieldPath: ['text'], previousText: 'بخش اول', text: 'تیتر تغییر کرده' },
])
const invalidated = reconcileArticleBlocksTranslation(source, newHeading, reviewed, reviewed)!
assert.equal((invalidated.blocks.find(b => b.id === 'heading')?.props as { text: string }).text, '')
assert.equal(getArticleBlockTranslationStatus(newHeading, invalidated, 'heading', ['text']), 'needs-retranslation')
for (const block of invalidated.blocks.filter(b => b.id !== 'heading')) {
	assert.deepEqual(block.props, reviewed.blocks.find(b => b.id === block.id)!.props, `a heading edit preserves reviewed ${block.id} fields`)
}
const freshHeading = setArticleBlockTranslation(newHeading, invalidated, 'heading', ['text'], 'العنوان الجديد')!
assert.equal(getArticleBlockTranslationStatus(newHeading, freshHeading, 'heading', ['text']), 'translated')
assert.equal((reconcileArticleBlocksTranslation(source, newHeading, reviewed, freshHeading)!.blocks.find(b => b.id === 'heading')?.props as { text: string }).text, 'العنوان الجديد', 'fresh matching source proof is accepted on the same save as the Persian edit')
assert.equal((reconcileArticleBlocksTranslation(newHeading, newHeading, freshHeading, reviewed)!.blocks.find(b => b.id === 'heading')?.props as { text: string }).text, 'العنوان الجديد', 'old proof cannot overwrite a newer translation')
const oldNoProof = { version: 1, blocks: [{ id: 'heading', type: 'heading', props: { text: '' } }] }
assert.equal((reconcileArticleBlocksTranslation(newHeading, newHeading, freshHeading, oldNoProof)!.blocks.find(b => b.id === 'heading')?.props as { text: string }).text, 'العنوان الجديد', 'an unproved stale blank cannot erase a reviewed field')
assert.equal((mergeArticleBlocksTranslation(newHeading, reviewed)!.blocks.find(b => b.id === 'heading')?.props as { text: string }).text, 'تیتر تغییر کرده', 'public rendering independently rejects stale provenance and falls back')
const addressChanged = setArticleBlockText(source, 'location-a', ['address'], 'آدرس تازه')
const addressArabic = reconcileArticleBlocksTranslation(source, addressChanged, reviewed, reviewed)!
assert.deepEqual(addressArabic.blocks.find(b => b.id === 'location-a')?.props,
	{ lat: 37.4822056789, lng: 49.4418273456, title: 'المطعم', address: '' }, 'changing an address clears only address text and preserves exact coordinates and title')
const legacyReviewed = structuredClone(reviewed)
delete legacyReviewed.translation
const legacyOutdated = setArticleBlockText(legacyReviewed, 'location-a', ['title'], 'عنوان قديم غير مراجع')
const legacyBlank = setArticleBlockText(legacyOutdated, 'image', ['caption'], '')
const legacyPreserved = reconcileArticleBlocksTranslation(source, newHeading, legacyReviewed, legacyBlank)!
assert.equal(getArticleBlockTextFields(legacyPreserved.blocks.find(b => b.id === 'heading')!)[0]!.text, '')
assert.equal((legacyPreserved.blocks.find(b => b.id === 'location-a')?.props as {title: string}).title, 'المطعم', 'unproved legacy payload cannot replace an unaffected reviewed field')
assert.equal((legacyPreserved.blocks.find(b => b.id === 'image')?.props as {caption: string}).caption, 'تعليق يدوي', 'unproved legacy payload cannot erase an unaffected reviewed field')
const deliberateLegacyEdit = setArticleBlockTranslation(newHeading, legacyPreserved, 'image', ['caption'], '')!
assert.equal((reconcileArticleBlocksTranslation(newHeading, newHeading, legacyPreserved, deliberateLegacyEdit)!.blocks.find(b => b.id === 'image')?.props as {caption: string}).caption, '', 'legacy fields remain manually clearable with current source proof')
const structuralOnly = structuredClone(source)
structuralOnly.blocks.reverse()
for (const block of structuralOnly.blocks) {
	block.width = 'full'; block.anim = 'none'; block.style = { bg: '#000000', fg: '#ffffff', align: 'start', pad: 'sm' }
	if (block.type === 'location') { block.props.lat = 35.123456789; block.props.lng = 52.987654321 }
	if (block.type === 'image' || block.type === 'hero') block.props.src = '/new-image.webp'
	if (block.type === 'link' || block.type === 'cta') block.props.href = '/new-link'
	if (block.type === 'gallery') block.props.images[0]!.src = '/new-gallery.webp'
}
assert.deepEqual(getChangedArticleBlockTextFields(source, structuralOnly), [], 'structure and order never count as text changes')
const structuralArabic = reconcileArticleBlocksTranslation(source, structuralOnly, reviewed, reviewed)!
assert.deepEqual(structuralArabic.blocks.map(b => b.id), structuralOnly.blocks.map(b => b.id))
for (const block of structuralArabic.blocks) {
	for (const field of getArticleBlockTextFields(block)) {
		assert.equal(field.text, getArticleBlockTextFields(reviewed.blocks.find(b => b.id === block.id)!).find(f => JSON.stringify(f.path) === JSON.stringify(field.path))!.text)
	}
}
const listChanged = setArticleBlockText(source, 'list', ['items', 1], 'مورد تغییر کرده')
assert.deepEqual((reconcileArticleBlocksTranslation(source, listChanged, reviewed, reviewed)!.blocks.find(b => b.id === 'list')?.props as {items: string[]}).items,
	['الأول', '', 'الثالث'], 'nested list paths invalidate only the changed entry')
const galleryChanged = setArticleBlockText(source, 'gallery', ['images', 1, 'alt'], 'شرح تازه')
const galleryArabic = reconcileArticleBlocksTranslation(source, galleryChanged, reviewed, reviewed)!.blocks.find(b => b.id === 'gallery')!
assert.equal(galleryArabic.type, 'gallery')
assert.deepEqual(galleryArabic.props.images, [{ src: '/a.webp', alt: 'الأولى' }, { src: '/b.webp', alt: '' }])
const duplicate = { ...source, blocks: [...source.blocks, { ...structuredClone(source.blocks[1]!), id: 'heading-copy' }] }
const copiedArabic = { ...reviewed, blocks: [...reviewed.blocks, { ...structuredClone(reviewed.blocks.find(b => b.id === 'heading')!), id: 'heading-copy' }] }
const duplicateArabic = reconcileArticleBlocksTranslation(source, duplicate, reviewed, copiedArabic)!
assert.equal((duplicateArabic.blocks.find(b => b.id === 'heading')?.props as {text: string}).text, 'عنوان يدوي')
assert.equal((duplicateArabic.blocks.find(b => b.id === 'heading-copy')?.props as {text: string}).text, '', 'a fresh duplicate ID cannot inherit another block translation or proof')
assert.equal(getArticleBlockTranslationStatus(duplicate, duplicateArabic, 'heading-copy', ['text']), 'missing')
const swappedType = { ...source, blocks: source.blocks.map(b => b.id === 'heading' ? { id: b.id, type: 'paragraph' as const, props: { text: 'بخش اول' } } : b) }
assert.equal((reconcileArticleBlocksTranslation(source, swappedType, reviewed, reviewed)!.blocks.find(b => b.id === 'heading')?.props as {text: string}).text, '', 'same ID/path with another type cannot reuse translation')
assert.equal(isArticleBlockTextPath('location', ['lat']), false)
assert.equal(isArticleBlockTextPath('cta', ['href']), false)
assert.equal(isArticleBlockTextPath('list', ['items', '1']), false)
assert.equal(isArticleBlockTextPath('gallery', ['images', 12, 'alt']), false)
assert.equal(isArticleBlockTextPath('__proto__' as never, ['text']), false)
assert.equal(isArticleBlockTextPath('paragraph', ['__proto__']), false)
assert.equal(isArticleBlockTextPath('gallery', ['images', 1, 'alt']), true)
assert(!mergeArticleBlocksTranslation(source, reviewed)!.translation, 'provenance is never added to the public source-shaped document')
const batchStatus = createArticleBlockTranslationStatusReader(newHeading, invalidated)
for (const block of newHeading.blocks) for (const field of getArticleBlockTextFields(block)) {
	assert.equal(batchStatus(block.id, field.path), getArticleBlockTranslationStatus(newHeading, invalidated, block.id, field.path), 'batch lookup preserves field-level statuses and source proof')
}
assert.equal(batchStatus('location-a', ['lat']), 'missing', 'status lookup rejects nontextual paths')
assert.equal(batchStatus('missing-id', ['text']), 'missing', 'status lookup rejects unknown block identities')
const maxFields: ArticleBlocksDoc = { version: 1, blocks: Array.from({ length: 200 }, (_, index) => ({
	id: `list-${index}`, type: 'list', props: { items: Array.from({ length: 30 }, (_, item) => `متن ${index} ${item}`) },
})) }
const maxArabic = setArticleBlockTranslations(maxFields, null, maxFields.blocks.flatMap(block =>
	getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: `عربي ${field.text}` }))))!
const maxStatus = createArticleBlockTranslationStatusReader(maxFields, maxArabic)
assert.equal(maxFields.blocks.flatMap(block => getArticleBlockTextFields(block).filter(field => maxStatus(block.id, field.path) === 'translated')).length, 6000, 'maximum list-heavy documents expose every field status with a single lookup index')
const olderPartialSource = structuredClone(source)
olderPartialSource.blocks.unshift(null as never)
const olderPartialNext = setArticleBlockText(olderPartialSource, 'heading', ['text'], 'تیتر سند قدیمی')
const olderPartialArabic = reconcileArticleBlocksTranslation(olderPartialSource, olderPartialNext, expected, expected)!
assert.equal(olderPartialArabic.blocks[0], null, 'translation reconciliation retains older partial source structures')
assert.equal(getArticleBlockTranslationStatus(olderPartialNext, olderPartialArabic, 'heading', ['text']), 'needs-retranslation', 'older partial documents remain field-translatable without rebuilding')
assert.deepEqual(source, snapshot)
console.log('Block translation regressions passed: every block type, exact structure, fallback, stable IDs, nested text, multiple precise locations, manual protection and source immutability.')
