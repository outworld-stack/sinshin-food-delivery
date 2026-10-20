import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { Admin2SessionDto } from '@sinshin/shared'

let role: string | null = 'admin2'
let refreshedRole: string | null = 'admin2'
let permissionReads = 0
let mainOrderReads = 0
let staffOrderReads = 0
let session: Admin2SessionDto = {
  isAdmin2LoggedIn: true,
  admin: { userId: 'staff-a', permissions: { orderDetailsRead: true, usersRead: false } },
} as Admin2SessionDto
const server = { ...await import('../src/server/admin') }
mock.module('#/server/admin', () => ({
  ...server,
  getSubAdminSession: async () => { permissionReads++; return session },
  getAdminOrders: async () => { mainOrderReads++; return { orders: [], total: 0 } },
  getSubAdminOrders: async () => { staffOrderReads++; return { orders: [], total: 0 } },
}))
const authStore = Object.assign((select: (state: { role: string | null }) => unknown) => select({ role }), {
  getState: () => ({ role }),
})
mock.module('#/stores/authStore', () => ({ useAuthStore: authStore, ensureAuthHydrated: async () => {} }))
mock.module('#/lib/auth-session', () => ({ ensureSession: async () => { role = refreshedRole } }))
mock.module('#/components/AdminLayout', () => ({ AdminLayout: () => null }))
mock.module('#/components/LoadingSkeletons', () => ({ AdminLayoutSkeleton: () => null }))
mock.module('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options, redirect: (options: unknown) => options }))
const query = { ...await import('@tanstack/react-query') }
let queryEnabled: unknown
mock.module('@tanstack/react-query', () => ({
  ...query,
  useQuery: (options: { enabled?: boolean }) => {
    queryEnabled = options.enabled
    return { data: session, isLoading: false }
  },
}))
const { hasAdminPermission, isAdminPathAllowed } = await import('../src/utils/adminAccess')
const { adminOrdersOptions } = await import('../src/utils/queryOptions')
const { usePermissions } = await import('../src/hooks/admin/usePermissions')
const { Route } = await import('../src/routes/admin/route')
const route = Route as unknown as { beforeLoad: (input: { location: { pathname: string; href: string } }) => Promise<void> }
const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

try {
  assert.equal(isAdminPathAllowed('admin2', '/admin/orders/123'), true)
  assert.equal(isAdminPathAllowed('admin2', '/admin/orders-private'), false, 'section boundaries cannot be bypassed with a shared prefix')
  assert.equal(isAdminPathAllowed('admin2', '/admin/admins'), false)
  assert.equal(isAdminPathAllowed('admin', '/admin/admin2/live-orders/'), true)
  assert.equal(isAdminPathAllowed('admin', '/admin/admin2/dashboard'), false)
  assert.equal(isAdminPathAllowed(null, '/admin/orders'), false)

  assert.equal(await hasAdminPermission(client, 'orderDetailsRead'), true)
  assert.equal(await hasAdminPermission(client, 'usersRead'), false)
  assert.equal(permissionReads, 1, 'route checks share the fresh session query')
  role = 'admin'
  assert.equal(await hasAdminPermission(client, 'usersWrite'), true)
  assert.equal(permissionReads, 1, 'the main administrator needs no Level 2 session request')
  role = 'user'
  assert.equal(await hasAdminPermission(client, 'usersRead'), false)

  role = 'admin2'
  assert.equal(usePermissions().permissions.orderDetailsRead, true)
  assert.equal(queryEnabled, true)
  session = { isAdmin2LoggedIn: false, admin: session.admin }
  assert.equal(usePermissions().permissions.orderDetailsRead, false, 'a revoked session cannot retain cached permissions')
  client.clear()
  assert.equal(await hasAdminPermission(client, 'orderDetailsRead'), false)
  role = 'admin'
  assert.equal(usePermissions().permissions.printingManage, true)
  assert.equal(queryEnabled, false)

  const filters = { page: 1, limit: 10, search: '', status: 'all', sortDate: 'newest', sortAmount: 'none', admin2: 'all', courier: 'all', admin2Id: null }
  await client.query(adminOrdersOptions({ ...filters, role: 'admin2' }))
  assert.equal(staffOrderReads, 1, 'missing persisted admin2Id still calls the role-scoped staff endpoint')
  assert.equal(mainOrderReads, 0)
  await client.query(adminOrdersOptions({ ...filters, role: 'admin' }))
  assert.equal(mainOrderReads, 1)

  role = null
  refreshedRole = 'admin2'
  await route.beforeLoad({ location: { pathname: '/admin/orders', href: '/admin/orders' } })
  assert.equal(role, 'admin2', 'the refreshed server role is read after session restoration')
  role = 'admin2'
  refreshedRole = 'user'
  await assert.rejects(route.beforeLoad({ location: { pathname: '/admin/orders', href: '/admin/orders' } }),
    (error: any) => error.to === '/login', 'demoted sessions leave protected routes after refresh')
  refreshedRole = 'admin2'
  await assert.rejects(route.beforeLoad({ location: { pathname: '/admin/admins', href: '/admin/admins' } }),
    (error: any) => error.to === '/admin/admin2/live-orders')

  console.log('Admin Level 2 access passed: scoped queries without a persisted ID, shared permission checks, revoked permissions, strict path boundaries and refreshed-role guards.')
} finally {
  client.clear()
}
