import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { myNotificationsOptions } from '../src/utils/queryOptions'
import { qk } from '../src/utils/queryKeys'

const client = new QueryClient()
const first = myNotificationsOptions('user-a')
const next = myNotificationsOptions('user-b')
const previousInbox = { items: [{
  id: 'private-a', type: 'system', title: 'Private order for user A',
  body: 'Ready', url: '/orders/a', data: {}, createdAt: new Date(), readAt: null,
}], unread: 1, ttlDays: 7 }
client.setQueryData(first.queryKey, previousInbox)
assert.equal(client.getQueryData(next.queryKey), undefined)
assert.deepEqual(client.getQueryData(first.queryKey), previousInbox)
assert.equal(myNotificationsOptions(undefined).enabled, false)
await client.invalidateQueries({ queryKey: qk.myNotifications })
assert.equal(client.getQueryState(first.queryKey)?.isInvalidated, true)
client.clear()
console.log('Notification cache regressions passed: account isolation, unauthenticated disable and prefix invalidation.')
