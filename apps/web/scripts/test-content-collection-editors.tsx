import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { contentSourceRevision, contentTranslationFields, reconcileContentTranslation, type ContentEntityType } from '@sinshin/shared'
import type { ContentTranslationBinding } from '../src/hooks/admin/useContentTranslationDraft'
import { requireContentSourceRevision } from '../src/utils/contentTranslationDraft'

const actualReact = { ...await import('react') }
type Host = { cells: unknown[]; cursor: number; effects: (() => void)[] }
const fresh = (): Host => ({ cells: [], cursor: 0, effects: [] })
let host = fresh()
mock.module('react', () => ({ ...actualReact,
	memo: (component: unknown) => component,
	useState<T>(initial: T | (() => T)) { const active = host, at = active.cursor++;
		if (!(at in active.cells)) active.cells[at] = typeof initial === 'function' ? (initial as () => T)() : initial
		return [active.cells[at], (value: T | ((before: T) => T)) => { active.cells[at] = typeof value === 'function' ? (value as (before: T) => T)(active.cells[at] as T) : value }] },
	useRef<T>(initial: T) { const at = host.cursor++; if (!(at in host.cells)) host.cells[at] = { current: initial }; return host.cells[at] },
	useEffect(effect: () => void, deps: unknown[]) { const at = host.cursor++, previous = host.cells[at] as unknown[] | undefined;
		if (!previous || deps.some((value, index) => value !== previous[index])) host.effects.push(effect); host.cells[at] = deps },
	useCallback: (callback: unknown) => callback, useMemo: (compute: () => unknown) => compute(),
}))
const queryRows = new Map<string, unknown>()
const mutations: unknown[] = []
const mutationTasks: Promise<unknown>[] = []
mock.module('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: unknown[] }) => ({ data: queryRows.get(JSON.stringify(options.queryKey)), isLoading: false, isPending: false, isError: false }),
	useQueryClient: () => ({ invalidateQueries: async () => {} }),
	useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onError?: (error: Error) => void }) => ({ isPending: false, mutate: (input: unknown) => {
		mutations.push(input); const task = options.mutationFn(input).catch(error => options.onError?.(error)); mutationTasks.push(task); return task
	} }),
}))
const toasts: string[] = []
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (state: unknown) => unknown) => select({ showToast: (text: string) => toasts.push(text) }) }))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ role: 'ADMIN' }) }))
mock.module('@tanstack/react-router', () => ({ Link: () => null, useRouter: () => ({ invalidate: async () => {} }), useRouterState: () => ({ location: { pathname: '/' } }) }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null }))
mock.module('#/components/shared/ImageField', () => ({ ImageField: () => null }))
mock.module('#/components/shared/PersianDatePicker', () => ({ PersianDatePicker: () => null }))
mock.module('#/components/ProductCard', () => ({ ProductCard: () => null }))
mock.module('#/components/admin/articles/builder/ArticlePageBuilder', () => ({ ArticlePageBuilder: () => null }))
mock.module('#/utils/queryOptions', () => ({ adminCategoriesOptions: { queryKey: ['categories'] }, packagingItemsOptions: { queryKey: ['packaging'] },
	settingsFeaturedAnimationOptions: { queryKey: ['animation'] }, adminMainCategoriesOptions: { queryKey: ['mains'] }, adminArticleCategoriesOptions: { queryKey: ['article-categories'] } }))
mock.module('#/server/products', () => ({ createCategory: async () => ({ success: true }), updateCategory: async () => ({ success: true }), deleteCategory: async () => ({ success: true }) }))
mock.module('#/server/articles', () => ({ createArticleCategory: async () => ({ success: true }), updateArticleCategory: async () => ({ success: true }), deleteArticleCategory: async () => ({ success: true }) }))
const termsCalls: { operation: 'create' | 'update'; input: Record<string, unknown> }[] = []
let termsConflict = false
mock.module('#/server/terms', () => ({ getAdminTerms: async () => null,
	createTerms: async (input: Record<string, unknown>) => { termsCalls.push({ operation: 'create', input });
		if (termsConflict) throw new Error('قوانین ذخیره‌شده تغییر کرده است؛ پیش‌نویس شما حفظ شده است')
		return { success: true, version: 1 } },
	updateTerms: async (input: Record<string, unknown>) => { requireContentSourceRevision(input.sourceRevision as string | undefined);
		termsCalls.push({ operation: 'update', input }); return { success: true, version: 2 } },
}))
let translatorCalls = 0
mock.module('#/server/translation', () => ({ translatePreview: async () => { translatorCalls++; return [] }, translateContentField: async () => { translatorCalls++; throw new Error('Unexpected translation') } }))
const { ProductForm } = await import('../src/components/admin/ProductForm')
const { ArticleForm } = await import('../src/components/admin/ArticleForm')
const { TermsEditor } = await import('../src/components/admin/settings/TermsEditor')
const { CategoryManager } = await import('../src/components/admin/products/CategoryManager')
const { ArticleCategoryManager } = await import('../src/components/admin/articles/ArticleCategoryManager')
const { ArField } = await import('../src/components/admin/ArField')
type Node = { type: unknown; props: Record<string, unknown> }
function nodes(value: unknown): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('props' in value) || !('type' in value)) return []
	const node = value as Node
	return [node, ...nodes(node.props.children)]
}
function find(tree: unknown, test: (node: Node) => boolean): Node { const found = nodes(tree).find(test); assert(found, `Expected editor control: ${test}`); return found }
function click(node: Node) { assert.equal(typeof node.props.onClick, 'function'); (node.props.onClick as () => void)() }
function change(node: Node, value: string) { assert.equal(typeof node.props.onChange, 'function');
	(node.props.onChange as (event: unknown) => void)({ target: { value, name: node.props.name, type: 'text' } }) }
function render(active: Host, component: (props: never) => unknown, props: unknown = {}) {
	host = active; host.cursor = 0; host.effects = []; const tree = component(props as never); for (const effect of host.effects) effect(); return tree
}
function seeded(type: ContentEntityType, source: Record<string, unknown>) {
	const missing = reconcileContentTranslation(type, String(source.id), null, source)
	const translated = reconcileContentTranslation(type, String(source.id), missing, missing, contentTranslationFields(type, missing).map(field => ({
		fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText, revision: field.revision, origin: 'manual', value: `عربي ${field.sourceText}`,
	})))
	return { ...translated, sourceRevision: contentSourceRevision(type, translated) }
}
function binding(node: Node): ContentTranslationBinding { assert(node.props.translation); return node.props.translation as ContentTranslationBinding }
function arabicField(tree: unknown, reference: string): Node { return find(tree, node => node.type === ArField && node.props.faReference === reference) }
queryRows.set(JSON.stringify(['categories']), [{ id: 'category', name: 'غذا' }])
queryRows.set(JSON.stringify(['mains']), [{ id: 'main', name: 'اصلی' }])
queryRows.set(JSON.stringify(['article-categories']), [{ id: 'category', name: 'خبر', hasSubCategories: false }])

const product = seeded('product', { id: 'product', name: 'محصول', description: 'شرح', originalPrice: 100, discountPercentage: 0, prepTime: 15, packagingCost: 0,
	categoryId: 'category', categoryIds: ['category'], profileImage: '/product.png', galleryImages: ['/gallery.png'], sizes: [], ingredients: ['اول', 'دوم'], sizesEnabled: false })
let productSave: Record<string, unknown> | undefined
const productHost = fresh(), productProps = { initialData: product, onSubmit: (value: Record<string, unknown>) => { productSave = value }, isSubmitting: false }
const renderProduct = () => render(productHost, ProductForm as (props: never) => unknown, productProps)
renderProduct(); let productTree = renderProduct()
const oldIngredient = binding(arabicField(productTree, 'اول')).field.fieldId
change(find(productTree, node => node.type === 'input' && node.props.value === 'اول'), 'اول ویرایش‌شده')
productTree = renderProduct()
assert.equal(binding(arabicField(productTree, 'اول ویرایش‌شده')).field.fieldId, oldIngredient)
assert.equal(binding(arabicField(productTree, 'اول ویرایش‌شده')).status, 'needs-review')
click(find(productTree, node => node.props['aria-label'] === 'انتقال ماده به پایین' && !node.props.disabled))
productTree = renderProduct()
const movedIngredient = binding(arabicField(productTree, 'اول ویرایش‌شده'))
assert.deepEqual(movedIngredient.field.fieldPath, ['ingredients', 1]); assert.equal(movedIngredient.field.fieldId, oldIngredient)
const manualNode = arabicField(productTree, 'اول ویرایش‌شده')
binding(manualNode).edit('مادة يدوية'); (manualNode.props.onChange as (value: string) => void)('مادة يدوية')
productTree = renderProduct(); (find(productTree, node => node.type === 'form').props.onSubmit as (event: unknown) => void)({ preventDefault() {} })
assert(productSave); assert.equal(productSave.sourceRevision, product.sourceRevision)
const savedProduct = reconcileContentTranslation('product', 'product', product, productSave, productSave.translationEdits as never)
assert.deepEqual(savedProduct.ingredientsAr, ['عربي دوم', 'مادة يدوية'])
assert.deepEqual(savedProduct.translationState.collections, productSave.translationIdentities)

const article = seeded('article', { id: 'article', title: 'عنوان', excerpt: 'خلاصه', content: 'متن مقاله', categoryId: 'category', blocks: null,
	profileImage: '/article.png', galleryImages: [], processes: [{ title: 'روند اول', items: ['گام اول', 'گام دوم'] }, { title: 'روند دوم', items: ['گام دیگر'] }] })
let articleSave: Record<string, unknown> | undefined
const articleHost = fresh(), articleProps = { initialData: article, onSubmit: (value: Record<string, unknown>) => { articleSave = value }, isSubmitting: false }
const renderArticle = () => render(articleHost, ArticleForm as (props: never) => unknown, articleProps)
let articleTree = renderArticle()
const firstStepId = binding(arabicField(articleTree, 'گام اول')).field.fieldId
change(find(articleTree, node => node.props['aria-label'] === 'متن فارسی گام' && node.props.value === 'گام اول'), 'گام ویرایش‌شده')
articleTree = renderArticle(); click(find(articleTree, node => node.props['aria-label'] === 'انتقال گام به پایین' && !node.props.disabled))
articleTree = renderArticle(); click(find(articleTree, node => node.props['aria-label'] === 'انتقال روند به پایین' && !node.props.disabled))
articleTree = renderArticle(); const step = binding(arabicField(articleTree, 'گام ویرایش‌شده'))
assert.equal(step.field.fieldId, firstStepId); assert.deepEqual(step.field.fieldPath, ['processes', 1, 'items', 1])
const articleSubmit = find(articleTree, node => node.type === 'form').props.onSubmit as (event: unknown) => void
articleSubmit({ preventDefault() {} })
assert(articleSave); assert.equal(articleSave.sourceRevision, article.sourceRevision)
const savedArticle = reconcileContentTranslation('article', 'article', article, articleSave, articleSave.translationEdits as never)
assert.equal((savedArticle.processesAr as { items: string[] }[])[1].items[0], 'عربي گام دوم')
assert.equal((savedArticle.processesAr as { items: string[] }[])[1].items[1], '')

const terms = seeded('terms', { id: 'terms-old', version: 1, createdAt: new Date(), sections: [{ title: 'بخش اول', items: ['بند اول', 'بند دوم'] }, { title: 'بخش دوم', items: ['بند دیگر'] }] })
queryRows.set(JSON.stringify(['admin', 'terms-content']), terms)
const termsHost = fresh(), renderTerms = () => render(termsHost, TermsEditor as (props: never) => unknown)
renderTerms(); let termsTree = renderTerms()
const firstTermId = binding(arabicField(termsTree, 'بند اول')).field.fieldId
change(find(termsTree, node => node.type === 'textarea' && node.props.value === 'بند اول'), 'بند ویرایش‌شده')
termsTree = renderTerms(); click(find(termsTree, node => node.props['aria-label'] === 'انتقال بند به پایین' && !node.props.disabled))
termsTree = renderTerms(); click(find(termsTree, node => node.props['aria-label'] === 'انتقال بخش به پایین' && !node.props.disabled))
queryRows.set(JSON.stringify(['admin', 'terms-content']), { ...terms, id: 'terms-concurrent', version: 2, sourceRevision: 'newer-server-token' })
termsTree = renderTerms()
const term = binding(arabicField(termsTree, 'بند ویرایش‌شده'))
assert.equal(term.field.fieldId, firstTermId); assert.deepEqual(term.field.fieldPath, ['sections', 1, 'items', 1])
click(find(termsTree, node => node.props.children === 'ذخیره قوانین (نسخه جدید)'))
const termsSave = mutations.pop() as Record<string, unknown>
assert.equal(termsSave.sourceRevision, terms.sourceRevision, 'a concurrent new terms row cannot silently rebind a dirty editor')
const savedTerms = reconcileContentTranslation('terms', 'terms-old', terms, termsSave, termsSave.translationEdits as never)
assert.equal((savedTerms.sectionsAr as { items: string[] }[])[1].items[0], 'عربي بند دوم')
assert.equal((savedTerms.sectionsAr as { items: string[] }[])[1].items[1], '')
assert.equal(termsCalls.at(-1)?.operation, 'update', 'a persisted terms snapshot must keep the guarded update path')

const termsQueryKey = JSON.stringify(['admin', 'terms-content'])
const addFirstTerms = (active: Host) => {
	const draw = () => render(active, TermsEditor as (props: never) => unknown)
	draw(); let tree = draw()
	click(find(tree, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('افزودن بخش')))
	tree = draw(); change(find(tree, node => node.type === 'input'), 'بخش تازه')
	tree = draw(); change(find(tree, node => node.type === 'textarea'), 'بند تازه')
	return draw
}
queryRows.set(termsQueryKey, { sections: [], sectionsAr: null, translationState: null, arAuto: false, version: 0, updatedAt: new Date().toISOString() })
const firstTermsHost = fresh(), renderFirstTerms = addFirstTerms(firstTermsHost)
let firstTermsTree = renderFirstTerms()
const firstArabic = arabicField(firstTermsTree, 'بند تازه')
binding(firstArabic).edit('بند يدوي'); (firstArabic.props.onChange as (value: string) => void)('بند يدوي')
firstTermsTree = renderFirstTerms(); click(find(firstTermsTree, node => node.props.children === 'ذخیره قوانین (نسخه جدید)'))
const firstTermsCall = termsCalls.at(-1)
assert.equal(firstTermsCall?.operation, 'create', 'an observed empty version-0 Terms snapshot enables explicit first creation')
assert(firstTermsCall); assert.equal(firstTermsCall.input.sourceRevision, undefined)
const firstTermsSave = reconcileContentTranslation('terms', 'created-terms', null, firstTermsCall.input, firstTermsCall.input.translationEdits as never)
assert.deepEqual(firstTermsSave.sections, [{ title: 'بخش تازه', items: ['بند تازه'] }])
assert.equal((firstTermsSave.sectionsAr as { items: string[] }[])[0].items[0], 'بند يدوي')
assert.deepEqual(firstTermsSave.translationState.collections, firstTermsCall.input.translationIdentities)

termsConflict = true
click(find(firstTermsTree, node => node.props.children === 'ذخیره قوانین (نسخه جدید)'))
await Promise.all(mutationTasks.splice(0)); termsConflict = false
firstTermsTree = renderFirstTerms()
assert.equal(arabicField(firstTermsTree, 'بند تازه').props.value, 'بند يدوي', 'a concurrent first-create rejection retains the manual Arabic draft')
assert(nodes(firstTermsTree).some(node => node.type === 'input' && node.props.value === 'بخش تازه'))
assert.match(toasts.at(-1) ?? '', /پیش‌نویس/)

queryRows.delete(termsQueryKey)
const unloadedTermsHost = fresh(), renderUnloadedTerms = addFirstTerms(unloadedTermsHost)
const callsBeforeUnloaded = termsCalls.length, mutationsBeforeUnloaded = mutations.length
click(find(renderUnloadedTerms(), node => node.props.children === 'ذخیره قوانین (نسخه جدید)'))
assert.equal(termsCalls.length, callsBeforeUnloaded, 'a missing/load-failed snapshot is not evidence of first creation')
assert.equal(mutations.length, mutationsBeforeUnloaded)
assert.match(toasts.at(-1) ?? '', /دوباره بارگذاری/)

queryRows.set(termsQueryKey, { ...terms, sourceRevision: undefined })
const unprovenTermsHost = fresh(), renderUnprovenTerms = () => render(unprovenTermsHost, TermsEditor as (props: never) => unknown)
renderUnprovenTerms(); let unprovenTree = renderUnprovenTerms()
change(find(unprovenTree, node => node.type === 'textarea' && node.props.value === 'بند اول'), 'بدون اثبات')
unprovenTree = renderUnprovenTerms(); const callsBeforeUnproven = termsCalls.length
click(find(unprovenTree, node => node.props.children === 'ذخیره قوانین (نسخه جدید)'))
await Promise.all(mutationTasks.splice(0))
assert.equal(termsCalls.length, callsBeforeUnproven, 'existing Terms with a missing saved token must not use createTerms')
assert.match(toasts.at(-1) ?? '', /پیش‌نویس/)

const category = seeded('category', { id: 'category', name: 'دسته', mainCategoryId: 'main', mainCategoryIds: ['main'], sizeNames: ['کوچک', 'بزرگ'] })
const categoryHost = fresh(), renderCategory = () => render(categoryHost, CategoryManager as (props: never) => unknown, { categories: [category] })
let categoryTree = renderCategory()
click(find(categoryTree, node => node.type === 'button' && node.props['aria-label'] === 'ویرایش دسته'))
categoryTree = renderCategory()
const firstTemplateId = binding(arabicField(categoryTree, 'کوچک')).field.fieldId
change(find(categoryTree, node => node.type === 'input' && node.props.value === 'کوچک'), 'کوچک تازه')
categoryTree = renderCategory(); click(find(categoryTree, node => node.props['aria-label'] === 'انتقال قالب به پایین' && !node.props.disabled))
categoryTree = renderCategory(); const template = binding(arabicField(categoryTree, 'کوچک تازه'))
assert.equal(template.field.fieldId, firstTemplateId); assert.deepEqual(template.field.fieldPath, ['sizeNames', 1])
click(find(categoryTree, node => node.type === 'button' && node.props.children === 'ذخیره'))
const categorySave = mutations.pop() as Record<string, unknown>
assert.equal(categorySave.sourceRevision, category.sourceRevision)
const savedCategory = reconcileContentTranslation('category', 'category', category, categorySave, categorySave.translationEdits as never)
assert.deepEqual(savedCategory.sizeNamesAr, ['عربي بزرگ', ''])
const queuedCategoryHost = fresh(), renderQueuedCategory = () => render(queuedCategoryHost, CategoryManager as (props: never) => unknown, { categories: [category] })
click(find(renderQueuedCategory(), node => node.type === 'button' && node.props['aria-label'] === 'ویرایش دسته'))
let queuedCategoryTree = renderQueuedCategory()
const queuedTemplateId = binding(arabicField(queuedCategoryTree, 'کوچک')).field.fieldId
const queuedSourceInput = find(queuedCategoryTree, node => node.type === 'input' && node.props.value === 'کوچک')
click(find(queuedCategoryTree, node => node.props['aria-label'] === 'انتقال قالب به پایین' && !node.props.disabled))
change(queuedSourceInput, 'کوچک هم‌زمان')
queuedCategoryTree = renderQueuedCategory()
const queuedTemplate = binding(arabicField(queuedCategoryTree, 'کوچک هم‌زمان'))
assert.equal(queuedTemplate.field.fieldId, queuedTemplateId, 'a queued source edit follows its stable template ID through a simultaneous reorder')
assert.deepEqual(queuedTemplate.field.fieldPath, ['sizeNames', 1])
assert.equal(binding(arabicField(queuedCategoryTree, 'بزرگ')).status, 'translated', 'the sibling template remains valid after the queued edit/reorder')
const queuedResults: { entity: string; actualId: string; expectedId: string; path: (string | number)[] }[] = []
const queuedProductHost = fresh(), drawQueuedProduct = () => render(queuedProductHost, ProductForm as (props: never) => unknown, productProps)
drawQueuedProduct(); const queuedProductTree = drawQueuedProduct()
const productIngredientId = binding(arabicField(queuedProductTree, 'اول')).field.fieldId
const oldProductInput = find(queuedProductTree, node => node.type === 'input' && node.props.value === 'اول')
click(find(queuedProductTree, node => node.props['aria-label'] === 'انتقال ماده به پایین' && !node.props.disabled))
change(oldProductInput, 'ماده هم‌زمان')
const queuedIngredient = binding(arabicField(drawQueuedProduct(), 'ماده هم‌زمان'))
queuedResults.push({ entity: 'product', actualId: queuedIngredient.field.fieldId, expectedId: productIngredientId, path: queuedIngredient.field.fieldPath })

const queuedArticleHost = fresh(), drawQueuedArticle = () => render(queuedArticleHost, ArticleForm as (props: never) => unknown, articleProps)
const queuedArticleTree = drawQueuedArticle(), articleStepId = binding(arabicField(queuedArticleTree, 'گام اول')).field.fieldId
const oldArticleInput = find(queuedArticleTree, node => node.props['aria-label'] === 'متن فارسی گام' && node.props.value === 'گام اول')
click(find(queuedArticleTree, node => node.props['aria-label'] === 'انتقال گام به پایین' && !node.props.disabled))
change(oldArticleInput, 'گام هم‌زمان')
const queuedStep = binding(arabicField(drawQueuedArticle(), 'گام هم‌زمان'))
queuedResults.push({ entity: 'article', actualId: queuedStep.field.fieldId, expectedId: articleStepId, path: queuedStep.field.fieldPath })

queryRows.set(termsQueryKey, terms)
const queuedTermsHost = fresh(), drawQueuedTerms = () => render(queuedTermsHost, TermsEditor as (props: never) => unknown)
drawQueuedTerms(); const queuedTermsTree = drawQueuedTerms(), termsItemId = binding(arabicField(queuedTermsTree, 'بند اول')).field.fieldId
const oldTermsInput = find(queuedTermsTree, node => node.type === 'textarea' && node.props.value === 'بند اول')
click(find(queuedTermsTree, node => node.props['aria-label'] === 'انتقال بخش به پایین' && !node.props.disabled))
change(oldTermsInput, 'بند هم‌زمان')
const queuedTerm = binding(arabicField(drawQueuedTerms(), 'بند هم‌زمان'))
queuedResults.push({ entity: 'terms', actualId: queuedTerm.field.fieldId, expectedId: termsItemId, path: queuedTerm.field.fieldPath })
assert.deepEqual(queuedResults.map(result => ({ ...result, actualId: result.expectedId })), queuedResults,
	'queued source handlers must resolve stable item IDs after reorder, never the new occupant at their old index')
assert.deepEqual(queuedResults.map(result => result.path), [['ingredients', 1], ['processes', 0, 'items', 1], ['sections', 1, 'items', 0]])

let titleTree = drawQueuedArticle()
const movedTitleId = binding(arabicField(titleTree, 'روند اول')).field.fieldId
const oldTitleInput = find(titleTree, node => node.props['aria-label'] === 'عنوان فارسی روند' && node.props.value === 'روند اول')
click(find(titleTree, node => node.props['aria-label'] === 'انتقال روند به پایین' && !node.props.disabled))
change(oldTitleInput, 'روند هم‌زمان')
titleTree = drawQueuedArticle()
assert.equal(binding(arabicField(titleTree, 'روند هم‌زمان')).field.fieldId, movedTitleId)
assert.deepEqual(binding(arabicField(titleTree, 'روند هم‌زمان')).field.fieldPath, ['processes', 1, 'title'])
assert.equal(binding(arabicField(titleTree, 'روند دوم')).status, 'translated')

const queuedManualProductHost = fresh(), drawManualProduct = () => render(queuedManualProductHost, ProductForm as (props: never) => unknown, productProps)
drawManualProduct(); const manualProductTree = drawManualProduct(), oldManualIngredient = arabicField(manualProductTree, 'اول')
click(find(manualProductTree, node => node.props['aria-label'] === 'انتقال ماده به پایین' && !node.props.disabled))
binding(oldManualIngredient).edit('مادة عند النقل'); (oldManualIngredient.props.onChange as (value: string) => void)('مادة عند النقل')
const movedManualIngredientTree = drawManualProduct()
assert.equal(arabicField(movedManualIngredientTree, 'اول').props.value, 'مادة عند النقل')
assert.equal(arabicField(movedManualIngredientTree, 'دوم').props.value, 'عربي دوم')

const queuedManualArticleHost = fresh(), drawManualArticle = () => render(queuedManualArticleHost, ArticleForm as (props: never) => unknown, articleProps)
const manualArticleTree = drawManualArticle(), oldManualStep = arabicField(manualArticleTree, 'گام اول')
click(find(manualArticleTree, node => node.props['aria-label'] === 'انتقال گام به پایین' && !node.props.disabled))
click(find(manualArticleTree, node => node.props['aria-label'] === 'انتقال روند به پایین' && !node.props.disabled))
binding(oldManualStep).edit('خطوة عند النقل'); (oldManualStep.props.onChange as (value: string) => void)('خطوة عند النقل')
const movedManualArticleTree = drawManualArticle()
assert.equal(arabicField(movedManualArticleTree, 'گام اول').props.value, 'خطوة عند النقل')
assert.equal(arabicField(movedManualArticleTree, 'گام دوم').props.value, 'عربي گام دوم')
assert.equal(arabicField(movedManualArticleTree, 'گام دیگر').props.value, 'عربي گام دیگر')

const queuedManualTermsHost = fresh(), drawManualTerms = () => render(queuedManualTermsHost, TermsEditor as (props: never) => unknown)
drawManualTerms(); const manualTermsTree = drawManualTerms(), oldManualTerm = arabicField(manualTermsTree, 'بند اول')
click(find(manualTermsTree, node => node.props['aria-label'] === 'انتقال بند به پایین' && !node.props.disabled))
click(find(manualTermsTree, node => node.props['aria-label'] === 'انتقال بخش به پایین' && !node.props.disabled))
binding(oldManualTerm).edit('بند عند النقل'); (oldManualTerm.props.onChange as (value: string) => void)('بند عند النقل')
const movedManualTermsTree = drawManualTerms()
assert.equal(arabicField(movedManualTermsTree, 'بند اول').props.value, 'بند عند النقل')
assert.equal(arabicField(movedManualTermsTree, 'بند دوم').props.value, 'عربي بند دوم')
assert.equal(arabicField(movedManualTermsTree, 'بند دیگر').props.value, 'عربي بند دیگر')
const sizeOne = seeded('productSize', { id: 'size-one', name: 'سایز اول', price: 100, image: '/one.png', discountPercentage: 10 })
const sizeTwo = seeded('productSize', { id: 'size-two', name: 'سایز دوم', price: 200, image: '/two.png', discountPercentage: 20 })
const sizeProductHost = fresh(), sizeProps = { ...productProps, initialData: { ...product, sizesEnabled: true, sizes: [sizeOne, sizeTwo] } }
const drawSizeProduct = () => render(sizeProductHost, ProductForm as (props: never) => unknown, sizeProps)
drawSizeProduct(); const sizeProductTree = drawSizeProduct()
const removedSizeName = find(sizeProductTree, node => node.type === 'input' && node.props.value === 'سایز اول')
const savedSizeArabic = find(sizeProductTree, node => (node.props.size as { id?: string } | undefined)?.id === 'size-two')
const sizeArabicHost = fresh(), oldSizeArabicTree = render(sizeArabicHost, savedSizeArabic.type as (props: never) => unknown, savedSizeArabic.props)
const oldSizeArabicField = find(oldSizeArabicTree, node => node.type === ArField)
click(find(sizeProductTree, node => node.type === 'button' && typeof node.props.className === 'string' && node.props.className.startsWith('col-span-1 ')))
binding(oldSizeArabicField).edit('اسم حجم يدوي'); (oldSizeArabicField.props.onChange as (value: string) => void)('اسم حجم يدوي')
change(removedSizeName, 'نام دیرهنگام سایز حذف‌شده')
const afterSizeDeletion = drawSizeProduct()
assert.equal(nodes(afterSizeDeletion).some(node => node.type === 'input' && node.props.value === 'نام دیرهنگام سایز حذف‌شده'), false,
	'a late source-name handler cannot restore a deleted size or edit the remaining size')
assert(nodes(afterSizeDeletion).some(node => node.type === 'input' && node.props.value === 'سایز دوم'))
assert.equal((find(afterSizeDeletion, node => (node.props.size as { id?: string } | undefined)?.id === 'size-two').props.size as { nameAr: string }).nameAr, 'اسم حجم يدوي',
	'the saved-size Arabic callback remains attached to its stable ID after another size is deleted')
change(find(afterSizeDeletion, node => node.type === 'input' && node.props.value === 'سایز دوم'), 'نام تازه سایز دوم')
const editOldSizeArabic = oldSizeArabicField.props.onChange as (value: string) => void
editOldSizeArabic('مسودة أقدم')
const currentSize = find(drawSizeProduct(), node => (node.props.size as { id?: string } | undefined)?.id === 'size-two').props.size as { name: string; price: number }
assert.equal(currentSize.name, 'نام تازه سایز دوم', 'old Arabic callbacks patch only Arabic fields and cannot restore their closed-over Persian name')
assert.equal(currentSize.price, 200)
const oldPrices = nodes(sizeProductTree).filter(node => node.type === 'input' && node.props.placeholder === 'قیمت (تومان)')
const oldImages = nodes(sizeProductTree).filter(node => node.props.label === 'تصویر این سایز (اختیاری)')
const oldWindows = nodes(sizeProductTree).filter(node => typeof node.props.idPrefix === 'string' && node.props.idPrefix.startsWith('size-'))
change(oldPrices[0], '999'); change(oldPrices[1], '333')
;(oldImages[0].props.onAdd as (value: string) => void)('/late-deleted.png')
;(oldImages[1].props.onAdd as (value: string) => void)('/latest-survivor.png')
;(oldWindows[0].props.onChange as (start: string, end: string) => void)('2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z')
;(oldWindows[1].props.onChange as (start: string, end: string) => void)('2031-01-01T00:00:00Z', '2031-01-02T00:00:00Z')
const afterDeferredMetadata = drawSizeProduct()
assert.equal(nodes(afterDeferredMetadata).some(node => (node.props.size as { id?: string } | undefined)?.id === 'size-one'), false,
	'late price/window/upload callbacks cannot restore a deleted translatable size')
const survivor = find(afterDeferredMetadata, node => (node.props.size as { id?: string } | undefined)?.id === 'size-two').props.size as Record<string, unknown>
assert.equal(survivor.name, 'نام تازه سایز دوم'); assert.equal(survivor.nameAr, 'مسودة أقدم')
assert.equal(survivor.price, '333', 'the existing numeric-input conversion is preserved')
assert.equal(survivor.image, '/latest-survivor.png'); assert.equal(survivor.discountStartsAt, '2031-01-01T00:00:00Z')
const oldSizeDeletes = nodes(sizeProductTree).filter(node => node.type === 'button' && typeof node.props.className === 'string' && node.props.className.startsWith('col-span-1 '))
click(oldSizeDeletes[1])
assert.equal(nodes(drawSizeProduct()).some(node => typeof node.props.size === 'object'), false, 'old removal of the second size resolves its ID after the first is deleted')

const ingredientActionsHost = fresh(), drawIngredientActions = () => render(ingredientActionsHost, ProductForm as (props: never) => unknown, productProps)
drawIngredientActions(); const ingredientActionsTree = drawIngredientActions()
const oldIngredientMove = find(ingredientActionsTree, node => node.props['aria-label'] === 'انتقال ماده به پایین' && !node.props.disabled)
const oldIngredientDelete = find(ingredientActionsTree, node => node.type === 'button' && node.props.className === 'hover:opacity-70')
click(oldIngredientMove); click(oldIngredientMove)
assert.deepEqual(binding(arabicField(drawIngredientActions(), 'اول')).field.fieldPath, ['ingredients', 1], 'repeated old move callback follows the moved ingredient and respects current bounds')
click(oldIngredientDelete)
assert.equal(nodes(drawIngredientActions()).some(node => node.type === ArField && node.props.faReference === 'اول'), false)
assert.equal(arabicField(drawIngredientActions(), 'دوم').props.value, 'عربي دوم')

const templateActionsHost = fresh(), drawTemplateActions = () => render(templateActionsHost, CategoryManager as (props: never) => unknown, { categories: [category] })
click(find(drawTemplateActions(), node => node.props['aria-label'] === 'ویرایش دسته'))
const templateActionsTree = drawTemplateActions(), oldTemplateMove = find(templateActionsTree, node => node.props['aria-label'] === 'انتقال قالب به پایین' && !node.props.disabled)
const oldTemplateDelete = find(templateActionsTree, node => node.props['aria-label'] === 'حذف قالب')
click(oldTemplateMove); click(oldTemplateMove)
assert.deepEqual(binding(arabicField(drawTemplateActions(), 'کوچک')).field.fieldPath, ['sizeNames', 1])
click(oldTemplateDelete)
assert.equal(nodes(drawTemplateActions()).some(node => node.type === ArField && node.props.faReference === 'کوچک'), false)
assert.equal(arabicField(drawTemplateActions(), 'بزرگ').props.value, 'عربي بزرگ')

const termsActionsHost = fresh(), drawTermsActions = () => render(termsActionsHost, TermsEditor as (props: never) => unknown)
drawTermsActions(); const termsActionsTree = drawTermsActions()
const oldTermMove = find(termsActionsTree, node => node.props['aria-label'] === 'انتقال بند به پایین' && !node.props.disabled)
const oldTermDelete = find(termsActionsTree, node => node.props['aria-label'] === 'حذف بند')
click(oldTermMove); click(oldTermMove); click(oldTermDelete)
assert.equal(nodes(drawTermsActions()).some(node => node.type === ArField && node.props.faReference === 'بند اول'), false)
assert.equal(arabicField(drawTermsActions(), 'بند دوم').props.value, 'عربي بند دوم')
const oldSectionMove = find(termsActionsTree, node => node.props['aria-label'] === 'انتقال بخش به پایین' && !node.props.disabled)
const oldSectionDelete = find(termsActionsTree, node => node.props['aria-label'] === 'حذف بخش')
click(oldSectionMove); click(oldSectionMove); click(oldSectionDelete)
assert.equal(nodes(drawTermsActions()).some(node => node.type === ArField && node.props.faReference === 'بخش اول'), false)
assert.equal(arabicField(drawTermsActions(), 'بند دیگر').props.value, 'عربي بند دیگر')

const subOne = seeded('articleSubCategory', { id: 'sub-one', name: 'زیردسته اول' }), subTwo = seeded('articleSubCategory', { id: 'sub-two', name: 'زیردسته دوم' })
const articleCategory = seeded('articleCategory', { id: 'article-category', name: 'دسته مقاله', hasSubCategories: true, subCategories: [subOne, subTwo] })
queryRows.set(JSON.stringify(['article-categories']), [articleCategory])
const subHost = fresh(), drawSubcategories = () => render(subHost, ArticleCategoryManager as (props: never) => unknown, { canWrite: true })
click(find(drawSubcategories(), node => node.type === 'button' && typeof node.props.className === 'string' && node.props.className.startsWith('p-1.5 rounded text-gray-500')))
let subTree = drawSubcategories()
const oldSubSecondInput = find(subTree, node => node.props['aria-label'] === 'نام فارسی زیردسته' && node.props.value === 'زیردسته دوم')
const oldSubDeletes = nodes(subTree).filter(node => node.type === 'button' && node.props.className === 'hover:opacity-70 cursor-pointer')
click(oldSubDeletes[0]); change(oldSubSecondInput, 'زیردسته دوم تازه')
subTree = drawSubcategories()
assert.equal(nodes(subTree).filter(node => node.props['aria-label'] === 'نام فارسی زیردسته').length, 1, 'old subcategory source handler cannot restore the removed row')
assert.equal(find(subTree, node => node.props['aria-label'] === 'نام فارسی زیردسته').props.value, 'زیردسته دوم تازه')
click(find(subTree, node => node.type === 'button' && node.props.children === 'ذخیره'))
const subSave = mutations.pop() as { subCategoryEntries: { id: string; name: string; nameAr: string; sourceRevision: string }[] }
assert.deepEqual(subSave.subCategoryEntries.map(entry => [entry.id, entry.name, entry.sourceRevision]), [['sub-two', 'زیردسته دوم تازه', subTwo.sourceRevision]])
const subAddHost = fresh(), drawSubAdd = () => render(subAddHost, ArticleCategoryManager as (props: never) => unknown, { canWrite: true })
click(find(drawSubAdd(), node => node.type === 'button' && typeof node.props.className === 'string' && node.props.className.startsWith('p-1.5 rounded text-gray-500')))
let subAddTree = drawSubAdd()
change(find(subAddTree, node => node.type === 'input' && typeof node.props.onKeyDown === 'function'), 'زیردسته افزوده')
subAddTree = drawSubAdd()
const oldSubAdd = find(subAddTree, node => node.type === 'input' && typeof node.props.onKeyDown === 'function').props.onKeyDown as (event: unknown) => void
const subAddDeletes = nodes(subAddTree).filter(node => node.type === 'button' && node.props.className === 'hover:opacity-70 cursor-pointer')
click(subAddDeletes[0]); oldSubAdd({ key: 'Enter', preventDefault() {} }); oldSubAdd({ key: 'Enter', preventDefault() {} })
assert.deepEqual(nodes(drawSubAdd()).filter(node => node.props['aria-label'] === 'نام فارسی زیردسته').map(node => node.props.value), ['زیردسته دوم', 'زیردسته افزوده'],
	'queued addition keeps current identities and suppresses duplicates instead of restoring removed subcategories')
click(subAddDeletes[1])
assert.deepEqual(nodes(drawSubAdd()).filter(node => node.props['aria-label'] === 'نام فارسی زیردسته').map(node => node.props.value), ['زیردسته افزوده'],
	'old second removal follows its key after first removal and queued addition')
assert.equal(translatorCalls, 0, 'source edits and reorder never automatically invoke the translator')
console.log('PASS collection editors: stable source/manual/move/delete handlers before rerender, deferred size metadata/uploads, article subcategory source ownership, manual preservation, pinned revisions and guarded first Terms creation')
