import assert from 'node:assert/strict'
import { tehranDay, nextTehranDayDelay } from '../src/utils/tehranDay'
import { adminOrdersOptions } from '../src/utils/queryOptions'

assert.equal(tehranDay(new Date('2026-10-17T20:29:59Z')), '2026-10-17')
assert.equal(tehranDay(new Date('2026-10-17T20:30:00Z')), '2026-10-18')
assert.equal(tehranDay(new Date('2026-12-31T20:30:00Z')), '2027-01-01')
assert.equal(nextTehranDayDelay('2026-10-17', Date.parse('2026-10-17T20:29:59Z')), 1100)
assert.equal(nextTehranDayDelay('2026-10-17', Date.parse('2026-10-18T20:30:00Z')), 1)
const filters = { page: 1, limit: 10, search: '', status: 'all', sortDate: 'today', sortAmount: 'none', admin2: 'all', courier: 'all', role: 'admin', admin2Id: null }
const yesterday = adminOrdersOptions({ ...filters, todayDay: '2026-10-17' })
const today = adminOrdersOptions({ ...filters, todayDay: '2026-10-18' })
assert.notDeepEqual(yesterday.queryKey, today.queryKey, 'today cache identity includes the Tehran calendar date')
assert.deepEqual(adminOrdersOptions({ ...filters, sortDate: 'newest', todayDay: '2026-10-17' }).queryKey,
  adminOrdersOptions({ ...filters, sortDate: 'newest', todayDay: '2026-10-18' }).queryKey)
console.log('Admin today regressions passed: Tehran midnight/year rollover, bounded timer and date-specific cache keys.')
