import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { CategoryId, Product, ProductId, SizeId } from '@sinshin/shared'

const react = { ...await import('react') }
const { QueryClient } = await import('@tanstack/react-query')
type Host = { cells: any[]; cursor: number; effects: Array<() => void> }
let host: Host = { cells: [], cursor: 0, effects: [] }
mock.module('react', () => ({
	...react,
	memo: (component: unknown) => component,
	useState(initial: any) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? initial() : initial
		return [active.cells[index], (value: any) => {
			active.cells[index] = typeof value === 'function' ? value(active.cells[index]) : value
		}]
	},
	useReducer(reducer: (state: any, action: any) => any, initial: any) {
		const active = host
		const index = active.cursor++
		if (!(index in active.cells)) active.cells[index] = initial
		return [active.cells[index], (action: any) => { active.cells[index] = reducer(active.cells[index], action) }]
	},
	useRef(initial: any) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useEffect(effect: () => void, deps: any[]) {
		const index = host.cursor++
		const previous = host.cells[index] as any[] | undefined
		if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) host.effects.push(effect)
		host.cells[index] = deps
	},
	useCallback: (callback: unknown) => callback,
	useMemo: (compute: () => unknown) => compute(),
}))
const t = new Proxy({} as Record<string, string>, { get: (_target, key) => String(key) })
const added: any[][] = []
mock.module('#/i18n', () => ({ useI18n: () => ({ t, fmt: { num: String, price: String } }),
	useI18nSafe: () => ({ t, fmt: { num: String, price: String } }), tpl: (value: string) => value }))
mock.module('#/stores/cartStore', () => ({ useCartStore: (select: any) => select({ addItem: (...args: any[]) => added.push(args) }) }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast() {} }) }))
mock.module('#/components/shared/ImageField', () => ({ ImageField: () => null }))
mock.module('#/components/shared/PersianDatePicker', () => ({ PersianDatePicker: () => null }))
mock.module('#/components/admin/ArField', () => ({ ArField: () => null }))
mock.module('#/hooks/useBack', () => ({ useBack: () => () => {} }))
mock.module('#/lib/seo', () => ({ alternateLinks() {}, headLang() {}, langUrl() {}, localizedFor() {}, productJsonLd() {}, withBrand() {} }))
const { qk } = await import('../src/utils/queryKeys')
const queryData = new Map<string, unknown>()
const queryCalls: unknown[][] = []
mock.module('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: readonly unknown[] }) => {
	queryCalls.push([...options.queryKey])
	return { data: queryData.get(JSON.stringify(options.queryKey)), isLoading: false }
} }))
mock.module('#/utils/queryOptions', () => ({
	adminCategoriesOptions: { queryKey: qk.categories }, packagingItemsOptions: { queryKey: qk.packagingItems },
	settingsFeaturedAnimationOptions: { queryKey: qk.settingsFeaturedAnimation },
	featuredAnimationOptions: { queryKey: qk.featuredAnimation },
	productByIdOptions: (id: string) => ({ queryKey: qk.productById(id) }),
	productReviewsOptions: (id: string) => ({ queryKey: qk.productReviews(id) }),
}))
let loadedProduct: Product
mock.module('@tanstack/react-router', () => ({ Link: () => null,
	createFileRoute: () => (options: object) => ({ ...options, useLoaderData: () => loadedProduct, useParams: () => ({ productId: 'product-slug' }) }),
	notFound: () => new Error('Not found'),
}))
const { ProductCard } = await import('../src/components/ProductCard')
const { ProductForm } = await import('../src/components/admin/ProductForm')
const { useProductPage } = await import('../src/hooks/site/useProductPage')
const { Route } = await import('../src/routes/products/$productId')
const { invalidateCategoryQueries, invalidatePackagingQueries } = await import('../src/utils/productCache')

type Element = { type: any; key?: string; props: Record<string, any> }
function nodes(value: any): Element[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value || typeof value !== 'object' || !('props' in value)) return []
	return [value, ...nodes(value.props.children)]
}
function find(tree: any, predicate: (node: Element) => boolean): Element {
	const node = nodes(tree).find(predicate)
	assert(node, 'Expected control is present')
	return node
}
function render(instance: Host, component: any, props: any = {}) {
	host = instance
	host.cursor = 0
	host.effects = []
	const tree = component(props)
	for (const effect of host.effects) effect()
	return tree
}
const instance = (): Host => ({ cells: [], cursor: 0, effects: [] })
const size = (id: string, name: string, price: number) => ({ id: id as SizeId, name, price, finalPrice: price, discountPercentage: 0, discountActive: false })
const product = (overrides: Partial<Product> = {}): Product => ({
	id: 'product' as ProductId, name: 'Pizza', description: 'Description', originalPrice: 100, finalPrice: 100,
	discountPercentage: 0, prepTime: 15, packagingCost: 50, categoryId: 'category' as CategoryId,
	categoryIds: ['category' as CategoryId], ingredients: ['Cheese', 'Tomato'], profileImage: '/pizza.png',
	galleryImages: ['/pizza.png'], status: 'ACTIVE', sizesEnabled: true,
	sizes: [size('old-size', 'Small', 100), size('large-size', 'Large', 200)],
	views: 0, sales: 0, isAvailable: true, purchasable: true,
	courierAllowed: true, takeawayAllowed: true, dineInAllowed: true, ...overrides,
})
const hookHost = instance()
let current = product()
let page = render(hookHost, () => useProductPage(current))
page.handleSelectSize('large-size')
page = render(hookHost, () => useProductPage(current))
assert.equal(page.selectedSizeId, 'large-size')
current = product({ sizes: [size('replacement-size', 'Replacement', 300)] })
page = render(hookHost, () => useProductPage(current))
assert.equal(page.selectedSizeId, page.selectedSize.id, 'refreshing removed sizes keeps submitted ID aligned with displayed price')
page.handleAddToCart()
assert.deepEqual(added.at(-1), ['product', 1, 'replacement-size'])
current = { ...current, purchasable: false }
page = render(hookHost, () => useProductPage(current))
const beforeLocked = added.length
page.handleAddToCart()
assert.equal(added.length, beforeLocked, 'category purchase lock prevents adding items')

const cardHost = instance()
let card = render(cardHost, ProductCard, { product: product() })
find(card, node => node.type === 'button' && node.props.children instanceof Array && node.props.children.includes('Large')).props.onClick()
card = render(cardHost, ProductCard, { product: current })
const lockedButton = find(card, node => node.props['aria-label'] === 'common.purchaseDisabledBadge')
assert.equal(lockedButton.props.disabled, true)
lockedButton.props.onClick()
assert.equal(added.length, beforeLocked, 'card handler also guards disabled category purchases')
card = render(cardHost, ProductCard, { product: { ...current, purchasable: true } })
find(card, node => node.props['aria-label'] === 'pdetail.addToCart').props.onClick()
assert.deepEqual(added.at(-1), ['product', 1, 'replacement-size'], 'cards never submit a removed size ID')

loadedProduct = product()
queryData.set(JSON.stringify(qk.productById('product-slug')), { ...loadedProduct, purchasable: false })
const routeComponent = (Route as unknown as { component: any }).component
let detail = render(instance(), routeComponent)
assert.equal(detail.props.product.purchasable, false, 'detail rendering follows refreshed query data instead of stale loader data')
assert.equal(detail.key, loadedProduct.id, 'different products reset quantity and size selection')
const detailPage = render(instance(), detail.type, detail.props)
const detailContentType = detail.type
assert(nodes(detailPage).some(node => node.props.purchasable === false), 'refreshed category lock reaches desktop/mobile purchase controls')
queryData.set(JSON.stringify(qk.productById('product-slug')), null)
detail = render(instance(), routeComponent)
assert.notEqual(detail.type, detailContentType, 'deleted products do not fall back to stale loader data')
assert(queryCalls.some(key => key.join('/') === 'product-by-id/product-slug'))

const formHost = instance()
const formSource = product({ sizesEnabled: false, packagingItemIds: ['inactive-item'] })
queryData.set(JSON.stringify(qk.categories), [{ id: 'category', name: 'Food' }])
queryData.set(JSON.stringify(qk.packagingItems), [
	{ id: 'active-item', title: 'Active box', price: 20, isActive: true },
	{ id: 'inactive-item', title: 'Inactive box', price: 40, isActive: false },
])
let submitted: any
const props = () => ({ initialData: { ...formSource }, onSubmit: (data: unknown) => { submitted = data }, isSubmitting: false })
render(formHost, ProductForm, props())
let form = render(formHost, ProductForm, props())
const inactiveChip = find(form, node => node.type === 'button' && node.props['aria-pressed'] === true && node.props.children instanceof Array && node.props.children.includes('Inactive box'))
assert(nodes(inactiveChip).some(node => node.props.children === '(غیرفعال)'), 'selected inactive packaging remains visible and removable')
assert.equal(find(form, node => node.props.name === 'packagingCost').props.disabled, true)
inactiveChip.props.onClick()
form = render(formHost, ProductForm, props())
assert.equal(find(form, node => node.props.name === 'packagingCost').props.disabled, false, 'removing inactive items restores manual packaging')
find(form, node => node.props.name === 'name').props.onChange({ target: { name: 'name', value: 'Draft name', type: 'text' } })
form = render(formHost, ProductForm, props())
assert.equal(find(form, node => node.props.name === 'name').props.value, 'Draft name', 'same-product cache refresh preserves unsaved form edits')
find(form, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted.name, 'Draft name')
assert.deepEqual(submitted.packagingItemIds, [])
submitted = undefined
form = render(formHost, ProductForm, { ...props(), isSubmitting: true })
find(form, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(submitted, undefined, 'pending product save cannot submit again')

const deletedHost = instance()
const deletedProps = { ...props(), initialData: product({ sizesEnabled: false, packagingItemIds: ['deleted-item'] }) }
render(deletedHost, ProductForm, deletedProps)
let deletedForm = render(deletedHost, ProductForm, deletedProps)
find(deletedForm, node => node.type === 'button' && node.props['aria-pressed'] === true && node.props.children instanceof Array && node.props.children.includes('قلم حذف‌شده')).props.onClick()
deletedForm = render(deletedHost, ProductForm, deletedProps)
assert.equal(find(deletedForm, node => node.props.name === 'packagingCost').props.disabled, false, 'a deleted packaging selection can be removed without losing the draft')

const featuredHost = instance()
const featuredSubmissions: any[] = []
const featuredProps = { ...props(), onSubmit: (data: unknown) => featuredSubmissions.push(data),
	initialData: product({ sizesEnabled: false, isFeatured: true, featuredAnimation: null }) }
queryData.set(JSON.stringify(qk.settingsFeaturedAnimation), 'sonar')
render(featuredHost, ProductForm, featuredProps)
let featuredForm = render(featuredHost, ProductForm, featuredProps)
const animationRadio = (value: string) => find(featuredForm,
	node => node.props.name === 'product-featured-animation' && node.props.value === value)
assert.equal(animationRadio('inherit').props.checked, true)
assert.equal(animationRadio('sonar').props.checked, false,
	'inheritance and an explicit choice matching the global default remain distinct')
animationRadio('sonar').props.onChange()
featuredForm = render(featuredHost, ProductForm, featuredProps)
find(featuredForm, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(featuredSubmissions.at(-1).featuredAnimation, 'sonar', 'the current global animation can be pinned explicitly')
animationRadio('inherit').props.onChange()
featuredForm = render(featuredHost, ProductForm, featuredProps)
find(featuredForm, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(featuredSubmissions.at(-1).featuredAnimation, null, 'an explicit animation can be reset to global inheritance')
const restrictedForm = render(instance(), ProductForm, { ...featuredProps, canToggleFeatured: false })
assert(!nodes(restrictedForm).some(node => node.props.name === 'product-featured-animation'),
	'admin2 cannot choose a featured animation')

const client = new QueryClient()
const derivedKeys = [qk.adminProducts({ page: 1, limit: 10, search: '', status: '', categoryId: '' }),
	qk.adminProductDetails('a'), qk.adminProductDetails('b'), qk.productsByMain('food'), qk.productById('a'),
	qk.cartDetails([{ productId: 'a', quantity: 1 }]), qk.checkoutPreview([], 'COURIER', null, false, null)]
const categoryKeys = [qk.categories, qk.adminMainCategories, qk.activeMainCategories, qk.adminPurchaseState]
for (const key of [...derivedKeys, ...categoryKeys, qk.packagingItems]) client.setQueryData(key, {})
client.setQueryData(['unrelated'], {})
await invalidatePackagingQueries(client)
for (const key of [...derivedKeys, qk.packagingItems]) assert.equal(client.getQueryState(key)?.isInvalidated, true, `packaging mutation refreshes ${key[0]}`)
assert.equal(client.getQueryState(qk.adminPurchaseState)?.isInvalidated, false)
await invalidateCategoryQueries(client)
for (const key of [...derivedKeys, ...categoryKeys]) assert.equal(client.getQueryState(key)?.isInvalidated, true, `category mutation refreshes ${key[0]}`)
assert.equal(client.getQueryState(['unrelated'])?.isInvalidated, false)
client.clear()
console.log('Product regressions passed: category locks, reactive detail data, removed sizes, inactive packaging removal, featured animation inheritance/overrides, draft preservation, duplicate saves and dependent cache invalidation.')
