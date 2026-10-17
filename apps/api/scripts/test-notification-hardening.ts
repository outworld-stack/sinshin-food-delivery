// Scratch PostgreSQL only. Pushes are dependency-injected mocks: no external traffic.
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { NotificationService } from '../src/domain/notification/notification.service'
import { notificationRoutes } from '../src/http/routes/notification.routes'
import { CouponNudgeJob } from '../src/workers/jobs/coupon-nudge-notification.job'
import { admin2Profiles, couponConditions, couponNudges, coupons, notifications, orders, pushSubscriptions, users } from '../src/infra/db/schema'
import type { PushOutcome, PushPayload } from '../src/infra/push/web-push'

const source = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const scratch = `sinshin_e2e_notify_security_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const boot = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let created = false
const queue: Array<Promise<unknown>> = []
let count = 0
function check(name: string, condition: boolean) {
  assert.ok(condition, name)
  count++
  console.log(`  ✓ ${name}`)
}
try {
  await boot.unsafe(`create database "${scratch}"`)
  created = true
  source.pathname = `/${scratch}`
  database = new Database(source.toString(), { max: 6 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: source.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://sinshin.example',
  })
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString('base64url')
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')
  const sent: Array<{ endpoint: string; payload: PushPayload }> = []
  const published: Array<{ channel: string }> = []
  let outcome: PushOutcome = { kind: 'ok' }
  const hub = { publish: (channel: string) => { published.push({ channel }) } }
  const notif = new NotificationService({
    db, config, hub: hub as never,
    sendPush: async (_config, target, payload) => { sent.push({ endpoint: target.endpoint, payload }); return outcome },
  })
  // Track background fanout without changing its HTTP fire-and-forget contract.
  const internal = notif as unknown as { pushToSubscribedUsers: (...args: unknown[]) => Promise<void> }
  const fanout = internal.pushToSubscribedUsers.bind(notif)
  internal.pushToSubscribedUsers = (...args) => {
    const pending = fanout(...args)
    queue.push(pending)
    return pending
  }
  const drain = async () => { await Promise.all(queue.splice(0)) }
  let phone = 9200000000
  const mkUser = async (extra: Partial<typeof users.$inferInsert> = {}) =>
    (await db.insert(users).values({ phone: `0${++phone}`, role: 'user', ...extra }).returning())[0]!
  const u1 = await mkUser()
  const u2 = await mkUser()
  const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`
  const subscribe = (userId: string, name: string) => notif.registerSubscription(userId, { endpoint: endpoint(name), p256dh, auth })

  check('Reject internal endpoint before storage', !(await notif.registerSubscription(u1.id, { endpoint: 'https://127.0.0.1/private', p256dh, auth })).ok)
  check('Reject malformed subscription key before storage', !(await notif.registerSubscription(u1.id, { endpoint: endpoint('bad-key'), p256dh: 'B'.repeat(87), auth })).ok)
  const ownership = await Promise.all([subscribe(u1.id, 'shared'), subscribe(u2.id, 'shared')])
  check('Concurrent ownership claims have exactly one winner', ownership.filter((r) => r.ok).length === 1)
  const winner = ownership[0]!.ok ? u1 : u2
  const loser = winner.id === u1.id ? u2 : u1
  check('Foreign account cannot delete subscription', await notif.removeSubscription(loser.id, endpoint('shared')) === false)
  check('Foreign account cannot refresh subscription', (await subscribe(loser.id, 'shared')).reason === 'owned-by-other')
  check('Equivalent URL spelling cannot bypass ownership', (await notif.registerSubscription(loser.id,
    { endpoint: 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/shared', p256dh, auth })).reason === 'owned-by-other')
  check('Owner can refresh and delete subscription', (await subscribe(winner.id, 'shared')).ok && await notif.removeSubscription(winner.id, endpoint('shared')))
  const legacyEndpoint = 'https://FCM.GOOGLEAPIS.COM:443/fcm/send/legacy_A_1'
  const [legacySub] = await db.insert(pushSubscriptions).values({ userId: u1.id, endpoint: legacyEndpoint, p256dh, auth }).returning()
  check('Legacy host/port spelling still blocks another account', (await subscribe(u2.id, 'legacy_A_1')).reason === 'owned-by-other')
  const repairRace = await Promise.all([
    notif.registerSubscription(u1.id, { endpoint: legacyEndpoint, p256dh, auth }),
    subscribe(u2.id, 'legacy_A_1'),
  ])
  check('Original owner repairs legacy alias while concurrent foreign claim is rejected',
    repairRace[0]!.ok && repairRace[1]!.reason === 'owned-by-other')
  check('Alias repair keeps the original subscription ID',
    (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, legacySub!.id)))[0]!.endpoint === endpoint('legacy_A_1'))
  await db.insert(pushSubscriptions).values({ userId: u1.id, endpoint: legacyEndpoint, p256dh, auth })
  await subscribe(u1.id, 'legacy_A_1')
  check('Duplicate aliases owned by the same account merge',
    (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u1.id))).length === 1)
  check('Unsubscribe accepts legacy spelling after repair', await notif.removeSubscription(u1.id, legacyEndpoint))

  await db.insert(pushSubscriptions).values([
    { userId: u1.id, endpoint: legacyEndpoint, p256dh, auth },
    { userId: u2.id, endpoint: endpoint('legacy_A_1'), p256dh, auth },
  ])
  check('Conflicting legacy owners are rejected without silently choosing a winner',
    (await subscribe(u1.id, 'legacy_A_1')).reason === 'owned-by-other'
      && (await subscribe(u2.id, 'legacy_A_1')).reason === 'owned-by-other')
  await notif.removeSubscription(u1.id, endpoint('legacy_A_1'))
  check('Cleanup removes only the requesting account aliases',
    (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint('legacy_A_1'))))[0]!.userId === u2.id)
  check('Remaining logical owner can refresh after conflict cleanup', (await subscribe(u2.id, 'legacy_A_1')).ok)
  await notif.removeSubscription(u2.id, legacyEndpoint)
  await subscribe(u1.id, 'CaseToken')
  check('Provider token case remains significant during alias lookup', (await subscribe(u2.id, 'casetoken')).ok)
  await notif.removeSubscription(u1.id, endpoint('CaseToken'))
  check('Case-sensitive token cleanup preserves the other endpoint', (await notif.pushStatus(u2.id)).endpoints.includes(endpoint('casetoken')))
  await notif.removeSubscription(u2.id, endpoint('casetoken'))
  await db.insert(pushSubscriptions).values({ userId: u1.id, endpoint: 'https://[invalid', p256dh, auth })
  check('Malformed legacy endpoint can still be cleaned up by its owner', await notif.removeSubscription(u1.id, 'https://[invalid'))
  await subscribe(u1.id, 'device-a')
  await subscribe(u1.id, 'device-b')
  for (const status of [400, 401, 403, 413, 429, 503]) {
    outcome = { kind: 'fail', status }
    await notif.sendTestPush(u1.id)
  }
  check('Provider auth/payload/outage errors preserve subscriptions', (await notif.pushStatus(u1.id)).subscriptions === 2)
  outcome = { kind: 'gone', status: 410 }
  await notif.sendTestPush(u1.id)
  check('Gone subscriptions are disabled', (await notif.pushStatus(u1.id)).subscriptions === 0)
  outcome = { kind: 'ok' }
  await subscribe(u1.id, 'device-a')
  await subscribe(u1.id, 'device-b')

  const uniqueId = crypto.randomUUID()
  sent.length = 0
  published.length = 0
  const repeated = await Promise.all(Array.from({ length: 8 }, () => notif.notifyUser(u1.id,
    { type: 'coupon_nudge', title: 'One nudge', body: 'One event' }, { notificationId: uniqueId })))
  check('Concurrent nudge retries return the same durable inbox ID', repeated.every((r) => r.id === uniqueId))
  check('Concurrent retries dispatch once per device', sent.length === 2 && published.length === 1)
  check('Notification ID cannot be reused for a different account', (await notif.notifyUser(u2.id,
    { type: 'coupon_nudge', title: 'Other', body: 'Other' }, { notificationId: uniqueId })).id === null)
  check('Another user cannot mark inbox row read', await notif.markRead(u2.id, uniqueId) === false)
  check('Mark-read succeeds once for owner', await notif.markRead(u1.id, uniqueId) && !(await notif.markRead(u1.id, uniqueId)))
  await db.update(notifications).set({ createdAt: new Date(Date.now() - 8 * 86400000), readAt: null }).where(eq(notifications.id, uniqueId))
  check('Expired inbox row cannot be marked read', await notif.markRead(u1.id, uniqueId) === false)

  const app = notificationRoutes({
    sessions: { authenticate: async () => ({ user: u1, ctx: {} }) } as never,
    notifications: notif, admin2: {} as never,
    redis: { incr: async () => 1, expire: async () => {} } as never,
  })
  for (const body of [{}, { all: false }, { id: 'not-a-uuid' }, { id: '' }]) {
    const response = await app.handle(new Request('http://localhost/notifications/read', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' }, body: JSON.stringify(body),
    }))
    check(`Invalid read body rejected with 422: ${JSON.stringify(body)}`, response.status === 422)
  }
  const readAll = await app.handle(new Request('http://localhost/notifications/read', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' }, body: JSON.stringify({ all: true }),
  }))
  check('Read-all remains accepted', readAll.status === 200)

  // Create a subscriber after broadcast's audience SELECT but before its inbox
  // inserts finish. It must not receive a push for an inbox row it never got.
  const lateId = crypto.randomUUID()
  await db.execute(sql.raw(`CREATE FUNCTION notification_late_signup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.title = 'late-signup' THEN
        INSERT INTO users (id, phone, role) VALUES ('${lateId}', '09209999999', 'user') ON CONFLICT DO NOTHING;
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
          VALUES ('${lateId}', '${endpoint('late')}', '${p256dh}', '${auth}') ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END $$`))
  await db.execute(sql.raw('CREATE TRIGGER notification_late_signup AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_late_signup()'))
  sent.length = 0
  const broadcast = await notif.broadcast({ type: 'broadcast', title: 'late-signup', body: 'b' })
  await drain()
  check('Broadcast stores original audience only', broadcast.targeted === 2)
  check('Broadcast sends to every original subscriber device and excludes later signup', sent.length === 2 && !sent.some((s) => s.endpoint === endpoint('late')))

  const staff = await Promise.all([
    mkUser({ role: 'admin' }), mkUser({ role: 'admin2' }), mkUser({ role: 'admin2' }),
    mkUser({ role: 'admin2' }), mkUser({ role: 'admin2' }), mkUser({ role: 'admin', bannedAt: new Date() }),
  ])
  const [, hall, takeaway, inactive] = staff
  await db.insert(admin2Profiles).values([
    { userId: hall!.id, isActive: true, scopeHall: true },
    { userId: takeaway!.id, isActive: true, scopeTakeaway: true },
    { userId: inactive!.id, isActive: false, scopeHall: true, scopeTakeaway: true },
  ] as Array<typeof admin2Profiles.$inferInsert>)
  for (let i = 0; i < staff.length; i++) await subscribe(staff[i]!.id, `staff-${i}`)
  for (const deliveryType of ['DINE_IN', 'PICKUP', 'DELIVERY'] as const) {
    const displayId = `TEST-${deliveryType}`
    await db.insert(orders).values({ userId: u1.id, displayId, deliveryType, status: 'PAID', totalAmount: 100, breakdown: {} as never })
    sent.length = 0
    const stats = await notif.notifyAdminsNewOrder({ displayId })
    const expected = [endpoint('staff-0'), endpoint(deliveryType === 'DINE_IN' ? 'staff-1' : 'staff-2')].sort()
    check(`Live ${deliveryType} orders target active staff in scope plus main admin`,
      stats.targeted === 2 && JSON.stringify(sent.map((s) => s.endpoint).sort()) === JSON.stringify(expected))
    check(`Live ${deliveryType} push has urgent short TTL`, sent.every((s) => s.payload.urgency === 'high' && s.payload.ttl === 900))
  }

  let morning = new Date()
  morning.setUTCHours(6, 0, 0, 0)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(morning)
  const [coupon] = await db.insert(coupons).values({ code: 'NUDGE', discountPercentage: 10, cronEnabled: true, startsAt: new Date(Date.now() - 86400000) }).returning()
  const [condition] = await db.insert(couponConditions).values({ couponId: coupon!.id, type: 'MIN_ORDERS_COUNT', params: { count: 3 } }).returning()
  const [nudge] = await db.insert(couponNudges).values({ userId: u1.id, couponId: coupon!.id, missingConditionId: condition!.id, missingCount: 1, remainingCount: 2, scanDate: date }).returning()
  const failedJob = new CouponNudgeJob({ db, config, now: () => morning,
    notifications: { notifyUser: async () => ({ id: null, pushAccepted: 0, pushGone: 0 }) } as never })
  await failedJob.run()
  check('Failed nudge insertion leaves sent marker empty for retry', (await db.select().from(couponNudges).where(eq(couponNudges.id, nudge!.id)))[0]!.smsSentAt === null)
  const job = new CouponNudgeJob({ db, config, now: () => morning, notifications: notif })
  sent.length = 0
  await Promise.all([job.run(), job.run(), job.run()])
  check('Concurrent nudge jobs produce one inbox row and one push per device',
    (await db.select().from(notifications).where(eq(notifications.id, nudge!.id))).length === 1 && sent.length === 2)
  check('Successful nudge is marked sent', (await db.select().from(couponNudges).where(eq(couponNudges.id, nudge!.id)))[0]!.smsSentAt !== null)

  const pendingNudges = await db.insert(couponNudges).values([u2.id, lateId].map((userId) => ({
    userId, couponId: coupon!.id, missingConditionId: condition!.id,
    missingCount: 1, remainingCount: 2, scanDate: date,
  }))).returning()
  await db.update(coupons).set({ isPublic: true }).where(eq(coupons.id, coupon!.id))
  await job.run()
  check('Coupon changed to public does not send stale private nudges',
    (await db.select().from(notifications).where(eq(notifications.id, pendingNudges[0]!.id))).length === 0)
  await db.update(coupons).set({ isPublic: false, startsAt: new Date(Date.now() + 86400000) }).where(eq(coupons.id, coupon!.id))
  await job.run()
  check('Coupon moved into future does not send stale nudges',
    (await db.select().from(notifications).where(eq(notifications.id, pendingNudges[0]!.id))).length === 0)
  await db.update(coupons).set({ startsAt: new Date(Date.now() - 86400000) }).where(eq(coupons.id, coupon!.id))
  let deadlineSends = 0
  const deadlineJob = new CouponNudgeJob({ db, config, now: () => morning,
    notifications: { notifyUser: async (...args: Parameters<NotificationService['notifyUser']>) => {
      deadlineSends++
      const result = await notif.notifyUser(...args)
      morning = new Date(morning.getTime() + 4 * 3600000) // 13:30 Tehran after first send
      return result
    } } as never })
  await deadlineJob.run()
  check('Nudge worker stops at the deadline before the next recipient', deadlineSends === 1)

  // Force the first 500-recipient insert to fail. The subsequent successful
  // chunk is still delivered, and failed recipients must not get phantom push.
  const bulk = await db.insert(users).values(Array.from({ length: 500 }, (_, i) => ({
    phone: `093${String(i).padStart(8, '0')}`, role: 'user' as const,
    createdAt: new Date(Date.now() + 60000 + i),
  }))).returning()
  const blockedUser = bulk[499]!
  await subscribe(blockedUser.id, 'blocked-chunk')
  await db.execute(sql.raw(`CREATE FUNCTION notification_fail_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.title = 'partial-broadcast' AND NEW.user_id = '${blockedUser.id}' THEN
        RAISE EXCEPTION 'intentional regression insert failure';
      END IF;
      RETURN NEW;
    END $$`))
  await db.execute(sql.raw('CREATE TRIGGER notification_fail_chunk BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_fail_chunk()'))
  sent.length = 0
  const originalError = console.error
  try {
    console.error = () => {} // The failed chunk is intentional; avoid dumping 500 rows of parameters.
    const partial = await notif.broadcast({ type: 'broadcast', title: 'partial-broadcast', body: 'b' })
    await drain()
    check('Failed broadcast chunk does not count as targeted', partial.targeted === 3)
  } finally { console.error = originalError }
  check('Only successful inbox recipients receive partial broadcast push', sent.length === 3 && !sent.some((s) => s.endpoint === endpoint('blocked-chunk')))
  check('No failed-chunk inbox rows exist', (await db.select().from(notifications).where(and(eq(notifications.userId, blockedUser.id), eq(notifications.title, 'partial-broadcast')))).length === 0)
  console.log(`Notification hardening: ${count} assertions passed.`)
} finally {
  await Promise.allSettled(queue)
  await database?.close()
  if (created) await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
  await boot.close({ timeout: 5 })
}
