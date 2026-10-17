import assert from 'node:assert/strict'

// Import with storage access denied: the module must still initialize and
// hydration must finish, so the login page and guarded routes remain usable.
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('Storage denied', 'SecurityError') },
})
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('Storage denied', 'SecurityError') },
})
const { useAuthStore, ensureAuthHydrated } = await import('../src/stores/authStore')
await ensureAuthHydrated()
assert.equal(useAuthStore.persist.hasHydrated(), true)
assert.doesNotThrow(() => useAuthStore.getState().login(false, 'user'))
assert.equal(useAuthStore.getState().isAuthenticated, true)
assert.doesNotThrow(() => useAuthStore.getState().logout())

let stored = '{invalid JSON'
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value },
    removeItem: () => { stored = '' },
  },
})
await useAuthStore.persist.rehydrate()
await ensureAuthHydrated()
assert.equal(useAuthStore.persist.hasHydrated(), true)
assert.equal(useAuthStore.getState().isAuthenticated, false)

// A persisted object cannot replace the store's functions or promote a
// normal user's UI role via a stale isAdmin flag.
stored = JSON.stringify({ state: { isAuthenticated: true, role: 'user', isAdmin: true, login: 'broken', logout: null }, version: 0 })
await useAuthStore.persist.rehydrate()
assert.equal(useAuthStore.getState().role, 'user')
assert.equal(useAuthStore.getState().isAdmin, false)
assert.equal(typeof useAuthStore.getState().login, 'function')
assert.equal(typeof useAuthStore.getState().logout, 'function')

for (const role of ['unknown-role', null]) {
  stored = JSON.stringify({ state: { isAuthenticated: true, role, isAdmin: true, activeOrderId: 'old-order' }, version: 0 })
  await useAuthStore.persist.rehydrate()
  assert.equal(useAuthStore.getState().isAuthenticated, false)
  assert.equal(useAuthStore.getState().role, null)
  assert.equal(useAuthStore.getState().isAdmin, false)
  assert.equal(useAuthStore.getState().activeOrderId, null)
}

console.log('Auth store: blocked storage, corrupt JSON, and invalid persisted state passed.')
