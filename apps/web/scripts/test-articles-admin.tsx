import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ArticleBlocksDoc } from '@sinshin/shared'
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
mock.module('#/components/shared/Toggle', () => ({ Toggle: () => null }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null }))

const { ArticleForm } = await import('../src/components/admin/ArticleForm')
const { ArticlePageBuilder } = await import('../src/components/admin/articles/builder/ArticlePageBuilder')
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
function render<T>(instance: Host, component: (props: T) => unknown, props: T) {
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

const client = new QueryClient()
const affectedKeys = [qk.articleCategories, qk.adminArticleCategories, qk.adminArticles,
  qk.articles('all', 'all'), qk.articles('category-a', 'sub-a'), qk.adminArticleDetails('a'), qk.adminArticleDetails('b')]
for (const key of affectedKeys) client.setQueryData(key, [])
client.setQueryData(['unrelated'], [])
await invalidateArticleQueries(client)
for (const key of affectedKeys) assert.equal(client.getQueryState(key)?.isInvalidated, true, `Article mutation refreshes ${key.join('/')}`)
assert.equal(client.getQueryState(['unrelated'])?.isInvalidated, false)
client.clear()
console.log('Articles admin regressions passed: plain/builder editing, draft preservation, mode conversion, categories, Arabic steps, immutable process edits, stable IDs, delayed uploads, undo, long text migration and article cache invalidation.')
