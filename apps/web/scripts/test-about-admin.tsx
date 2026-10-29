import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ArticleBlocksDoc } from '@sinshin/shared'
import type { AboutContent, AboutContentInput } from '../src/types/site/about'

// Run the real editor and builder handlers with a deterministic hook host.
// Upload, translation and map SDK boundaries are replaced; draft state is real.
const react = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number; effects: (() => void)[]; changed: boolean }
const freshHost = (): Host => ({ cells: [], cursor: 0, effects: [], changed: false })
let host = freshHost()
mock.module('react', () => ({
	...react,
	memo: (component: unknown) => component,
	useState<T>(initial: T | (() => T)) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
		return [active.cells[index], (value: T | ((previous: T) => T)) => {
			const next = typeof value === 'function' ? (value as (previous: T) => T)(active.cells[index] as T) : value
			active.changed ||= !Object.is(next, active.cells[index])
			active.cells[index] = next
		}]
	},
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useEffect(effect: () => void, deps: unknown[]) {
		const index = host.cursor++
		const before = host.cells[index] as unknown[] | undefined
		if (!before || deps.some((value, at) => !Object.is(value, before[at]))) host.effects.push(effect)
		host.cells[index] = deps
	},
	useCallback: (callback: unknown) => callback,
	useMemo: (compute: () => unknown) => compute(),
}))
mock.module('#/components/shared/ImageField', () => ({ ImageField: () => null }))
mock.module('#/components/shared/MapPicker', () => ({ MapPicker: () => null }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null }))
mock.module('#/components/ConfirmModal', () => ({ ConfirmModal: () => null }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (state: unknown) => unknown) => select({ showToast() {} }) }))

const { AboutContentForm } = await import('../src/components/admin/settings/AboutContentForm')
const { ArticlePageBuilder } = await import('../src/components/admin/articles/builder/ArticlePageBuilder')
const { ImageField } = await import('../src/components/shared/ImageField')
const { MapPicker } = await import('../src/components/shared/MapPicker')
const { ArField } = await import('../src/components/admin/ArField')
const { ConfirmModal } = await import('../src/components/ConfirmModal')

type Element = { type: unknown; props: Record<string, any> }
function nodes(value: unknown): Element[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('props' in value)) return []
	const element = value as Element
	return [element, ...nodes(element.props.children)]
}
function find(value: unknown, predicate: (element: Element) => boolean) {
	const found = nodes(value).find(predicate)
	assert(found, 'Expected editor control is present')
	return found
}
function render<T>(active: Host, component: (props: T) => unknown, props: T) {
	let tree: unknown
	for (let attempts = 0; attempts < 10; attempts++) {
		host = active
		active.cursor = 0
		active.changed = false
		active.effects = []
		tree = component(props)
		for (const effect of active.effects) effect()
		if (!active.changed) return tree
	}
	throw new Error('Render did not settle')
}

const initial: AboutContent = {
	heroTitle: 'Our restaurant', heroText: 'Original story', heroGradient: '/uploads/hero.png',
	teamTitle: 'Our team', teamGradient: '/uploads/team.webp', teamAlt: 'Kitchen team',
	heroTitleAr: 'مطعمنا', heroTextAr: '', teamTitleAr: 'فريقنا', teamAltAr: 'فريق المطبخ',
	updatedAt: new Date('2026-10-29T10:00:00Z'),
	location: { lat: 37.4822056, lng: 49.4418273, address: 'Restaurant entrance', addressAr: 'مدخل المطعم' },
	blocks: { version: 1, blocks: [
		{ id: 'a', type: 'paragraph', props: { text: 'First section' } },
		{ id: 'b', type: 'paragraph', props: { text: 'Second section' } },
	] },
	blocksAr: null,
}
const original = structuredClone(initial)
let currentInitial = initial
let isSaving = false
let saveWork: (input: AboutContentInput) => Promise<unknown> = async () => ({ success: true })
const saved: AboutContentInput[] = []
const formHost = freshHost()
let tree: unknown
const renderForm = () => {
	tree = render(formHost, AboutContentForm, {
		initialData: currentInitial, isSaving,
		onSave: async (input) => { saved.push(input); return saveWork(input) },
	})
	return tree
}
const field = (name: string) => find(tree, (node) => node.props.name === name)
const submitControl = () => find(tree, (node) => node.type === 'button' && node.props.type === 'submit')
const submit = () => find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} }) as Promise<void>
const button = (label: string) => find(tree, (node) => node.type === 'button' && node.props.children === label)
function change(name: string, value: string) {
	field(name).props.onChange({ target: { value } })
	renderForm()
}

renderForm()
assert.equal(field('heroTitle').props.value, initial.heroTitle, 'initial content renders without a blank draft flash')
assert.equal(submitControl().props.disabled, true, 'unchanged content cannot submit')
change('heroText', 'Draft story')
currentInitial = { ...initial, updatedAt: new Date('2026-10-29T10:01:00Z'), heroText: 'External update' }
renderForm()
assert.equal(field('heroText').props.value, 'Draft story', 'background refetch cannot overwrite unsaved text')
saveWork = async () => { throw new Error('Connection lost — please retry') }
await submit()
renderForm()
assert.equal(field('heroText').props.value, 'Draft story', 'failed save preserves draft')
assert.equal(submitControl().props.disabled, false, 'failed save remains retryable')
assert.equal(find(tree, (node) => node.props.role === 'alert').props.children, 'Connection lost — please retry')

let finishSave: (() => void) | undefined
saveWork = () => new Promise((resolve) => { finishSave = () => resolve({ success: true }) })
const firstSubmit = submit()
await submit()
assert.equal(saved.length, 2, 'duplicate submission is blocked before rerender')
isSaving = true
renderForm()
assert.equal(find(tree, (node) => node.type === 'fieldset').props.disabled, true)
assert.equal(field('heroText').props.value, 'Draft story', 'mutation pending rerenders preserve draft')
// A upload callback already in flight can still arrive while controls are disabled.
find(tree, (node) => node.type === ImageField && node.props.label.startsWith('تصویر اصلی')).props.onAdd('/uploads/new-hero.webp')
renderForm()
finishSave?.()
await firstSubmit
isSaving = false
renderForm()
assert.equal(submitControl().props.disabled, false, 'edits arriving during save remain dirty')
assert.deepEqual(find(tree, (node) => node.type === ImageField && node.props.label.startsWith('تصویر اصلی')).props.images, ['/uploads/new-hero.webp'])

// Removing optional material clears the public fields and its translations.
find(tree, (node) => node.type === ImageField && node.props.label.startsWith('تصویر اصلی')).props.onRemove(0)
renderForm()
button('حذف بخش تیم').props.onClick()
renderForm()
find(tree, (node) => node.type === ConfirmModal).props.onConfirm()
renderForm()
assert.equal(field('teamTitle').props.value, '')
assert.equal(find(tree, (node) => node.type === ArField && node.props.label === 'عنوان بخش تیم').props.value, '')
assert.equal(submitControl().props.disabled, false, 'image-free About content is valid')

// The existing page builder drives edits, additions, reordering and removal.
const builderHost = freshHost()
let builderTree: unknown
function renderBuilder() {
	renderForm()
	const element = find(tree, (node) => node.type === ArticlePageBuilder)
	builderTree = render(builderHost, ArticlePageBuilder, element.props as { doc: ArticleBlocksDoc; onChange: (doc: ArticleBlocksDoc) => void })
}
renderBuilder()
find(builderTree, (node) => node.props.block?.id === 'a' && typeof node.props.patchProps === 'function').props.patchProps({ text: 'Edited section' })
renderBuilder()
find(builderTree, (node) => node.props['aria-label'] === 'دوبل‌کردن بلوک').props.onClick()
renderBuilder()
let doc = find(tree, (node) => node.type === ArticlePageBuilder).props.doc as ArticleBlocksDoc
assert.equal(doc.blocks.length, 3, 'new section is added through builder')
assert.notEqual(doc.blocks[0]!.id, doc.blocks[1]!.id)
find(builderTree, (node) => node.props['aria-label'] === 'انتقال به پایین' && !node.props.disabled).props.onClick()
renderBuilder()
find(builderTree, (node) => node.props['aria-label'] === 'حذف بلوک').props.onClick()
renderBuilder()
doc = find(tree, (node) => node.type === ArticlePageBuilder).props.doc
assert.deepEqual(doc.blocks.map((block) => block.id), ['a', 'b'], 'reorder and removal preserve remaining content identities')
assert.equal((doc.blocks[0]!.props as { text: string }).text, 'Edited section')

button('عربی').props.onClick()
renderForm()
const arDoc: ArticleBlocksDoc = { version: 1, blocks: [{ id: 'ar-a', type: 'paragraph', props: { text: 'قصتنا' } }] }
find(tree, (node) => node.type === ArticlePageBuilder).props.onChange(arDoc)
renderForm()
assert.deepEqual(find(tree, (node) => node.type === ArticlePageBuilder).props.doc, arDoc)
button('فارسی').props.onClick()
renderForm()
assert.deepEqual(find(tree, (node) => node.type === ArticlePageBuilder).props.doc, doc, 'language switching preserves independent drafts')
button('عربی').props.onClick()
renderForm()
button('حذف محتوای عربی و استفاده از فارسی').props.onClick()
renderForm()
find(tree, (node) => node.type === ConfirmModal).props.onConfirm()
renderForm()
assert.equal(find(tree, (node) => node.type === ArticlePageBuilder).props.doc.blocks.length, 0)
const emptyAboutBuilder = find(tree, (node) => node.type === ArticlePageBuilder)
const emptyBuilderTree = render(freshHost(), ArticlePageBuilder, emptyAboutBuilder.props as Parameters<typeof ArticlePageBuilder>[0])
assert.equal(nodes(emptyBuilderTree).some((node) => node.props.children?.includes?.('— حداقل یک بلوکِ متنی لازم است')), false, 'optional About sections must not claim that a text block is required')

// Manual-coordinate partial input must block submission of a stale valid pin.
find(tree, (node) => node.type === MapPicker).props.onValidityChange(false)
renderForm()
const beforeInvalid = saved.length
await submit()
assert.equal(saved.length, beforeInvalid)
assert.equal(submitControl().props.disabled, true)
find(tree, (node) => node.type === MapPicker).props.onChange({ lat: 91, lng: 49 })
renderForm()
assert.equal(submitControl().props.disabled, true, 'invalid coordinates cannot be saved')
find(tree, (node) => node.type === MapPicker).props.onChange({ lat: 37.5, lng: 49.5 })
renderForm()
change('locationAddress', 'New entrance')
assert.equal(submitControl().props.disabled, false)

saveWork = async (input) => {
	currentInitial = { ...input, updatedAt: new Date('2026-10-29T10:02:00Z') }
	return { success: true }
}
await submit()
renderForm()
const result = saved.at(-1)!
assert.equal(result.heroText, 'Draft story')
assert.equal(result.heroGradient, '')
assert.equal(result.teamGradient, '')
assert.equal(result.teamTitleAr, '')
assert.equal(result.blocksAr, null, 'removing the Arabic version restores Persian fallback')
assert.deepEqual(result.blocks, doc)
assert.deepEqual(result.location, { lat: 37.5, lng: 49.5, address: 'New entrance', addressAr: 'مدخل المطعم' })
assert.equal(submitControl().props.disabled, true, 'only a successful save marks the draft clean')
assert.deepEqual(initial, original, 'editing never mutates cached input')

change('heroTitle', '   ')
assert.equal(submitControl().props.disabled, true, 'whitespace-only title cannot be saved')
currentInitial = { ...currentInitial, heroTitle: 'External clean value', updatedAt: new Date('2026-10-29T10:03:00Z') }
renderForm()
assert.equal(field('heroTitle').props.value, '   ', 'a later refetch still cannot erase a new edit')

// A successful PATCH need not have a successful follow-up GET. The ignored
// pre-save response must not be reapplied when the dirty flag is cleared.
const raceHost = freshHost()
let raceInitial = initial
const renderRace = () => render(raceHost, AboutContentForm, {
	initialData: raceInitial, isSaving: false,
	onSave: async () => ({ success: true }),
})
let raceTree = renderRace()
find(raceTree, (node) => node.props.name === 'heroText').props.onChange({ target: { value: 'Saved local story' } })
raceInitial = { ...initial, heroText: 'Older external story', updatedAt: new Date('2026-10-29T11:00:00Z') }
raceTree = renderRace()
await find(raceTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
raceTree = renderRace()
assert.equal(find(raceTree, (node) => node.props.name === 'heroText').props.value, 'Saved local story', 'successful save plus failed refetch cannot restore an ignored older response')

// A partial coordinate edit must preserve the whole draft even when no text
// field has been touched yet.
const mapDraftHost = freshHost()
let mapDraftInitial = initial
const renderMapDraft = () => render(mapDraftHost, AboutContentForm, {
	initialData: mapDraftInitial, isSaving: false,
	onSave: async () => ({ success: true }),
})
let mapDraftTree = renderMapDraft()
find(mapDraftTree, (node) => node.type === MapPicker).props.onValidityChange(false)
mapDraftInitial = {
	...initial, heroText: 'Newer server story',
	location: { lat: 38, lng: 50, address: 'Moved restaurant' },
	updatedAt: new Date('2026-10-29T12:00:00Z'),
}
mapDraftTree = renderMapDraft()
assert.deepEqual(find(mapDraftTree, (node) => node.type === MapPicker).props.value, initial.location, 'refetch cannot replace a partial coordinate draft')
assert.equal(find(mapDraftTree, (node) => node.props.name === 'heroText').props.value, initial.heroText)
assert.equal(find(mapDraftTree, (node) => node.props.type === 'submit').props.disabled, true)

// The restaurant settings remain the source of the destination until the
// editor explicitly changes the About location or its address.
const defaultHost = freshHost()
const defaultInitial: AboutContent = { ...initial, location: null, defaultLocation: initial.location }
const defaultSaves: AboutContentInput[] = []
const renderDefault = () => render(defaultHost, AboutContentForm, {
	initialData: defaultInitial, isSaving: false,
	onSave: async (input) => { defaultSaves.push(input); return { success: true } },
})
let defaultTree = renderDefault()
assert.deepEqual(find(defaultTree, (node) => node.type === MapPicker).props.value, initial.location)
find(defaultTree, (node) => node.props.name === 'heroText').props.onChange({ target: { value: 'New default story' } })
defaultTree = renderDefault()
await find(defaultTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(defaultSaves.at(-1)?.location, null, 'saving text must not freeze the configured restaurant location')

defaultTree = renderDefault()
const pendingTranslation = find(defaultTree, (node) => node.type === ArField && node.props.label === 'آدرس رستوران').props.onChange
find(defaultTree, (node) => node.type === MapPicker).props.onChange({ lat: 37.6, lng: 49.6 })
defaultTree = renderDefault()
pendingTranslation('المدخل الجديد')
defaultTree = renderDefault()
await find(defaultTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.deepEqual(defaultSaves.at(-1)?.location, {
	lat: 37.6, lng: 49.6, address: 'Restaurant entrance', addressAr: 'المدخل الجديد',
}, 'delayed Arabic translation must preserve the latest selected destination')

defaultTree = renderDefault()
find(defaultTree, (node) => node.type === MapPicker).props.onValidityChange(false)
defaultTree = renderDefault()
find(defaultTree, (node) => node.type === 'button' && node.props.children === 'استفاده از موقعیت تنظیمات اصلی').props.onClick()
defaultTree = renderDefault()
assert.deepEqual(find(defaultTree, (node) => node.type === MapPicker).props.value, initial.location)
assert.equal(find(defaultTree, (node) => node.props.type === 'submit').props.disabled, false)
await find(defaultTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(defaultSaves.at(-1)?.location, null, 'reset restores inheritance from restaurant settings')

// Catch blocks that the normalizer would silently drop or change. Validate
// the inactive language too, so a bad Arabic pin cannot disappear on save.
for (const [language, block] of [
	['fa', { id: 'bad-link', type: 'link', props: { label: 'More', href: 'javascript:alert(1)' } }],
	['ar', { id: 'bad-pin', type: 'location', props: { lat: 91, lng: 49 } }],
	['fa', { id: 'bad-cta', type: 'cta', props: { label: 'More', to: 'url', href: '' } }],
	['ar', { id: 'bad-gallery', type: 'gallery', props: { layout: 'grid', images: Array.from({ length: 13 }, () => ({ src: '/uploads/image.png' })) } }],
] as const) {
	const invalidHost = freshHost()
	let saves = 0
	const invalidInitial: AboutContent = {
		...initial,
		[language === 'fa' ? 'blocks' : 'blocksAr']: { version: 1, blocks: [block] },
	}
	const renderInvalid = () => render(invalidHost, AboutContentForm, {
		initialData: invalidInitial, isSaving: false,
		onSave: async () => { saves++; return { success: true } },
	})
	let invalidTree = renderInvalid()
	find(invalidTree, (node) => node.props.name === 'heroText').props.onChange({ target: { value: 'Edited story' } })
	invalidTree = renderInvalid()
	await find(invalidTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
	invalidTree = renderInvalid()
	assert.equal(saves, 0, `${language} ${block.type} validation blocks data loss`)
	assert.equal(find(invalidTree, (node) => node.type === ArticlePageBuilder).props.doc.blocks[0].id, block.id, 'invalid language is selected for correction')
	assert.match(find(invalidTree, (node) => node.props.role === 'alert').props.children, language === 'fa' ? /محتوای فارسی/ : /محتوای عربی/)
}

console.log('PASS About editor: draft retention, save retries, bilingual block validation, location defaults/reset, translation races and map validity')
