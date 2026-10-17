/** Real Redis regressions. Uses unique keys and never sends an SMS. */
import assert from 'node:assert/strict'
import { RedisClient } from 'bun'
import { OtpService } from '../src/domain/auth/otp.service'
import { sendOtp, verifyOtp, type OtpKeys, type SendOtpParams } from '../src/domain/shared/otp-core'
import { AppError } from '../src/domain/shared/errors'
import { sha256 } from '../src/domain/shared/crypto'
import type { AppConfig } from '../src/infra/config/env'
import { RedisService } from '../src/infra/redis/redis'
import type { SmsService } from '../src/infra/sms/sms.service'

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const redis = new RedisService(url)
const client = new RedisClient(url)
const prefix = `test:otp:${crypto.randomUUID()}`
const cleanup = new Set<string>()
let checks = 0
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message)
  checks++
  console.log(`  ✓ ${message}`)
}
const keys: OtpKeys = {
  code: p => `${prefix}:${p}:code`, cooldown: p => `${prefix}:${p}:cd`,
  attempts: p => `${prefix}:${p}:att`, hour: p => `${prefix}:${p}:hour`, day: p => `${prefix}:${p}:day`,
}
const params = (phone: string, overrides: Partial<SendOtpParams> = {}): SendOtpParams => {
  for (const key of Object.values(keys)) cleanup.add(key(phone))
  return {
    phone, keys, ttlSeconds: 120, cooldownSeconds: 60, maxPerHour: 100, maxPerDay: 100,
    messages: { hourCap: 'hour', dayCap: 'day', cooldown: () => 'cooldown', storeFail: 'store', smsFail: 'sms' },
    sendSms: async () => true, isProd: false, ...overrides,
  }
}
const verify = (phone: string, code: string) => verifyOtp({ redis }, {
  phone, code, keys, ttlSeconds: 120, maxAttempts: 3,
})
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code

try {
  assert.ok(await redis.connect(), 'local Redis must be reachable')
  let sent = 0
  const sends = await Promise.allSettled(Array.from({ length: 20 }, () => sendOtp({ redis },
    params('parallel', { sendSms: async () => { sent++; return true } }))))
  check(sent === 1 && sends.filter(r => r.status === 'fulfilled').length === 1,
    'parallel requests issue exactly one challenge and one SMS')
  const issued = sends.find(r => r.status === 'fulfilled')
  assert.ok(issued?.status === 'fulfilled' && issued.value.devCode)
  const verifies = await Promise.all(Array.from({ length: 20 }, () => verify('parallel', issued.value.devCode!)))
  check(verifies.filter(r => r.ok).length === 1, 'parallel verification consumes a code exactly once')

  params('legacy')
  await redis.set(keys.code('legacy'), sha256('123456:legacy'), { ex: 120 })
  check((await verify('legacy', '123456')).ok, 'challenges issued before this update remain valid')

  const budget = await sendOtp({ redis }, params('budget'))
  assert.ok(budget.devCode)
  const wrong = budget.devCode === '000000' ? '111111' : '000000'
  for (let i = 0; i < 3; i++) {
    const result = await verify('budget', wrong)
    check(!result.ok && result.reason === 'mismatch' && result.attemptsLeft === 2 - i,
      `incorrect attempt ${i + 1} consumes one attempt`)
  }
  const exhausted = await verify('budget', budget.devCode)
  check(!exhausted.ok && exhausted.reason === 'too-many', 'correct code cannot bypass an exhausted attempt budget')

  await sendOtp({ redis }, params('window'))
  await client.send('EXPIRE', [keys.hour('window'), '5'])
  await client.send('EXPIRE', [keys.day!('window'), '5'])
  await redis.del(keys.cooldown('window'))
  await sendOtp({ redis }, params('window'))
  check(Number(await client.send('TTL', [keys.hour('window')])) <= 5, 'hourly budget does not slide on a resend')
  check(Number(await client.send('TTL', [keys.day!('window')])) <= 5, 'daily budget does not slide on a resend')
  await redis.del(keys.cooldown('window'))
  await assert.rejects(sendOtp({ redis }, params('window', { maxPerHour: 2 })), hasCode('RATE_LIMITED'))
  checks++

  const phone = `${prefix}:failure-window`
  for (const key of ['code', 'cd', 'att', 'h', 'd', 'vf']) cleanup.add(`otp:${key}:${phone}`)
  let latestCode = ''
  const service = new OtpService({
    redis,
    config: { isProd: true, otp: { ttlSeconds: 120, cooldownSeconds: 60, maxAttempts: 3,
      maxPerHourPerPhone: 100, maxPerDayPerPhone: 100 } } as AppConfig,
    sms: { sendOtp: async (_phone: string, code: string) => { latestCode = code; return true } } as SmsService,
  })
  for (let i = 0; i < 10; i++) {
    if (i % 3 === 0) {
      await redis.del(`otp:cd:${phone}`)
      await service.send(phone)
    }
    await assert.rejects(service.verify(phone, latestCode === '000000' ? '111111' : '000000'),
      hasCode(i === 9 ? 'RATE_LIMITED' : 'VALIDATION_ERROR'))
  }
  await redis.del(`otp:cd:${phone}`)
  await service.send(phone)
  await assert.rejects(service.verify(phone, latestCode), hasCode('RATE_LIMITED'))
  check(await redis.get(`otp:vf:${phone}`) === '10', 'new codes cannot bypass the cross-code verification lockout')
  await redis.del(`otp:vf:${phone}`) // simulate expiration of the fixed window
  await service.verify(phone, latestCode)
  check(await redis.get(`otp:code:${phone}`) === null, 'verification recovers after the lockout expires')

  let finishOld!: (sent: boolean) => void
  let notifyStarted!: () => void
  const started = new Promise<void>(resolve => { notifyStarted = resolve })
  const delayed = sendOtp({ redis }, params('delayed', { isProd: true, sendSms: async () => {
    notifyStarted()
    return new Promise<boolean>(resolve => { finishOld = resolve })
  } }))
  const oldFailure = assert.rejects(delayed, hasCode('INTERNAL_ERROR'))
  await started
  await redis.del(keys.cooldown('delayed')) // old request exceeds its cooldown
  const newer = await sendOtp({ redis }, params('delayed'))
  finishOld(false)
  await oldFailure
  check((await verify('delayed', newer.devCode!)).ok, 'late SMS failure preserves a newer code')
  check(await redis.exists(keys.cooldown('delayed')), 'late SMS failure preserves a newer cooldown')

  await assert.rejects(sendOtp({ redis }, params('throws', { sendSms: async () => { throw new Error('provider') } })),
    hasCode('INTERNAL_ERROR'))
  check(!await redis.exists(keys.cooldown('throws')) && !await redis.exists(keys.code('throws')),
    'provider exceptions release their challenge and cooldown')

  const unavailable = { consumeOtp: async () => null } as unknown as RedisService
  await assert.rejects(verifyOtp({ redis: unavailable }, { phone: 'unavailable', code: '123456',
    keys, maxAttempts: 3, ttlSeconds: 120 }), hasCode('SERVICE_UNAVAILABLE'))
  checks++
  let outageSms = false
  await assert.rejects(sendOtp({ redis: { issueOtp: async () => null } as unknown as RedisService },
    params('unavailable', { sendSms: async () => { outageSms = true; return true } })), hasCode('SERVICE_UNAVAILABLE'))
  check(!outageSms, 'Redis failure never sends an untracked code')
  console.log(`\nOTP regressions: ${checks} passed`)
} finally {
  if (cleanup.size) await redis.del(...cleanup)
  await redis.close()
  client.close()
}
