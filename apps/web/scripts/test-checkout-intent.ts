import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import type { CheckoutInput } from '@sinshin/shared'

const values = new Map<string, string>()
let writesBlocked = false
let removalsBlocked = false
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (writesBlocked) throw new DOMException('Full storage', 'QuotaExceededError')
    values.set(key, value)
  },
  removeItem: (key: string) => {
    if (removalsBlocked) throw new DOMException('Storage denied', 'SecurityError')
    values.delete(key)
  },
} })

// Bun normalizes file-import query strings, so use independent VM module
// instances of the unchanged module compiled by Bun's normal TypeScript build.
const built = await Bun.build({
  entrypoints: [fileURLToPath(new URL('../src/lib/checkout-intent.ts', import.meta.url))],
  target: 'browser', format: 'cjs',
})
assert(built.success, built.logs.map(String).join('\n'))
const compiledModule = await built.outputs[0]!.text()
const reload = async (): Promise<typeof import('../src/lib/checkout-intent')> => {
  const module = { exports: {} }
  runInNewContext(compiledModule, { module, exports: module.exports, sessionStorage, crypto, Date })
  return module.exports as typeof import('../src/lib/checkout-intent')
}
const input: CheckoutInput = {
  items: [{ productId: 'product-1', sizeId: 'size-1', quantity: 1 }],
  deliveryType: 'PICKUP', useWallet: false, gatewayId: 'MOCK',
  addressId: null, customerNote: '', couponCode: null,
}

// Each module instance has fresh memory while the browser storage survives.
const first = await reload()
const initialKey = first.checkoutIntentKey(input)
const reloaded = await reload()
assert.notEqual(first.checkoutIntentKey, reloaded.checkoutIntentKey)
assert.equal(reloaded.checkoutIntentKey(structuredClone(input)), initialKey)
const changedInput = { ...input, items: [{ ...input.items[0]!, quantity: 2 }] }
const changedKey = reloaded.checkoutIntentKey(changedInput)
assert.notEqual(changedKey, initialKey, 'a changed purchase needs its own idempotency key')
assert.equal((await reload()).checkoutIntentKey(changedInput), changedKey)

// The server's durable order response retires this request for an independent
// checkout without waiting for a PSP outcome. Storage must preserve this boundary.
reloaded.completeCheckoutIntent(changedKey, 'unresolved-original-order')
const independent = await reload()
const independentKey = independent.checkoutIntentKey(changedInput)
assert.notEqual(independentKey, changedKey, 'the same basket can start a new checkout after the original order is known')
assert.equal(independent.checkoutIntentKey(changedInput), independentKey, 'a lost new response still retries its own key')
independent.completeCheckoutIntent(changedKey, 'unresolved-original-order')
independent.clearCheckoutIntent('unresolved-original-order')
assert.equal(independent.checkoutIntentKey(changedInput), independentKey, 'old callbacks cannot mark or clear a newer in-flight request')
independent.completeCheckoutIntent(independentKey, 'new-order')
const boundRecord = [...values.values()][0]
independent.clearCheckoutIntent('unresolved-original-order')
assert.equal([...values.values()][0], boundRecord, 'old callbacks cannot clear a newer known-order intent')
independent.clearCheckoutIntent('new-order')
assert.notEqual(independent.checkoutIntentKey(changedInput), independentKey)

// Clearing a terminal purchase allows an identical future purchase.
reloaded.clearCheckoutIntent()
const nextPurchase = (await reload()).checkoutIntentKey(changedInput)
assert.notEqual(nextPurchase, changedKey)

// Failure to remove storage must not resurrect a completed purchase key.
const terminal = await reload()
assert.equal(terminal.checkoutIntentKey(changedInput), nextPurchase)
removalsBlocked = true
terminal.clearCheckoutIntent()
const afterBlockedRemoval = terminal.checkoutIntentKey(changedInput)
assert.notEqual(afterBlockedRemoval, nextPurchase)
assert.equal(terminal.checkoutIntentKey(changedInput), afterBlockedRemoval)
removalsBlocked = false

// A failed write with an older readable record still retries from memory.
writesBlocked = true
const memoryKey = terminal.checkoutIntentKey(input)
assert.notEqual(memoryKey, afterBlockedRemoval)
assert.equal(terminal.checkoutIntentKey(structuredClone(input)), memoryKey)
terminal.completeCheckoutIntent(memoryKey, 'memory-only-order')
const independentMemoryKey = terminal.checkoutIntentKey(input)
assert.notEqual(independentMemoryKey, memoryKey, 'a failed storage write cannot trap a known order in memory')
assert.equal(terminal.checkoutIntentKey(input), independentMemoryKey)
removalsBlocked = true
terminal.clearCheckoutIntent()
assert.notEqual(terminal.checkoutIntentKey(input), memoryKey)
writesBlocked = false
removalsBlocked = false

// Reload ignores corrupted persisted state and renews expired purchase keys.
for (const key of values.keys()) values.set(key, '{invalid-json')
const repaired = await reload()
const repairedKey = repaired.checkoutIntentKey(input)
assert(repairedKey.length >= 8)
const originalNow = Date.now
try {
  const current = originalNow()
  Date.now = () => current + 49 * 60 * 60 * 1000
  assert.notEqual((await reload()).checkoutIntentKey(input), repairedKey)
} finally {
  Date.now = originalNow
}

console.log('Checkout intent regressions passed: lost-response reload, independent identical checkout after durable order, order-bound callback reset, blocked storage, malformed state and expiry.')
