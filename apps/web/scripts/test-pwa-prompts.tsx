import assert from 'node:assert/strict'
import { mock } from 'bun:test'

// Promotion suppression must not disable background subscription repair.
const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree: any; render(): void }
let host: Host
mock.module('react', () => ({
  ...react,
  useState(initial: any) {
    const owner = host
    const cell = owner.cells[owner.cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, (next: any) => {
      const value = typeof next === 'function' ? next(cell.value) : next
      if (!Object.is(value, cell.value)) { cell.value = value; owner.dirty = true }
    }]
  },
  useRef(initial: any) { return (host.cells[host.cursor++] ??= { value: { current: initial } }).value },
  useCallback: (callback: any) => callback,
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const cell = host.cells[host.cursor++] ??= {}
    if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
      host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
    }
  },
}))
const state: { state: 'default' | 'granted' } = { state: 'granted' }
let reconciles = 0, reads = 0
mock.module('#/lib/push-subscription', () => ({
  AUTO_PROMPT_KEY: 'push-dismiss', AUTO_PROMPT_RETRY_DAYS: 3,
  getPushState: async () => { reads++; return { ...state } },
  reconcileSubscription: async () => { reconciles++ },
  enablePush: async () => ({ state: 'granted', subscribed: true }),
}))
mock.module('#/stores/authStore', () => ({ useAuthStore: () => false }))
const dictionary = new Proxy({}, { get: (_target, key) => String(key) })
mock.module('#/i18n', () => ({ DICTS: { fa: dictionary }, readLangCookie: () => 'fa' }))
let pathname = '/'
mock.module('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: { pathname } }),
}))
const originals = new Map(['window', 'navigator', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let timerId = 0
const timers = new Map<number, () => unknown>()
const browser = Object.assign(new EventTarget(), {
  navigator: { userAgent: 'Android Chrome', platform: 'Linux', maxTouchPoints: 1 },
  location: { pathname: '/' },
  matchMedia: () => ({ matches: false }),
  setTimeout: (callback: () => unknown) => { timers.set(++timerId, callback); return timerId },
  clearTimeout: (id: number) => { timers.delete(id) },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser.navigator })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
const { PushAutoPrompt } = await import('../src/pwa/PushAutoPrompt')
let suppressPromotion = true
const owner: Host = {
  cells: [], cursor: 0, effects: [], dirty: false, tree: null,
  render() {
    do {
      host = owner; owner.cursor = 0; owner.dirty = false
      owner.tree = PushAutoPrompt({ suppressPromotion })
      for (const effect of owner.effects.splice(0)) effect()
    } while (owner.dirty)
  },
}
async function runTimers() {
  const due = [...timers.values()]; timers.clear()
  for (const callback of due) await callback()
  await Promise.resolve()
  owner.render()
}
try {
  owner.render()
  await runTimers()
  assert.equal(reads, 1, 'landing-page inline actions do not skip checking push state')
  assert.equal(reconciles, 1, 'granted subscriptions still reconcile while promotions are hidden')
  assert.equal(owner.tree, null, 'no duplicate floating prompt overlays landing actions')

  pathname = '/products'; suppressPromotion = false; state.state = 'default'
  owner.render(); await runTimers()
  assert(owner.tree, 'other pages can show the notification prompt')

  pathname = '/'; suppressPromotion = true
  owner.render()
  assert.equal(owner.tree, null, 'entering the landing page immediately hides an open promotion')
  await runTimers()
  assert.equal(owner.tree, null, 'default permission on the landing page does not reopen the duplicate prompt')

  pathname = '/products'; suppressPromotion = false
  owner.render()
  pathname = '/'; suppressPromotion = true
  owner.render(); await runTimers()
  assert.equal(owner.tree, null, 'a delayed promotion cannot leak across navigation back to the landing page')

  console.log('PWA prompt regressions passed: landing suppression, background reconciliation, other-page prompts and navigation timers.')
} finally {
  for (const cell of owner.cells) cell.cleanup?.()
  assert.equal(timers.size, 0)
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  mock.restore()
}
