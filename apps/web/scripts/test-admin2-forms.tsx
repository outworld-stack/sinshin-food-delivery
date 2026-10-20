import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
mock.module('react', () => ({ ...react, memo: (component: unknown) => component,
  useState: (initial: unknown) => [initial, () => {}], useCallback: (callback: unknown) => callback }))
mock.module('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ ...options, useParams: () => ({ productId: 'product-a', userId: 'user-a' }) }),
  useNavigate: () => () => {}, Link: () => null,
}))
let isMainAdmin = false
let isChecking = false
let permissions: Record<string, boolean> = { productsWrite: false, usersWrite: false, canAnnounceBusy: true }
mock.module('#/hooks/admin/usePermissions', () => ({ usePermissions: () => ({ permissions, isChecking, isMainAdmin, isAdmin2: !isMainAdmin }) }))
mock.module('#/hooks/admin/useAdminUserEditPage', () => ({ useAdminUserEditPage: () => ({ state: {}, updateMutation: {} }) }))
mock.module('#/hooks/admin/useSiteContentSettings', () => ({ useSiteContentSettings: () => ({ gallery: [] }) }))
mock.module('#/utils/adminAccess', () => ({ hasAdminPermission: async (_client: unknown, permission: string) => permissions[permission] === true }))
const noop = () => {}
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (value: unknown) => unknown) => select({ showToast: noop }) }))
mock.module('#/stores/authStore', () => ({ useAuthStore: { getState: () => ({ role: isMainAdmin ? 'admin' : 'admin2' }) }, ensureAuthHydrated: async () => {} }))
const requests: { kind: string; data: any }[] = []
mock.module('#/server/admin', () => ({
  setLiveTrackingEnabled: async ({ data }: any) => { requests.push({ kind: 'tracking', data }) },
  setRestaurantOpen: async ({ data }: any) => { requests.push({ kind: 'hourly', data }) },
}))
mock.module('#/server/products', () => ({ updateAdminProduct: noop }))
const results: Record<string, any> = {}
const enabled = new Map<string, unknown>()
const retries: string[] = []
let isPending = false
mock.module('@tanstack/react-query', () => ({
  useQuery: ({ queryKey, enabled: canFetch }: { queryKey: string[]; enabled?: boolean }) => {
    enabled.set(queryKey[0]!, canFetch)
    return { refetch: () => retries.push(queryKey[0]!), ...results[queryKey[0]!] }
  },
  useQueryClient: () => ({ invalidateQueries: noop }),
  useMutation: (options: { mutationFn: (value: unknown) => unknown }) => ({ isPending, mutate: options.mutationFn }),
}))
const optionNames = ['aboutContentOptions', 'adminGalleryImagesOptions', 'deliveryZonesOptions', 'settingsIranOnlyOptions', 'settingsOutsideScopeOptions', 'settingsRegistrationPermitsOptions', 'settingsRestaurantOptions', 'settingsRestaurantStatusOptions', 'settingsTrackingOptions']
mock.module('#/utils/queryOptions', () => ({
  ...Object.fromEntries(optionNames.map(name => [name, { queryKey: [name] }])),
  adminProductDetailsOptions: () => ({ queryKey: ['product'] }),
  adminUserDetailsOptions: () => ({ queryKey: ['user'] }),
}))
for (const [path, names] of [
  ['#/components/admin/ProductForm', ['ProductForm']],
  ['#/components/admin/users/UserEditForm', ['UserEditForm']],
  ['#/components/LoadingSkeletons', ['AdminProductFormSkeleton', 'AdminUserEditSkeleton']],
  ['#/components/ConfirmModal', ['ConfirmModal']],
  ['#/components/shared/PermissionGate', ['PermissionGate']],
  ['#/components/shared/RouteFallbacks', ['RouteError', 'RouteNotFound']],
  ['#/components/shared/Toggle', ['Toggle']],
  ...['AboutContentForm', 'DeliveryZonesManager', 'GalleryManager', 'GeoAccessCard', 'PaymentGatewaysCard', 'RegistrationPermitCard', 'RestaurantStatusCard', 'TermsEditor'].map(name => [`#/components/admin/settings/${name}`, [name]] as const),
] as const) mock.module(path, () => Object.fromEntries(names.map(name => [name, function placeholder() { return null }])))

const { Route: productRoute } = await import('../src/routes/admin/products/$productId/edit')
const { Route: userRoute } = await import('../src/routes/admin/users/$userId/edit')
const { Route: settingsRoute } = await import('../src/routes/admin/settings/index')
const { PermissionGate } = await import('../src/components/shared/PermissionGate')
const { RouteNotFound } = await import('../src/components/shared/RouteFallbacks')
const { RestaurantStatusCard } = await import('../src/components/admin/settings/RestaurantStatusCard')
const { Toggle } = await import('../src/components/shared/Toggle')
const { AdminProductFormSkeleton } = await import('../src/components/LoadingSkeletons')
type Element = { type: any; props: Record<string, any> }
const render = (route: unknown): Element => (route as { component: () => Element }).component()
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const element = value as Element
  return [element, ...nodes(element.props.children)]
}
function find(tree: unknown, predicate: (value: Element) => boolean) {
  const result = nodes(tree).find(predicate)
  assert(result, 'Expected control is present')
  return result
}
assert.equal(render(productRoute).type, PermissionGate)
assert.equal(enabled.get('product'), false, 'denied product editors do not fetch product data')
isChecking = true
assert.equal(render(productRoute).type, AdminProductFormSkeleton)
isChecking = false
permissions.productsWrite = true
results.product = { isError: true }
let tree = render(productRoute)
assert.equal(tree.props.role, 'alert', 'product load failure does not become an endless skeleton')
find(tree, node => node.type === 'button').props.onClick()
assert.equal(retries.at(-1), 'product')
results.product = { data: null }
assert.equal(render(productRoute).type, RouteNotFound)
assert.equal(render(userRoute).type, PermissionGate)
assert.equal(enabled.get('user'), false)
const userLoader = (userRoute as unknown as { loader: (input: any) => Promise<void> }).loader
let userReads = 0
const loaderContext = { context: { queryClient: { query: async () => { userReads++ } } }, params: { userId: 'user-a' } }
await userLoader(loaderContext)
assert.equal(userReads, 0, 'denied user editors do not prefetch on direct navigation')
permissions.usersWrite = true
await userLoader(loaderContext)
assert.equal(userReads, 1)
results.user = { isError: true }
assert.equal(render(userRoute).props.role, 'alert', 'failed user data cannot expose an empty editable form')
results.user = { data: null }
assert.equal(render(userRoute).type, RouteNotFound)

function settingsTree() {
  const content = render(settingsRoute).props.children as Element
  return content.type(content.props)
}
results.settingsRestaurantStatusOptions = { data: { isOpen: false, temporarilyClosed: false } }
tree = settingsTree()
assert.equal(find(tree, node => node.type === RestaurantStatusCard).props.hourlyOpen, false, 'Level 2 sees the actual hourly closure without the main-admin query')
assert.equal(enabled.get('settingsRestaurantOptions'), false)
assert.equal(enabled.get('settingsTrackingOptions'), false)
isMainAdmin = true
results.settingsTrackingOptions = { data: false }
results.settingsRestaurantOptions = { data: { isOpen: false } }
results.settingsRestaurantStatusOptions = { data: { isOpen: true, temporarilyClosed: true } }
tree = settingsTree()
await find(tree, node => node.type === Toggle).props.onToggle()
assert.deepEqual(requests.at(-1), { kind: 'tracking', data: { enabled: true } }, 'disabled tracking can be enabled')
await find(tree, node => node.type === RestaurantStatusCard).props.onToggleHourly()
assert.equal(requests.at(-1)?.data.isOpen, false, 'hourly toggle uses hourly state even while temporarily closed')
const previousRequests = requests.length
isPending = true
tree = settingsTree()
await find(tree, node => node.type === Toggle).props.onToggle()
await find(tree, node => node.type === RestaurantStatusCard).props.onToggleHourly()
assert.equal(requests.length, previousRequests, 'pending settings mutations cannot be duplicated')
console.log('Admin Level 2 forms passed: denied editor queries/loaders, editor failure and missing states, actual hourly status, disabled tracking enablement and pending mutation guards.')
