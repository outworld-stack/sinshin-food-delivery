/** Upgrade the exact pre-feature chain in a scratch PostgreSQL database. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'

const chain = join(import.meta.dir, '..', 'drizzle')
const journal = JSON.parse(readFileSync(join(chain, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>
}
const upgradeIndex = journal.entries.findIndex(entry =>
  /FIRST_PURCHASE/.test(readFileSync(join(chain, `${entry.tag}.sql`), 'utf8')))
assert(upgradeIndex > 0, 'Coupon upgrade migration must exist')
const workDir = mkdtempSync(join(tmpdir(), 'sinshin-coupon-upgrade-chain-'))
const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local PostgreSQL required')
const scratch = `sinshin_e2e_coupon_migration_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const target = new URL(source); target.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1 })
let database: Database | undefined
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
  database = new Database(target.toString(), { max: 2 })
  const db = database.db
  await migrate(db, { migrationsFolder: workDir })
  // Raw SQL intentionally matches the old schema, independent of the new ORM.
  await db.execute(sql`insert into users (id, phone) values ('10000000-0000-4000-8000-000000000001', '09320000001')`)
  await db.execute(sql`insert into main_categories (id, name, slug) values ('10000000-0000-4000-8000-000000000002', 'Legacy menu', 'legacy-menu')`)
  await db.execute(sql`insert into categories (id, main_category_id, name, slug) values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Legacy category', 'legacy-category')`)
  await db.execute(sql`insert into products (id, category_id, name, original_price) values ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'Legacy product', 100000)`)
  await db.execute(sql`insert into coupons (id, code, discount_percentage, is_public, used_count) values
    ('10000000-0000-4000-8000-000000000005', 'HISTORY20', 20, false, 1),
    ('10000000-0000-4000-8000-000000000006', 'PENDING20', 20, true, 1)`)
  await db.execute(sql`insert into coupon_conditions (coupon_id, type, params) values
    ('10000000-0000-4000-8000-000000000005', 'MIN_ORDERS_COUNT', '{"count":1}')`)
  await db.execute(sql`insert into orders (id, display_id, user_id, status, delivery_type, payment_status, payment_method, total_amount, breakdown, coupon_id) values
    ('10000000-0000-4000-8000-000000000007', 'LEGACY-SUCCESS', '10000000-0000-4000-8000-000000000001', 'PAID', 'PICKUP', 'SUCCESS', 'MIXED', 85000,
      '{"foodTotal":100000,"discount":20000,"walletDeduction":30000,"deliveryFee":0,"packagingFee":5000,"totalAmount":85000,"amountPaidOnline":55000}', '10000000-0000-4000-8000-000000000005'),
    ('10000000-0000-4000-8000-000000000008', 'LEGACY-PENDING', '10000000-0000-4000-8000-000000000001', 'PENDING_PAYMENT', 'DINE_IN', 'PENDING', 'GATEWAY', 80000,
      '{"foodTotal":100000,"discount":20000,"walletDeduction":0,"deliveryFee":0,"packagingFee":0,"totalAmount":80000,"amountPaidOnline":80000}', '10000000-0000-4000-8000-000000000006')`)
  await db.execute(sql`insert into order_items (order_id, product_id, name, unit_price, quantity) values
    ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000004', 'Legacy product', 100000, 1),
    ('10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000004', 'Legacy product', 100000, 1)`)
  await db.execute(sql`insert into coupon_grants (coupon_id, user_id, consumed_at) values
    ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', now())`)
  await db.execute(sql`insert into coupon_redemptions (coupon_id, user_id, order_id) values
    ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007')`)
  await db.execute(sql`insert into payments (user_id, order_id, amount, gateway, mode, status, gateway_ref, verified_at) values
    ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 55000, 'ZARINPAL', 'direct', 'SUCCESS', 'old-receipt', now()),
    ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008', 80000, 'ZARINPAL', 'direct', 'PENDING', 'pending-receipt', null)`)
  await db.execute(sql`insert into wallet_transactions (user_id, type, amount, description, order_id) values
    ('10000000-0000-4000-8000-000000000001', 'DEPOSIT', 100000, 'Legacy funding', null),
    ('10000000-0000-4000-8000-000000000001', 'WITHDRAW', 30000, 'Legacy payment', '10000000-0000-4000-8000-000000000007')`)
  const history = async () => {
    const [row] = await db.execute(sql`select
      (select jsonb_agg(to_jsonb(c) - 'condition_mode' - 'discount_scope' - 'discount_category_id' - 'discount_product_id' order by id) from coupons c) as coupons,
      (select jsonb_agg(to_jsonb(c) order by id) from coupon_conditions c) as conditions,
      (select jsonb_agg(to_jsonb(g) order by id) from coupon_grants g) as grants,
      (select jsonb_agg(to_jsonb(r) order by id) from coupon_redemptions r) as redemptions,
      (select jsonb_agg(to_jsonb(o) - 'coupon_eligible_subtotal' order by id) from orders o) as orders,
      (select jsonb_agg(to_jsonb(i) - 'coupon_discount_amount' order by id) from order_items i) as items,
      (select jsonb_agg(to_jsonb(p) - 'mellat_order_id' order by id) from payments p) as payments,
      (select jsonb_agg(to_jsonb(w) order by id) from wallet_transactions w) as ledger`)
    return row
  }
  const before = await history()
  await migrate(db, { migrationsFolder: chain })
  assert.deepEqual(await history(), before)
  passed('upgrade preserves every historical coupon, condition, grant, redemption, order, line, payment and ledger row')
  const defaults = await db.execute(sql`select condition_mode, discount_scope, discount_category_id, discount_product_id from coupons`)
  assert.equal(defaults.length, 2)
  for (const row of defaults) {
    assert.equal(row.condition_mode, 'AND')
    assert.equal(row.discount_scope, 'ALL_PRODUCTS')
    assert.equal(row.discount_category_id, null)
    assert.equal(row.discount_product_id, null)
  }
  const [initial] = await db.execute(sql`select
    (select count(*)::int from first_purchase_reservations) as reservations,
    (select count(*)::int from order_items where coupon_discount_amount = 0) as lines,
    (select count(*)::int from orders where coupon_eligible_subtotal = 0) as orders`)
  assert.deepEqual(initial, { reservations: 0, lines: 2, orders: 2 })
  passed('legacy coupons default AND/ALL_PRODUCTS; additive line snapshots never reconstruct historical finances')
  await db.execute(sql`insert into coupon_conditions (coupon_id, type, params) values ('10000000-0000-4000-8000-000000000006', 'FIRST_PURCHASE', '{}')`)
  await db.execute(sql`insert into coupons (code, discount_percentage, condition_mode, discount_scope, discount_product_id)
    values ('NEWPRODUCT', 15, 'OR', 'PRODUCT', '10000000-0000-4000-8000-000000000004')`)
  await assert.rejects(() => db.execute(sql`insert into coupons (code, discount_percentage, discount_scope, discount_product_id)
    values ('BADPRODUCT', 15, 'PRODUCT', '00000000-0000-4000-8000-000000000999')`))
  await assert.rejects(() => db.execute(sql`insert into coupons (code, discount_percentage, discount_scope, discount_category_id)
    values ('BADCATEGORY', 15, 'CATEGORY', '00000000-0000-4000-8000-000000000999')`))
  await db.execute(sql`insert into first_purchase_reservations (user_id, order_id)
    values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008')`)
  await assert.rejects(() => db.execute(sql`insert into first_purchase_reservations (user_id, order_id)
    values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007')`))
  await assert.rejects(() => db.execute(sql`delete from orders where id = '10000000-0000-4000-8000-000000000008'`))
  await assert.rejects(() => db.execute(sql`insert into first_purchase_reservations (user_id, order_id)
    values ('00000000-0000-4000-8000-000000000999', '10000000-0000-4000-8000-000000000007')`))
  passed('new condition/scope writes work and foreign keys protect scope targets and live reservations')
  const beforeRepeat = await history()
  await migrate(db, { migrationsFolder: chain })
  assert.deepEqual(await history(), beforeRepeat)
  const [journalRows] = await db.execute(sql`select count(*)::int as total from drizzle.__drizzle_migrations`)
  assert.equal(journalRows!.total, journal.entries.length)
  passed('reapplying the complete chain changes neither financial records nor migration journal')
  console.log(`Coupon migration: ${checks} scenarios passed`)
} finally {
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
  if (dirname(resolve(workDir)) !== resolve(tmpdir()) || !basename(workDir).startsWith('sinshin-coupon-upgrade-chain-')) {
    throw new Error('Refusing to remove an unexpected temporary migration directory')
  }
  rmSync(workDir, { recursive: true, force: true })
}
