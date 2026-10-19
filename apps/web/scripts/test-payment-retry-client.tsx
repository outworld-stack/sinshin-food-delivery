import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { qk } from '../src/utils/queryKeys'

const requests: Array<{ path: string; method: string; body: unknown }> = []
const invalidations: unknown[] = []
const toasts: string[] = []
const location = { href: '' }
let response: unknown = { paymentUrl: 'https://sep.shaparak.ir/pay/existing-token', displayId: 'ord-retry' }
let requestError: Error | undefined
let requestGate: Promise<void> = Promise.resolve()
let pendingMutation: Promise<void> | undefined

mock.module('#/lib/api-fetch', () => ({
  authJson: async (path: string, method: string, body: unknown) => {
    requests.push({ path, method, body })
    await requestGate
    if (requestError) throw requestError
    return response
  },
  getJson: async () => { throw new Error('Unexpected GET') },
  fetchWithTimeout: async () => { throw new Error('Unexpected mock payment') },
}))
mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async (input: unknown) => { invalidations.push(input) } }),
  useMutation: (options: any) => ({
    // Keep false to exercise the real hook's same-frame double-click guard.
    isPending: false,
    mutate: () => {
      pendingMutation = (async () => {
        try { await options.onSuccess(await options.mutationFn()) }
        catch (error) { await options.onError(error) }
        finally { await options.onSettled() }
      })()
    },
  }),
}))
mock.module('#/i18n', () => ({
  useI18n: () => ({ t: new Proxy({}, { get: (_target, key) => String(key) }), apiError: (message: string) => message }),
}))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast: (message: string) => toasts.push(message) }) }))
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })

// Use the actual hook and checkout API function: the button's callback must
// POST the display ID, then navigate the browser to the returned gateway URL.
const { useOrderPaymentRetry } = await import('../src/hooks/dashboard/useOrderPaymentRetry')
let page!: ReturnType<typeof useOrderPaymentRetry>
function Probe() { page = useOrderPaymentRetry('ord-retry'); return null }
renderToStaticMarkup(createElement(Probe))

let release!: () => void
requestGate = new Promise<void>((resolve) => { release = resolve })
page.handleRetry()
page.handleRetry()
assert.deepEqual(requests, [{ path: '/payments/retry', method: 'POST', body: { orderId: 'ord-retry' } }])
assert.equal(location.href, '', 'wait for the gateway response before navigating')
release()
await pendingMutation
assert.equal(location.href, 'https://sep.shaparak.ir/pay/existing-token')
assert.deepEqual(invalidations.at(-1), { queryKey: qk.orderDetails('ord-retry') })
assert.equal(toasts.length, 0)

// A timeout/conflict can mean the payment settled meanwhile. Refresh the
// order, show the server error and allow another explicit attempt.
location.href = ''
requestError = new Error('Payment status changed')
page.handleRetry()
await pendingMutation
assert.equal(requests.length, 2)
assert.equal(location.href, '')
assert.equal(toasts.at(-1), requestError.message)
assert.equal(invalidations.length, 2)
requestError = undefined
response = { paymentUrl: 'https://gateway.example/pay/new-token', displayId: 'ord-retry' }
page.handleRetry()
await pendingMutation
assert.equal(requests.length, 3)
assert.equal(location.href, 'https://gateway.example/pay/new-token')

location.href = ''
response = { displayId: 'ord-retry' }
page.handleRetry()
await pendingMutation
assert.equal(location.href, '')
assert.equal(toasts.at(-1), 'dash.orderDetail.pendingRetryNoUrl')
assert.equal(invalidations.length, 4)
console.log('Payment retry client passed: authenticated order request, gateway redirect, double-click guard, recoverable errors and order refresh.')
