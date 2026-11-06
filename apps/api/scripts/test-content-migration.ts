/** Migration 0026 -> 0027 with legacy bilingual records. Disposable local PostgreSQL only. */
import assert from 'node:assert/strict'
import { mkdir, copyFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { SQL } from 'bun'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { eligibleContentTranslationFields, reconcileContentTranslation, type ContentEntityType } from '@sinshin/shared'
import { Database } from '../src/infra/db/client'
import * as schema from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_content_migration_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source); scratchUrl.pathname = `/${scratch}`
const workspaceRoot = resolve(import.meta.dir, '../../..')
const staging = resolve(workspaceRoot, '.tmp', `content-legacy-migrations-${process.pid}-${crypto.randomUUID()}`)
assert(staging.startsWith(`${workspaceRoot}${sep}.tmp${sep}`), 'Migration fixtures must stay inside workspace .tmp')
const migrationsFolder = resolve(import.meta.dir, '../drizzle')
const journal = await Bun.file(resolve(migrationsFolder, 'meta/_journal.json')).json() as {
  entries: { idx: number; tag: string; when: number }[]
}
const boundary = journal.entries.findIndex(entry => entry.tag.startsWith('0027_'))
assert(boundary > 0, 'Content provenance migration must be present in journal')
let database: Database | undefined
let raw: SQL | undefined
let count = 0
const passed = (name: string) => { count++; console.log(`PASS ${name}`) }
const previousFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in legacy migration tests') }) as unknown as typeof fetch

try {
  await mkdir(resolve(staging, 'meta'), { recursive: true })
  for (const entry of journal.entries.slice(0, boundary)) {
    await copyFile(resolve(migrationsFolder, `${entry.tag}.sql`), resolve(staging, `${entry.tag}.sql`))
  }
  await Bun.write(resolve(staging, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, boundary) }))
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 4 })
  raw = new SQL(scratchUrl.toString(), { max: 2 })
  const db = database.db
  await migrate(db, { migrationsFolder: staging })
  const mainId = crypto.randomUUID(), categoryId = crypto.randomUUID(), productId = crypto.randomUUID()
  const articleCategoryId = crypto.randomUUID(), articleSubId = crypto.randomUUID()
  const processes = [{ title: 'بخش', items: ['اول', 'دوم'] }]
  const processesAr = [{ title: 'قسم', items: ['أول', 'ثان'] }]
  const blocks = { version: 1, blocks: [
    { id: 'location-one', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, address: 'نشانی اول' } },
    { id: 'location-two', type: 'location', props: { lat: -12.987654321, lng: 0, address: 'نشانی دوم' } },
    { id: 'heading', type: 'heading', props: { text: 'عنوان', level: 2 } },
  ] }
  const blocksAr = { ...blocks, blocks: blocks.blocks.map(block => ({ ...block, props: {
    ...block.props, ...(block.type === 'heading' ? { text: 'عنوان عربي' } : { address: 'عنوان موقع' }),
  } })) }
  await raw.unsafe('insert into main_categories(id,name,name_ar,slug,is_active) values($1,$2,$3,$4,true)', [mainId, 'رستوران', 'مطعم', 'restaurant'])
  await raw.unsafe('insert into categories(id,main_category_id,name,name_ar,slug,has_sizes,size_names,size_names_ar) values($1,$2,$3,$4,$5,true,$6::jsonb,$7::jsonb)',
    [categoryId, mainId, 'غذا', 'طعام', 'food', JSON.stringify(['کوچک', 'بزرگ']), JSON.stringify(['صغير', 'كبير'])])
  await raw.unsafe('insert into products(id,category_id,name,name_ar,description,description_ar,ingredients,ingredients_ar,original_price,ar_auto) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,100000,true)',
    [productId, categoryId, 'غذا', 'وجبة', 'توضیح', 'وصف يدوي', JSON.stringify(['پنیر', 'قارچ']), JSON.stringify(['جبن', 'فطر'])])
  await raw.unsafe('insert into product_sizes(product_id,name,name_ar,price) values($1,$2,$3,100000)', [productId, 'کوچک', 'صغير'])
  await raw.unsafe('insert into packaging_items(title,title_ar,price) values($1,$2,5000)', ['جعبه', 'صندوق'])
  await raw.unsafe('insert into article_categories(id,name,name_ar,slug) values($1,$2,$3,$4)', [articleCategoryId, 'آموزش', 'تعليم', 'guide'])
  await raw.unsafe('insert into article_sub_categories(id,category_id,name,name_ar,slug) values($1,$2,$3,$4,$5)', [articleSubId, articleCategoryId, 'غذا', 'طعام', 'food'])
  await raw.unsafe('insert into articles(category_id,sub_category_id,title,title_ar,excerpt,excerpt_ar,content,content_ar,processes,processes_ar,blocks,blocks_ar,ar_auto) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,true)',
    [articleCategoryId, articleSubId, 'مقاله', 'مقال', 'خلاصه', 'ملخص', 'محتوا', 'محتوى', JSON.stringify(processes), JSON.stringify(processesAr), JSON.stringify(blocks), JSON.stringify(blocksAr)])
  await raw.unsafe('insert into gallery_images(src,alt,alt_ar,ar_auto) values($1,$2,$3,true)', ['/gallery.webp', 'تصویر', 'صورة'])
  await raw.unsafe('insert into content_about(hero_title,hero_title_ar,hero_text,hero_text_ar,hero_gradient,team_title,team_title_ar,team_gradient,team_alt,team_alt_ar,blocks,blocks_ar,location,ar_auto) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,true)',
    ['درباره', 'عن', 'متن', 'نص', 'from-red-400 to-blue-500', 'تیم', 'فريق', 'from-red-400 to-blue-500', 'تصویر تیم', 'صورة الفريق',
      JSON.stringify(blocks), JSON.stringify(blocksAr), JSON.stringify({ lat: 37.4822056789, lng: 49.4418273456, address: 'نشانی', addressAr: 'عنوان' })])
  await raw.unsafe('insert into terms(version,sections,sections_ar,ar_auto) values(1,$1::jsonb,$2::jsonb,true)', [JSON.stringify(processes), JSON.stringify(processesAr)])
  await raw.unsafe('insert into settings(key,value) values($1,$2::jsonb),($3,$4::jsonb)',
    ['temporary_close_reason', JSON.stringify('بسته'), 'temporary_close_reason_ar', JSON.stringify('مغلق')])
  const tables = ['main_categories', 'categories', 'products', 'product_sizes', 'packaging_items', 'article_categories',
    'article_sub_categories', 'articles', 'gallery_images', 'content_about', 'terms', 'settings']
  const snapshots = new Map<string, Record<string, unknown>[]>()
  for (const table of tables) {
    const rows = await raw.unsafe(`select row_to_json(t) as row from "${table}" t order by ${table === 'settings' ? 'key' : 'id'}`) as { row: Record<string, unknown> }[]
    snapshots.set(table, rows.map(item => item.row))
  }
  await migrate(db, { migrationsFolder })
  for (const table of tables) {
    const rows = await raw.unsafe(`select row_to_json(t) as row from "${table}" t order by ${table === 'settings' ? 'key' : 'id'}`) as { row: Record<string, unknown> }[]
    const after = rows.map(({ row }) => {
      assert.equal(row.translation_state, null, `${table} gets a backward-compatible null sidecar`)
      const { translation_state: _state, ...content } = row
      return content
    })
    assert.deepEqual(after, snapshots.get(table), `${table} migration must not alter any pre-existing Persian/Arabic/structural value`)
    passed(`${table} legacy contents survive additive migration exactly`)
  }
  await migrate(db, { migrationsFolder })
  passed('content migration is idempotent')
  const legacyRows: [ContentEntityType, Record<string, unknown>][] = []
  for (const [type, table] of [
    ['mainCategory', schema.mainCategories], ['category', schema.categories], ['product', schema.products],
    ['productSize', schema.productSizes], ['packagingItem', schema.packagingItems],
    ['articleCategory', schema.articleCategories], ['articleSubCategory', schema.articleSubCategories],
    ['article', schema.articles], ['gallery', schema.galleryImages], ['about', schema.contentAbout], ['terms', schema.terms],
  ] as const) {
    const rows = await db.select().from(table)
    for (const row of rows) legacyRows.push([type, row])
  }
  for (const [type, row] of legacyRows) {
    const reconciled = reconcileContentTranslation(type, String(row.id), row, row)
    assert.equal(eligibleContentTranslationFields(type, reconciled).length, 0, `${type} populated legacy fields must never be automatically retransmitted`)
    const { translationState: _state, ...content } = reconciled
    const { translationState: _oldState, ...original } = row
    assert.deepEqual(content, original, `${type} lazy metadata binding preserves every existing Arabic value`)
    passed(`${type} lazy legacy provenance preserves populated Arabic as manual/legacy`)
  }
  console.log(`Legacy content migration regressions: ${count} passed`)
} finally {
  globalThis.fetch = previousFetch
  await raw?.close({ timeout: 5 })
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
  // Resolve and verify again immediately before recursive cleanup on Windows.
  const cleanup = resolve(staging)
  assert(cleanup.startsWith(`${workspaceRoot}${sep}.tmp${sep}`), 'Unsafe fixture cleanup path')
  await rm(cleanup, { recursive: true, force: true })
}
