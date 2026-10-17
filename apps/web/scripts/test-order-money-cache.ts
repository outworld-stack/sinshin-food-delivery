import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { UserOrder } from '@sinshin/shared'
import { qk } from '../src/utils/queryKeys'

const client = new QueryClient()
let previousDependencies: readonly unknown[] | undefined
let effectRuns = 0
mock.module('react', () => ({
  useEffect(effect: () => void, dependencies: readonly unknown[]) {
    if (previousDependencies && dependencies.every((value, index) => Object.is(value, previousDependencies![index]))) return
    previousDependencies = dependencies
    effectRuns++
    effect()
  },
}))
mock.module('@tanstack/react-query', () => ({ useQueryClient: () => client }))
const { useOrderFinancialSync } = await import('../src/hooks/dashboard/useOrderFinancialSync')

const moneyKeys = [
  qk.userProfile, qk.userProfileLight,
  qk.myOrders(1, 10, 'newest'), qk.myOrders(2, 5, 'oldest'),
  qk.checkoutPreview([], 'PICKUP', null, true, null),
]
function fillCaches() {
  for (const key of moneyKeys) client.setQueryData(key, { previousBalance: 1_000 })
  client.setQueryData(qk.orderDetails('order-a'), { status: 'PENDING_PAYMENT' })
}

fillCaches()
useOrderFinancialSync('order-a', undefined, undefined)
for (const key of moneyKeys) assert.equal(client.getQueryState(key)?.isInvalidated, false)

for (const [status, payment] of [
  ['PENDING_PAYMENT', 'PENDING'], ['PAID', 'SUCCESS'], ['CANCELED', 'REFUNDED'],
] satisfies Array<[UserOrder['status'], UserOrder['paymentStatus']]>) {
  fillCaches()
  useOrderFinancialSync('order-a', status, payment)
  for (const key of moneyKeys) assert.equal(client.getQueryState(key)?.isInvalidated, true, `${status} updates ${key[0]}`)
  assert.equal(client.getQueryState(qk.orderDetails('order-a'))?.isInvalidated, false, 'avoid order polling/refetch loop')
  const previousRuns = effectRuns
  fillCaches()
  useOrderFinancialSync('order-a', status, payment)
  assert.equal(effectRuns, previousRuns, 'unchanged polling response does not refresh all money again')
  for (const key of moneyKeys) assert.equal(client.getQueryState(key)?.isInvalidated, false)
}
useOrderFinancialSync('order-b', 'CANCELED', 'REFUNDED')
assert.equal(client.getQueryState(qk.userProfile)?.isInvalidated, true, 'a different order refreshes the shared wallet even with same status')
client.clear()
console.log('Order money cache regressions passed: wallet/light profile, all order pages and checkout previews refresh after payment/refund with no polling loop.')
