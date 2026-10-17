// Upgrade the untouched 0010 chain in a scratch DB; never rewrite the workspace journal.
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { checkoutIdempotency, couponNudges, coupons, orders, users } from '../src/infra/db/schema'

const chain = join(import.meta.dir, '..', 'drizzle')
const journal = JSON.parse(readFileSync(join(chain, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>
}
const migrationIndex = journal.entries.findIndex((entry) => entry.tag.startsWith('0011_'))
assert.ok(migrationIndex > 0, '0011 migration must be present')
const workDir = mkdtempSync(join(tmpdir(), 'sinshin-0011-chain-'))
const scratch = `sinshin_e2e_migration0011_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const target = new URL(process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
const adminUrl = new URL(target)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
let created = false
let assertions = 0
const check = (name: string, condition: boolean) => {
  assert.ok(condition, name)
  assertions++
  console.log(`  ✓ ${name}`)
}
try {
  mkdirSync(join(workDir, 'meta'), { recursive: true })
  const previous = journal.entries.slice(0, migrationIndex)
  writeFileSync(join(workDir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: previous }))
  for (const entry of previous) copyFileSync(join(chain, `${entry.tag}.sql`), join(workDir, `${entry.tag}.sql`))
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  target.pathname = `/${scratch}`
  database = new Database(target.toString(), { max: 2 })
  const db = database.db
  await migrate(db, { migrationsFolder: workDir })

  const [user] = await db.insert(users).values({ phone: '09301100000', role: 'user' }).returning()
  const [coupon] = await db.insert(coupons).values({ code: 'MIGRATION0011', discountPercentage: 10 }).returning()
  const orphanId = crypto.randomUUID()
  const validOrderId = crypto.randomUUID()
  const orphanOrderId = crypto.randomUUID()
  const snapshot = { subtotal: 1000, couponDiscount: 100, totalAmount: 900 }
  await db.execute(sql`insert into checkout_idempotency (user_id, key, response) values
    (${user!.id}, 'legacy-complete', ${JSON.stringify({ orderId: validOrderId })}::jsonb),
    (${user!.id}, 'legacy-pending', null),
    (${user!.id}, 'legacy-another', null)`)
  await db.execute(sql`insert into orders (id, display_id, user_id, delivery_type, total_amount, breakdown, coupon_id) values
    (${validOrderId}, 'MIG-VALID', ${user!.id}, 'PICKUP', 900, ${JSON.stringify(snapshot)}::jsonb, ${coupon!.id}),
    (${orphanOrderId}, 'MIG-ORPHAN', ${user!.id}, 'PICKUP', 900, ${JSON.stringify(snapshot)}::jsonb, ${orphanId})`)
  const [nudge] = await db.insert(couponNudges).values({
    userId: user!.id, couponId: coupon!.id, scanDate: '2026-10-17', remainingCount: 123,
  }).returning()
  // Keep exact DB representations so migration cannot silently rewrite old payloads.
  const [legacy] = await db.execute(sql`select response::text as response, claimed_at::text as claimed_at,
    updated_at::text as updated_at from checkout_idempotency where key = 'legacy-complete'`)

  await migrate(db, { migrationsFolder: chain })
  const claims = await db.select().from(checkoutIdempotency)
  check('All legacy checkout rows survive with nullable requestHash', claims.length === 3 && claims.every((row) => row.requestHash === null))
  const tokens = claims.map((row) => row.claimToken)
  check('Every legacy claim gets a distinct UUID token', tokens.every((token) => /^[0-9a-f-]{36}$/.test(token)) && new Set(tokens).size === tokens.length)
  const [preserved] = await db.execute(sql`select response::text as response, claimed_at::text as claimed_at,
    updated_at::text as updated_at from checkout_idempotency where key = 'legacy-complete'`)
  check('Legacy cached response and timestamps remain untouched', JSON.stringify(preserved) === JSON.stringify(legacy))
  const orderRows = await db.select().from(orders)
  check('Dangling coupon reference becomes null without deleting its order', orderRows.find((row) => row.id === orphanOrderId)?.couponId === null)
  check('Valid coupon reference is preserved', orderRows.find((row) => row.id === validOrderId)?.couponId === coupon!.id)
  check('Existing order amounts and pricing snapshots are preserved', orderRows.length === 2 && orderRows.every((row) =>
    row.totalAmount === 900 && JSON.stringify(row.breakdown) === JSON.stringify(snapshot)))
  const [oldNudge] = await db.select().from(couponNudges).where(eq(couponNudges.id, nudge!.id))
  check('Widening remainingCount preserves old values', oldNudge!.remainingCount === 123)
  await db.update(couponNudges).set({ remainingCount: 5_000_000_000 }).where(eq(couponNudges.id, nudge!.id))
  const [largeNudge] = await db.select().from(couponNudges).where(eq(couponNudges.id, nudge!.id))
  check('remainingCount supports 5e9 through the real ORM', largeNudge!.remainingCount === 5_000_000_000)
  const requestHash = 'a'.repeat(64)
  const [newClaim] = await db.insert(checkoutIdempotency).values({ userId: user!.id, key: 'new-claim', requestHash }).returning()
  check('New checkout rows keep their hash and receive a fresh token', newClaim!.requestHash === requestHash && !tokens.includes(newClaim!.claimToken))
  let rejected = false
  try {
    await db.execute(sql`update orders set coupon_id = ${orphanId} where id = ${orphanOrderId}`)
  } catch { rejected = true }
  check('Foreign key rejects new dangling coupon references', rejected)

  const before = await db.select().from(checkoutIdempotency).orderBy(checkoutIdempotency.key)
  await migrate(db, { migrationsFolder: chain })
  const after = await db.select().from(checkoutIdempotency).orderBy(checkoutIdempotency.key)
  check('Repeated migration preserves hashes, claim tokens and cached data', JSON.stringify(after) === JSON.stringify(before))
  const [repeatedNudge] = await db.select().from(couponNudges).where(eq(couponNudges.id, nudge!.id))
  check('Repeated migration preserves widened nudge values', repeatedNudge!.remainingCount === 5_000_000_000)
  const [journalCount] = await db.execute(sql`select count(*)::int as total from drizzle.__drizzle_migrations`)
  check('Repeat migration adds no journal entry', Number(journalCount!.total) === journal.entries.length)
  await db.delete(coupons).where(eq(coupons.id, coupon!.id))
  const [orderAfterDelete] = await db.select().from(orders).where(eq(orders.id, validOrderId as never))
  check('Deleting a coupon nulls the order link and preserves the order total', orderAfterDelete!.couponId === null && orderAfterDelete!.totalAmount === 900)
  console.log(`0011 upgrade/reapply: ${assertions} assertions passed.`)
} finally {
  await database?.close()
  if (created) await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
  if (dirname(resolve(workDir)) !== resolve(tmpdir()) || !basename(workDir).startsWith('sinshin-0011-chain-')) {
    throw new Error('Refusing to remove an unexpected migration test directory')
  }
  rmSync(workDir, { recursive: true, force: true })
}
