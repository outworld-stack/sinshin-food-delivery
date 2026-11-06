/** Real PostgreSQL upgrade/allocator checks; only disposable local databases. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database, type Db } from '../src/infra/db/client'
import { payments } from '../src/infra/db/schema'
import type { PaymentId } from '../src/domain/shared/brand'

const MIN_ID = 281474976710656n
const MAX_ID = 9223372036854775807n
const chain = join(import.meta.dir, '..', 'drizzle')
const journal = JSON.parse(readFileSync(join(chain, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>
}
const upgradeIndex = journal.entries.findIndex(entry =>
  /CREATE SEQUENCE.*mellat_order_id_seq/.test(readFileSync(join(chain, `${entry.tag}.sql`), 'utf8')))
assert(upgradeIndex > 0, 'Mellat allocation migration must exist')
const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_mellat_allocation_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
const workDir = mkdtempSync(join(tmpdir(), 'sinshin-mellat-allocation-chain-'))
const userId = '20000000-0000-4000-8000-000000000001'
const orderId = '20000000-0000-4000-8000-000000000002'
const couponId = '20000000-0000-4000-8000-000000000003'
let database: Database | undefined
let secondWorker: Database | undefined
let created = false
let checks = 0
const passed = (name: string) => { checks++; console.log(`PASS ${name}`) }

try {
  mkdirSync(join(workDir, 'meta'))
  const previous = journal.entries.slice(0, upgradeIndex)
  writeFileSync(join(workDir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: previous }))
  for (const entry of previous) copyFileSync(join(chain, `${entry.tag}.sql`), join(workDir, `${entry.tag}.sql`))
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(target.toString(), { max: 4 })
  const db = database.db
  await migrate(db, { migrationsFolder: workDir })
  // These fixtures deliberately use the exact old schema rather than new ORM columns.
  await db.execute(sql`insert into users (id, phone) values (${userId}, '09328000001')`)
  await db.execute(sql`insert into coupons (id, code, discount_percentage, is_public, used_count)
    values (${couponId}, 'MELLATLEGACY', 10, false, 1)`)
  await db.execute(sql`insert into coupon_conditions (coupon_id, type, params)
    values (${couponId}, 'FIRST_PURCHASE', '{}')`)
  await db.execute(sql`insert into orders (id, display_id, user_id, status, delivery_type, payment_status,
    payment_method, total_amount, breakdown, coupon_id) values
    (${orderId}, 'MELLAT-LEGACY', ${userId}, 'PENDING_PAYMENT', 'PICKUP', 'PENDING', 'MIXED', 90000,
    '{"foodTotal":100000,"discount":10000,"walletDeduction":20000,"deliveryFee":0,"packagingFee":0,"totalAmount":90000,"amountPaidOnline":70000}', ${couponId})`)
  await db.execute(sql`insert into coupon_grants (coupon_id, user_id, consumed_at) values (${couponId}, ${userId}, now())`)
  await db.execute(sql`insert into first_purchase_reservations (user_id, order_id) values (${userId}, ${orderId})`)
  await db.execute(sql`insert into wallet_transactions (user_id, type, amount, description, order_id) values
    (${userId}, 'DEPOSIT', 100000, 'Legacy funding', null),
    (${userId}, 'WITHDRAW', 20000, 'Legacy order reservation', ${orderId})`)
  await db.execute(sql`insert into payments (user_id, order_id, amount, gateway, mode, status, gateway_ref, metadata) values
    (${userId}, ${orderId}, 70000, 'MELLAT', 'direct', 'PENDING', '0:t:legacyToken', '{"paymentUrl":"legacy-url"}'),
    (${userId}, ${orderId}, 70000, 'MELLAT', 'direct', 'SUCCESS', '281474976710655:s:123456789', '{"verified":true}'),
    (${userId}, ${orderId}, 70000, 'MELLAT', 'direct', 'PENDING', null, '{"initToken":"lost-request","initFailed":true}'),
    (${userId}, ${orderId}, 70000, 'ZARINPAL', 'direct', 'FAILED', 'legacy-authority', '{"failed":true}')`)
  const history = async () => {
    const [row] = await db.execute(sql`select
      (select jsonb_agg(to_jsonb(p) - 'mellat_order_id' order by id) from payments p) as payments,
      (select jsonb_agg(to_jsonb(o) order by id) from orders o) as orders,
      (select jsonb_agg(to_jsonb(w) order by id) from wallet_transactions w) as ledger,
      (select jsonb_agg(to_jsonb(c) order by id) from coupons c) as coupons,
      (select jsonb_agg(to_jsonb(g) order by id) from coupon_grants g) as grants,
      (select jsonb_agg(to_jsonb(r) order by user_id) from first_purchase_reservations r) as reservations`)
    return row
  }
  const before = await history()
  await migrate(db, { migrationsFolder: chain })
  assert.deepEqual(await history(), before)
  const historical = await db.select().from(payments)
  assert.equal(historical.length, 4)
  assert(historical.every(payment => payment.mellatOrderId === null))
  passed('upgrade preserves legacy tokens, receipts, lost requests, amounts, metadata, wallet and coupon/FIRST reservations')
  const [referenceColumn] = await db.execute(sql`select character_maximum_length as maximum
    from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'gateway_ref'`)
  assert.equal(referenceColumn!.maximum, 128)

  const [definition] = await db.execute(sql`select seqmin::text as minimum, seqmax::text as maximum,
    seqstart::text as start, seqincrement::text as increment, seqcache::text as cache, seqcycle as cycle
    from pg_sequence where seqrelid = 'public.mellat_order_id_seq'::regclass`)
  assert.deepEqual(definition, {
    minimum: MIN_ID.toString(), maximum: MAX_ID.toString(), start: MIN_ID.toString(),
    increment: '1', cache: '1', cycle: false,
  })
  passed('allocator reserves the entire 48-bit historical namespace and uses a bounded non-cycling sequence')
  await migrate(db, { migrationsFolder: chain })
  assert.deepEqual(await history(), before)
  const [journalRows] = await db.execute(sql`select count(*)::int as total from drizzle.__drizzle_migrations`)
  assert.equal(journalRows!.total, journal.entries.length)
  passed('reapplying the upgrade changes neither history nor the migration journal')

  secondWorker = new Database(target.toString(), { max: 4 })
  const other = secondWorker.db
  const insertAttempt = async (worker: Db = db) => {
    const [attempt] = await worker.insert(payments).values({
      userId, orderId: orderId as never, amount: 70000, gateway: 'MELLAT', mode: 'direct',
    }).returning()
    return attempt!.id
  }
  // An atomic UPDATE locks each attempt and reuses its committed allocation.
  // Separate Database instances represent independent application workers.
  const allocate = async (worker: Db, attemptId: PaymentId) => {
    const [row] = await worker.execute<{ allocated: string }>(sql`update payments
      set mellat_order_id = coalesce(mellat_order_id, nextval('public.mellat_order_id_seq'))
      where id = ${attemptId} returning mellat_order_id::text as allocated`)
    assert(row)
    return BigInt(row.allocated)
  }
  const firstAttempt = await insertAttempt()
  const first = await allocate(db, firstAttempt)
  assert.equal(first, MIN_ID)
  const [readBack] = await other.select().from(payments).where(eq(payments.id, firstAttempt))
  assert.equal(readBack!.mellatOrderId, MIN_ID)
  assert.equal(typeof readBack!.mellatOrderId, 'bigint')
  assert.equal(await allocate(other, firstAttempt), first)
  passed('the first committed allocation is outside legacy hashes, survives another worker and is reused exactly')

  const sharedAttempt = await insertAttempt()
  const sameAttempt = await Promise.all(Array.from({ length: 32 }, (_, index) =>
    allocate(index % 2 === 0 ? db : other, sharedAttempt)))
  assert.equal(new Set(sameAttempt).size, 1)
  // Concurrent UPDATE evaluation may burn unused sequence values before its
  // row-lock recheck. Gaps are safe; the committed association must stay unique.
  assert(sameAttempt.every(value => value > first && value <= MAX_ID))
  passed('concurrent workers persist one immutable association for the same attempt')

  const batchSize = 512
  const attempts = await db.insert(payments).values(Array.from({ length: batchSize }, () => ({
    userId, orderId: orderId as never, amount: 70000, gateway: 'MELLAT', mode: 'direct',
  }))).returning({ id: payments.id })
  const allocated = await Promise.all(attempts.map((attempt, index) =>
    allocate(index % 2 === 0 ? db : other, attempt.id)))
  assert.equal(new Set(allocated).size, batchSize)
  assert(allocated.every(value => value > MIN_ID && value <= MAX_ID))
  const [count] = await db.execute(sql`select count(*)::int as count, count(distinct mellat_order_id)::int as distinct_count
    from payments where mellat_order_id is not null`)
  assert.equal(count!.count, batchSize + 2)
  assert.equal(count!.distinct_count, batchSize + 2)
  passed('a large burst across independent workers persists globally distinct IDs')

  const burnedAttempt = await insertAttempt()
  let burned = 0n
  const rollback = new Error('Intentional scratch transaction rollback')
  await assert.rejects(() => db.transaction(async tx => {
    const [row] = await tx.execute<{ allocated: string }>(sql`update payments
      set mellat_order_id = nextval('public.mellat_order_id_seq') where id = ${burnedAttempt}
      returning mellat_order_id::text as allocated`)
    burned = BigInt(row!.allocated)
    throw rollback
  }), error => error === rollback)
  const [rolledBack] = await other.select().from(payments).where(eq(payments.id, burnedAttempt))
  assert.equal(rolledBack!.mellatOrderId, null)
  assert(await allocate(other, burnedAttempt) > burned)
  passed('rollback leaves no committed association and permanently burns its sequence value')

  const duplicateA = await insertAttempt()
  const duplicateB = await insertAttempt(other)
  const explicitId = MAX_ID - 100n
  const duplicateResults = await Promise.allSettled([
    db.transaction(tx => tx.update(payments).set({ mellatOrderId: explicitId }).where(eq(payments.id, duplicateA))),
    other.transaction(tx => tx.update(payments).set({ mellatOrderId: explicitId }).where(eq(payments.id, duplicateB))),
  ])
  assert.equal(duplicateResults.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(duplicateResults.filter(result => result.status === 'rejected').length, 1)
  passed('the database rejects duplicate associations across concurrent transactions')

  await assert.rejects(() => db.update(payments).set({ mellatOrderId: null }).where(eq(payments.id, firstAttempt)))
  await assert.rejects(() => other.update(payments).set({ mellatOrderId: MAX_ID - 99n }).where(eq(payments.id, firstAttempt)))
  await db.update(payments).set({ mellatOrderId: first, status: 'FAILED', metadata: { audit: 'retained' } })
    .where(eq(payments.id, firstAttempt))
  const [unchanged] = await other.select().from(payments).where(eq(payments.id, firstAttempt))
  assert.equal(unchanged!.mellatOrderId, first)
  assert.equal(unchanged!.status, 'FAILED')
  passed('the association cannot be changed or cleared, while normal payment status/metadata updates remain valid')

  const anotherUserId = crypto.randomUUID()
  const anotherOrderId = crypto.randomUUID()
  await db.execute(sql`insert into users (id, phone) values (${anotherUserId}, '09328000002')`)
  await db.execute(sql`insert into orders (id, display_id, user_id, delivery_type, total_amount, breakdown)
    values (${anotherOrderId}, 'MELLAT-RETARGET', ${anotherUserId}, 'PICKUP', 70000, '{}')`)
  await assert.rejects(() => db.execute(sql`update payments set id = ${crypto.randomUUID()} where id = ${firstAttempt}`))
  await assert.rejects(() => other.execute(sql`update payments set order_id = ${anotherOrderId} where id = ${firstAttempt}`))
  await assert.rejects(() => db.execute(sql`update payments set user_id = ${anotherUserId} where id = ${firstAttempt}`))
  const [originalBinding] = await other.select().from(payments).where(eq(payments.id, firstAttempt))
  assert.equal(originalBinding!.orderId, orderId)
  assert.equal(originalBinding!.userId, userId)
  passed('an allocated request cannot be retargeted to another payment, order or customer')

  const invalidAttempt = await insertAttempt()
  for (const invalidId of [0n, -1n, MIN_ID - 1n]) {
    await assert.rejects(() => db.update(payments).set({ mellatOrderId: invalidId }).where(eq(payments.id, invalidAttempt)))
  }
  await assert.rejects(() => db.execute(sql`update payments set mellat_order_id = ${(MAX_ID + 1n).toString()}::bigint
    where id = ${invalidAttempt}`))
  passed('range checks reject legacy hashes, negative values and integers outside the PSP signed-long range')

  // Exhaustion is simulated only inside this disposable database. No reset,
  // fallback namespace or cyclic allocation may occur after the final value.
  await db.execute(sql`select setval('public.mellat_order_id_seq', ${MAX_ID.toString()}::bigint, false)`)
  const finalAttempt = await insertAttempt()
  assert.equal(await allocate(db, finalAttempt), MAX_ID)
  const longestReference = `${MAX_ID}:t:${'A'.repeat(100)}`
  assert.equal(longestReference.length, 122)
  await db.update(payments).set({ gatewayRef: longestReference }).where(eq(payments.id, finalAttempt))
  const [longReference] = await other.select().from(payments).where(eq(payments.id, finalAttempt))
  assert.equal(longReference!.gatewayRef, longestReference)
  passed('a maximum signed-long ID and 100-character Mellat token persist without truncation')
  const exhaustedAttempt = await insertAttempt(other)
  await assert.rejects(() => allocate(other, exhaustedAttempt))
  await assert.rejects(() => allocate(db, exhaustedAttempt))
  const [exhausted] = await db.select().from(payments).where(eq(payments.id, exhaustedAttempt))
  assert.equal(exhausted!.mellatOrderId, null)
  const [end] = await db.execute<{ last: string }>(sql`select last_value::text as last from public.mellat_order_id_seq`)
  assert.equal(BigInt(end!.last), MAX_ID)
  assert.equal(await allocate(other, finalAttempt), MAX_ID)
  passed('the maximum signed-long ID round-trips exactly; exhaustion fails repeatedly without wrapping or changing existing IDs')
  console.log(`Mellat allocation: ${checks} scenarios passed`)
} finally {
  await secondWorker?.close()
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
  if (dirname(resolve(workDir)) !== resolve(tmpdir()) || !basename(workDir).startsWith('sinshin-mellat-allocation-chain-')) {
    throw new Error('Refusing to remove an unexpected temporary migration directory')
  }
  rmSync(workDir, { recursive: true, force: true })
}
