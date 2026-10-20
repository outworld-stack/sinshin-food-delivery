/** Admin2 concurrency and access regressions. Creates and drops only a local scratch database. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { AppError } from '../src/domain/shared/errors'
import { asUserId } from '../src/domain/shared/brand'
import { Admin2Service } from '../src/domain/admin2/admin2.service'
import { LiveService } from '../src/domain/live/live.service'
import { admin2Activities, admin2Profiles, admin2Sessions, orders, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_admin2_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let count = 0
const passed = (name: string) => { count++; console.log(`PASS ${name}`) }
const status = (expected: number) => (error: unknown) => error instanceof AppError && error.status === expected
const savedFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in admin2 safety test') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({ NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(),
    GATEWAY_MODE: 'direct', JWT_SECRET: 'admin2-safety-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
    SUPER_ADMIN_PHONES: '09150001000' })
  const settingsWrites: unknown[] = []
  const settings = {
    set: async (...args: unknown[]) => { settingsWrites.push(args) },
    setBusy: async (busy: boolean) => { settingsWrites.push(busy) },
  } as never
  const events: Array<{ event: string; data: unknown }> = []
  const hub = { publish: (_channel: string, payload: { event: string; data: unknown }) => { events.push(payload) } } as never
  const service = new Admin2Service({ db, config, settings, hub })
  const input = (phone: string) => ({ phone, firstName: '  Admin  ', lastName: '  Two  ', scopeHall: true, scopeTakeaway: false })
  const [ordinary, main, unknown] = await db.insert(users).values([
    { phone: '09150001001' }, { phone: '09150001002', role: 'admin' }, { phone: '09150001003', role: 'other' },
  ]).returning()
  assert(ordinary && main && unknown)

  await assert.rejects(service.add({ ...input('09150001004'), firstName: '   ' }), status(422))
  for (const phone of [main.phone, unknown.phone, '09150001000']) {
    assert.equal((await service.add(input(phone))).success, false)
  }
  assert.equal((await db.select().from(users)).length, 3, 'configured main administrator is not created as level 2')
  assert.equal((await db.query.users.findFirst({ where: eq(users.id, unknown.id) }))!.role, 'other')
  passed('blank names, main administrators and non-user roles cannot be registered as level 2')

  await db.execute(sql`alter table admin2_profiles add constraint test_admin2_profile_failure check (first_name <> '__FAIL__')`)
  await assert.rejects(service.add({ ...input(ordinary.phone), firstName: '__FAIL__' }))
  assert.equal((await db.query.users.findFirst({ where: eq(users.id, ordinary.id) }))!.role, 'user')
  assert.equal(await service.profile(ordinary.id), undefined)
  await assert.rejects(service.add({ ...input('09150001004'), firstName: '__FAIL__' }))
  assert.equal(await db.query.users.findFirst({ where: eq(users.phone, '09150001004') }), undefined)
  await db.execute(sql`alter table admin2_profiles drop constraint test_admin2_profile_failure`)
  passed('profile insertion failure rolls back both new accounts and existing-user promotions')

  assert.equal(await service.permissionsOf(ordinary.id), null, 'cache an absent profile before promotion')
  assert.equal((await service.add(input(ordinary.phone))).userId, ordinary.id)
  const promoted = await service.profile(ordinary.id)
  assert.equal(promoted!.firstName, 'Admin')
  assert.equal(promoted!.lastName, 'Two')
  assert.equal((await service.permissionsOf(ordinary.id))!.orderDetailsRead, true)
  assert.equal((await service.permissionsOf(ordinary.id))!.printingManage, false)
  assert.equal((await service.permissionsOf(ordinary.id))!.usersWrite, false)
  assert.deepEqual(await service.scopeOf(ordinary.id), { hall: true, takeaway: false })
  passed('promotion clears cached missing profiles and applies trimmed names and conservative permissions')

  const concurrent = await Promise.all(Array.from({ length: 6 }, () => service.add(input('09150001005'))))
  assert.equal(concurrent.filter((result) => result.success).length, 1)
  const secondId = concurrent.find((result) => result.success)!.userId!
  assert.equal((await db.select().from(users).where(eq(users.phone, '09150001005'))).length, 1)
  assert.equal((await db.select().from(admin2Profiles)).length, 2)
  await service.toggleActive(ordinary.id)
  await db.update(users).set({ role: 'user' }).where(eq(users.id, ordinary.id))
  assert.equal((await service.add(input(ordinary.phone))).success, true)
  assert.equal((await service.profile(ordinary.id))!.isActive, true)
  assert.equal((await service.permissionsOf(ordinary.id))!.orderDetailsRead, true)
  passed('concurrent registration creates one profile; promotion restores an inactive legacy profile')

  await service.setPermissions(ordinary.id, { printingManage: true, takeaway: true })
  assert.equal((await service.permissionsOf(ordinary.id))!.printingManage, true)
  assert.equal((await service.permissionsOf(ordinary.id))!.productsRead, true, 'partial updates preserve unrelated permissions')
  assert.deepEqual(await service.scopeOf(ordinary.id), { hall: true, takeaway: true })
  const raceService = new Admin2Service({ db, config, settings, hub })
  const readProfile = raceService.profile.bind(raceService)
  let releaseRead!: () => void
  let capturedRead!: () => void
  const readCaptured = new Promise<void>((resolve) => { capturedRead = resolve })
  const readReleased = new Promise<void>((resolve) => { releaseRead = resolve })
  let delayFirstRead = true
  raceService.profile = async (id) => {
    const profile = await readProfile(id)
    if (delayFirstRead) {
      delayFirstRead = false
      capturedRead()
      await readReleased
    }
    return profile
  }
  const inFlightPermissions = raceService.permissionsOf(ordinary.id)
  await readCaptured
  await raceService.setPermissions(ordinary.id, { printingManage: false })
  releaseRead()
  assert.equal((await inFlightPermissions)!.printingManage, false, 'an old in-flight read cannot restore revoked permissions')
  assert.equal((await raceService.permissionsOf(ordinary.id))!.printingManage, false)
  await Promise.all(Array.from({ length: 10 }, () => service.toggleActive(ordinary.id)))
  assert.equal((await service.profile(ordinary.id))!.isActive, true, 'even concurrent toggles preserve the initial state')
  const missingId = crypto.randomUUID()
  await assert.rejects(service.setPermissions(missingId, { hall: true }), status(404))
  await assert.rejects(service.toggleActive(missingId), status(404))
  passed('permission edits invalidate warm and in-flight caches; concurrent toggles and missing profiles are handled correctly')

  await service.setPermissions(ordinary.id, { canAnnounceBusy: true })
  await db.insert(admin2Sessions).values({ adminUserId: asUserId(ordinary.id) })
  await service.setBusy(ordinary.id, 'admin2', true)
  await service.setTemporaryClose(ordinary.id, 'admin2', true, 'Maintenance')
  assert.equal((await service.sessions(ordinary.id))[0]!.wasActive, true)
  const writesBeforeDisable = settingsWrites.length
  await service.toggleActive(ordinary.id)
  await assert.rejects(service.permissionsOf(ordinary.id), status(403))
  await assert.rejects(service.scopeOf(ordinary.id), status(403))
  await assert.rejects(service.setBusy(ordinary.id, 'admin2', false), status(403))
  await assert.rejects(service.setTemporaryClose(ordinary.id, 'admin2', false), status(403))
  await assert.rejects(service.setBusy(ordinary.id, 'user', false), status(403))
  assert.equal(settingsWrites.length, writesBeforeDisable, 'disabled accounts do not mutate restaurant settings')
  await service.toggleActive(ordinary.id)
  passed('disabled profiles lose access immediately; authorized restaurant changes record meaningful activity')

  const [buyer] = await db.insert(users).values({ phone: '09150001006' }).returning()
  assert(buyer)
  const breakdown = { foodTotal: 100_000, discount: 0, walletDeduction: 0, deliveryFee: 0,
    packagingFee: 0, totalAmount: 100_000, amountPaidOnline: 100_000 }
  let orderSequence = 0
  const addOrder = async (patch: Partial<typeof orders.$inferInsert> = {}) => {
    const [order] = await db.insert(orders).values({ displayId: `ord-${String(++orderSequence).padStart(8, '0')}`,
      userId: buyer.id, status: 'PAID', deliveryType: 'DINE_IN', totalAmount: 100_000, breakdown, ...patch }).returning()
    return order!
  }
  const hall = await addOrder()
  const pickup = await addOrder({ deliveryType: 'PICKUP' })
  const delivery = await addOrder({ deliveryType: 'DELIVERY' })
  const owned = await addOrder({ status: 'CONFIRMED', deliveryType: 'DELIVERY', confirmedBy: ordinary.id })
  const other = await addOrder({ status: 'CONFIRMED', confirmedBy: secondId })
  const claimedPaid = await addOrder({ confirmedBy: secondId })
  const historical = await addOrder({ status: 'DELIVERED', confirmedBy: ordinary.id })
  const live = new LiveService({ db, config, admin2: service, hub })
  const visible = async () => (await live.liveOrders(ordinary.id, 'admin2')).orders.map((order) => order.id).sort()
  await service.setPermissions(ordinary.id, { hall: true, takeaway: false })
  assert.deepEqual(await visible(), [hall.displayId, owned.displayId].sort())
  assert.equal(await service.queueCountFor(ordinary.id), 1)
  await service.setPermissions(ordinary.id, { hall: false, takeaway: false })
  assert.deepEqual(await visible(), [owned.displayId], 'removing scopes hides the cached queue while retaining owned orders')
  await service.setPermissions(ordinary.id, { takeaway: true })
  assert.deepEqual(await visible(), [pickup.displayId, delivery.displayId, owned.displayId].sort())
  assert.equal(await service.queueCountFor(ordinary.id), 2)
  await service.toggleActive(ordinary.id)
  await assert.rejects(visible(), status(403))
  await service.toggleActive(ordinary.id)
  await assert.rejects(live.assertOrderViewable(ordinary.id, 'admin2', hall.displayId), status(403))
  await assert.rejects(live.assertOrderViewable(ordinary.id, 'admin2', other.displayId), status(403))
  await assert.rejects(live.assertOrderViewable(ordinary.id, 'admin2', claimedPaid.displayId), status(403))
  assert.equal((await live.assertOrderViewable(ordinary.id, 'admin2', historical.displayId)).id, historical.id)
  assert.equal((await live.liveOrders(main.id, 'admin')).orders.length, 5)
  passed('live lists, queue counts and details honor scope changes, ownership, disabled profiles and main-admin access')

  assert.equal((await live.confirmOrder(ordinary.id, 'admin2', hall.displayId, {})).success, false)
  await service.setPermissions(ordinary.id, { hall: true })
  const noted = await addOrder({ customerNote: 'Allergy', noteSeen: false })
  assert.equal((await live.confirmOrder(ordinary.id, 'admin2', noted.displayId, {})).success, false)
  await live.viewNote(ordinary.id, 'admin2', noted.displayId)
  assert.equal((await visible()).includes(noted.displayId), true)
  assert.equal((await live.liveOrders(ordinary.id, 'admin2')).orders.find((order) => order.id === noted.displayId)!.noteSeen, true)
  const confirmations = await Promise.all([
    live.confirmOrder(ordinary.id, 'admin2', noted.displayId, {}),
    live.confirmOrder(secondId, 'admin2', noted.displayId, {}),
  ])
  assert.equal(confirmations.filter((result) => result.success).length, 1)
  const confirmed = (await db.select().from(orders).where(eq(orders.id, noted.id)))[0]!
  assert.equal(confirmed.status, 'CONFIRMED')
  const activities = await db.select().from(admin2Activities).where(eq(admin2Activities.orderDisplayId, noted.displayId))
  assert.equal(activities.filter((activity) => activity.action === 'ORDER_CONFIRM').length, 1)
  assert.equal(events.filter((event) => event.event === 'order-confirmed').length, 1)
  const confirmedTotals = (await db.select().from(admin2Profiles)).reduce((sum, profile) => sum + profile.ordersConfirmed, 0)
  assert.equal(confirmedTotals, 1)
  assert.equal((await live.confirmOrder(ordinary.id, 'admin2', claimedPaid.displayId, {})).success, false)
  passed('notes refresh immediately; simultaneous confirmations assign one owner, one counter increment and one audit event')

  console.log(`Admin2 safety: ${count} passed`)
} finally {
  globalThis.fetch = savedFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
