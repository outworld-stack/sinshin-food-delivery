import assert from 'node:assert/strict'
import {
	fillMissingArticleBlocksTranslation, getArticleBlockTextFields,
	mergeArticleBlocksTranslation, normalizeArticleBlocksTranslation,
	setArticleBlockText, type ArticleBlocksDoc,
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
console.log('Block translation regressions passed: every block type, exact structure, fallback, stable IDs, nested text, multiple precise locations, manual protection and source immutability.')
