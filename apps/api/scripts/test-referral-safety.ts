/** Real PostgreSQL referral binding and ledger reporting in an isolated database. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { AdminService } from '../src/domain/admin/admin.service'
import { AuthService } from '../src/domain/auth/auth.service'
import { RegistrationPermitService } from '../src/domain/auth/registration-permit.service'
import { DeviceService } from '../src/domain/device/device.service'
import { ProfileService } from '../src/domain/order/profile.service'
import { OrderService } from '../src/domain/order/order.service'
import { AppError } from '../src/domain/shared/errors'
import { deviceEvents, deviceIdentities, deviceLinks, devices, orders, referralProfits, users, walletTransactions } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_referral_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let count = 0
function passed(name: string) { count++; console.log(`PASS ${name}`) }
const domainError = (code: AppError['code']) => (error: unknown) => error instanceof AppError && error.code === code
const savedFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in referral safety test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 6 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(),
    JWT_SECRET: 'referral-safety-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
    DEVICE_ENFORCEMENT: 'true', DEVICE_REFERRAL_BLOCK_AFTER: '3',
  })
  const deviceService = new DeviceService({ db, config })
  const orderService = new OrderService({ db, config, coupons: {} as never, settings: {} as never, zones: {} as never, notifications: {} as never })
  const profile = new ProfileService({ db, config, orders: orderService, devices: deviceService })
  const adminService = new AdminService({ db })
  let userNumber = 0
  const makeUser = async (referralCode?: string, referredBy?: string) => (await db.insert(users)
    .values({ phone: `0916${String(++userNumber).padStart(7, '0')}`, referralCode, referredBy }).returning())[0]!
  const getUser = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!
  const makeDevice = async () => (await db.insert(devices).values({
    fingerprintHash: crypto.randomUUID(), canvasHash: crypto.randomUUID(), webglHash: crypto.randomUUID(),
    audioHash: crypto.randomUUID(), fontsHash: crypto.randomUUID(),
  }).returning())[0]!
  const currentDevice = await makeDevice()
  const first = await makeUser('SIN-FIRST')
  const second = await makeUser('SIN-SECOND')
  const legacy = await makeUser('sin-legacy')
  const linked = await makeUser('SIN-LINKED')
  await profile.applyReferral(linked.id, currentDevice.id, ' sin-legacy ')
  assert.equal((await getUser(linked.id)).referredBy, legacy.id)
  assert.equal((await db.select().from(deviceEvents).where(and(eq(deviceEvents.phone, linked.phone), eq(deviceEvents.event, 'REFERRAL_APPLIED')))).length, 1)
  await assert.rejects(() => profile.applyReferral(linked.id, currentDevice.id, first.referralCode!), domainError('CONFLICT'))
  await assert.rejects(() => profile.applyReferral(first.id, currentDevice.id, first.referralCode!), domainError('VALIDATION_ERROR'))
  await assert.rejects(() => profile.applyReferral(first.id, currentDevice.id, 'SIN-SECOND'.padEnd(40, 'X')), domainError('VALIDATION_ERROR'))
  passed('binding accepts normalized and legacy codes once, rejecting self and truncated-code matches')

  const racer = await makeUser('SIN-RACER')
  const competing = await Promise.allSettled([first, second].map((referrer) => profile.applyReferral(racer.id, currentDevice.id, referrer.referralCode!)))
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((await db.select().from(deviceEvents).where(and(eq(deviceEvents.phone, racer.phone), eq(deviceEvents.event, 'REFERRAL_APPLIED')))).length, 1)
  passed('concurrent bindings preserve exactly one referrer and one audit event')

  const cycleA = await makeUser('SIN-CYCLEA'), cycleB = await makeUser('SIN-CYCLEB'), cycleC = await makeUser('SIN-CYCLEC')
  await profile.applyReferral(cycleA.id, currentDevice.id, cycleB.referralCode!)
  await profile.applyReferral(cycleB.id, currentDevice.id, cycleC.referralCode!)
  await assert.rejects(() => profile.applyReferral(cycleC.id, currentDevice.id, cycleA.referralCode!), domainError('VALIDATION_ERROR'))
  const reciprocalA = await makeUser('SIN-RECA'), reciprocalB = await makeUser('SIN-RECB')
  const reciprocal = await Promise.allSettled([
    profile.applyReferral(reciprocalA.id, currentDevice.id, reciprocalB.referralCode!),
    profile.applyReferral(reciprocalB.id, currentDevice.id, reciprocalA.referralCode!),
  ])
  assert.equal(reciprocal.filter((result) => result.status === 'fulfilled').length, 1)
  const oldCycleA = await makeUser('SIN-OLDA'), oldCycleB = await makeUser('SIN-OLDB', oldCycleA.id)
  await db.update(users).set({ referredBy: oldCycleB.id }).where(eq(users.id, oldCycleA.id))
  await assert.rejects(() => profile.applyReferral(first.id, currentDevice.id, oldCycleA.referralCode!), domainError('VALIDATION_ERROR'))
  passed('transitive, reciprocal concurrent, and preexisting cyclic ancestry are rejected')

  const auditFailure = await makeUser('SIN-AUDIT')
  await db.execute(sql`create function reject_referral_audit() returns trigger language plpgsql as $$
    begin if new.event = 'REFERRAL_APPLIED' then raise exception 'Simulated audit failure'; end if; return new; end $$`)
  await db.execute(sql`create trigger reject_referral_audit before insert on device_events for each row execute function reject_referral_audit()`)
  await assert.rejects(() => profile.applyReferral(auditFailure.id, currentDevice.id, first.referralCode!))
  assert.equal((await getUser(auditFailure.id)).referredBy, null)
  await db.execute(sql`drop trigger reject_referral_audit on device_events`)
  await db.execute(sql`drop function reject_referral_audit()`)
  passed('audit failure rolls the referral binding back atomically')

  const crowded = await makeDevice(), linkedDevice = await makeDevice(), blocked = await makeUser('SIN-BLOCKED')
  const pair = [crowded.id, linkedDevice.id].sort()
  await db.insert(deviceLinks).values({ deviceA: pair[0]!, deviceB: pair[1]!, similarity: 1 })
  await db.insert(deviceIdentities).values([
    { deviceId: crowded.id, phone: blocked.phone },
    ...['09179999991', '09179999992', '09179999993'].map((phone) => ({ deviceId: linkedDevice.id, phone })),
  ])
  await assert.rejects(() => profile.applyReferral(blocked.id, crowded.id, first.referralCode!), domainError('FORBIDDEN'))
  assert.equal((await getUser(blocked.id)).referredBy, null)
  assert.equal((await db.select().from(deviceEvents).where(and(eq(deviceEvents.phone, blocked.phone), eq(deviceEvents.event, 'REFERRAL_BLOCKED')))).length, 1)
  passed('linked-device population blocks rewards and retains its refusal audit')

  const editUser = await makeUser('SIN-EDIT')
  await adminService.updateAdminUser(editUser.id, { referralCode: ' custom_code ' }, 'admin')
  assert.equal((await getUser(editUser.id)).referralCode, 'CUSTOM_CODE')
  await assert.rejects(() => adminService.updateAdminUser(editUser.id, { referralCode: 'a'.repeat(17) }, 'admin'), domainError('VALIDATION_ERROR'))
  await assert.rejects(() => adminService.updateAdminUser(editUser.id, { referralCode: 'SIN-LEGACY' }, 'admin'), domainError('CONFLICT'))
  await assert.rejects(() => adminService.updateAdminUser(editUser.id, { referralCode: 'NEW-CODE' }, 'admin2'), domainError('FORBIDDEN'))
  const adminRaceA = await makeUser('SIN-EDITA'), adminRaceB = await makeUser('SIN-EDITB')
  const edits = await Promise.allSettled([adminRaceA, adminRaceB].map((user) => adminService.updateAdminUser(user.id, { referralCode: 'same-code' }, 'admin')))
  assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1)
  const failedEdit = edits.find((result) => result.status === 'rejected')
  assert(failedEdit?.status === 'rejected' && domainError('CONFLICT')(failedEdit.reason))
  passed('admin codes stay usable and unique across casing, length limits, and concurrent edits')

  const ambiguousA = await makeUser('sin-ambiguous'), ambiguousB = await makeUser('SIN-AMBIGUOUS')
  assert.notEqual(ambiguousA.id, ambiguousB.id)
  await assert.rejects(() => profile.applyReferral(first.id, currentDevice.id, 'sin-ambiguous'), domainError('NOT_FOUND'))
  const auth = new AuthService({
    db, config, devices: deviceService, permits: new RegistrationPermitService({ db }),
    otp: { verify: async () => undefined } as never,
    sessions: { createSession: async () => ({}) } as never,
    admin2: { assertLoginAllowed: async () => undefined } as never,
  })
  const signup = async (phone: string, refCode: string) => {
    const hash = (salt: string) => new Bun.CryptoHasher('sha256').update(`${phone}:${salt}`).digest('hex')
    await auth.loginWithOtp(phone, '123456', {
      clientId: crypto.randomUUID(), canvasHash: hash('canvas'), webglHash: hash('webgl'),
      audioHash: hash('audio'), fontsHash: hash('fonts'), platform: 'Android', touch: true,
    }, '127.0.0.1', { termsAccepted: true, refCode })
    return (await db.select().from(users).where(eq(users.phone, phone)))[0]!
  }
  assert.equal((await signup('09180000001', 'SIN-LEGACY')).referredBy, legacy.id)
  assert.equal((await signup('09180000002', 'SIN-AMBIGUOUS')).referredBy, null)
  assert.equal((await signup('09180000003', 'SIN-LEGACY'.padEnd(40, 'X'))).referredBy, null)
  passed('signup accepts legacy normalized codes and never guesses ambiguous or truncated attribution')

  const earningsOwner = await makeUser('SIN-EARNINGS'), buyer = await makeUser('SIN-BUYER', earningsOwner.id)
  let orderNumber = 0
  const makeOrder = async (userId: string, amount: number, refunded = false) => (await db.insert(orders).values({
    userId, displayId: `ord-referral${++orderNumber}`, deliveryType: 'DINE_IN',
    status: refunded ? 'CANCELED' : 'PAID', paymentStatus: refunded ? 'REFUNDED' : 'SUCCESS', totalAmount: amount,
    breakdown: { foodTotal: amount, discount: 0, walletDeduction: 0, deliveryFee: 0, packagingFee: 0, totalAmount: amount, amountPaidOnline: amount },
  }).returning())[0]!
  for (let index = 0; index < 3; index++) {
    const order = await makeOrder(buyer.id, 1_500_000_000, index === 2)
    const [profit] = await db.insert(referralProfits).values({
      referrerId: earningsOwner.id, buyerId: buyer.id, orderId: order.id,
      baseAmount: 1_500_000_000, amount: 1_500_000_000, percent: 100,
    }).returning()
    await db.insert(walletTransactions).values({
      userId: earningsOwner.id, type: 'DEPOSIT', amount: profit!.amount, description: 'Referral reward', orderId: order.id, referralProfitId: profit!.id,
    })
    if (index === 2) await db.insert(walletTransactions).values({
      userId: earningsOwner.id, type: 'WITHDRAW', amount: profit!.amount, description: 'Referral reversal', referralProfitId: profit!.id,
    })
  }
  const ownOrder = await makeOrder(earningsOwner.id, 1_000)
  await db.insert(walletTransactions).values({ userId: earningsOwner.id, type: 'DEPOSIT', amount: 1_000, description: 'Unrelated refund', orderId: ownOrder.id })
  const full = await profile.get(earningsOwner.id, currentDevice.id)
  const light = await profile.get(earningsOwner.id, currentDevice.id, { light: true })
  assert.equal(full.totalReferralProfit, 3_000_000_000)
  assert.equal(light.totalReferralProfit, 3_000_000_000)
  assert.equal(full.walletBalance, 3_000_001_000)
  assert.deepEqual(full.myReferrals.map((referral) => ({ orders: referral.totalOrders, spent: referral.totalSpent, profit: referral.myProfit })), [
    { orders: 2, spent: 3_000_000_000, profit: 3_000_000_000 },
  ])
  assert(full.walletTransactions.filter((tx) => tx.description === 'Referral reward').every((tx) => tx.orderId === null))
  assert.equal(full.walletTransactions.find((tx) => tx.description === 'Unrelated refund')!.orderId, ownOrder.displayId)
  passed('profile reports net earned money and spending above int32 without exposing other buyers order links')

  await db.insert(users).values(Array.from({ length: 204 }, () => ({
    phone: `0916${String(++userNumber).padStart(7, '0')}`, referredBy: earningsOwner.id,
  })))
  const largeFull = await profile.get(earningsOwner.id, currentDevice.id)
  const largeLight = await profile.get(earningsOwner.id, currentDevice.id, { light: true })
  assert.equal(largeFull.myReferrals.length, 200)
  assert.equal(largeFull.totalReferrals, 205)
  assert.equal(largeLight.myReferrals.length, 0)
  assert.equal(largeLight.totalReferrals, 205)
  assert.equal(largeFull.totalReferralProfit, 3_000_000_000)
  passed('full and light profile counts include referrals beyond the 200-row detail limit')
  console.log(`Referral safety: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
