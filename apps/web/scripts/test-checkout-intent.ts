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

console.log('Checkout intent regressions passed: real module reload, changed payload, terminal reset, blocked removal/write, malformed storage and expiry.')
