import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
const { QueryClient } = await import('@tanstack/react-query')
const client = new QueryClient()
type Host = { cells: any[]; cursor: number; effects: Array<() => void> }
let host: Host
mock.module('react', () => ({
  ...react,
  memo: (component: unknown) => component,
  useState(initial: unknown) {
    const active = host
    const index = active.cursor++
    if (!(index in active.cells)) active.cells[index] = initial
    return [active.cells[index], (value: unknown) => { active.cells[index] = value }]
  },
  useRef(initial: unknown) {
    const index = host.cursor++
    if (!(index in host.cells)) host.cells[index] = { current: initial }
    return host.cells[index]
  },
  useEffect(effect: () => void, deps: unknown[]) {
    const index = host.cursor++
    const previous = host.cells[index] as unknown[] | undefined
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) host.effects.push(effect)
    host.cells[index] = deps
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (compute: () => unknown) => compute(),
}))

const { qk } = await import('../src/utils/queryKeys')
let search = { page: 3, limit: 20, search: 'Pizza', status: 'all', categoryId: 'category-a' }
const events: string[] = []
const navigate = async (options: any) => {
  events.push('navigate')
  search = typeof options.search === 'function' ? options.search(search) : options.search
}
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search,
  Link: () => null,
  createFileRoute: () => (options: object) => options,
}))
const permissions = { productsRead: true, productsWrite: true, productsAvailability: true }
mock.module('#/hooks/admin/usePermissions', () => ({
  usePermissions: () => ({ permissions, isChecking: false, isMainAdmin: true }),
}))
mock.module('#/utils/adminAccess', () => ({ hasAdminPermission: async () => true }))
mock.module('#/stores/toastStore', () => ({
  useToastStore: (select: any) => select({ showToast() {} }),
}))
mock.module('#/server/products', () => ({
  toggleProductStatus: async () => ({ success: true }),
  setProductAvailability: async () => ({ success: true }),
  deleteProduct: async () => ({ success: true }),
}))
const mutations: any[] = []
const originalInvalidate = client.invalidateQueries.bind(client)
client.invalidateQueries = (async (filters: any) => {
  events.push(`invalidate:${filters.queryKey[0]}`)
  return originalInvalidate(filters)
}) as typeof client.invalidateQueries
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: any) => ({ data: client.getQueryData(options.queryKey), isLoading: false, isError: false }),
  useQueryClient: () => client,
  useMutation: (options: any) => {
    mutations.push(options)
    return { isPending: false, mutate() {} }
  },
}))
mock.module('#/utils/queryOptions', () => ({
  adminCategoriesOptions: { queryKey: qk.categories },
  adminProductsOptions: (filters: Parameters<typeof qk.adminProducts>[0]) => ({ queryKey: qk.adminProducts(filters) }),
}))
for (const [path, names] of [
  ['#/components/LoadingSkeletons', ['AdminProductsPageSkeleton']],
  ['#/components/ConfirmModal', ['ConfirmModal']],
  ['#/components/Pagination', ['Pagination']],
  ['#/components/shared/PermissionGate', ['Can', 'PermissionGate']],
  ['#/components/shared/RouteFallbacks', ['RouteError']],
  ...['CategoryManager', 'CategoryPurchaseManager', 'MainCategoryManager', 'PackagingItemsManager', 'ProductsFilterBox']
    .map((name) => [`#/components/admin/products/${name}`, [name]] as const),
] as const) mock.module(path, () => Object.fromEntries(names.map((name) => [name, () => null])))

const { adminProductsPageSizes, adminProductsSearchSchema, useAdminProductsPage } =
  await import('../src/hooks/admin/useAdminProductsPage')
const { AdminProductCard } = await import('../src/components/admin/products/AdminProductCard')
const { Pagination } = await import('../src/components/Pagination')
const { Route } = await import('../src/routes/admin/products/index')

function render(component: () => any) {
  host = { cells: [], cursor: 0, effects: [] }
  mutations.length = 0
  const result = component()
  for (const effect of host.effects) effect()
  return result
}
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  return [value, ...nodes(value.props.children)]
}
const product = { id: 'edited', name: 'Pizza', prepTime: 15, finalPrice: 100,
  status: 'ACTIVE', categoryId: 'category-a', isAvailable: true }
function seedPage(page = 3) {
  search = { page, limit: 20, search: 'Pizza', status: 'all', categoryId: 'category-a' }
  const key = qk.adminProducts(search)
  client.setQueryData(key, { products: [product], total: 41 })
  events.length = 0
  return key
}

assert.equal(adminProductsSearchSchema.parse({}).limit, 10)
for (const limit of [5, 7, 100, -1, '20', null]) {
  assert.equal(adminProductsSearchSchema.parse({ limit }).limit, 10,
    `Unsupported/legacy limit ${limit} matches the selector's default`)
}
for (const limit of adminProductsPageSizes) {
  assert.equal(adminProductsSearchSchema.parse({ limit }).limit, limit)
}

let key = seedPage()
render(useAdminProductsPage)
const toggle = mutations[0]!
const context = await toggle.onMutate(product.id)
assert.equal(client.getQueryData<any>(key).products[0].status, 'INACTIVE')
await toggle.onSuccess()
await toggle.onSettled(undefined, null)
assert.deepEqual(search, { page: 1, limit: 20, search: 'Pizza', status: 'all', categoryId: 'category-a' },
  'Successful status changes follow the updated product to page one while preserving filters')
assert(events.indexOf('invalidate:admin-products') < events.indexOf('navigate'),
  'The first page is invalidated before navigating to it')

key = seedPage()
render(useAdminProductsPage)
const failedToggle = mutations[0]!
const failedContext = await failedToggle.onMutate(product.id)
const error = new Error('Offline')
failedToggle.onError(error, product.id, failedContext)
await failedToggle.onSettled(undefined, error)
assert.equal(client.getQueryData<any>(key).products[0].status, 'ACTIVE', 'Failed toggles restore the previous status')
assert.equal(search.page, 3, 'Failed toggles preserve the current page')
assert(!events.includes('navigate'))
assert(context.previous.length > 0)

seedPage()
const page = render((Route as unknown as { component: () => any }).component)
const card = nodes(page).find((node) => node.type === AdminProductCard)
const pagination = nodes(page).find((node) => node.type === Pagination)
assert(card && pagination)
assert.deepEqual(pagination.props.pageSizeOptions, adminProductsPageSizes)
assert.equal(typeof card.props.onAvailabilityChanged, 'function')
render(() => AdminProductCard(card.props))
const availability = mutations[0]!
await availability.onSuccess({ success: false }, false)
assert.equal(search.page, 3, 'Rejected availability changes do not navigate')
assert(!events.includes('navigate'))
await availability.onSuccess({ success: true }, false)
assert.equal(search.page, 1, 'Successful availability changes follow the updated product to page one')
assert(events.indexOf('invalidate:admin-products') < events.indexOf('navigate'))
assert.equal(search.limit, 20)
assert.equal(search.categoryId, 'category-a')

client.clear()
console.log('PASS admin product page sizes, status rollback, first-page navigation and availability wiring')
