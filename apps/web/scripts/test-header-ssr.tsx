/** Public navigation must be present before JS hydrates persisted account state. */
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

let hydrated = false
let authenticated = true
const queries: boolean[] = []
mock.module('#/hooks/useHydrated', () => ({ useHydrated: () => hydrated }))
mock.module('#/hooks/shared/useActiveOrder', () => ({ useActiveOrder: () => {} }))
mock.module('#/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ isAuthenticated: authenticated, role: 'admin', activeOrderId: 'order-123' }),
}))
mock.module('#/stores/cartStore', () => ({ useCartStore: (select: (state: unknown) => unknown) => select({ getTotalItems: () => 17 }) }))
mock.module('#/i18n', () => ({ useI18n: () => ({ t: new Proxy({}, { get: (_, key) => String(key) }), fmt: { num: (value: number) => String(value) } }) }))
mock.module('#/components/Brand', () => ({ Brand: ({ to }: { to: string }) => <a href={to}>Sinshin</a> }))
mock.module('#/components/ThemeToggle', () => ({ ThemeToggle: () => <button type="button">Theme</button> }))
mock.module('#/components/LangSwitcher', () => ({ LangSwitcher: () => <button type="button">Language</button> }))
mock.module('#/utils/queryOptions', () => ({
  activeMainCategoriesOptions: { kind: 'mains' },
  userProfileLightClientOptions: { kind: 'profile' },
  notificationsUnreadOptions: (id?: string) => ({ kind: 'notifications', enabled: Boolean(id) }),
}))
mock.module('@tanstack/react-query', () => ({ useQuery: (options: { kind: string; enabled?: boolean }) => {
  if (options.kind === 'mains') return { data: [{ id: '1', slug: 'pizza', name: 'Pizza' }, { id: '2', slug: 'burgers', name: 'Burgers' }] }
  queries.push(Boolean(options.enabled))
  return options.kind === 'profile' && options.enabled ? { data: { id: 'user-123' } } : { data: undefined }
} }))
mock.module('@tanstack/react-router', () => ({ Link: ({ to, search, params, children, ...props }: any) => {
  let href = to as string
  for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, String(value))
  if (search) href += `?${new URLSearchParams(search)}`
  return <a href={href} {...props}>{children}</a>
} }))
const { Header } = await import('../src/components/Header')
const server = renderToStaticMarkup(<Header />)
assert(server.includes('href="/products?tab=pizza"') && server.includes('href="/products?tab=burgers"'), 'SSR emits ordinary crawlable menu links')
assert(server.includes('href="/"') && server.includes('href="/cart"') && server.includes('href="/login"'))
assert(!server.includes('href="/admin"') && !server.includes('/dashboard'), 'persisted account state cannot affect initial HTML')
assert(!server.includes('>17<'), 'the persisted cart badge waits for hydration')
assert(queries.every(enabled => !enabled), 'private queries wait for hydrated authentication')
assert.equal(renderToStaticMarkup(<Header />), server, 'first client render matches the server navigation')

hydrated = true
queries.length = 0
const client = renderToStaticMarkup(<Header />)
assert(client.includes('href="/admin"') && client.includes('href="/dashboard/orders/order-123"'))
assert(client.includes('href="/dashboard"') && client.includes('>17<'), 'account and cart controls return after hydration')
assert(queries.every(enabled => enabled), 'authenticated queries enable after hydration')
authenticated = false
const anonymous = renderToStaticMarkup(<Header />)
assert(anonymous.includes('href="/login"') && !anonymous.includes('href="/admin"'))
console.log('PASS header SSR: crawlable links, stable hydration, private query guards, restored account and cart controls')
