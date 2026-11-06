import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { collectionTranslationIdentities, contentSourceRevision, contentTranslationFields, matchesContentSourceRevision, reconcileContentTranslation, type ContentEntityType } from '@sinshin/shared'
import { moveCollectionIdentity, appendCollectionIdentity } from '../src/utils/contentTranslationDraft'

function required<T>(value: T | null | undefined): T {
	assert(value != null, 'Expected a required translation fixture value')
	return value
}

// Real hook state; the only translator boundary is a deterministic, unpaid mock.
const react = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number; cleanups: (() => void)[] }
const fresh = (): Host => ({ cells: [], cursor: 0, cleanups: [] })
let host = fresh()
mock.module('react', () => ({ ...react,
	useCallback: (callback: unknown) => callback,
	useRef<T>(initial: T) { const index = host.cursor++; if (!(index in host.cells)) host.cells[index] = { current: initial }; return host.cells[index] },
	useState<T>(initial: T) { const active = host; const index = active.cursor++; if (!(index in active.cells)) active.cells[index] = initial;
		return [active.cells[index], (next: T | ((before: T) => T)) => { active.cells[index] = typeof next === 'function' ? (next as (before: T) => T)(active.cells[index] as T) : next }] },
	useEffect(effect: () => undefined | (() => void), deps: unknown[]) { const index = host.cursor++; const before = host.cells[index] as unknown[] | undefined;
		if (!before || deps.some((value, at) => !Object.is(value, before[at]))) { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup) }; host.cells[index] = deps },
}))
const requests: unknown[] = []
let work: (text: string) => Promise<string> = async text => `عربي ${text}`
mock.module('#/server/translation', () => ({
	translatePreview: async (texts: string[]) => { requests.push({ texts: [...texts] }); return Promise.all(texts.map(work)) },
	translateContentField: async (request: Record<string, unknown>) => { requests.push(structuredClone(request)); return { ...request, value: await work(String(request.sourceText)) } },
}))
const { useContentTranslationDraft } = await import('../src/hooks/admin/useContentTranslationDraft')
const missingRevisionHost = fresh()
host = missingRevisionHost
function MissingProofEditor() {
	return useContentTranslationDraft({ entityType: 'gallery', entityId: 'existing-image',
		initialRow: { alt: 'متن سرور', altAr: null }, row: { alt: 'متن ویرایش‌شده', altAr: '' } })
}
const noSavedProof = MissingProofEditor()
assert.equal(noSavedProof.sourceRevision, undefined, 'an existing DTO without a server token never gets a fabricated revision')
function editor(type: ContentEntityType, initial: Record<string, unknown>, id = 'entity-one') {
	const active = fresh()
	initial = { ...initial, sourceRevision: initial.sourceRevision ?? contentSourceRevision(type, initial) }
	let row = { ...structuredClone(initial), translationIdentities: collectionTranslationIdentities(type, initial) }
	let persisted = initial
	const render = () => { host = active; active.cursor = 0; return useContentTranslationDraft({ entityType: type, entityId: id, initialRow: persisted, row }) }
	return { render, change: (patch: Record<string, unknown>) => { row = { ...row, ...patch } }, row: () => row,
		refreshInitial: (next: Record<string, unknown>) => { persisted = next },
		unmount: () => { for (const cleanup of active.cleanups) cleanup() } }
}
function automatic(type: ContentEntityType, source: Record<string, unknown>) {
	const seeded = reconcileContentTranslation(type, 'entity-one', null, source)
	return reconcileContentTranslation(type, 'entity-one', seeded, seeded, contentTranslationFields(type, seeded).map(field => ({
		fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText, value: `عربي ${field.sourceText}`, revision: 0, origin: 'automatic' as const,
	})))
}
const suppliedRevision = editor('gallery', { alt: 'متن سرور', altAr: null, sourceRevision: 'opaque-raw-server-proof', derivedDisplayProperty: true })
assert.equal(suppliedRevision.render().sourceRevision, 'opaque-raw-server-proof', 'display DTO transformations never replace the supplied raw-row source token')

const product = automatic('product', { name: 'نام اصلی', description: 'توضیح اصلی', ingredients: ['پنیر', 'قارچ'], ingredientsAr: [] })
const productEditor = editor('product', product)
const initialDraft = productEditor.render()
const originalNameId = required(initialDraft.field(['name'])).field.fieldId
productEditor.change({ name: 'نام تازه' })
let draft = productEditor.render()
assert.equal(required(draft.field(['name'])).status, 'needs-retranslation')
assert.equal(required(draft.field(['description'])).status, 'translated')
assert.equal(required(draft.field(['ingredients', 1])).status, 'translated')
const newName = await required(draft.field(['name'])).translate()
assert.deepEqual(requests.pop(), { texts: ['نام تازه'] }, 'unsaved one-field preview sends only the selected Persian source')
required(draft.field(['name'])).edit(required(newName), 'automatic')
productEditor.change({ nameAr: newName })
draft = productEditor.render()
assert.equal(required(draft.field(['name'])).status, 'translated')
assert.equal(draft.getEdits()[0].fieldId, originalNameId)
assert.equal(draft.sourceRevision, initialDraft.sourceRevision, 'keystrokes cannot rebind the persisted source revision')
assert.equal(draft.getEdits().length, 1)
const savedProduct = reconcileContentTranslation<Record<string, unknown>>('product', 'entity-one', product, productEditor.row(), draft.getEdits())
assert.equal(savedProduct.nameAr, newName)
assert.equal(savedProduct.descriptionAr, product.descriptionAr)
assert.deepEqual(savedProduct.ingredientsAr, product.ingredientsAr)

// Reorder carries translated values by identity, even with an outdated parallel Arabic array.
productEditor.change({ ingredients: ['قارچ', 'پنیر'], translationIdentities: moveCollectionIdentity(productEditor.row().translationIdentities, ['ingredients'], 0, 1) })
draft = productEditor.render()
assert.equal(required(draft.field(['ingredients', 0])).field.value, 'عربي قارچ')
assert.equal(required(draft.field(['ingredients', 1])).field.value, 'عربي پنیر')
required(draft.field(['ingredients', 1])).edit('جبن يدوي', 'manual')
productEditor.change({ ingredients: ['پنیر', 'قارچ'], translationIdentities: moveCollectionIdentity(productEditor.row().translationIdentities, ['ingredients'], 0, 1) })
draft = productEditor.render()
assert.deepEqual(draft.getEdits().find(edit => edit.fieldId.startsWith('ingredients:'))?.fieldPath, ['ingredients', 0], 'manual proof follows its stable item through reorder')
const reorderedSave = reconcileContentTranslation<Record<string, unknown>>('product', 'entity-one', product, productEditor.row(), draft.getEdits())
assert.deepEqual(reorderedSave.ingredientsAr, ['جبن يدوي', 'عربي قارچ'])
productEditor.change({ ingredients: ['پنیر', 'پنیر', 'قارچ'], translationIdentities: moveCollectionIdentity(appendCollectionIdentity(productEditor.row().translationIdentities, ['ingredients']), ['ingredients'], 2, 1) })
draft = productEditor.render()
assert.equal(required(draft.field(['ingredients', 0])).field.value, 'جبن يدوي', 'a duplicate draft keeps the original item identity and manual translation')
assert.equal(required(draft.field(['ingredients', 1])).field.value, null, 'ambiguous copies never steal a saved Arabic value')
const duplicateId = required(draft.field(['ingredients', 1])).field.fieldId
assert.equal(required(productEditor.render().field(['ingredients', 1])).field.fieldId, duplicateId, 'new draft identities remain stable across renders')
required(draft.field(['ingredients', 1])).edit('جبن جديد', 'manual')
const copySave = reconcileContentTranslation<Record<string, unknown>>('product', 'entity-one', product, productEditor.row(), draft.getEdits())
assert.equal((copySave.ingredientsAr as string[])[1], 'جبن جديد', 'the server safely accepts an explicit new collection identity')

// Persisted missing fields use the validated entity operation; duplicate clicks dedupe before a rerender.
const missing = editor('product', { name: 'نام', nameAr: 'اسم يدوي', description: 'توضیح یکتا', descriptionAr: null, ingredients: ['مواد'], ingredientsAr: ['مكونات'] })
let missingDraft = missing.render()
let resolve: ((value: string) => void) | undefined
work = () => new Promise(done => { resolve = done })
const request = required(missingDraft.field(['description'])).translate()
await required(missingDraft.field(['description'])).translate()
assert.equal(requests.length, 1)
assert.deepEqual(requests[0], { entityType: 'product', entityId: 'entity-one', fieldId: 'description', fieldPath: ['description'], sourceText: 'توضیح یکتا', revision: 0 })
assert(!JSON.stringify(requests[0]).includes('اسم يدوي') && !JSON.stringify(requests[0]).includes('مواد'))
missing.change({ description: 'جدیدتر' }); missing.render(); resolve?.('استجابة قديمة')
assert.equal(await request, undefined, 'late suggestions cannot bind to newer Persian source')
requests.length = 0
missingDraft = missing.render()
const manualRace = required(missingDraft.field(['description'])).translate()
required(missingDraft.field(['description'])).edit('كتابة بشرية', 'manual')
missing.change({ descriptionAr: 'كتابة بشرية' }); missing.render(); resolve?.('اقتراح متأخر')
assert.equal(await manualRace, undefined, 'new manual edits defeat pending automatic responses')
assert.equal(missing.render().getEdits()[0].origin, 'manual')
requests.length = 0

const unmounted = editor('gallery', { alt: 'متن عکس', altAr: null })
const unmountedWork = required(unmounted.render().field(['alt'])).translate()
unmounted.unmount(); resolve?.('صورة')
assert.equal(await unmountedWork, undefined, 'unmounted editors discard late work')
work = async text => `عربي ${text}`
requests.length = 0

// Every entity adapter exposes only textual fields; structure and completed siblings stay outside requests.
for (const [type, source, path, patch] of [
	['productSize', { name: 'کوچک', price: 123, image: '/size.png' }, ['name'], { name: 'بزرگ' }],
	['category', { name: 'غذا', sizeNames: ['کوچک', 'بزرگ'] }, ['sizeNames', 1], { sizeNames: ['کوچک', 'خیلی بزرگ'] }],
	['mainCategory', { name: 'کافه', slug: 'cafe' }, ['name'], { name: 'رستوران' }],
	['articleCategory', { name: 'مقاله' }, ['name'], { name: 'اخبار' }],
	['articleSubCategory', { name: 'فرعی' }, ['name'], { name: 'جدید' }],
	['about', { heroTitle: 'معرفی', heroText: 'داستان', teamTitle: 'تیم', teamAlt: 'عکس', location: { lat: 37.123456789, lng: 49.123456789, address: 'نشانی' } }, ['location', 'address'], { location: { lat: 37.123456789, lng: 49.123456789, address: 'نشانی تازه' } }],
	['gallery', { alt: 'عکس', src: '/image.png' }, ['alt'], { alt: 'عکس جدید' }],
	['terms', { sections: [{ title: 'قوانین', items: ['بند یک', 'بند دو'] }] }, ['sections', 0, 'items', 1], { sections: [{ title: 'قوانین', items: ['بند یک', 'بند جدید'] }] }],
	['packagingItem', { title: 'جعبه', price: 999 }, ['title'], { title: 'کارتن' }],
	['temporaryClose', { reason: 'علت تعطیلی', disablePayments: false }, ['reason'], { reason: 'علت تازه' }],
] as [ContentEntityType, Record<string, unknown>, (string | number)[], Record<string, unknown>][]) {
	const instance = editor(type, automatic(type, source))
	instance.render(); instance.change(patch)
	const changed = instance.render()
	const binding = required(changed.field(path))
	assert.equal(binding.status, 'needs-retranslation', type)
	const translated = await binding.translate()
	assert.deepEqual(requests.pop(), { texts: [binding.field.sourceText] }, `${type} sends one exact field only`)
	binding.edit(required(translated), 'automatic')
	assert.equal(changed.getEdits().length, 1)
	assert.equal(changed.field(['lat']), undefined, 'coordinates and arbitrary field paths have no translation action')
}

const manualAbout = editor('about', { heroTitle: 'عنوان', heroTitleAr: 'عنوان يدوي', heroText: 'متن', heroTextAr: null,
	teamTitle: 'تیم', teamTitleAr: null, teamAlt: '', teamAltAr: null, location: { lat: 37, lng: 49, address: 'نشانی', addressAr: 'عنوان يدوي' } })
manualAbout.render(); manualAbout.change({ heroTitle: 'عنوان تازه' })
const review = manualAbout.render()
assert.equal(required(review.field(['heroTitle'])).status, 'needs-review')
assert.equal(required(review.field(['heroTitle'])).field.staleValue, 'عنوان يدوي')
required(review.field(['heroText'])).register(value => manualAbout.change({ heroTextAr: value }))
required(review.field(['teamTitle'])).register(value => manualAbout.change({ teamTitleAr: value }))
await review.translateEligible()
assert.deepEqual(requests.splice(0), [{ entityType: 'about', entityId: 'entity-one', fieldId: 'heroText', fieldPath: ['heroText'], sourceText: 'متن', revision: 0 },
	{ entityType: 'about', entityId: 'entity-one', fieldId: 'teamTitle', fieldPath: ['teamTitle'], sourceText: 'تیم', revision: 0 }], 'bulk skips valid and stale manual fields')
const manualSuggestion = await required(review.field(['heroTitle'])).translate()
assert.deepEqual(requests.pop(), { texts: ['عنوان تازه'] }, 'explicit review can obtain one-field suggestion without overwriting the stale draft')
assert.equal(review.getEdits().some(edit => edit.fieldId === 'heroTitle'), false)
required(review.field(['heroTitle'])).edit(required(manualSuggestion), 'manual')
assert.equal(required(review.getEdits().find(edit => edit.fieldId === 'heroTitle')).origin, 'manual')
const beforeCoordinates = required(manualAbout.render().field(['location', 'address'])).field
manualAbout.change({ location: { lat: 38.987654321, lng: 48.987654321, address: 'نشانی', addressAr: 'عنوان يدوي' } })
assert.equal(required(manualAbout.render().field(['location', 'address'])).status, beforeCoordinates.status, 'coordinate-only changes leave address translation valid')

const failedRecord = reconcileContentTranslation('gallery', 'entity-one', null, { alt: 'عکس ناموفق', altAr: null })
failedRecord.translationState.fields[0].error = 'Queued translator timeout'
const failedEditor = editor('gallery', failedRecord)
assert.equal(required(failedEditor.render().field(['alt'])).failed, true, 'reopened editors show persisted queue failures')
required(failedEditor.render().field(['alt'])).edit('صورة يدوية', 'manual')
failedEditor.change({ altAr: 'صورة يدوية' })
assert.equal(required(failedEditor.render().field(['alt'])).failed, false, 'manual review clears only the matching failure')

for (const [type, collection] of [['terms', 'sections'], ['article', 'processes']] as const) {
	const initial = reconcileContentTranslation(type, 'entity-one', null, { [collection]: [{ title: 'بخش قبلی', items: ['بند قبلی'] }],
		[`${collection}Ar`]: [{ title: 'عنوان سابق', items: ['بند سابق'] }] })
	const nested = editor(type, initial)
	nested.render()
	const added = { title: 'بخش تازه اول', items: ['بند تازه اول'] }
	const sibling = { title: 'بخش تازه دوم', items: ['بند تازه دوم'] }
	let nestedIds = appendCollectionIdentity(nested.row().translationIdentities, [collection])
	nestedIds = appendCollectionIdentity(nestedIds, [collection, 1, 'items'])
	nestedIds = moveCollectionIdentity(nestedIds, [collection], 1, 0)
	nested.change({ translationIdentities: nestedIds, [collection]: [added, ...initial[collection]], [`${collection}Ar`]: [{ title: '', items: [''] }, ...initial[`${collection}Ar`]] })
	let state = nested.render()
	required(state.field([collection, 0, 'items', 0])).edit('بند يدوي جديد', 'manual')
	nestedIds = appendCollectionIdentity(nested.row().translationIdentities, [collection])
	nestedIds = appendCollectionIdentity(nestedIds, [collection, 2, 'items'])
	nestedIds = moveCollectionIdentity(nestedIds, [collection], 2, 0)
	nested.change({ translationIdentities: nestedIds, [collection]: [sibling, added, ...initial[collection]] })
	state = nested.render()
	nested.change({ translationIdentities: moveCollectionIdentity(nestedIds, [collection], 1, 2), [collection]: [sibling, ...initial[collection], added] })
	state = nested.render()
	const proofs = state.getEdits()
	assert.equal(proofs.length, 2, `${type} sends just the explicit item proof and its new parent identity hint`)
	assert(proofs.some(edit => edit.fieldPath.join('.') === `${collection}.2.title` && edit.value === '' && edit.origin === 'automatic'))
	const saved = reconcileContentTranslation<Record<string, unknown>>(type, 'entity-one', initial, nested.row(), proofs)
	const savedArabic = saved[`${collection}Ar`]
	assert(Array.isArray(savedArabic), 'saved nested Arabic retains its collection structure')
	assert.equal(savedArabic[2].items[0], 'بند يدوي جديد', `${type} child-only manual edits survive new sibling insertion and reorder`)
	assert.equal(savedArabic[1].items[0], 'بند سابق', `${type} preserves the existing manual sibling`)
	assert.equal(savedArabic[0].items[0], '', `${type} never attaches the new manual edit to another new section`)
}

const refreshSource = reconcileContentTranslation('product', 'entity-one', null, { name: 'نام', nameAr: null, description: 'متن', descriptionAr: null })
const refreshed = editor('product', refreshSource)
const refreshBaseline = refreshed.render().sourceRevision
required(refreshed.render().field(['name'])).edit('اسم يدوي محلي', 'manual')
refreshed.change({ nameAr: 'اسم يدوي محلي' })
const withFailure = structuredClone(refreshSource)
required(withFailure.translationState.fields.find(field => field.fieldId === 'description')).error = 'Persisted queue failure'
refreshed.refreshInitial(withFailure)
assert.equal(required(refreshed.render().field(['description'])).failed, true, 'new queue errors refresh into the same mounted draft hook')
assert.equal(required(refreshed.render().field(['name'])).field.value, 'اسم يدوي محلي', 'status refresh preserves explicit Arabic drafts')
const description = required(contentTranslationFields('product', withFailure).find(field => field.fieldId === 'description'))
const completed = reconcileContentTranslation('product', 'entity-one', withFailure, withFailure, [{ fieldId: description.fieldId,
	fieldPath: description.fieldPath, sourceText: description.sourceText, value: 'نص مكتمل', revision: description.revision, origin: 'automatic' }])
refreshed.refreshInitial(completed)
const refreshedDraft = refreshed.render()
assert.equal(required(refreshedDraft.field(['description'])).failed, false, 'successful retry clears the persisted field failure')
assert.equal(required(refreshedDraft.field(['description'])).status, 'translated')
assert.equal(refreshedDraft.sourceRevision, refreshBaseline, 'server status refresh never silently rebinds old form save proofs')
assert(!matchesContentSourceRevision('product', completed, refreshBaseline), 'old forms remain fenced against newer persisted translations')
assert.equal(required(refreshedDraft.field(['name'])).field.value, 'اسم يدوي محلي')

let rejectLate: ((error: Error) => void) | undefined
work = () => new Promise<string>((_resolve, reject) => { rejectLate = reject })
const lateFailure = editor('gallery', { alt: 'عکس نخست', altAr: null })
const failedPending = required(lateFailure.render().field(['alt'])).translate().catch(() => undefined)
lateFailure.change({ alt: 'عکس تازه' }); lateFailure.render()
required(rejectLate)(new Error('Obsolete failure'))
await failedPending
assert.equal(required(lateFailure.render().field(['alt'])).failed, false, 'late failures cannot mark newer source drafts as failed')

const { QueryClient } = await import('@tanstack/react-query')
const { invalidateTranslatedContentQueries } = await import('../src/utils/contentTranslationCache')
const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
const { qk } = await import('../src/utils/queryKeys')
const cacheKeys = [qk.productByIdAll, qk.productsByMainPrefix, qk.similarProductsAll, qk.aboutContent, qk.termsContent, qk.adminGalleryImages]
for (const key of cacheKeys) cache.setQueryData(key, { cached: true })
for (const type of ['product', 'about', 'terms', 'gallery'] as const) await invalidateTranslatedContentQueries(cache, type)
for (const key of cacheKeys) assert.equal(cache.getQueryState(key)?.isInvalidated, true)
cache.clear()
console.log('PASS content translation editors: exact requests, all entity adapters, source proofs, manual review, collection identity, deduplication, late responses, bulk eligibility and localized caches')
