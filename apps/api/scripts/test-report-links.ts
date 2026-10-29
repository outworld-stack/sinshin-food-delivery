import assert from 'node:assert/strict'
import { AppConfig } from '../src/infra/config/env'
import { ReportLinks } from '../src/domain/report/report-links'
import { SmsService } from '../src/infra/sms/sms.service'

const secret = 'report-link-test-secret-'.repeat(3)
const makeConfig = (hours = '24') => new AppConfig({
  NODE_ENV: 'development', JWT_SECRET: secret, REPORT_TOKEN_TTL_HOURS: hours,
  SMS_PROVIDER: 'real', SMS_IR_API_KEY: 'test-key-no-live-access',
  SMS_TEMPLATE_ID_DAILY: '101', SMS_TEMPLATE_ID_WEEKLY: '102',
})
const config = makeConfig()
const links = new ReportLinks(config)
const originalNow = Date.now
let clock = Date.parse('2026-10-24T21:29:00Z')
const issuedAt = Math.floor(clock / 1000)
Date.now = () => clock
const requests: Array<{ mobile: string; templateId: number; parameters: Array<{ name: string; value: string }> }> = []
const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  assert.equal(String(url), 'https://api.sms.ir/v1/send/verify', 'unexpected network call')
  requests.push(JSON.parse(String(init?.body)))
  return Response.json({ status: 1, data: { messageId: 1 } })
}) as typeof fetch

try {
  for (const kind of ['daily', 'weekly'] as const) {
    const token = links.reportToken(kind)
    assert.match(token, /^[A-Za-z0-9_-]{24}$/)
    assert.deepEqual(links.verifyReportDetails(token), { kind, issuedAt, expiresAt: issuedAt + 86400 })
    assert.equal(new ReportLinks(makeConfig('72')).verifyReport(token), kind,
      'changing configured TTL does not invalidate links already sent')
    assert.equal(links.reportTokenTtlLeft(token), 86400)
    const sms = new SmsService(config, mockFetch)
    assert.equal(await sms.sendReportToken('09120000000', kind, token), true)
    const request = requests.at(-1)!
    assert.equal(request.templateId, kind === 'daily' ? 101 : 102)
    assert.deepEqual(request.parameters, [{ name: 'TOKEN', value: token }], 'the SMS transport sends the whole token')
    assert.equal(links.verifyReport(request.parameters[0]!.value), kind)

    const bytes = Buffer.from(token, 'base64url')
    for (let index = 0; index < bytes.length; index++) {
      const changed = Buffer.from(bytes)
      changed[index] = changed[index]! ^ 1
      assert.equal(links.verifyReport(changed.toString('base64url')), null, `tampered byte ${index}`)
    }
    assert.equal(links.verifyReport(token.slice(0, -1)), null)
    assert.equal(links.verifyReport(`${token}=`), null)
    assert.equal(links.verifyReport(links.reportToken(kind, issuedAt + 61)), null)
    clock += 86400_000 - 1000
    assert.equal(links.verifyReport(token), kind, 'valid through the last second of its own expiry')
    clock += 1000
    assert.equal(links.verifyReport(token), null, 'expiry is enforced at the exact boundary')
    clock = issuedAt * 1000
  }
  assert.notEqual(links.reportToken('daily'), links.reportToken('weekly'))
  for (const invalidTime of [0, -1, Infinity, NaN, issuedAt + 0.5, 0x100000000]) {
    assert.throws(() => links.reportToken('daily', invalidTime))
  }
  for (const badHours of ['0', '-1', 'Infinity', 'NaN']) {
    const invalidConfigLinks = new ReportLinks(makeConfig(badHours))
    assert.equal(invalidConfigLinks.verifyReport(invalidConfigLinks.reportToken('daily')), 'daily')
  }
  const legacyHash = new Bun.CryptoHasher('sha256')
    .update(`rpt:report:daily:${issuedAt}:${secret}`).digest('hex').slice(0, 32)
  const legacy = `r.daily.${issuedAt}.${issuedAt + 86400}.${legacyHash}`
  assert.equal(links.verifyReport(legacy), 'daily', 'unmodified legacy links remain usable until expiry')
  assert.equal(links.verifyReport(legacy.slice(0, 25)), null, 'the formerly truncated SMS token cannot grant access')
  assert.equal(links.verifyReport(legacy.replace(String(issuedAt + 86400), String(issuedAt + 172800))), null)
  const before = requests.length
  assert.equal(await new SmsService(config, mockFetch).sendReportToken('09120000000', 'daily', legacy), false)
  assert.equal(await new SmsService(config, mockFetch).sendReportToken('09120000000', 'daily', ''), false)
  assert.equal(requests.length, before, 'invalid report links are never sent as successful SMS')
  console.log('Report links passed: complete SMS tokens, tamper/expiry checks, TTL changes, legacy compatibility and rejection before transport.')
} finally {
  Date.now = originalNow
}
