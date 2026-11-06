import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { TranslationEdit } from '@sinshin/shared'
import type { ProductFormData } from '../src/types/forms'

const calls: { path: string; method: string; body?: Record<string, unknown> }[] = []
let requestError: Error | undefined
function popBody() {
	const call = calls.pop()
	assert(call, 'Expected a captured API request')
	assert(call.body, 'Expected a request payload')
	return call.body
}
mock.module('#/lib/api-fetch', () => ({
	authJson: async (path: string, method: string, body?: Record<string, unknown>) => { calls.push({ path, method, body }); if (requestError) throw requestError; return { success: true, version: 2 } },
	getJson: async () => null, postJson: async () => null,
}))
const proof: TranslationEdit = { fieldId: 'description', fieldPath: ['description'], sourceText: 'متن دقیق', value: 'نص دقيق', revision: 4, origin: 'manual' }
const revision = 'validated-persisted-source'
const { getAdminCategories, updateAdminProduct, updateCategory, updateMainCategory, updatePackagingItem, toggleMainCategory, setDefaultMainCategory,
	reorderMainCategory, toggleProductStatus, setMainPurchaseState, setCategoryPurchaseState, setProductAvailability, createMainCategory } = await import('../src/server/products')
const { createTerms, getAdminTerms, updateTerms } = await import('../src/server/terms')
const { updateGalleryImage, reorderGalleryImage } = await import('../src/server/gallery')
const { updateArticle, updateArticleCategory, toggleArticleStatus } = await import('../src/server/articles')
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

const revisions = { 'entity-one': revision, 'entity-two': 'second-saved-token' }
for (const action of [
	() => toggleMainCategory({ data: { id: 'entity-one', sourceRevision: revision } }),
	() => toggleProductStatus({ data: { id: 'entity-one', sourceRevision: revision } }),
	() => setMainPurchaseState({ data: { id: 'entity-one', purchaseEnabled: false, sourceRevision: revision } }),
	() => setCategoryPurchaseState({ data: { id: 'entity-one', purchaseEnabled: true, sourceRevision: revision } }),
	() => setProductAvailability({ data: { id: 'entity-one', available: false, sourceRevision: revision } }),
	() => toggleArticleStatus('entity-one', revision),
	() => updateGalleryImage({ id: 'entity-one', isActive: false, sourceRevision: revision }),
	() => updatePackagingItem({ id: 'entity-one', data: { price: 50, sourceRevision: revision } }),
]) { await action(); assert.equal(popBody().sourceRevision, revision, 'metadata-only mutations carry the exact saved token too') }
for (const action of [
	() => setDefaultMainCategory({ data: { id: 'entity-one', sourceRevisions: revisions } }),
	() => reorderMainCategory({ data: { id: 'entity-one', direction: 'up', sourceRevisions: revisions } }),
	() => reorderGalleryImage({ id: 'entity-one', direction: 'down', sourceRevisions: revisions }),
]) { await action(); assert.deepEqual(popBody().sourceRevisions, revisions, 'multi-row updates carry source proofs for each affected row') }

const updatesWithoutProof = [
	() => updateMainCategory({ data: { id: 'main', name: 'نام' } }),
	() => updateCategory({ data: { id: 'category', name: 'نام', mainCategoryIds: ['main'] } }),
	() => updateAdminProduct({ data: { id: 'product', sizes: [] } as unknown as ProductFormData & { id: string } }),
	() => updateAdminProduct({ data: { id: 'product', sourceRevision: revision, sizes: [{ id: 'saved-size' }] } as unknown as ProductFormData & { id: string } }),
	() => updatePackagingItem({ id: 'item', data: { price: 100 } }),
	() => updateGalleryImage({ id: 'image', isActive: false }),
	() => updateArticle({ id: 'article', title: 'عنوان', excerpt: 'خلاصه', content: 'متن', categoryId: 'category' }),
	() => updateArticleCategory({ id: 'category', name: 'نام', hasSubCategories: false, subCategories: [] }),
	() => updateArticleCategory({ id: 'category', sourceRevision: revision, name: 'نام', hasSubCategories: true, subCategories: ['فرعی'], subCategoryEntries: [{ id: 'saved-sub', name: 'فرعی' }] }),
	() => updateTerms({ sections: [] }),
	() => updateAboutContent({} as Parameters<typeof updateAboutContent>[0]),
	() => setTemporaryClose({ data: { closed: false, reason: 'علت' } }),
	() => toggleMainCategory({ data: { id: 'main' } }),
	() => toggleProductStatus({ data: { id: 'product' } }),
	() => setMainPurchaseState({ data: { id: 'main', purchaseEnabled: false } }),
	() => setCategoryPurchaseState({ data: { id: 'category', purchaseEnabled: false } }),
	() => setProductAvailability({ data: { id: 'product', available: false } }),
	() => toggleArticleStatus('article'),
	() => setDefaultMainCategory({ data: { id: 'main' } }),
	() => reorderMainCategory({ data: { id: 'main', direction: 'up', sourceRevisions: {} } }),
	() => reorderGalleryImage({ id: 'image', direction: 'down' }),
]
const beforeMissingProof = calls.length
for (const action of updatesWithoutProof) await assert.rejects(action, error => error instanceof Error
	&& 'status' in error && error.status === 409 && /پیش‌نویس/.test(error.message))
assert.equal(calls.length, beforeMissingProof, 'missing saved revisions are rejected before sending any mutation')
await createMainCategory({ data: { name: 'تازه', slug: 'new-main' } })
assert.equal(popBody().sourceRevision, undefined, 'creation does not require an existing-record revision')
await updatePackagingItem({ id: 'packaging-one', data: { title: 'جعبه', titleAr: 'صندوق', sourceRevision: revision, translationEdits: [proof] } })
assert.deepEqual(popBody().translationEdits, [proof])

await updateTerms({ sections: [{ title: 'قوانین', items: ['بند اول', 'بند دوم'] }], sectionsAr: [{ title: '', items: ['', 'بند عربي'] }], sourceRevision: revision, translationEdits: [proof] })
assert.deepEqual(popBody(), { sections: [{ title: 'قوانین', items: ['بند اول', 'بند دوم'] }], sectionsAr: [{ title: '', items: ['', 'بند عربي'] }], sourceRevision: revision, translationEdits: [proof] }, 'terms serialization preserves every empty nested slot and its explicit edit proof')
const firstTerms = { sections: [{ title: 'قوانین تازه', items: ['بند تازه'] }], sectionsAr: [{ title: ' قواعد ', items: [' بند جديد '] }],
	translationIdentities: [{ collectionPath: ['sections'], itemIds: ['sections:first'] }, { collectionPath: ['sections', 0, 'items'], itemIds: ['sections:first:items:first'] }], translationEdits: [proof] }
await createTerms(firstTerms)
assert.deepEqual(popBody(), { ...firstTerms, sectionsAr: [{ title: 'قواعد', items: ['بند جديد'] }] }, 'explicit first creation retains identities and manual proofs without inventing a saved revision')
requestError = Object.assign(new Error('Reload the existing saved Terms'), { status: 409 })
await assert.rejects(() => createTerms(firstTerms), requestError)
assert.equal(popBody().sourceRevision, undefined, 'a concurrent first-create conflict propagates instead of becoming an unguarded update')
requestError = undefined
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
