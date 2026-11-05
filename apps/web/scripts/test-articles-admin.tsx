import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { getArticleBlockTextFields, normalizeArticleBlocksTranslation, readArticleBlockText, setArticleBlockText, setArticleBlockTranslations, type ArticleBlocksDoc, type ArticleBlockType, type ArticleBlockTextPath } from '@sinshin/shared'
import type { ArticleFormData } from '../src/types/forms'

// Exercise the real component handlers with a small hook host. Network and
// upload boundaries are mocked; no DOM or database is needed for draft state.
const react = { ...await import('react') }
const { QueryClient } = await import('@tanstack/react-query')
type Host = { cells: unknown[]; cursor: number }
let host: Host = { cells: [], cursor: 0 }
mock.module('react', () => ({
  ...react,
  useState<T>(initial: T | (() => T)) {
    const active = host
    const index = active.cursor++
    if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
    return [active.cells[index], (value: T | ((previous: T) => T)) => {
      active.cells[index] = typeof value === 'function' ? (value as (previous: T) => T)(active.cells[index] as T) : value
    }]
  },
  useRef<T>(initial: T) {
    const index = host.cursor++
    if (!(index in host.cells)) host.cells[index] = { current: initial }
    return host.cells[index]
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = host.cursor++
    const before = host.cells[index] as unknown[] | undefined
    if (!before || deps.some((value, at) => !Object.is(value, before[at]))) effect()
    host.cells[index] = deps
  },
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
}))
const categories = [
  { id: 'category-a', name: 'A', hasSubCategories: true, subCategories: [{ id: 'sub-a', name: 'Sub A' }] },
  { id: 'category-b', name: 'B', hasSubCategories: false, subCategories: [] },
]
let categoriesError = false
mock.module('@tanstack/react-query', () => ({ useQuery: () => ({ data: categories, isPending: false, isError: categoriesError }) }))
mock.module('#/utils/queryOptions', () => ({ adminArticleCategoriesOptions: {} }))
mock.module('@tanstack/react-router', () => ({ Link: () => null }))
const toasts: string[] = []
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (state: unknown) => unknown) => select({ showToast: (message: string) => toasts.push(message) }) }))
mock.module('#/components/shared/ImageField', () => ({ ImageField: () => null }))
mock.module('#/components/shared/MapPicker', () => ({ MapPicker: () => null }))
mock.module('#/components/shared/Toggle', () => ({ Toggle: () => null }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null }))
let previewInput: { blocks: ArticleBlocksDoc; blocksAr?: ArticleBlocksDoc | null; blockId?: string } | undefined
let resolveTranslation: ((doc: ArticleBlocksDoc) => void) | undefined
let previewCalls = 0
const fieldRequests: { blockId: string; blockType: ArticleBlockType; fieldPath: ArticleBlockTextPath; text: string }[] = []
let resolveField: ((result: { blockId: string; blockType: ArticleBlockType; fieldPath: ArticleBlockTextPath; sourceText: string; translation: string }) => void) | undefined
mock.module('#/server/translation', () => ({
  translateArticleBlocksPreview: (input: typeof previewInput) => {
    previewCalls++
    previewInput = input
    return new Promise<ArticleBlocksDoc>(resolve => { resolveTranslation = resolve })
  },
  translateArticleBlockField: (input: (typeof fieldRequests)[number]) => {
    fieldRequests.push(input)
    return new Promise(resolve => { resolveField = resolve })
  },
}))

const { ArticleForm } = await import('../src/components/admin/ArticleForm')
const { ArticlePageBuilder } = await import('../src/components/admin/articles/builder/ArticlePageBuilder')
const { useArabicBlockTranslations } = await import('../src/components/admin/articles/builder/useArabicBlockTranslations')
const { plainTextToDoc, blocksToPlainText } = await import('../src/components/admin/articles/builder/blockModel')
const { invalidateArticleQueries } = await import('../src/components/admin/articles/invalidateArticleQueries')
const { qk } = await import('../src/utils/queryKeys')
type Element = { type: unknown; props: Record<string, any> }
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as Element
  return [node, ...nodes(node.props.children)]
}
function find(tree: unknown, predicate: (node: Element) => boolean): Element {
  const node = nodes(tree).find(predicate)
  assert(node, 'Expected control is present')
  return node
}
function render<T, R>(instance: Host, component: (props: T) => R, props: T): R {
  host = instance
  host.cursor = 0
  return component(props)
}
const draft: ArticleFormData = {
  title: 'Original', author: '', excerpt: 'Summary', content: 'Original content',
  profileImage: '', galleryImages: [], categoryId: 'category-a', subCategoryId: 'sub-a',
  processes: [{ title: 'First', items: ['First step'] }, { title: 'Second', items: ['Second step'] }],
  processesAr: [], isFeatured: false, blocks: null, titleAr: '', excerptAr: '', contentAr: '',
}
const formHost: Host = { cells: [], cursor: 0 }
let submitted: ArticleFormData | undefined
function getSubmitted(): ArticleFormData | undefined { return submitted }
let isSubmitting = false
let tree: unknown
function renderForm(initialData: ArticleFormData | undefined = { ...draft }) {
  tree = render(formHost, ArticleForm, { initialData, isSubmitting, onSubmit: data => { submitted = data } })
}
function change(name: string, value: string) {
  find(tree, node => node.props.name === name).props.onChange({ target: { name, value } })
  renderForm()
}
function switchMode(label: string) {
  find(tree, node => node.type === 'button' && node.props.children === label).props.onClick()
  renderForm()
}
function submit() { find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }) }
renderForm()
assert.equal(find(tree, node => node.props.name === 'content').props.value, 'Original content', 'legacy articles open in plain mode')
change('content', 'Unsaved content')
isSubmitting = true
renderForm()
assert.equal(find(tree, node => node.props.name === 'content').props.value, 'Unsaved content', 'parent mutation rerenders preserve edits')
submit()
assert.equal(submitted, undefined, 'a pending save cannot submit again')
isSubmitting = false
renderForm()
submit()
assert.equal(getSubmitted()?.content, 'Unsaved content')
assert.equal(getSubmitted()?.blocks, null)
assert.equal(getSubmitted()?.author, 'سین شین')
assert.equal(getSubmitted()?.processesAr.length, 2, 'legacy translation slots align to all Persian processes')

switchMode('صفحه‌ساز بلوکی')
let builder = find(tree, node => node.type === ArticlePageBuilder)
assert.equal(blocksToPlainText(builder.props.doc), 'Unsaved content')
const changedDoc = plainTextToDoc('Latest block content')
builder.props.onChange(changedDoc)
renderForm()
switchMode('متن ساده')
assert.equal(find(tree, node => node.props.name === 'content').props.value, 'Latest block content', 'switching to plain carries current block text')
switchMode('صفحه‌ساز بلوکی')
assert.equal(find(tree, node => node.type === ArticlePageBuilder).props.doc, changedDoc, 'unchanged round trip preserves block layout and IDs')
switchMode('متن ساده')
change('content', 'Changed in plain mode')
switchMode('صفحه‌ساز بلوکی')
assert.equal(blocksToPlainText(find(tree, node => node.type === ArticlePageBuilder).props.doc), 'Changed in plain mode', 'returning to builder keeps plain edits')
change('categoryId', 'category-b')
submit()
assert.equal(getSubmitted()?.subCategoryId, null, 'changing categories clears old subcategory')

const arSteps = () => find(tree, node => node.type === 'textarea' && node.props.placeholder?.includes('هر خط = معرب'))
arSteps().props.onChange({ target: { value: 'الخطوة الأولى\n' } })
renderForm()
assert.equal(arSteps().props.value, 'الخطوة الأولى\n', 'Enter must remain available for the next translated step')
const originalSteps = [...draft.processes[0]!.items]
find(tree, node => node.props.placeholder === 'عنوان روند (مثلا: آماده‌سازی مواد)').props.onChange({ target: { value: ' First ' } })
renderForm()
find(tree, node => node.props.placeholder === 'متن گام (اینتر یا دکمه را بزنید)').props.onChange({ target: { value: ' Added step ' } })
renderForm()
find(tree, node => node.type === 'button' && node.props.children === 'افزودن گام').props.onClick()
renderForm()
submit()
assert.deepEqual(draft.processes[0]!.items, originalSteps, 'editing steps never mutates the cached source article')
assert.deepEqual(getSubmitted()?.processes[0]?.items, ['First step', 'Added step'])
assert.equal(getSubmitted()?.processes.length, 2)
categoriesError = true
renderForm()
submitted = undefined
submit()
assert.equal(submitted, undefined, 'category fetch failure cannot clear the article category on save')
categoriesError = false

const newHost: Host = { cells: [], cursor: 0 }
const newProps = { isSubmitting: false, onSubmit() {} }
const firstNew = render(newHost, ArticleForm, newProps)
const nextNew = render(newHost, ArticleForm, newProps)
assert.equal(find(firstNew, node => node.type === ArticlePageBuilder).props.doc.blocks[0].id,
  find(nextNew, node => node.type === ArticlePageBuilder).props.doc.blocks[0].id, 'new article block IDs stay stable across renders')

// A delayed upload must address the current block by ID and merge into the
// current document, even if it was reordered, edited, or removed meanwhile.
const builderHost: Host = { cells: [], cursor: 0 }
let doc: ArticleBlocksDoc = { version: 1, blocks: [
  { id: 'image-a', type: 'image', props: { src: '/old.png' } },
  { id: 'text-b', type: 'paragraph', props: { text: 'Before' } },
] }
function renderBuilder() { return render(builderHost, ArticlePageBuilder, { doc, onChange: next => { doc = next } }) }
let builderTree = renderBuilder()
function fieldsFor(value: unknown, id: string) {
  return find(value, node => node.props.block?.id === id && typeof node.props.patchProps === 'function')
}
const delayedImage = fieldsFor(builderTree, 'image-a').props.patchProps
doc = { ...doc, blocks: [doc.blocks[1]!, doc.blocks[0]!] }
builderTree = renderBuilder()
fieldsFor(builderTree, 'text-b').props.patchProps({ text: 'After' })
renderBuilder()
delayedImage({ src: '/new.png' })
assert.equal(doc.blocks[0]?.type, 'paragraph')
assert.equal((doc.blocks[0]!.props as { text: string }).text, 'After', 'upload preserves newer text edits')
assert.equal((doc.blocks[1]!.props as { src: string }).src, '/new.png', 'upload updates the original block after reorder')
builderTree = renderBuilder()
find(builderTree, node => node.type === 'button' && node.props.children instanceof Array && node.props.children.includes('واگرد')).props.onClick()
assert.equal((doc.blocks[0]!.props as { text: string }).text, 'After', 'undo restores only the most recent edit')
doc = { ...doc, blocks: [doc.blocks[0]!] }
renderBuilder()
delayedImage({ src: '/removed.png' })
assert.equal(doc.blocks.length, 1, 'removed image cannot be restored by a late upload')

doc = { version: 1, blocks: [{ id: 'gallery-c', type: 'gallery', props: { images: [{ src: '/first.png' }], layout: 'grid' } }] }
builderTree = renderBuilder()
const galleryFields = fieldsFor(builderTree, 'gallery-c')
const galleryFieldsTree = (galleryFields.type as (props: Record<string, unknown>) => unknown)(galleryFields.props)
const imageField = find(galleryFieldsTree, node => node.props.multiple === true && typeof node.props.onAdd === 'function')
const delayedAdd = imageField.props.onAdd
delayedAdd('/second.png')
delayedAdd('/third.png')
assert.deepEqual((doc.blocks[0]!.props as { images: { src: string }[] }).images.map(image => image.src), ['/first.png', '/second.png', '/third.png'], 'overlapping gallery uploads merge rather than overwrite one another')

const longText = 'x'.repeat(12001)
const migrated = plainTextToDoc(longText)
assert.equal(migrated.blocks.length, 3)
assert.equal(migrated.blocks.map(block => (block.props as { text: string }).text).join(''), longText, 'long plain text survives migration without server truncation')
assert.equal(plainTextToDoc('First\r\n\r\nSecond').blocks.length, 2)
const emojiMigration = plainTextToDoc(`${'x'.repeat(4999)}🍕rest`)
assert.equal((emojiMigration.blocks[0]!.props as { text: string }).text.length, 4999, 'paragraph splitting must not break a Unicode surrogate pair')

// stage-92 — بلوک موقعیت: انتخاب‌گرِ نقشه به‌جای تایپِ دستیِ مختصات +
// لینک‌های تستِ نشان (نما: @lat,lng · مسیر: routing/car/destination).
doc = { version: 1, blocks: [{ id: 'location-d', type: 'location', props: { lat: 37.4822056, lng: 49.4418273, title: 'شعبه انزلی', address: 'بلوار اقدسیه' } }] }
builderTree = renderBuilder()
const locationFields = fieldsFor(builderTree, 'location-d')
const locationFieldsTree = (locationFields.type as (props: Record<string, unknown>) => unknown)(locationFields.props)
assert(!nodes(locationFieldsTree).some(node => node.type === 'input' && node.props.type === 'number'),
	'stage-92: manual lat/lng number inputs are replaced by the map picker')
const pickerElement = find(locationFieldsTree, node => typeof node.type === 'function' && node.type.name === 'LocationPickerField')
assert.equal(pickerElement.props.lat, 37.4822056, 'picker is wired to the block coordinates')
assert.equal(pickerElement.props.lng, 49.4418273)
const Picker = pickerElement.type as (props: Record<string, unknown>) => unknown
const pickerHost: Host = { cells: [], cursor: 0 }
const pickerProps = { lat: 37.4822056, lng: 49.4418273,
	onChange: (coords: Record<string, number>) => locationFields.props.patchProps({ lat: coords.lat, lng: coords.lng }) }
let pickerTree = render(pickerHost, Picker, pickerProps as never)
assert(find(pickerTree, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('انتخاب روی نقشه')),
	'map picker button is offered for the location block')
assert(find(pickerTree, node => node.type === 'a' && node.props.href === 'https://neshan.org/maps/@37.482206,49.441827,15z'),
	'verified view deep link — neshan opens centered on the point')
assert(find(pickerTree, node => node.type === 'a' && node.props.href === 'https://neshan.org/maps/routing/car/destination/37.482206,49.441827'),
	'verified route deep link — destination pin + route from the current location')
find(pickerTree, node => node.type === 'button' && node.props['aria-expanded'] === false).props.onClick()
pickerTree = render(pickerHost, Picker, pickerProps as never)
const mapPickerElement = find(pickerTree, node => typeof node.type === 'function' && node.type.name === 'MapPicker')
assert.deepEqual(mapPickerElement.props.value, { lat: 37.4822056, lng: 49.4418273 }, 'MapPicker receives the block point')
mapPickerElement.props.onChange({ lat: 37.5, lng: 49.5 })
assert.equal((doc.blocks[0]!.props as { lat: number }).lat, 37.5, 'map click updates the block coordinates')
assert.equal((doc.blocks[0]!.props as { lng: number }).lng, 49.5)
assert.equal((doc.blocks[0]!.props as { title: string }).title, 'شعبه انزلی', 'map click never touches other block props')
mapPickerElement.props.onValidityChange(false)
pickerTree = render(pickerHost, Picker, pickerProps as never)
assert.equal(find(pickerTree, node => node.type === 'button' && node.props['aria-expanded'] === true).props.disabled, true,
	'an invalid coordinate draft remains mounted so native article-form validation cannot be bypassed by collapsing the map')
mapPickerElement.props.onValidityChange(true)
pickerTree = render(pickerHost, Picker, pickerProps as never)
assert.equal(find(pickerTree, node => node.type === 'button' && node.props['aria-expanded'] === true).props.disabled, false)

const bilingualSource: ArticleBlocksDoc = { version: 1, blocks: [
  { id: 'hero', type: 'hero', props: { title: 'هیرو', text: 'متن' } },
  { id: 'heading', type: 'heading', props: { text: 'عنوان', level: 3 } },
  { id: 'paragraph', type: 'paragraph', props: { text: 'متن اصلی' } },
  { id: 'image', type: 'image', props: { src: '/original.webp' } },
  { id: 'gallery', type: 'gallery', props: { layout: 'slider', images: [{ src: '/one.webp' }, { src: '/two.webp' }] } },
  { id: 'quote', type: 'quote', props: { text: 'نقل قول' } },
  { id: 'callout', type: 'callout', props: { text: 'نکته' } },
  { id: 'list', type: 'list', props: { items: ['اول', 'دوم'], ordered: true } },
  { id: 'cta', type: 'cta', props: { label: 'اقدام', to: 'menu' } },
  { id: 'link', type: 'link', props: { label: 'پیوند', href: '/articles/test', variant: 'card' } },
  { id: 'pin-one', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, title: 'اول', address: 'آدرس اول' } },
  { id: 'pin-two', type: 'location', props: { lat: -12.987654321, lng: 0, title: 'دوم', address: 'آدرس دوم' } },
  { id: 'divider', type: 'divider', props: { variant: 'space' } },
] }
const originalSource = structuredClone(bilingualSource)
let arabicDoc: ArticleBlocksDoc | null = null
const currentArabicDoc = (): ArticleBlocksDoc | null => arabicDoc
const bilingualHost: Host = { cells: [], cursor: 0 }
function renderBilingualBuilder() {
  return render(bilingualHost, ArticlePageBuilder, {
    doc: bilingualSource, docAr: arabicDoc, onChange() {}, onArabicChange(next) { arabicDoc = next },
  })
}
let bilingualTree = renderBilingualBuilder()
const counts: Record<string, number> = { hero: 2, heading: 1, paragraph: 1, image: 2, gallery: 2, quote: 2, callout: 2, list: 2, cta: 3, link: 3, 'pin-one': 2, 'pin-two': 2, divider: 0 }
for (const block of bilingualSource.blocks) {
  const panel = find(bilingualTree, node => node.props['data-arabic-block'] === block.id)
  assert.equal(nodes(panel).filter(node => node.type === 'textarea').length, counts[block.id], `Arabic text inputs support ${block.type}`)
  assert(!nodes(panel).some(node => node.type === 'input'), 'Arabic panels never expose structure/coordinate inputs')
  assert(find(panel, node => node.type === 'button' && node.props.children === 'ترجمه خودکار به عربی'), 'every block offers its translation action')
}
find(bilingualTree, node => node.type === 'button' && node.props.children === 'ترجمه خودکار همه بلوک‌ها به عربی').props.onClick()
assert.equal(previewInput?.blockId, undefined, 'translate-all sends the complete document')
assert.equal(previewInput?.blocks, bilingualSource)
bilingualTree = renderBilingualBuilder()
assert(nodes(bilingualTree).filter(node => node.type === 'button' && node.props.children === 'ترجمه خودکار به عربی').every(node => node.props.disabled), 'concurrent translation actions are disabled')
resolveTranslation!(normalizeArticleBlocksTranslation(bilingualSource, null)!)
await new Promise(resolve => setTimeout(resolve, 0))
bilingualTree = renderBilingualBuilder()
const firstPinPanel = find(bilingualTree, node => node.props['data-arabic-block'] === 'pin-one')
find(firstPinPanel, node => node.type === 'textarea').props.onChange({ target: { value: 'عنوان يدوي' } })
assert.deepEqual(bilingualSource, originalSource, 'manual Arabic editing leaves the Persian article intact')
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'pin-one'), ['title']), 'عنوان يدوي')
bilingualTree = renderBilingualBuilder()
find(find(bilingualTree, node => node.props['data-arabic-block'] === 'pin-two'), node => node.type === 'button').props.onClick()
assert.equal(previewInput?.blockId, 'pin-two', 'individual action identifies the exact location block')
resolveTranslation!(setArticleBlockText(normalizeArticleBlocksTranslation(bilingualSource, null)!, 'pin-two', ['title'], 'المكان الثاني'))
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'pin-one'), ['title']), 'عنوان يدوي')
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'pin-two'), ['title']), 'المكان الثاني')

// Exercise delayed replies directly, including a manual clear and source changes.
const hookHost: Host = { cells: [], cursor: 0 }
const sourceRef = { current: bilingualSource }
const mounted = { current: true }
function renderTranslationHook() {
  return render(hookHost, useArabicBlockTranslations, {
    doc: sourceRef, docAr: arabicDoc, mounted, onChange(next) { arabicDoc = next }, showToast() {},
  })
}
let translationHook = renderTranslationHook()
const pending = translationHook.translate()
translationHook.edit('pin-one', ['title'], '')
translationHook.edit('paragraph', ['text'], 'تحرير يدوي أثناء الترجمة')
sourceRef.current = { ...bilingualSource, blocks: [...bilingualSource.blocks].reverse().filter(b => b.id !== 'pin-two') }
sourceRef.current = setArticleBlockText(sourceRef.current, 'heading', ['text'], 'عنوان فارسي جديد')
translationHook = renderTranslationHook()
let suggestions = normalizeArticleBlocksTranslation(bilingualSource, null)!
for (const [id, path, value] of [
  ['pin-one', ['title'], 'اقتراح قديم'], ['pin-one', ['address'], 'عنوان جديد'],
  ['pin-two', ['title'], 'عنوان محذوف'], ['paragraph', ['text'], 'اقتراح تلقائي'], ['heading', ['text'], 'ترجمة قديمة'],
] as const) suggestions = setArticleBlockText(suggestions, id, [...path], value)
resolveTranslation!(suggestions)
await pending
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'pin-one'), ['title']), '', 'manual clears are protected from pending suggestions')
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'paragraph'), ['text']), 'تحرير يدوي أثناء الترجمة')
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'heading'), ['text']), '', 'changed Persian text rejects stale Arabic suggestions')
assert.equal(readArticleBlockText(currentArabicDoc()?.blocks.find(b => b.id === 'pin-one'), ['address']), 'عنوان جديد')
assert.deepEqual(currentArabicDoc()?.blocks.map(b => b.id), sourceRef.current.blocks.map(b => b.id), 'pending suggestions follow current source order and cannot restore deleted blocks')
assert.equal((currentArabicDoc()?.blocks.find(b => b.id === 'pin-one')?.props as { lat: number }).lat, 37.4822056789)
const afterEdits = structuredClone(arabicDoc)
translationHook = renderTranslationHook()
const cancelled = translationHook.translate()
mounted.current = false
resolveTranslation!(suggestions)
await cancelled
assert.deepEqual(arabicDoc, afterEdits, 'unmounted editor discards delayed suggestions')

const legacyHost: Host = { cells: [], cursor: 0 }
const legacyDraft = { ...draft, blocks: bilingualSource, blocksAr: arabicDoc }
let savedLegacy: ArticleFormData | undefined
const legacyTree = render(legacyHost, ArticleForm, { initialData: legacyDraft, isSubmitting: false, onSubmit(next) { savedLegacy = next } })
assert.equal(find(legacyTree, node => node.type === ArticlePageBuilder).props.doc, bilingualSource, 'existing articles load their original builder document without reconstruction')
find(legacyTree, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.deepEqual(savedLegacy?.blocks, bilingualSource)
assert.deepEqual(savedLegacy?.blocksAr, arabicDoc, 'reviewed Arabic document is included separately on save')

// Exact source-field changes invalidate only that field and require an explicit targeted action.
let fieldSource = structuredClone(bilingualSource)
let fieldArabic = setArticleBlockTranslations(fieldSource, null, fieldSource.blocks.flatMap(block =>
  getArticleBlockTextFields(block).filter(field => field.text.trim()).map(field => ({ blockId: block.id, path: field.path, text: `عربي ${field.text}` }))))!
const fieldHost: Host = { cells: [], cursor: 0 }
function renderFields() {
  return render(fieldHost, ArticlePageBuilder, { doc: fieldSource, docAr: fieldArabic,
    onChange(next) { fieldSource = next }, onArabicChange(next) { fieldArabic = next } })
}
function arabicField(value: unknown, id: string, path: ArticleBlockTextPath) {
  return find(find(value, node => node.props['data-arabic-block'] === id), node => node.props['data-arabic-field'] === JSON.stringify(path))
}
function resolveFieldRequest(translation: string) {
  const input = fieldRequests.at(-1)!
  resolveField!({ blockId: input.blockId, blockType: input.blockType, fieldPath: [...input.fieldPath], sourceText: input.text, translation })
}
let fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'translated')
assert.equal(arabicField(fieldTree, 'image', ['alt']).props['data-arabic-status'], 'missing')
const beforeSourceEdit = structuredClone(fieldArabic)
const beforeFieldRequests = fieldRequests.length
const beforeBulkPreviews = previewCalls
fieldsFor(fieldTree, 'heading').props.patchProps({ text: 'عنوان فارسی تغییرکرده' })
fieldTree = renderFields()
assert.equal(fieldRequests.length, beforeFieldRequests)
assert.equal(previewCalls, beforeBulkPreviews, 'typing Persian text never requests automatic translation')
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'needs-retranslation')
assert.equal(find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'textarea').props.value, '')
for (const block of fieldArabic.blocks.filter(b => b.id !== 'heading')) {
  assert.deepEqual(block.props, beforeSourceEdit.blocks.find(b => b.id === block.id)!.props, `heading edit preserves other manual ${block.type} translations`)
}
assert.equal(arabicField(fieldTree, 'pin-one', ['address']).props['data-arabic-status'], 'translated')
find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'button').props.onClick()
assert.deepEqual(fieldRequests.at(-1), { blockId: 'heading', blockType: 'heading', fieldPath: ['text'], text: 'عنوان فارسی تغییرکرده' }, 'a field action sends exactly its current Persian text and identity')
assert.equal(fieldRequests.length, beforeFieldRequests + 1)
assert.equal(previewCalls, beforeBulkPreviews, 'field action never invokes whole-block or whole-article translation')
assert(!('blocksAr' in fieldRequests.at(-1)!) && !('blocks' in fieldRequests.at(-1)!))
fieldTree = renderFields()
assert.equal(find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'textarea').props.disabled, undefined, 'manual editing remains available during translation')
resolveFieldRequest('العنوان الجديد فقط')
await new Promise(resolve => setTimeout(resolve, 0))
fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'translated')
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'heading'), ['text']), 'العنوان الجديد فقط')
for (const block of fieldArabic.blocks.filter(b => b.id !== 'heading')) assert.deepEqual(block.props, beforeSourceEdit.blocks.find(b => b.id === block.id)!.props)
fieldsFor(fieldTree, 'pin-one').props.patchProps({ address: 'آدرس جدید فقط برای یک شعبه' })
fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'pin-one', ['address']).props['data-arabic-status'], 'needs-retranslation')
assert.equal(arabicField(fieldTree, 'pin-one', ['title']).props['data-arabic-status'], 'translated')
assert.equal(arabicField(fieldTree, 'pin-two', ['address']).props['data-arabic-status'], 'translated')
const selectedPin = fieldSource.blocks.find(b => b.id === 'pin-one')!
assert.equal(selectedPin.type, 'location')
assert.equal(selectedPin.props.lat, 37.4822056789)
assert.equal(selectedPin.props.lng, 49.4418273456)
fieldsFor(fieldTree, 'pin-one').props.patchProps({ lat: 37.98765432109, lng: 49.12345678901 })
fieldSource = { ...fieldSource, blocks: fieldSource.blocks.map(b => ({ ...b, width: 'sm', anim: 'blur', style: { bg: '#010203', fg: '#abcdef' } })) }
fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'translated')
assert.equal(arabicField(fieldTree, 'pin-one', ['title']).props['data-arabic-status'], 'translated', 'coordinate and style changes do not invalidate translated titles')
const beforeChangedOnly = fieldRequests.length
find(fieldTree, node => node.type === 'button' && node.props.children === 'ترجمه فقط فیلدهای تغییرکرده').props.onClick()
assert.equal(fieldRequests.length, beforeChangedOnly + 1)
assert.deepEqual(fieldRequests.at(-1), { blockId: 'pin-one', blockType: 'location', fieldPath: ['address'], text: 'آدرس جدید فقط برای یک شعبه' })
assert.equal(previewCalls, beforeBulkPreviews)
resolveFieldRequest('العنوان الجديد للفرع')
await new Promise(resolve => setTimeout(resolve, 0))
fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'pin-one', ['address']).props['data-arabic-status'], 'translated')
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'pin-two'), ['address']), 'عربي آدرس دوم')
assert.deepEqual(fieldArabic.blocks.find(b => b.id === 'pin-one')?.props, { lat: 37.98765432109, lng: 49.12345678901, title: 'عربي اول', address: 'العنوان الجديد للفرع' })
const duplicateHeading = { ...structuredClone(fieldSource.blocks.find(b => b.id === 'heading')!), id: 'new-heading-copy' }
fieldSource = { ...fieldSource, blocks: [duplicateHeading, ...[...fieldSource.blocks].reverse()] }
fieldTree = renderFields()
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'translated', 'block order does not invalidate reviewed fields')
assert.equal(arabicField(fieldTree, 'new-heading-copy', ['text']).props['data-arabic-status'], 'missing', 'a duplicate with a fresh ID never inherits the original translation')
const repeatedFieldTree = renderFields()
assert.equal(arabicField(repeatedFieldTree, 'new-heading-copy', ['text']).props['data-arabic-status'], 'missing', 'invalidation survives rerenders when parent Arabic props have not updated yet')
find(fieldTree, node => node.type === 'button' && node.props.children === 'ترجمه خودکار همه بلوک‌ها به عربی').props.onClick()
assert.equal(previewCalls, beforeBulkPreviews + 1)
assert(!('blocksAr' in previewInput!), 'initial all/block previews do not retransmit existing Arabic')
assert.deepEqual(previewInput!.blocks.blocks.flatMap(b => getArticleBlockTextFields(b).filter(f => f.text.trim()).map(f => [b.id, f.path, f.text])),
  [['new-heading-copy', ['text'], 'عنوان فارسی تغییرکرده']], 'Translate All omits every completed Persian sibling and sends only untranslated source fields')
resolveTranslation!(setArticleBlockText(normalizeArticleBlocksTranslation(previewInput!.blocks, null)!, 'new-heading-copy', ['text'], 'عنوان النسخة الجديدة'))
await new Promise(resolve => setTimeout(resolve, 0))
fieldTree = renderFields()
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'heading'), ['text']), 'العنوان الجديد فقط')
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'new-heading-copy'), ['text']), 'عنوان النسخة الجديدة')
fieldsFor(fieldTree, 'heading').props.patchProps({ text: 'المصدر الفارسي الأول' })
fieldTree = renderFields()
find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'button').props.onClick()
const pendingSourceFields = fieldsFor(fieldTree, 'heading').props.patchProps
pendingSourceFields({ text: 'المصدر الفارسي الثاني' })
pendingSourceFields({ text: 'المصدر الفارسي الأول' })
resolveFieldRequest('اقتراح قديم رغم الرجوع')
await new Promise(resolve => setTimeout(resolve, 0))
fieldTree = renderFields()
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'heading'), ['text']), '', 'A -> B -> A before rerender still discards a pending stale field response')
assert.equal(arabicField(fieldTree, 'heading', ['text']).props['data-arabic-status'], 'needs-retranslation')
find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'button').props.onClick()
find(arabicField(fieldTree, 'heading', ['text']), node => node.type === 'textarea').props.onChange({ target: { value: 'تصحيح يدوي أثناء الطلب' } })
resolveFieldRequest('اقتراح آلي متأخر')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(readArticleBlockText(fieldArabic.blocks.find(b => b.id === 'heading'), ['text']), 'تصحيح يدوي أثناء الطلب', 'a pending one-field response never overwrites manual review')

const client = new QueryClient()
const affectedKeys = [qk.articleCategories, qk.adminArticleCategories, qk.adminArticles,
  qk.articles('all', 'all'), qk.articles('category-a', 'sub-a'), qk.adminArticleDetails('a'), qk.adminArticleDetails('b')]
for (const key of affectedKeys) client.setQueryData(key, [])
client.setQueryData(['unrelated'], [])
await invalidateArticleQueries(client)
for (const key of affectedKeys) assert.equal(client.getQueryState(key)?.isInvalidated, true, `Article mutation refreshes ${key.join('/')}`)
assert.equal(client.getQueryState(['unrelated'])?.isInvalidated, false)
client.clear()
console.log('Articles admin regressions passed: plain/builder editing, draft preservation, mode conversion, categories, Arabic steps, immutable process edits, stable IDs, delayed uploads, undo, long text migration, map-based location picking and article cache invalidation.')
