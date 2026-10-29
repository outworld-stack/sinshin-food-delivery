/** About content CRUD, authorization and localization against disposable local PostgreSQL. */
import assert from 'node:assert/strict'
import type { AboutContentDto, ArticleBlocksDoc } from '@sinshin/shared'
import { SQL } from 'bun'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import { SettingsService } from '../src/domain/settings/settings.service'
import { AppError } from '../src/domain/shared/errors'
import { aboutRoutes } from '../src/http/routes/about.routes'
import { Database } from '../src/infra/db/client'
import { contentAbout, settings, SETTING_KEYS } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_about_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
let created = false
let count = 0
const passed = (name: string) => { count++; console.log(`PASS ${name}`) }
const originalFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in About tests') }) as unknown as typeof fetch

try {
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(scratchUrl.toString(), { max: 4 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const configuredLocation = { lat: 37.4822056, lng: 49.4418273 }
  const databaseLocation = { lat: 35.69, lng: 51.39 }
  await db.insert(settings).values({ key: SETTING_KEYS.restaurantLocation, value: databaseLocation })
  const settingsService = new SettingsService({ db, config: { restaurantLocation: configuredLocation } as never })
  const sessions = {
    authenticate: async (token: string) => ({
      user: { id: '00000000-0000-4000-8000-000000000001', role: token === 'main' ? 'admin' : token }, ctx: {},
    }),
  }
  const app = new Elysia()
    .onError(({ error, set }) => {
      if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
    })
    .use(aboutRoutes({ db, sessions: sessions as never, settings: settingsService }))
    .compile()
  const request = (method: string, path: string, body?: unknown, token?: string, lang = 'fa') =>
    app.handle(new Request(`http://localhost${path}`, {
      method,
      headers: {
        'content-type': 'application/json', 'x-sinshin-lang': lang,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  const get = async (lang = 'fa', isAdmin = false): Promise<AboutContentDto> => {
    const response = await request('GET', isAdmin ? '/admin/about' : '/about', undefined, isAdmin ? 'main' : undefined, lang)
    assert.equal(response.status, 200)
    return response.json() as Promise<AboutContentDto>
  }
  const save = (body: unknown, token = 'main') => request('PATCH', '/admin/about', body, token)
  const legacy = {
    heroTitle: 'داستان سین شین', heroText: 'خوش آمدید',
    heroGradient: `/uploads/${'a'.repeat(250)}.webp`, teamTitle: 'تیم ما',
    teamGradient: '/uploads/team.webp', teamAlt: 'تیم سین شین',
  }
  const blocks: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'heading', type: 'heading', props: { text: 'داستان ما', level: 2 } },
    { id: 'text', type: 'paragraph', props: { text: 'متن تازه' } },
    { id: 'photo', type: 'image', props: { src: '/uploads/restaurant.webp', alt: 'رستوران' } },
  ] }
  const blocksAr: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'ar-text', type: 'paragraph', props: { text: 'قصتنا' } },
  ] }
  const destination = { lat: 37.501234, lng: 49.401234, address: 'نشانی رستوران', addressAr: 'عنوان المطعم' }

  const initial = await get()
  assert.equal(initial.heroTitle, 'درباره سین شین')
  assert.equal(initial.blocks, null)
  assert.deepEqual(initial.location, { ...configuredLocation, address: '', addressAr: null })
  assert.equal(initial.defaultLocation, undefined, 'public output only exposes the resolved destination')
  const initialAdmin = await get('ar', true)
  assert.equal(initialAdmin.location, null, 'the editor preserves the absence of a custom destination')
  assert.deepEqual(initialAdmin.defaultLocation, initial.location)
  assert.equal((await db.select().from(contentAbout)).length, 0, 'reads never create content rows')
  passed('unseeded page is editable and uses the configured restaurant destination, including env precedence')

  for (const role of ['admin2', 'user', 'courier']) {
    assert.equal((await request('GET', '/admin/about', undefined, role)).status, 403)
    assert.equal((await save(legacy, role)).status, 403)
  }
  assert.equal((await request('GET', '/admin/about')).status, 401)
  assert.equal((await request('PATCH', '/admin/about', legacy)).status, 401)
  assert.equal((await db.select().from(contentAbout)).length, 0)
  passed('only the main admin can read original editor data or change About content')

  assert.equal((await save({ ...legacy, heroTitleAr: 'عن سين شين', blocks, blocksAr, location: destination })).status, 200)
  const persian = await get()
  assert.equal(persian.heroGradient, legacy.heroGradient, 'real upload URLs longer than the legacy 200-character limit survive')
  assert.deepEqual(persian.blocks, blocks)
  assert.deepEqual(persian.location, destination)
  const arabic = await get('ar')
  assert.equal(arabic.heroTitle, 'عن سين شين')
  assert.equal(arabic.heroText, legacy.heroText)
  assert.deepEqual(arabic.blocks, blocksAr)
  assert.equal(arabic.location?.address, destination.addressAr)
  const raw = await get('ar', true)
  assert.equal(raw.heroTitle, legacy.heroTitle)
  assert.deepEqual(raw.blocks, blocks)
  assert.equal(raw.location?.address, destination.address)
  assert.deepEqual(raw.defaultLocation, initial.location, 'reset can preview the default even with an active override')
  const jsonTypes = await db.execute<{ block_type: string; location_type: string }>(
    // The driver must write JSON objects, not double-encoded JSON strings.
    sql`select jsonb_typeof(blocks) as block_type, jsonb_typeof(location) as location_type from content_about`,
  )
  assert.equal(jsonTypes[0]?.block_type, 'object')
  assert.equal(jsonTypes[0]?.location_type, 'object')
  passed('sections, upload URLs and destination persist as JSON objects; public Arabic and raw admin reads are distinct')

  assert.equal((await save({ ...legacy, heroText: 'تغییر متن' })).status, 200)
  const preserved = await get('fa', true)
  assert.deepEqual(preserved.blocks, blocks)
  assert.deepEqual(preserved.blocksAr, blocksAr)
  assert.deepEqual(preserved.location, destination)
  assert.equal(preserved.heroTitleAr, 'عن سين شين')
  passed('older clients omitting new fields and Arabic translations cannot erase them')

  const edited: ArticleBlocksDoc = { version: 1, blocks: [
    blocks.blocks[2]!,
    { id: 'text', type: 'paragraph', props: { text: 'متن ویرایش شده' } },
    { id: 'new', type: 'quote', props: { text: 'محتوای جدید' } },
  ] }
  assert.equal((await save({ ...legacy, blocks: edited, blocksAr: null, heroTitleAr: '  ', location: { ...destination, address: ' نشانی جدید ', addressAr: ' ' } })).status, 200)
  const changed = await get('ar')
  assert.deepEqual(changed.blocks, edited)
  assert.equal(changed.heroTitle, legacy.heroTitle)
  assert.equal(changed.location?.address, 'نشانی جدید')
  assert.equal(changed.location?.addressAr, null)
  assert.deepEqual((await db.select().from(settings).where(eq(settings.key, SETTING_KEYS.restaurantLocation)))[0]?.value, databaseLocation)
  passed('add, edit, remove and reorder sections round-trip; cleared Arabic falls back; About edits leave delivery origin untouched')

  for (const invalid of [
    { lat: 91, lng: 49 }, { lat: 37, lng: -181 }, { lat: '37', lng: 49 }, { lat: null, lng: 49 },
  ]) {
    assert.equal((await save({ ...legacy, location: { ...invalid, address: '' } })).status, 422)
  }
  assert.equal((await save({ ...legacy, location: { ...destination, address: 'x'.repeat(501) } })).status, 422)
  assert.equal((await save({ ...legacy, heroTitle: '  ' })).status, 422)
  assert.equal((await save({ ...legacy, blocks: { version: 2, blocks: [] } })).status, 422)
  assert.equal((await save({ ...legacy, blocks: { version: 1, blocks: Array.from({ length: 201 }, () => blocks.blocks[0]) } })).status, 422)
  assert.equal((await save({ ...legacy, blocks: { version: 1, blocks: [
    { id: 'huge', type: 'paragraph', props: { text: 'م'.repeat(140_000) } },
  ] } })).status, 422)
  assert.deepEqual((await get()).blocks, edited)
  passed('invalid coordinates, oversized input and blank headings are rejected without replacing saved content')

  assert.equal((await save({ ...legacy, blocks: { version: 1, blocks: [
    { id: 'unsafe', type: 'image', props: { src: 'javascript:alert(1)' } },
    { id: 'safe', type: 'paragraph', props: { text: ' متن ایمن ', onClick: 'alert(1)' } },
  ] } })).status, 200)
  assert.deepEqual((await get()).blocks, { version: 1, blocks: [
    { id: 'safe', type: 'paragraph', props: { text: 'متن ایمن' } },
  ] })
  passed('About content uses the existing block sanitizer for unsafe URLs and unrecognized props')

  assert.equal((await save({ ...legacy, heroText: '', heroGradient: '', teamTitle: '', teamGradient: '', teamAlt: '', blocks: { version: 1, blocks: [] }, blocksAr: null, location: null })).status, 200)
  const cleared = await get()
  assert.equal(cleared.blocks, null)
  assert.equal(cleared.blocksAr, null)
  assert.equal(cleared.heroGradient, '')
  assert.equal(cleared.teamTitle, '')
  assert.deepEqual(cleared.location, initial.location)
  assert.equal((await get('fa', true)).location, null)
  assert.equal((await save(legacy)).status, 200)
  assert.equal((await db.select().from(contentAbout))[0]?.location, null, 'unrelated edits keep following the restaurant destination')
  assert.equal((await db.select().from(contentAbout)).length, 1)
  passed('empty documents and optional fixed sections can be removed; resetting the map restores the restaurant destination')

  await db.delete(contentAbout)
  const concurrent = await Promise.all([save(legacy), save(legacy)])
  assert(concurrent.every(response => response.status === 200))
  assert.equal((await db.select().from(contentAbout)).length, 1)
  passed('concurrent first saves preserve the singleton row')
  console.log(`${count} About API checks passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
