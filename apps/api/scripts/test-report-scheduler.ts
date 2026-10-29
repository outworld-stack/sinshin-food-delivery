/** Report recovery with a controlled clock, plus isolated Redis lease races. No SMS is sent. */
import assert from 'node:assert/strict'
import { RedisClient } from 'bun'
import { JobRunRegistry } from '../src/infra/monitor/job-registry'
import { RedisService } from '../src/infra/redis/redis'
import { CronScheduler, type DailyJob } from '../src/workers/scheduler'
import { DailyReportJob } from '../src/workers/jobs/daily-report.job'
import { WeeklyReportJob } from '../src/workers/jobs/weekly-report.job'

let now = Date.parse('2026-10-28T21:29:00Z') // Thursday 00:59 in Tehran.
const clock = () => new Date(now)
class MemoryRedis {
  online = true
  readonly entries = new Map<string, { value: string; expires: number }>()
  read(key: string) {
    const entry = this.entries.get(key)
    if (entry && entry.expires <= now) this.entries.delete(key)
    return this.entries.get(key)?.value
  }
  write(key: string, value: string, ttl: number) {
    this.entries.set(key, { value, expires: now + ttl * 1000 })
  }
  async setNx(key: string, owner: string, { ex }: { ex: number }) {
    if (!this.online) return null
    if (this.read(key)) return false
    this.write(key, owner, ex)
    return true
  }
  async claimScheduledJob(leaseKey: string, doneKey: string, owner: string, ttl: number) {
    if (!this.online) return null
    if (this.read(doneKey)) return false
    return this.setNx(leaseKey, owner, { ex: ttl })
  }
  async finishScheduledJob(input: {
    leaseKey: string; doneKey: string; owner: string; success: boolean
    doneTtlSeconds: number; retrySeconds: number
  }) {
    if (!this.online) return null
    if (this.read(input.leaseKey) !== input.owner) return false
    if (input.success) {
      this.write(input.doneKey, '1', input.doneTtlSeconds)
      this.entries.delete(input.leaseKey)
    } else this.write(input.leaseKey, 'retry', input.retrySeconds)
    return true
  }
}

const memory = new MemoryRedis()
const registry = new JobRunRegistry()
const scheduler = () => new CronScheduler(memory as unknown as RedisService, registry, clock)
const fire = (runner: CronScheduler, job: DailyJob) =>
  (runner as unknown as { fire(job: DailyJob): Promise<void> }).fire(job)
let dailyRuns = 0
let weeklyRuns = 0
let failDaily = true
const deps = { reports: {
  runDailyFlow: async () => { dailyRuns++; if (failDaily) throw new Error('simulated archive/SMS failure') },
  runWeeklyFlow: async () => { weeklyRuns++ },
} } as never
const daily = new DailyReportJob(deps)
const weekly = new WeeklyReportJob(deps)
const first = scheduler()
first.register(daily)
first.register(weekly)
await fire(first, daily)
assert.equal(dailyRuns, 0, 'nothing runs before its Tehran due time')
now += 2 * 60_000
await fire(first, daily)
assert.equal(dailyRuns, 1)
assert.equal(registry.snapshot().find(job => job.name === daily.name)!.lastOk, false)
failDaily = false
const second = scheduler()
await fire(second, daily)
assert.equal(dailyRuns, 1, 'failure cooldown is shared across replicas')
now += 5 * 60_000
await fire(second, daily)
assert.equal(dailyRuns, 2, 'failed reports retry after the scheduled minute')
assert.equal(registry.snapshot().find(job => job.name === daily.name)!.lastOk, true)
now += 7 * 3_600_000
await fire(scheduler(), daily)
assert.equal(dailyRuns, 2, 'restarting more than six hours later cannot resend a completed daily report')
now += 24 * 3_600_000
await fire(scheduler(), daily)
assert.equal(dailyRuns, 3, 'the next report day is independently eligible')

memory.online = false
now += 24 * 3_600_000
await fire(first, daily)
assert.equal(dailyRuns, 3)
memory.online = true
now += 60_000
await fire(first, daily)
assert.equal(dailyRuns, 4, 'Redis recovery after the scheduled minute still produces the report')

now = Date.parse('2026-11-01T07:30:00Z') // Sunday after a missed Saturday run.
await fire(first, weekly)
assert.equal(weeklyRuns, 1)
now = Date.parse('2026-11-06T07:30:00Z') // Friday in the same reporting week.
await fire(scheduler(), weekly)
assert.equal(weeklyRuns, 1, 'weekly completion survives later restarts in the same week')
now = Date.parse('2026-11-06T21:30:00Z') // Saturday 01:00, before the new run.
await fire(first, weekly)
assert.equal(weeklyRuns, 1)
now += 5 * 60_000
await fire(first, weekly)
assert.equal(weeklyRuns, 2, 'a new weekly period starts at Saturday 01:05 Tehran')

let parallelRuns = 0
let release!: () => void
const held = new Promise<void>(resolve => { release = resolve })
const parallel: DailyJob = { name: 'parallel-report', time: '01:00', recovery: {}, run: async () => { parallelRuns++; await held } }
const race = [fire(first, parallel), fire(first, parallel), fire(second, parallel)]
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(parallelRuns, 1, 'one local invocation and one replica own a report period')
release()
await Promise.all(race)

const originalInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval
const originalCron = (Bun as unknown as { cron?: unknown }).cron
const intervals = new Map<number, () => void>()
let timerId = 0
const nativeCallbacks: Array<() => void> = []
const pollRunner = scheduler()
let pollRuns = 0
let unrelatedRuns = 0
try {
  globalThis.setInterval = ((callback: () => void) => {
    const id = ++timerId
    intervals.set(id, callback)
    return id
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((id: number) => { intervals.delete(id) }) as unknown as typeof clearInterval
  ;(Bun as unknown as { cron: unknown }).cron = (_schedule: string, callback: () => void) => {
    nativeCallbacks.push(callback)
    return { stop() {}, start() {} }
  }
  now = Date.parse('2026-11-06T21:29:00Z')
  pollRunner.register({ name: 'poll-report', time: '01:00', recovery: {}, run: async () => { pollRuns++ } })
  pollRunner.register({ name: 'unrelated-job', time: '01:00', run: async () => { unrelatedRuns++ } })
  await pollRunner.start()
  assert.equal(nativeCallbacks.length, 2)
  now += 4 * 60_000 // The exact minute passed while the API/event loop was unavailable.
  for (const callback of intervals.values()) callback()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pollRuns, 1, 'recovery polling remains active alongside native cron')
  assert.equal(unrelatedRuns, 0, 'unrelated daily jobs do not opt into report catch-up')
} finally {
  pollRunner.stop()
  globalThis.setInterval = originalInterval
  globalThis.clearInterval = originalClearInterval
  ;(Bun as unknown as { cron?: unknown }).cron = originalCron
}
assert.equal(intervals.size, 0, 'stop removes the recovery timer')
console.log('Report scheduler passed: Tehran periods, outage recovery, retries, restart deduplication, replica races and native-cron polling.')

// Verify the actual Lua primitives, including a delayed former owner, with unique local keys.
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')
assert(['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname), 'Scheduler tests require local Redis')
const redis = new RedisService(redisUrl.toString())
const client = new RedisClient(redisUrl.toString())
const prefix = `test:report-scheduler:${crypto.randomUUID()}`
const leaseKey = `${prefix}:lease`
const doneKey = `${prefix}:done`
try {
  assert(await redis.connect())
  const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => redis.claimScheduledJob(leaseKey, doneKey, String(i), 60)))
  assert.equal(claims.filter(Boolean).length, 1)
  const owner = String(claims.indexOf(true))
  assert.equal(await redis.finishScheduledJob({ leaseKey, doneKey, owner: 'former-owner', success: true, doneTtlSeconds: 60, retrySeconds: 60 }), false)
  assert.equal(await client.get(leaseKey), owner, 'a former owner cannot unlock another execution')
  assert.equal(await redis.finishScheduledJob({ leaseKey, doneKey, owner, success: false, doneTtlSeconds: 60, retrySeconds: 60 }), true)
  assert.equal(await client.get(doneKey), null, 'failed runs are not marked complete')
  assert.equal(await redis.claimScheduledJob(leaseKey, doneKey, 'retry-owner', 60), false)
  await client.del(leaseKey) // Simulate expiration without waiting a minute.
  assert.equal(await redis.claimScheduledJob(leaseKey, doneKey, 'retry-owner', 60), true)
  assert.equal(await redis.finishScheduledJob({ leaseKey, doneKey, owner: 'retry-owner', success: true, doneTtlSeconds: 60, retrySeconds: 60 }), true)
  assert.equal(await redis.claimScheduledJob(leaseKey, doneKey, 'late-owner', 60), false)
  assert.equal(await client.get(leaseKey), null)
  console.log('Report Redis leases passed: atomic competing claims, owner checks, failure cooldown and completed-period deduplication.')
} finally {
  await client.del(leaseKey, doneKey)
  client.close()
  await redis.close()
}
