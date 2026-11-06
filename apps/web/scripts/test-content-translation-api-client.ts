import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { TranslationEdit } from '@sinshin/shared'
import type { ProductFormData } from '../src/types/forms'

const calls: { path: string; method: string; body?: Record<string, unknown> }[] = []
function popBody() {
	const call = calls.pop()
	assert(call, 'Expected a captured API request')
	assert(call.body, 'Expected a request payload')
	return call.body
}
mock.module('#/lib/api-fetch', () => ({
	authJson: async (path: string, method: string, body?: Record<string, unknown>) => { calls.push({ path, method, body }); return { success: true, version: 2 } },
	getJson: async () => null, postJson: async () => null,
}))
const proof: TranslationEdit = { fieldId: 'description', fieldPath: ['description'], sourceText: 'متن دقیق', value: 'نص دقيق', revision: 4, origin: 'manual' }
const revision = 'validated-persisted-source'
const { getAdminCategories, updateAdminProduct, updateCategory, updateMainCategory, updatePackagingItem } = await import('../src/server/products')
const { getAdminTerms, updateTerms } = await import('../src/server/terms')
const { updateGalleryImage } = await import('../src/server/gallery')
const { updateArticle, updateArticleCategory } = await import('../src/server/articles')
const { updateAboutContent } = await import('../src/server/about')
const { setTemporaryClose } = await import('../src/server/admin')
const { translateContentField, translateArticleBlockField } = await import('../src/server/translation')

await getAdminCategories(); await getAdminTerms()
assert.deepEqual(calls.splice(0), [{ path: '/admin/menu/categories', method: 'GET', body: undefined }, { path: '/admin/terms', method: 'GET', body: undefined }], 'editors fetch raw source/provenance separately from localized public responses')
await updateAdminProduct({ data: {
	id: 'product-one', name: 'غذا', description: 'متن دقیق', nameAr: 'طعام', descriptionAr: 'نص دقيق', sourceRevision: revision, translationEdits: [proof],
	ingredients: ['اول', 'دوم', 'سوم'], ingredientsArText: '\nثاني\n',
	sizes: [
		{ id: 'size-one', name: 'بزرگ', nameAr: 'كبير', price: 100, image: '/image.png', discountPercentage: 0, discountStartsAt: null, discountEndsAt: null, sourceRevision: 'size-proof', translationEdits: [{ ...proof, fieldId: 'name', fieldPath: ['name'], sourceText: 'بزرگ', value: 'كبير' }] },
		{ draftId: 'new-size-draft', name: 'متوسط', nameAr: 'متوسط', price: 90, image: '/new-image.png', discountPercentage: 0, discountStartsAt: null, discountEndsAt: null },
	],
} as ProductFormData & { id: string } })
const product = popBody()
assert.deepEqual(product.ingredientsAr, ['', 'ثاني', ''], 'blank Arabic ingredients retain source alignment')
assert.equal(product.sourceRevision, revision)
assert.deepEqual(product.translationEdits, [proof])
const size = (product.sizes as Record<string, unknown>[])[0]
assert.equal(size.id, 'size-one'); assert.equal(size.sourceRevision, 'size-proof'); assert.equal(size.image, '/image.png')
assert.equal((size.translationEdits as TranslationEdit[])[0].fieldId, 'name')
const newSize = (product.sizes as Record<string, unknown>[])[1]
assert.equal(newSize.id, undefined, 'new sizes do not claim a persisted ID that the update API would reject')
assert.equal('draftId' in newSize, false, 'local size identities stay inside the editor')
assert.equal(newSize.nameAr, 'متوسط', 'new size Arabic text survives serialization alongside existing size proofs')

await updateCategory({ data: { id: 'category-one', name: 'دسته', mainCategoryIds: ['main-one'], nameAr: 'فئة', sizeNames: ['کوچک', 'بزرگ'], sizeNamesAr: ['', 'كبير'], sourceRevision: revision, translationEdits: [proof] } })
assert.deepEqual(popBody(), { name: 'دسته', mainCategoryIds: ['main-one'], nameAr: 'فئة', sizeNames: ['کوچک', 'بزرگ'], sizeNamesAr: ['', 'كبير'], sourceRevision: revision, translationEdits: [proof], courierEnabled: true, takeawayEnabled: true, dineInEnabled: true })
await updateMainCategory({ data: { id: 'main-one', name: 'رستوران', nameAr: 'مطعم', sourceRevision: revision, translationEdits: [proof] } })
assert.equal(popBody().sourceRevision, revision)
await updatePackagingItem({ id: 'packaging-one', data: { title: 'جعبه', titleAr: 'صندوق', sourceRevision: revision, translationEdits: [proof] } })
assert.deepEqual(popBody().translationEdits, [proof])

await updateTerms({ sections: [{ title: 'قوانین', items: ['بند اول', 'بند دوم'] }], sectionsAr: [{ title: '', items: ['', 'بند عربي'] }], sourceRevision: revision, translationEdits: [proof] })
assert.deepEqual(popBody(), { sections: [{ title: 'قوانین', items: ['بند اول', 'بند دوم'] }], sectionsAr: [{ title: '', items: ['', 'بند عربي'] }], sourceRevision: revision, translationEdits: [proof] }, 'terms serialization preserves every empty nested slot and its explicit edit proof')
await updateGalleryImage({ id: 'gallery-one', alt: 'عکس', altAr: 'صورة', src: '/photo.png', sourceRevision: revision, translationEdits: [proof] })
assert.deepEqual(popBody().translationEdits, [proof])
await updateArticle({ id: 'article-one', title: 'عنوان', excerpt: 'خلاصه', content: 'متن', categoryId: 'category', sourceRevision: revision, translationEdits: [proof] })
assert.deepEqual(popBody().translationEdits, [proof])
await updateArticleCategory({ id: 'category-one', name: 'مقاله', hasSubCategories: true, subCategories: ['فرعی'], sourceRevision: revision, translationEdits: [proof],
	subCategoryEntries: [{ id: 'stable-sub-one', name: 'فرعی', nameAr: 'فرعي', sourceRevision: 'sub-revision', translationEdits: [proof] }] })
const articleCategory = popBody()
assert.equal((articleCategory.subCategoryEntries as Record<string, unknown>[])[0].id, 'stable-sub-one')
assert.equal((articleCategory.subCategoryEntries as Record<string, unknown>[])[0].sourceRevision, 'sub-revision')
await updateAboutContent({ heroTitle: 'عنوان', heroText: 'داستان', teamTitle: 'تیم', teamAlt: 'عکس', heroGradient: '', teamGradient: '',
	heroTitleAr: '', heroTextAr: '', teamTitleAr: '', teamAltAr: '', location: { lat: 37.123456789012, lng: 49.987654321098, address: 'آدرس', addressAr: 'عنوان' },
	sourceRevision: revision, translationEdits: [proof] })
const about = popBody()
assert.deepEqual(about.translationEdits, [proof]); assert.equal((about.location as { lat: number }).lat, 37.123456789012)
await setTemporaryClose({ data: { closed: true, reason: 'علت تعطیلی', reasonAr: 'سبب الإغلاق', sourceRevision: revision, translationEdits: [proof] } })
assert.equal(popBody().sourceRevision, revision)

const field = { entityType: 'product' as const, entityId: 'product-one', fieldId: 'description', fieldPath: ['description'], sourceText: 'متن دقیق', revision: 4 }
await translateContentField(field)
assert.deepEqual(calls.pop(), { path: '/admin/translate/field', method: 'POST', body: field }, 'one-field requests include only identity and current Persian text')
const blockField = { entityType: 'about' as const, entityId: '1', revision: 3, blockId: 'heading-one', blockType: 'heading' as const, fieldPath: ['text'], text: 'عنوان' }
await translateArticleBlockField(blockField)
assert.deepEqual(calls.pop(), { path: '/admin/translate/block-field', method: 'POST', body: blockField }, 'stored block previews send the exact field proof without sending a document')
console.log('PASS translation API clients: raw admin reads, explicit proof/revision forwarding, stable size/subcategory IDs, nested Arabic placeholders, exact coordinates and minimal field requests')
