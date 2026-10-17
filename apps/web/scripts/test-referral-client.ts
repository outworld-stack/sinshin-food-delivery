import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const values = new Map<string, string>()
let blockReads = false
let blockWrites = false
let blockRemovals = false
const localStorage = {
  getItem(key: string) {
    if (blockReads) throw new DOMException('Storage denied', 'SecurityError')
    return values.get(key) ?? null
  },
  setItem(key: string, value: string) {
    if (blockWrites) throw new DOMException('Storage full', 'QuotaExceededError')
    values.set(key, value)
  },
  removeItem(key: string) {
    if (blockRemovals) throw new DOMException('Storage denied', 'SecurityError')
    values.delete(key)
  },
}
const location = { href: 'https://sinshin.test/login?lang=ar&ref=friend-01#terms' }
const routerState = { __TSR_key: 'kept', __TSR_index: 3 }
const history = {
  state: routerState,
  replaceState(state: unknown, _unused: string, href: string) {
    assert.equal(state, routerState, 'preserve router navigation state')
    location.href = new URL(href, location.href).href
  },
}
const built = await Bun.build({
  entrypoints: [fileURLToPath(new URL('../src/utils/referralCapture.ts', import.meta.url))],
  target: 'browser', format: 'cjs',
})
assert(built.success, built.logs.map(String).join('\n'))
const compiled = await built.outputs[0]!.text()
function reload(browser = true): typeof import('../src/utils/referralCapture') {
  const module = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, URL, URLSearchParams,
    ...(browser ? { window: { location, history }, localStorage } : {}),
  })
  return module.exports as typeof import('../src/utils/referralCapture')
}

const capture = reload()
// Login reads this before the root's effect; no existing local value is needed.
assert.equal(capture.captureRefFromUrl() ?? capture.getStoredRef(), 'FRIEND-01')
assert.equal(location.href, 'https://sinshin.test/login?lang=ar#terms')
assert.equal(capture.captureRefFromUrl(), null)
assert.equal(reload().getStoredRef(), 'FRIEND-01', 'normal storage survives reload')

blockReads = true
blockWrites = true
assert.equal(capture.storeReferralCode(' other_02 '), 'OTHER_02')
assert.equal(capture.getStoredRef(), 'OTHER_02', 'blocked storage preserves referral through navigation')
blockReads = false
assert.equal(capture.getStoredRef(), 'OTHER_02', 'old readable storage cannot override failed write')
blockRemovals = true
capture.clearStoredRef()
assert.equal(capture.getStoredRef(), null, 'failed removal cannot reuse a consumed referral')

for (const raw of ['AB', 'A'.repeat(17), 'GOOD%20CODE', 'name/other', 'کدمعرف', 'FRIEND\nOTHER']) {
  assert.equal(capture.storeReferralCode(raw), null, `reject malformed code ${raw}`)
  assert.equal(capture.getStoredRef(), null)
}
assert.equal(capture.storeReferralCode('a'.repeat(16)), 'A'.repeat(16))

blockWrites = false
blockRemovals = false
values.set('sinshin-ref', 'A'.repeat(20))
assert.equal(reload().getStoredRef(), null, 'historical invalid storage is not silently truncated')
values.set('sinshin-ref', ' old_code ')
assert.equal(reload().getStoredRef(), 'OLD_CODE')

const server = reload(false)
assert.equal(server.getStoredRef(), null)
assert.equal(server.captureRefFromUrl(), null)
server.clearStoredRef()
console.log('Referral browser regressions passed: direct login capture, reload, blocked/full storage, consumed codes, router/hash preservation and canonical validation.')
