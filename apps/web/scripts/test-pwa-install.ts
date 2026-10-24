import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; value: any; render(): void; unmount(): void }
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
  useCallback(fn: any, deps: unknown[]) {
    const cell = host.cells[host.cursor++] ??= {}
    if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) { cell.value = fn; cell.deps = deps }
    return cell.value
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const cell = host.cells[host.cursor++] ??= {}
    if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
      host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
    }
  },
}))

const { usePwaInstall } = await import('../src/pwa/usePwaInstall')
const { isInstalledPwa, isIosInstallDevice, PWA_INSTALL_REQUEST_EVENT } = await import('../src/pwa/install')
const originals = new Map(['window', 'navigator', 'localStorage', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let timerId = 0
const timers = new Map<number, () => void>()
const store = new Map<string, string>()
let storageBlocked = false
let inClick = false
let browser!: EventTarget & { navigator: any; matchMedia(): any }
let media!: EventTarget & { matches: boolean }
const hosts: Host[] = []

function installGlobals({ ios = false, standalone = false, iosStandalone = false } = {}) {
  media = Object.assign(new EventTarget(), { matches: standalone })
  const nav = { userAgent: ios ? 'Mozilla/5.0 Safari' : 'Mozilla/5.0 Android Chrome', platform: ios ? 'MacIntel' : 'Linux', maxTouchPoints: ios ? 5 : 0, standalone: iosStandalone }
  browser = Object.assign(new EventTarget(), { navigator: nav, matchMedia: () => media })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { if (storageBlocked) throw new Error('storage denied'); return store.get(key) ?? null },
    setItem: (key: string, value: string) => { if (storageBlocked) throw new Error('storage denied'); store.set(key, value) },
    removeItem: (key: string) => { if (storageBlocked) throw new Error('storage denied'); store.delete(key) },
  } })
  globalThis.setTimeout = ((callback: () => void) => { timers.set(++timerId, callback); return timerId }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
}

function mount(): Host {
  const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, value: undefined,
    render() {
      do {
        host = owner; owner.cursor = 0; owner.dirty = false
        owner.value = usePwaInstall()
        for (const effect of owner.effects.splice(0)) effect()
      } while (owner.dirty)
    },
    unmount() { for (const cell of owner.cells) { cell.cleanup?.(); cell.cleanup = undefined } },
  }
  hosts.push(owner)
  owner.render()
  return owner
}

function clickInstall() {
  inClick = true
  try { browser.dispatchEvent(new Event(PWA_INSTALL_REQUEST_EVENT)) } finally { inClick = false }
}
function beforeInstall(prompt: () => Promise<void>, userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> = Promise.resolve({ outcome: 'accepted' })) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice })
  browser.dispatchEvent(event)
  assert(event.defaultPrevented, 'the captured browser event suppresses an automatic duplicate prompt')
}
function runTimers() { const due = [...timers.values()]; timers.clear(); for (const callback of due) callback() }
async function settle(owner: Host) { for (let i = 0; i < 6; i++) await Promise.resolve(); owner.render() }

try {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'navigator')
  assert.equal(isInstalledPwa(), false, 'SSR does not access browser globals')
  assert.equal(isIosInstallDevice(), false)

  installGlobals()
  let owner = mount()
  assert(!('serviceWorker' in navigator), 'the test browser intentionally has no service-worker support')
  clickInstall(); owner.render()
  assert(owner.value.showInstallGuide, 'manual installation help opens without beforeinstallprompt or service workers')
  owner.value.closeInstallGuide(); owner.render()
  assert(!owner.value.showInstallGuide)
  clickInstall(); owner.render()
  assert(owner.value.showInstallGuide, 'help is always reopenable')
  owner.unmount()

  installGlobals({ ios: true })
  owner = mount()
  assert(isIosInstallDevice(), 'iPad desktop user agents are recognized')
  assert(owner.value.showIosGuide, 'iOS guidance does not require a native install event')
  owner.value.dismissIosGuide(); owner.render()
  owner.unmount()
  owner = mount()
  assert(!owner.value.showIosGuide, 'automatic iOS banner dismissal persists')
  clickInstall(); owner.render()
  assert(owner.value.showInstallGuide, 'persistent banner dismissal cannot hide manual installation access')
  owner.unmount()

  store.clear()
  installGlobals()
  owner = mount()
  let calls = 0
  let finishPrompt!: () => void
  beforeInstall(() => {
    calls++
    assert(inClick, 'native prompt must run synchronously in the click activation')
    return new Promise<void>(resolve => { finishPrompt = resolve })
  })
  runTimers(); owner.render()
  assert(owner.value.showInstall)
  owner.value.dismissInstall(); owner.render()
  clickInstall(); owner.render()
  assert.equal(calls, 1, 'manual action works after dismissing the automatic banner')
  clickInstall()
  assert.equal(calls, 1, 'rapid repeat clicks do not reuse a pending native prompt')
  assert(!owner.value.showInstallGuide, 'duplicate clicks do not open help behind the native prompt')
  finishPrompt(); await settle(owner)
  assert(!owner.value.standalone, 'acceptance is not treated as a completed Android installation')
  clickInstall(); owner.render()
  assert(owner.value.showInstallGuide, 'a consumed prompt falls back to instructions on the next click')
  browser.dispatchEvent(new Event('appinstalled')); owner.render()
  assert(owner.value.standalone)
  assert(!owner.value.showInstallGuide)
  clickInstall(); owner.render()
  assert(!owner.value.showInstallGuide, 'installed apps ignore manual installation requests')
  assert.equal(store.has('sinshin-install-dismissed'), false)
  owner.unmount()

  assert(isInstalledPwa(), 'installation is remembered in a normal browser tab for newly mounted buttons')
  owner = mount()
  assert(owner.value.standalone, 'a remounted installation controller agrees with newly mounted buttons')
  clickInstall(); owner.render()
  assert(!owner.value.showInstallGuide, 'route remounts do not restore installation UI after appinstalled')
  owner.unmount()

  installGlobals()
  assert(!isInstalledPwa(), 'a fresh window does not inherit installation state that could outlive an uninstall')
  owner = mount()
  beforeInstall(() => { throw new Error('expired browser event') })
  clickInstall(); await settle(owner)
  assert(owner.value.showInstallGuide, 'a synchronously rejected native prompt recovers to instructions')
  assert(!owner.value.standalone)
  owner.value.closeInstallGuide(); owner.render()
  beforeInstall(async () => {}, Promise.resolve({ outcome: 'dismissed' }))
  clickInstall(); await settle(owner)
  assert(store.has('sinshin-install-dismissed'))
  assert(!owner.value.standalone)
  beforeInstall(async () => { calls++ })
  runTimers(); owner.render()
  assert(!owner.value.showInstall, 'browser dismissal suppresses only the automatic banner')
  clickInstall(); await settle(owner)
  assert.equal(calls, 2, 'a later native event remains manually usable after dismissal')
  owner.unmount()

  installGlobals()
  owner = mount()
  let rejectPrompt!: (reason: Error) => void
  beforeInstall(() => new Promise<void>((_resolve, reject) => { rejectPrompt = reject }))
  clickInstall()
  browser.dispatchEvent(new Event('appinstalled'))
  rejectPrompt(new Error('late failure')); await settle(owner)
  assert(!owner.value.showInstallGuide, 'a late prompt error cannot reopen help after installation')
  owner.unmount()

  for (const options of [{ standalone: true }, { ios: true, iosStandalone: true }]) {
    installGlobals(options)
    owner = mount()
    assert(owner.value.standalone)
    clickInstall(); owner.render()
    assert(!owner.value.showInstallGuide)
    assert(!owner.value.showIosGuide)
    owner.unmount()
  }

  installGlobals()
  owner = mount()
  clickInstall(); owner.render()
  media.matches = true
  media.dispatchEvent(new Event('change')); owner.render()
  assert(owner.value.standalone && !owner.value.showInstallGuide, 'display-mode changes also dismiss installation UI')
  owner.unmount()

  storageBlocked = true
  installGlobals({ ios: true })
  owner = mount()
  owner.value.dismissIosGuide()
  clickInstall(); owner.render()
  assert(owner.value.showInstallGuide, 'blocked storage cannot break installation access')
  beforeInstall(() => new Promise<void>((_resolve, reject) => { rejectPrompt = reject }))
  clickInstall(); owner.render()
  owner.unmount()
  rejectPrompt(new Error('after unmount')); await settle(owner)
  assert(!owner.value.showInstallGuide, 'unmounted prompt callbacks do not update installation UI')
  browser.dispatchEvent(new Event(PWA_INSTALL_REQUEST_EVENT))
  runTimers(); owner.render()
  assert(!owner.value.showInstallGuide, 'event listeners and pending banner timers are removed on unmount')
  assert.equal(timers.size, 0)
  console.log('PWA install regressions passed: manual and native paths, iOS/iPad, activation, dismissal, concurrency, failures, standalone and lifecycle cleanup.')
} finally {
  for (const owner of hosts) owner.unmount()
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  mock.restore()
}
