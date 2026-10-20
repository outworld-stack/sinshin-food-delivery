import assert from 'node:assert/strict'
import { mock } from 'bun:test'

// Render the real hooks and route components with deterministic query responses.
// Hook cells survive rerenders, including effects, so arrivals and queue changes
// exercise the behavior operators see while the panel stays open.
const react = { ...await import('react') }
type Host = { cells: any[]; cursor: number; effects: (() => void)[] }
let host: Host = { cells: [], cursor: 0, effects: [] }
const newHost = (): Host => ({ cells: [], cursor: 0, effects: [] })
function state(initial: any) {
  const active = host
  const index = active.cursor++
  if (!(index in active.cells)) active.cells[index] = typeof initial === 'function' ? initial() : initial
  return [active.cells[index], (next: any) => {
    active.cells[index] = typeof next === 'function' ? next(active.cells[index]) : next
  }]
}
mock.module('react', () => ({
  ...react,
  memo: (component: unknown) => component,
  useState: state,
  useReducer: (reducer: (value: any, action: any) => unknown, initial: any) => {
    const [value, setValue] = state(initial)
    return [value, (action: any) => setValue((previous: any) => reducer(previous, action))]
  },
  useRef: (initial: any) => state(() => ({ current: initial }))[0],
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    const active = host
    const index = active.cursor++
    const previous = active.cells[index]
    if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    active.effects.push(() => {
      previous?.cleanup?.()
      active.cells[index] = { deps, cleanup: effect() }
    })
  },
}))
const noop = () => {}
let cleared = 0
let invalidatedSessions = 0
let role: string | null = 'admin2'
const navigations: unknown[] = []
const queryEnabled = new Map<string, unknown>()
const retries: string[] = []
let sessionQuery: any
let liveQuery: any
let statsQuery: any
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
    const kind = options.queryKey[0]!
    queryEnabled.set(kind, options.enabled)
    return { isLoading: false, isError: false, refetch: () => retries.push(kind),
      ...(kind === 'session' ? sessionQuery : kind === 'live' ? liveQuery : statsQuery) }
  },
  useQueryClient: () => ({ clear: () => { cleared++ }, invalidateQueries: noop }),
  useMutation: () => ({ mutate: noop, isPending: false }),
}))
mock.module('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options, useNavigate: () => (input: unknown) => navigations.push(input), Link: () => null, Outlet: () => null }))
mock.module('#/utils/queryOptions', () => ({
  admin2SessionOptions: { queryKey: ['session'] },
  admin2LiveOrdersOptions: (id: string) => ({ queryKey: ['live', id] }),
  admin2StatsOptions: (id: string) => ({ queryKey: ['stats', id] }),
}))
mock.module('#/lib/auth-session', () => ({ getAccessToken: () => null, onUnauthorized: () => { invalidatedSessions++ }, tryRefresh: async () => false }))
mock.module('#/lib/push-subscription', () => ({ disablePush: async () => {}, resumePushSynchronization: noop }))
mock.module('#/server/admin', () => ({ subAdminLogout: async () => {}, viewOrderNote: async () => ({ note: '' }) }))
const toasts: string[] = []
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (value: unknown) => unknown) => select({ showToast: (message: string) => toasts.push(message) }) }))
const stub = () => null
for (const [path, name] of [
  ['#/components/admin/admin2/ConfirmOrderModal', 'ConfirmOrderModal'],
  ['#/components/admin/admin2/InvoicePrintCenterModal', 'InvoicePrintCenterModal'],
  ['#/components/admin/admin2/LiveOrderCard', 'LiveOrderCard'],
  ['#/components/admin/admin2/NoteModal', 'NoteModal'],
  ['#/components/Pagination', 'Pagination'],
  ['#/components/shared/PermissionGate', 'PermissionGate'],
  ['#/components/admin/admin2/Admin2StatCards', 'Admin2StatCards'],
  ['#/components/admin/admin2/Admin2RecentOrders', 'Admin2RecentOrders'],
  ['#/components/shared/ChartPanel', 'ChartPanel'],
] as const) mock.module(path, () => ({ [name]: function placeholder() { return stub() } }))
mock.module('#/components/LoadingSkeletons', () => ({ LiveOrdersSkeleton: stub, Skeleton: stub, AdminLayoutSkeleton: stub }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: stub }))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: (value: unknown) => unknown) => select({ role }) }))
mock.module('#/hooks/useHydrated', () => ({ useHydrated: () => true }))
mock.module('#/hooks/shared/useRealLogout', () => ({ useRealLogout: () => noop }))
mock.module('#/components/Brand', () => ({ Brand: stub }))
mock.module('#/components/ThemeToggle', () => ({ ThemeToggle: stub }))

const { useAdmin2Panel: realPanel } = await import('../src/hooks/admin/useAdmin2Panel')
let panelOverride: any
mock.module('#/hooks/admin/useAdmin2Panel', () => ({ useAdmin2Panel: () => panelOverride }))
const { Route: liveRoute } = await import('../src/routes/admin/admin2/live-orders/index')
const { Route: dashboardRoute } = await import('../src/routes/admin/admin2/dashboard/index')
const { Pagination } = await import('../src/components/Pagination')
const { LiveOrderCard } = await import('../src/components/admin/admin2/LiveOrderCard')
const { PermissionGate } = await import('../src/components/shared/PermissionGate')
const { AdminLayout } = await import('../src/components/AdminLayout')
const LivePage = (liveRoute as unknown as { component: () => unknown }).component
const DashboardPage = (dashboardRoute as unknown as { component: () => unknown }).component
function render<T>(instance: Host, component: () => T): T {
  host = instance
  host.cursor = 0
  host.effects = []
  const result = component()
  for (const effect of host.effects) effect()
  return result
}
type Element = { type: unknown; props: Record<string, any> }
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const element = value as Element
  return [element, ...nodes(element.props.children)]
}
function content(value: any): string {
  if (Array.isArray(value)) return value.map(content).join(' ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return value?.props ? content(value.props.children) : ''
}
function find(tree: unknown, predicate: (node: Element) => boolean): Element {
  const result = nodes(tree).find(predicate)
  assert(result, 'Expected control is present')
  return result
}
const order = (id: string, status = 'PAID') => ({ id, status })
function login(id = 'staff-a', canRead = true) {
  sessionQuery = { data: { isAdmin2LoggedIn: true, admin: { userId: id, permissions: { orderDetailsRead: canRead } } } }
}

const panelHost = newHost()
login()
liveQuery = { data: { orders: [] }, isLoading: true }
assert.equal(render(panelHost, realPanel).isLoading, true, 'initial queue loading stays a skeleton')
liveQuery = { data: { orders: [] } }
render(panelHost, realPanel)
assert.equal(toasts.length, 0, 'first successful response establishes an alert baseline')
liveQuery = { data: { orders: [order('a')] } }
render(panelHost, realPanel)
assert.equal(toasts.length, 1, 'the first arrival into an empty queue alerts')
liveQuery = { data: { orders: [order('b')] } }
render(panelHost, realPanel)
assert.equal(toasts.length, 2, 'a replacement arrival alerts even when queue length is unchanged')
render(panelHost, realPanel)
assert.equal(toasts.length, 2, 'rerendering the same queue does not repeat the alert')
liveQuery = { data: { orders: [order('b', 'CONFIRMED'), order('c', 'CONFIRMED')] } }
render(panelHost, realPanel)
assert.equal(toasts.length, 2, 'already confirmed arrivals do not sound like a new paid order')
login('staff-b')
liveQuery = { data: { orders: [order('new-account-order')] } }
panelOverride = render(panelHost, realPanel)
assert.equal(toasts.length, 2, 'changing accounts starts a fresh alert baseline')
login('staff-b', false)
panelOverride = render(panelHost, realPanel)
assert.equal(queryEnabled.get('live'), false, 'revoked order access disables background order requests')
assert.equal(panelOverride.canReadOrders, false)

const pageHost = newHost()
assert.equal((render(pageHost, LivePage) as Element).type, PermissionGate, 'revoked access hides cached orders')
login()
panelOverride = { ...panelOverride, session: sessionQuery.data, canReadOrders: true, liveError: true, orders: [] }
let tree = render(pageHost, LivePage)
assert(content(tree).includes('ناموفق'), 'queue errors are visible')
assert(!content(tree).includes('هنوز سفارشی ثبت نشده'), 'a failed queue is never presented as empty')
find(tree, node => node.type === 'button' && content(node).includes('تلاش دوباره')).props.onClick()
assert.equal(retries.at(-1), 'live')
panelOverride = { ...panelOverride, liveError: false, orders: Array.from({ length: 45 }, (_, i) => order(String(i))) }
tree = render(pageHost, LivePage)
find(tree, node => node.type === Pagination).props.onPageChange(3)
tree = render(pageHost, LivePage)
assert.equal(find(tree, node => node.type === LiveOrderCard).props.order.id, '40')
panelOverride.orders = panelOverride.orders.slice(0, 21)
tree = render(pageHost, LivePage)
assert.equal(find(tree, node => node.type === Pagination).props.currentPage, 2)
assert.equal(find(tree, node => node.type === LiveOrderCard).props.order.id, '20', 'queue shrink clamps to the last nonempty page')
panelOverride.orders = Array.from({ length: 45 }, (_, i) => order(String(i)))
tree = render(pageHost, LivePage)
assert.equal(find(tree, node => node.type === Pagination).props.currentPage, 2, 'later arrivals do not jump back to the previously invalid page')

statsQuery = { isError: true }
tree = render(newHost(), DashboardPage)
assert(content(tree).includes('دریافت آمار ناموفق بود'), 'dashboard failures expose retry instead of an endless skeleton')
find(tree, node => node.type === 'button').props.onClick()
assert.equal(retries.at(-1), 'stats')
login('staff-a', false)
assert.equal((render(newHost(), DashboardPage) as Element).type, PermissionGate)
assert.equal(queryEnabled.get('stats'), false)
sessionQuery = { isError: true }
tree = render(newHost(), DashboardPage)
assert(content(tree).includes('اطلاعات ورود ناموفق'), 'session failure is distinguished from signed-out state')

tree = render(newHost(), () => AdminLayout({}))
assert(content(tree).includes('دریافت دسترسی‌های حساب ناموفق'), 'failed initial permissions have a retry path for every protected page')
find(tree, node => node.type === 'button' && content(node).includes('تلاش دوباره')).props.onClick()
assert.equal(retries.at(-1), 'session')
login('staff-a', false)
sessionQuery.data.admin.permissions.notificationsSend = true
tree = render(newHost(), () => AdminLayout({}))
const menuItems = find(tree, node => Array.isArray(node.props.items)).props.items as { to: string }[]
assert(!menuItems.some(item => item.to.includes('/orders') || item.to.includes('/dashboard') || item.to.includes('/couriers')), 'menus hide revoked order/stat/courier pages')
assert(menuItems.some(item => item.to === '/admin/notifications'), 'staff allowed to send notifications can reach the composer without history permission')
sessionQuery = { data: { isAdmin2LoggedIn: false } }
render(newHost(), () => AdminLayout({}))
assert.equal(invalidatedSessions, 1, 'revoked sessions clear the live token and auth store')
assert.equal(cleared, 1, 'revoked sessions clear protected cached data')
assert.deepEqual(navigations.at(-1), { to: '/login', replace: true })
role = 'user'
render(newHost(), () => AdminLayout({}))
assert.equal(cleared, 2, 'a role change while mounted removes protected cached data')
assert.deepEqual(navigations.at(-1), { to: '/login', replace: true })

console.log('Admin Level 2 live panel passed: loading/errors/retry, denied data access, first/replacement arrival alerts, account boundaries, persistent page clamping, dashboard recovery and layout permission/session revocation.')
