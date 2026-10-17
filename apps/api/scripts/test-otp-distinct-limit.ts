/** Real Redis regression checks; only random, short-lived test keys are used. */
import { RedisClient } from 'bun'
import { strict as assert } from 'node:assert'
import { RedisService } from '../src/infra/redis/redis'

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const redis = new RedisService(url)
const raw = new RedisClient(url)
const prefix = `test:otp-distinct:${crypto.randomUUID()}`
const keys = [`${prefix}:quota`, `${prefix}:race`, `${prefix}:expiry`]
let passed = 0
const check = (label: string, condition: boolean) => {
  assert.ok(condition, label)
  console.log(`  ✓ ${label}`)
  passed++
}

try {
  const quota = keys[0]!
  const allowed = await Promise.all(Array.from({ length: 80 }, (_, i) =>
    redis.sAddWithinLimit(quota, `phone-${i}`, 80, 60)))
  check('All 80 available distinct-phone slots are admitted', allowed.every(Boolean))
  check('The 81st phone is rejected', await redis.sAddWithinLimit(quota, 'phone-81', 80, 60) === false)
  check('Retrying the rejected phone stays rejected', await redis.sAddWithinLimit(quota, 'phone-81', 80, 60) === false)
  check('A previously admitted phone can request again', await redis.sAddWithinLimit(quota, 'phone-0', 80, 60) === true)
  check('Rejected phones do not grow the set', await redis.sCard(quota) === 80)

  const racing = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    redis.sAddWithinLimit(keys[1]!, `phone-${i}`, 7, 60)))
  check('Concurrent arrivals cannot exceed capacity', racing.filter(Boolean).length === 7)

  await redis.sAddWithinLimit(keys[2]!, 'first', 80, 60)
  await raw.send('PEXPIRE', [keys[2]!, '5000'])
  await redis.sAddWithinLimit(keys[2]!, 'second', 80, 60)
  const ttl = Number(await raw.send('PTTL', [keys[2]!]))
  check('A new member does not extend the original window', ttl > 0 && ttl <= 5000)
  console.log(`\n${passed} distinct-phone quota checks passed.`)
} finally {
  await raw.del(...keys)
  await redis.close()
  raw.close()
}
