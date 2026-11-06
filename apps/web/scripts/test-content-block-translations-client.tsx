import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { getArticleBlockTextFields, normalizeArticleBlocksTranslation, readArticleBlockText, reconcileArticleBlocksTranslation, setArticleBlockTexts, setArticleBlockTranslations, type ArticleBlocksDoc, type ArticleBlockTextUpdate } from '@sinshin/shared'

const react = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number }
let host: Host = { cells: [], cursor: 0 }
mock.module('react', () => ({ ...react,
	useRef<T>(initial: T) { const index = host.cursor++; if (!(index in host.cells)) host.cells[index] = { current: initial }; return host.cells[index] },
	useState<T>(initial: T) { const active = host; const index = active.cursor++; if (!(index in active.cells)) active.cells[index] = initial;
		return [active.cells[index], (next: T | ((before: T) => T)) => { active.cells[index] = typeof next === 'function' ? (next as (before: T) => T)(active.cells[index] as T) : next }] },
}))
type FieldRequest = { blockId: string; blockType: string; fieldPath: (string | number)[]; text: string; entityType?: 'article' | 'about'; entityId?: string; revision?: number }
const fields: FieldRequest[] = []
const bulkTexts: string[][] = []
let translate: (text: string) => Promise<string> = async text => `عربي ${text}`
mock.module('#/server/translation', () => ({
	translateArticleBlockField: async (request: FieldRequest) => { fields.push(structuredClone(request)); return { ...request, sourceText: request.text, translation: await translate(request.text) } },
	translateArticleBlocksPreview: async (request: { blocks: ArticleBlocksDoc; blocksAr?: ArticleBlocksDoc }) => {
		assert.equal(request.blocksAr, undefined, 'bulk requests never retransmit Arabic values')
		const selected = request.blocks.blocks.flatMap(block => getArticleBlockTextFields(block).filter(field => field.text.trim())
			.map(field => ({ blockId: block.id, path: field.path, text: field.text })))
		bulkTexts.push(selected.map(field => field.text))
		const updates: ArticleBlockTextUpdate[] = []
		for (const field of selected) updates.push({ ...field, text: await translate(field.text) })
		return setArticleBlockTranslations(request.blocks, null, updates, 'automatic')
	},
}))
const { useArabicBlockTranslations } = await import('../src/components/admin/articles/builder/useArabicBlockTranslations')
function required<T>(value: T | null | undefined): T { assert(value !== null && value !== undefined, 'expected translated document'); return value }
function editor(source: ArticleBlocksDoc, arabic?: ArticleBlocksDoc | null, saved?: { entityType: 'article' | 'about'; entityId: string }) {
	const active: Host = { cells: [], cursor: 0 }
	const doc = { current: source }
	const mounted = { current: true }
	let draft = arabic
	let persistedArabic = arabic
	const render = () => { host = active; active.cursor = 0; return useArabicBlockTranslations({ doc, docAr: draft, mounted,
		onChange(next) { draft = next }, showToast() {}, translationEntityType: saved?.entityType, translationEntityId: saved?.entityId,
		initialDoc: source, initialDocAr: persistedArabic }) }
	return { render, doc, draft: () => draft, mounted, clearArabic: () => { draft = null }, refreshInitialArabic: (next: ArticleBlocksDoc) => { persistedArabic = next } }
}
const source: ArticleBlocksDoc = { version: 1, blocks: [
	{ id: 'manual', type: 'heading', props: { text: 'عنوان دستی', level: 2 } },
	{ id: 'automatic', type: 'heading', props: { text: 'عنوان خودکار', level: 2 } },
	{ id: 'clear', type: 'paragraph', props: { text: 'متن پاک شده' } },
	{ id: 'completed', type: 'paragraph', props: { text: 'متن کامل' } },
	{ id: 'pin-one', type: 'location', props: { lat: 37.123456789012, lng: 49.987654321098, title: 'عنوان محل', address: 'آدرس شعبه' }, width: 'md', anim: 'fade-up', style: { bg: '#ffffff', fg: '#111111' } },
] }
let draft = required(setArticleBlockTranslations(source, null, [
	{ blockId: 'manual', path: ['text'], text: 'عنوان يدوي' },
	{ blockId: 'clear', path: ['text'], text: '' },
], 'manual'))
draft = required(setArticleBlockTranslations(source, draft, [
	{ blockId: 'automatic', path: ['text'], text: 'عنوان تلقائي' },
	{ blockId: 'completed', path: ['text'], text: 'نص كامل' },
	{ blockId: 'pin-one', path: ['title'], text: 'عنوان الموقع' },
	{ blockId: 'pin-one', path: ['address'], text: 'عنوان الفرع' },
], 'automatic'))
const mixed = editor(source, draft)
mixed.doc.current = setArticleBlockTexts(source, [{ blockId: 'manual', path: ['text'], text: 'عنوان دستی تازه' },
	{ blockId: 'automatic', path: ['text'], text: 'عنوان خودکار تازه' }])
let hook = mixed.render()
assert.equal(hook.changedCount, 1, 'changed-only bulk counts only automatically eligible fields')
await hook.translate()
assert.deepEqual(bulkTexts.pop(), ['عنوان خودکار تازه'], 'bulk omits manual review drafts, empty manual clears and completed siblings')
hook = mixed.render()
assert.equal(hook.status('manual', ['text']), 'needs-retranslation')
assert.equal(hook.draft?.translation?.fields.find(field => field.blockId === 'manual')?.staleValue, 'عنوان يدوي')
assert.equal(readArticleBlockText(hook.draft?.blocks.find(block => block.id === 'clear'), ['text']), '')
assert.deepEqual(hook.draft?.blocks.find(block => block.id === 'pin-one')?.props, draft.blocks.find(block => block.id === 'pin-one')?.props,
	'bulk translations preserve exact coordinates and unaffected location text')
assert.deepEqual(hook.draft?.blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]), mixed.doc.current.blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]))

const changedOnly = editor(source, draft)
changedOnly.doc.current = mixed.doc.current
await changedOnly.render().translateChanged()
assert.deepEqual(fields.pop(), { blockId: 'automatic', blockType: 'heading', fieldPath: ['text'], text: 'عنوان خودکار تازه' },
	'changed-only translation selects one eligible field and never resends a manual sibling')

let resolve: ((value: string) => void) | undefined
const refreshSource: ArticleBlocksDoc = { version: 1, blocks: [{ id: 'refresh', type: 'heading', props: { text: 'متن صف', level: 2 } }] }
const refreshed = editor(refreshSource, null, { entityType: 'article', entityId: 'saved' })
refreshed.render()
const failedSnapshot = required(normalizeArticleBlocksTranslation(refreshSource, null))
failedSnapshot.translation = { fields: [{ blockId: 'refresh', blockType: 'heading', fieldPath: ['text'], sourceText: 'متن صف', status: 'missing', origin: 'automatic', revision: 0, error: 'Queued field failure' }] }
refreshed.refreshInitialArabic(failedSnapshot)
assert.equal(refreshed.render().draft?.translation?.fields[0]?.error, 'Queued field failure', 'queue failures refresh into an existing untouched block draft')
const completedSnapshot = required(setArticleBlockTranslations(refreshSource, failedSnapshot, [{ blockId: 'refresh', path: ['text'], text: 'نص مكتمل' }], 'automatic'))
refreshed.refreshInitialArabic(completedSnapshot)
let refreshedHook = refreshed.render()
assert.equal(refreshedHook.status('refresh', ['text']), 'translated')
const beforeRefreshedBulk = bulkTexts.length
await refreshedHook.translate()
assert.equal(bulkTexts.length, beforeRefreshedBulk, 'completed queue results are never retransmitted by stale open forms')
refreshedHook.edit('refresh', ['text'], 'تحرير محلي')
refreshed.refreshInitialArabic(required(setArticleBlockTranslations(refreshSource, completedSnapshot, [{ blockId: 'refresh', path: ['text'], text: 'تحرير بعيد' }], 'manual')))
refreshedHook = refreshed.render()
assert.equal(readArticleBlockText(refreshedHook.draft?.blocks[0], ['text']), 'تحرير محلي', 'server metadata refresh never overwrites a local manual block edit')

translate = () => new Promise<string>(accept => { resolve = accept })
hook = mixed.render()
const beforeRequests = fields.length
const pending = hook.translate('manual', ['text'])
await hook.translate('manual', ['text'])
hook = mixed.render()
assert.equal(fields.length, beforeRequests + 1, 'duplicate clicks do not issue duplicate field requests')
assert.equal(hook.fieldState('manual', ['text']).busy, true)
assert.equal(hook.fieldState('automatic', ['text']).busy, false, 'only the selected field displays loading')
assert.deepEqual(fields.at(-1), { blockId: 'manual', blockType: 'heading', fieldPath: ['text'], text: 'عنوان دستی تازه' },
	'an explicit manual-review field action sends only its new source')
required(resolve)('عنوان يدوي جديد')
await pending
hook = mixed.render()
assert.equal(hook.fieldState('manual', ['text']).busy, false)
assert.equal(readArticleBlockText(hook.draft?.blocks.find(block => block.id === 'manual'), ['text']), 'عنوان يدوي جديد')

const typingSource: ArticleBlocksDoc = { version: 1, blocks: [{ id: 'typing', type: 'heading', props: { text: 'عنوان اصلی', level: 2 } }] }
const typingArabic = required(setArticleBlockTranslations(typingSource, null, [{ blockId: 'typing', path: ['text'], text: 'عنوان تلقائي' }], 'automatic'))
const typing = editor(typingSource, typingArabic, { entityType: 'article', entityId: 'saved' })
for (const text of ['ت', 'تحرير', 'تحرير يدوي كامل']) typing.render().edit('typing', ['text'], text)
let typedSave = required(reconcileArticleBlocksTranslation(typingSource, typingSource, typingArabic, typing.draft()))
assert.equal(readArticleBlockText(typedSave.blocks[0], ['text']), 'تحرير يدوي كامل', 'multiple Arabic keystrokes keep one valid saved revision proof')
for (const text of ['عنوان پیش‌نویس یک', 'عنوان پیش‌نویس دو', 'عنوان نهایی']) {
	const next = setArticleBlockTexts(typing.doc.current, [{ blockId: 'typing', path: ['text'], text }])
	typing.render().sourceChanged(next)
	typing.doc.current = next
	for (const text of ['ن', 'نص', 'نص يدوي جديد']) typing.render().edit('typing', ['text'], text)
}
typedSave = required(reconcileArticleBlocksTranslation(typingSource, typing.doc.current, typingArabic, typing.draft()))
assert.equal(readArticleBlockText(typedSave.blocks[0], ['text']), 'نص يدوي جديد', 'repeated unsaved Persian and Arabic edits bind to the final source without weakening saved revision checks')
typing.render().edit('typing', ['text'], '')
typedSave = required(reconcileArticleBlocksTranslation(typingSource, typing.doc.current, typingArabic, typing.draft()))
assert.equal(readArticleBlockText(typedSave.blocks[0], ['text']), '')
assert.equal(typedSave.translation?.fields[0]?.origin, 'manual', 'clearing a changed field explicitly prevents automatic refill')

const cleared = editor(typingSource, typingArabic)
cleared.render(); cleared.clearArabic(); cleared.render()
cleared.refreshInitialArabic(required(setArticleBlockTranslations(typingSource, typingArabic, [{ blockId: 'typing', path: ['text'], text: 'نتيجة صف متأخرة' }], 'automatic')))
const clearedHook = cleared.render()
const callsBeforeClear = bulkTexts.length
await clearedHook.translate()
assert.equal(bulkTexts.length, callsBeforeClear, 'whole-document manual clears are omitted from automatic bulk before save')
assert.equal(readArticleBlockText(clearedHook.draft?.blocks[0], ['text']), '', 'a late server snapshot cannot restore a deliberately cleared Arabic document')
const partialClear = editor(source, draft)
partialClear.render(); partialClear.clearArabic(); partialClear.render()
partialClear.render().edit('manual', ['text'], 'مراجعة واحدة بعد المسح')
const partialClearSaved = required(reconcileArticleBlocksTranslation(source, source, draft, partialClear.draft()))
assert.equal(readArticleBlockText(partialClearSaved.blocks.find(block => block.id === 'manual'), ['text']), 'مراجعة واحدة بعد المسح')
assert.equal(readArticleBlockText(partialClearSaved.blocks.find(block => block.id === 'completed'), ['text']), '', 'reviewing one field after a whole clear keeps every other explicit clear source-bound')
assert.equal(partialClearSaved.translation?.fields.find(field => field.blockId === 'completed')?.origin, 'manual')

const failure = editor(source)
translate = async () => { throw new Error('Mock translator failed') }
await failure.render().translate('automatic', ['text'])
let failed = failure.render()
assert.equal(failed.fieldState('automatic', ['text']).error, 'Mock translator failed')
assert.equal(failed.fieldState('manual', ['text']).error, undefined, 'field failures do not contaminate sibling status')
translate = async text => `عربي ${text}`
await failed.translate('automatic', ['text'])
failed = failure.render()
assert.equal(failed.fieldState('automatic', ['text']).error, undefined)
assert.equal(failed.status('automatic', ['text']), 'translated', 'retry fills only the failed field')
assert.equal(failed.status('manual', ['text']), 'missing')

const savedAr = required(normalizeArticleBlocksTranslation(source, null))
savedAr.translation = { fields: [{ blockId: 'automatic', blockType: 'heading', fieldPath: ['text'], sourceText: 'عنوان خودکار', revision: 3, origin: 'automatic', status: 'missing' }] }
const saved = editor(source, savedAr, { entityType: 'about', entityId: '1' })
await saved.render().translate('automatic', ['text'])
assert.deepEqual(fields.pop(), { blockId: 'automatic', blockType: 'heading', fieldPath: ['text'], text: 'عنوان خودکار', entityType: 'about', entityId: '1', revision: 3 },
	'unchanged saved About block requests include exact identity and source revision')
saved.doc.current = setArticleBlockTexts(source, [{ blockId: 'automatic', path: ['text'], text: 'پیش‌نویس تازه' }])
await saved.render().translate('automatic', ['text'])
assert.deepEqual(fields.pop(), { blockId: 'automatic', blockType: 'heading', fieldPath: ['text'], text: 'پیش‌نویس تازه' },
	'unsaved source changes use a single text preview without a false saved proof')

translate = () => new Promise<string>(accept => { resolve = accept })
const race = editor(source)
const late = race.render().translate('manual', ['text'])
race.render().edit('manual', ['text'], 'تحرير يدوي أثناء الطلب')
required(resolve)('اقتراح متأخر')
await late
assert.equal(readArticleBlockText(race.draft()?.blocks.find(block => block.id === 'manual'), ['text']), 'تحرير يدوي أثناء الطلب', 'late responses preserve newer manual edits')
const unmounted = editor(source)
const cancelled = unmounted.render().translate('manual', ['text'])
unmounted.mounted.current = false
required(resolve)('اقتراح بعد الإغلاق')
await cancelled
assert.equal(unmounted.draft(), undefined, 'unmounted editors never publish delayed translations')

console.log('PASS block editor lifecycle: minimal requests, manual bulk protection, selected field loading/failures, retry, saved proofs, coordinates, duplicate clicks and late responses')
