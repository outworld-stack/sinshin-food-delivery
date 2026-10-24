import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { UserOrder } from '@sinshin/shared'

// Run the component's actual effects against controlled server, wall and
// monotonic clocks, including the render before hydration effects run.
const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree: any }
let host: Host
mock.module('react', () => ({
  ...react,
  memo: (component: unknown) => component,
  useState(initial: any) {
    const owner = host
    const cell = owner.cells[owner.cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, (value: unknown) => { cell.value = value; owner.dirty = true }]
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const cell = host.cells[host.cursor++] ??= {}
    if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
      host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
    }
  },
}))
let locale = 'fa-IR'
mock.module('#/i18n', () => ({
  useI18n: () => ({
    t: new Proxy({}, { get: (_target, key) => String(key) }),
    fmt: { num: (n: number) => n.toLocaleString(locale), price: String },
  }),
  tpl: (text: string, values: { n: string }) => `${text} ${values.n}`,
}))
mock.module('#/hooks/dashboard/useOrderPaymentRetry', () => ({
  useOrderPaymentRetry: () => ({ retryMutation: { isPending: false }, handleRetry() {} }),
}))
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } })
let wallTime = Date.parse('2030-01-01T00:00:00Z')
let elapsed = 0
const originalNow = Date.now
const originalPerformance = globalThis.performance
Date.now = () => wallTime
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => elapsed } })
let nextTimer = 0
const timers = new Map<number, () => void>()
const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval
globalThis.setInterval = ((callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id }) as any
globalThis.clearInterval = ((id: number) => { timers.delete(id) }) as any

const { PendingPaymentBox } = await import('../src/components/dashboard/order-detail/PendingPaymentBox')
const serverTime = Date.parse('2026-10-24T12:00:00Z')
let order = {
  id: 'order-a', totalAmount: 100_000, breakdown: { amountPaidOnline: 80_000 },
  pendingCheckedAt: new Date(serverTime), pendingExpiresAt: new Date(serverTime + 90_000),
} as UserOrder
function render(owner: Host, effects = true) {
  host = owner; owner.cursor = 0; owner.dirty = false
  owner.tree = PendingPaymentBox({ order })
  if (effects) for (const effect of owner.effects.splice(0)) effect()
}
function mount(effects = true): Host {
  const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, tree: null }
  render(owner, effects)
  return owner
}
function flush(owner: Host) {
  for (let i = 0; owner.dirty && i < 10; i++) render(owner)
  assert(!owner.dirty, 'effects must converge')
}
function unmount(owner: Host) { for (const cell of owner.cells) cell.cleanup?.() }
function advance(owner: Host, ms: number) {
  elapsed += ms
  for (const tick of [...timers.values()]) tick()
  flush(owner)
}
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}
const text = (owner: Host) => JSON.stringify(owner.tree)
const hasButton = (owner: Host) => nodes(owner.tree).some(node => node.type === 'button')

try {
  const server = mount(false)
  const serverMarkup = text(server)
  wallTime = Date.parse('2020-01-01T00:00:00Z')
  const client = mount(false)
  assert.equal(text(client), serverMarkup, 'SSR and first client render must not depend on their wall clocks')
  assert(serverMarkup.includes('۰۱:۳۰'), 'server time defines the localized countdown even on a badly skewed device')
  for (const effect of client.effects.splice(0)) effect()
  flush(client)
  wallTime += 24 * 60 * 60_000
  advance(client, 31_000)
  assert(text(client).includes('۰۰:۵۹'))
  assert(nodes(client.tree).some(node => node.props.className?.includes('text-red-600')), 'last minute is highlighted')
  assert(hasButton(client), 'changing the device date must not prematurely hide payment')
  locale = 'ar'
  render(client)
  assert(text(client).includes('٠٠:٥٩'), 'language switching localizes the running countdown')
  advance(client, 59_000)
  assert(!hasButton(client))
  assert(text(client).includes('dash.orderDetail.expiredHint'))
  assert.equal(timers.size, 0, 'expired windows stop ticking while server verification continues')

  // Polling refreshes the time reference; changing the order cannot inherit the
  // previous order's expired local state, even before its new effects execute.
  order = { ...order, id: 'order-b', pendingCheckedAt: new Date(serverTime + 60_000), pendingExpiresAt: new Date(serverTime + 180_000) }
  render(client, false)
  assert(hasButton(client))
  assert(text(client).includes('٠٢:٠٠'))
  for (const effect of client.effects.splice(0)) effect()
  flush(client)
  assert.equal(timers.size, 1)
  unmount(client)
  assert.equal(timers.size, 0)

  // Mixed API deployments and malformed dates remain usable and never show NaN.
  for (const value of [undefined, null, new Date('invalid')]) {
    order = { ...order, pendingExpiresAt: value }
    const legacy = mount(); flush(legacy)
    assert(hasButton(legacy))
    assert(!text(legacy).includes('pendingCountdown'))
    assert.equal(timers.size, 0)
    unmount(legacy)
  }
  order = { ...order, pendingCheckedAt: undefined, pendingExpiresAt: new Date(wallTime + 60_000) }
  const legacy = mount(false)
  assert(!text(legacy).includes('pendingCountdown'), 'legacy wall-clock fallback waits until hydration')
  for (const effect of legacy.effects.splice(0)) effect()
  flush(legacy)
  assert(text(legacy).includes('٠١:٠٠'))
  advance(legacy, 60_000)
  assert(!hasButton(legacy))
  unmount(legacy)
  console.log('Payment window client passed: server clock, hydration, elapsed time, locale, expiry, refresh, cleanup and legacy responses.')
} finally {
  Date.now = originalNow
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance })
  globalThis.setInterval = originalInterval
  globalThis.clearInterval = originalClear
}
