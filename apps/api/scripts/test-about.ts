/** About content CRUD, authorization and localization against disposable local PostgreSQL. */
import assert from 'node:assert/strict'
import { maximumBlockTranslationFixture } from './content-save-fixtures'
import { bindArticleBlockItemIdentities, contentSourceRevision, contentTranslationFields, mergeArticleBlocksTranslation, readArticleBlockText, setArticleBlockTranslation, type AboutContentDto, type ArticleBlocksDoc } from '@sinshin/shared'
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
  const save = async (body: unknown, token = 'main') => {
    const [current] = await db.select().from(contentAbout).limit(1)
    return request('PATCH', '/admin/about', body && typeof body === 'object'
      ? { sourceRevision: current ? contentSourceRevision('about', current) : undefined, ...body } : body, token)
  }
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
  const blocksAr = setArticleBlockTranslation(blocks, null, 'heading', ['text'], 'قصتنا')!
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
  assert.deepEqual(arabic.blocks, mergeArticleBlocksTranslation(blocks, blocksAr))
  assert.equal(arabic.translationState, undefined, 'public responses omit internal provenance')
  assert.equal(arabic.blocksAr, undefined, 'public clients receive only the safely merged document')
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
  assert.deepEqual(preserved.blocksAr, raw.blocksAr)
  assert.deepEqual(preserved.location, destination)
  assert.equal(preserved.heroTitleAr, 'عن سين شين')
  passed('older clients omitting new fields and Arabic translations cannot erase them')

  const edited: ArticleBlocksDoc = { version: 1, blocks: [
    blocks.blocks[2]!,
    { id: 'text', type: 'paragraph', props: { text: 'متن ویرایش شده' } },
    { id: 'new', type: 'quote', props: { text: 'محتوای جدید' } },
  ] }
  const titleField = contentTranslationFields('about', preserved).find(field => field.fieldId === 'heroTitle')!
  assert.equal((await save({ ...legacy, blocks: edited, blocksAr: null, heroTitleAr: '  ',
    sourceRevision: preserved.sourceRevision,
    translationEdits: [{ ...titleField, value: '', origin: 'manual' }],
    location: { ...destination, address: ' نشانی جدید ', addressAr: ' ' } })).status, 200)
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
  assert.equal(cleared.blocksAr, undefined)
  assert.equal(cleared.heroGradient, '')
  assert.equal(cleared.teamTitle, '')
  assert.deepEqual(cleared.location, initial.location)
  assert.equal((await get('fa', true)).location, null)
  assert.equal((await save(legacy)).status, 200)
  assert.equal((await db.select().from(contentAbout))[0]?.location, null, 'unrelated edits keep following the restaurant destination')
  assert.equal((await db.select().from(contentAbout)).length, 1)
  passed('empty documents and optional fixed sections can be removed; resetting the map restores the restaurant destination')

  const lifecycleBlocks: ArticleBlocksDoc = bindArticleBlockItemIdentities({ version: 1, blocks: [
    { id: 'list', type: 'list', props: { items: ['اول', 'دوم'], ordered: true }, style: { bg: '#ffffff' }, width: 'md', anim: 'fade' },
    { id: 'branch-one', type: 'location', props: { title: 'شعبه اول', address: 'نشانی اول', lat: 37.4822056789, lng: 49.4418273456 } },
    { id: 'branch-two', type: 'location', props: { title: 'شعبه دوم', address: 'نشانی دوم', lat: 35.123456789, lng: 51.987654321 } },
  ] })
  let lifecycleArabic = setArticleBlockTranslation(lifecycleBlocks, null, 'list', ['items', 0], 'الأول')!
  lifecycleArabic = setArticleBlockTranslation(lifecycleBlocks, lifecycleArabic, 'list', ['items', 1], 'الثاني')!
  lifecycleArabic = setArticleBlockTranslation(lifecycleBlocks, lifecycleArabic, 'branch-one', ['address'], 'العنوان الأول')!
  lifecycleArabic = setArticleBlockTranslation(lifecycleBlocks, lifecycleArabic, 'branch-two', ['address'], 'العنوان الثاني')!
  const lifecycleInput = { ...legacy, location: destination, blocks: lifecycleBlocks, blocksAr: lifecycleArabic }
  const beforeLifecycle = await get('fa', true)
  const scalarValues: Record<string, string> = { heroTitle: 'قصتنا', heroText: 'أهلا', teamTitle: 'فريقنا', teamAlt: 'الفريق', 'location.address': 'عنوان المطعم' }
  const scalarEdits = contentTranslationFields('about', { ...beforeLifecycle, ...lifecycleInput })
    .map(field => ({ fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText, revision: field.revision, value: scalarValues[field.fieldId]!, origin: 'manual' as const }))
  assert.equal((await save({ ...lifecycleInput, translationEdits: scalarEdits })).status, 200)
  const reviewed = await get('fa', true)
  assert.equal((await request('PATCH', '/admin/about', { ...lifecycleInput, blocksAr: null }, 'main')).status, 422)
  assert.deepEqual((await get('fa', true)).blocksAr, reviewed.blocksAr, 'unproved nulls cannot erase reviewed block translations')
  assert.equal((await save({ ...lifecycleInput, heroTitle: 'عنوان تازه', heroTitleAr: reviewed.heroTitleAr })).status, 200)
  const titleChanged = await get('fa', true)
  assert.equal(titleChanged.heroTitleAr, null)
  assert.equal(titleChanged.heroTextAr, reviewed.heroTextAr)
  assert.equal(titleChanged.teamTitleAr, reviewed.teamTitleAr)
  assert.equal(titleChanged.teamAltAr, reviewed.teamAltAr)
  assert.deepEqual(titleChanged.blocksAr, reviewed.blocksAr)
  assert.equal(titleChanged.translationState?.fields.find(field => field.fieldId === 'heroTitle')?.status, 'needs-review')
  assert.equal((await get('ar')).heroTitle, 'عنوان تازه')
  passed('one About scalar change invalidates only its manual field, preserves all other translations, and falls back publicly')
  const structureOnly = structuredClone(lifecycleBlocks)
  structureOnly.blocks.reverse()
  const movedLocation = structureOnly.blocks.find(block => block.id === 'branch-one')!
  if (movedLocation.type === 'location') movedLocation.props.lat = 36.987654321
  structureOnly.blocks.find(block => block.id === 'list')!.style = { bg: '#123456', fg: '#654321' }
  assert.equal((await save({ ...lifecycleInput, heroTitle: titleChanged.heroTitle, blocks: structureOnly,
    location: { ...destination, lat: 38.111111111, lng: 50.222222222 } })).status, 200)
  const moved = await get('fa', true)
  assert.equal(moved.location?.addressAr, reviewed.location?.addressAr)
  assert.equal(readArticleBlockText(moved.blocksAr?.blocks.find(block => block.id === 'branch-one'), ['address']), 'العنوان الأول')
  assert.equal(readArticleBlockText(moved.blocksAr?.blocks.find(block => block.id === 'list'), ['items', 0]), 'الأول')
  assert.deepEqual((await get('ar')).blocks?.blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]),
    structureOnly.blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]))
  passed('About ordering, styles and exact coordinate edits preserve valid address and list translations')
  const changedNested = structuredClone(structureOnly)
  const list = changedNested.blocks.find(block => block.id === 'list')!
  if (list.type === 'list') list.props.items[1] = 'مورد تازه'
  assert.equal((await save({ ...lifecycleInput, heroTitle: titleChanged.heroTitle, blocks: changedNested, blocksAr: moved.blocksAr,
    location: { ...moved.location!, address: 'نشانی تازه', addressAr: moved.location?.addressAr } })).status, 200)
  const nestedChanged = await get('fa', true)
  assert.equal(nestedChanged.location?.addressAr, null)
  assert.equal(nestedChanged.location?.lat, 38.111111111)
  assert.equal(nestedChanged.location?.lng, 50.222222222)
  assert.equal(readArticleBlockText(nestedChanged.blocksAr?.blocks.find(block => block.id === 'list'), ['items', 0]), 'الأول')
  assert.equal(readArticleBlockText(nestedChanged.blocksAr?.blocks.find(block => block.id === 'list'), ['items', 1]), '')
  assert.equal(nestedChanged.blocksAr?.translation?.fields.find(field => field.blockId === 'list' && field.fieldPath[1] === 1)?.staleValue, 'الثاني')
  const publicNested = await get('ar')
  assert.deepEqual(publicNested.blocks?.blocks.filter(block => block.type === 'location').map(block => block.props),
    mergeArticleBlocksTranslation(changedNested, nestedChanged.blocksAr)?.blocks.filter(block => block.type === 'location').map(block => block.props))
  assert.equal(readArticleBlockText(publicNested.blocks?.blocks.find(block => block.id === 'list'), ['items', 1]), 'مورد تازه')
  const approvedList = setArticleBlockTranslation(changedNested, nestedChanged.blocksAr, 'list', ['items', 1], 'المورد الجديد')!
  assert.equal((await save({ ...lifecycleInput, heroTitle: titleChanged.heroTitle, blocks: changedNested, blocksAr: approvedList,
    location: nestedChanged.location, sourceRevision: nestedChanged.sourceRevision })).status, 200)
  assert.equal(readArticleBlockText((await get('ar')).blocks?.blocks.find(block => block.id === 'list'), ['items', 1]), 'المورد الجديد')
  assert.equal((await save({ ...lifecycleInput, sourceRevision: reviewed.sourceRevision })).status, 422)
  assert.equal((await get('fa', true)).heroTitle, titleChanged.heroTitle)
  passed('one nested About list field and location address invalidate separately; manual review fills only the field and stale full forms are rejected')

  await db.update(contentAbout).set({ location: { lat: 91, lng: 51, address: 'نشانی قدیمی', addressAr: 'عنوان قديم' } })
  const legacyLocationRow = (await db.select().from(contentAbout))[0]
  assert(legacyLocationRow)
  const invalidLocationEditor = await get('fa', true)
  assert.equal(invalidLocationEditor.location, null, 'invalid legacy coordinates stay out of the editor location control')
  assert.equal(invalidLocationEditor.sourceRevision, contentSourceRevision('about', legacyLocationRow), 'admin proof binds the original persisted row before sanitizing coordinates')
  assert.deepEqual((await get('ar')).location, initial.location)
  const repairResponse = await request('PATCH', '/admin/about', { heroTitle: invalidLocationEditor.heroTitle,
    heroText: invalidLocationEditor.heroText, heroGradient: invalidLocationEditor.heroGradient,
    teamTitle: invalidLocationEditor.teamTitle, teamGradient: invalidLocationEditor.teamGradient, teamAlt: invalidLocationEditor.teamAlt, location: null,
    sourceRevision: invalidLocationEditor.sourceRevision }, 'main')
  assert.equal(repairResponse.status, 200)
  const repaired = (await db.select().from(contentAbout))[0]
  assert(repaired)
  assert.equal(repaired.location, null)
  assert.deepEqual(repaired.blocks, legacyLocationRow.blocks)
  assert.deepEqual(repaired.blocksAr, legacyLocationRow.blocksAr)
  assert.equal(repaired.heroTitleAr, legacyLocationRow.heroTitleAr)
  passed('legacy invalid location can be repaired using the admin-issued raw-row proof without rebuilding existing blocks')

  const maximumAbout = maximumBlockTranslationFixture()
  assert(Buffer.byteLength(JSON.stringify(maximumAbout.source)) > 262_144)
  assert(Buffer.byteLength(JSON.stringify(maximumAbout.arabic)) > 2_097_152)
  assert.equal((await save({ ...legacy, blocks: maximumAbout.source, blocksAr: maximumAbout.arabic })).status, 200)
  const maximumAboutSaved = await get('fa', true)
  assert.equal(maximumAboutSaved.blocksAr?.translation?.fields.length, 6000)
  assert.equal((await request('PATCH', '/admin/about', { ...legacy, blocks: maximumAboutSaved.blocks,
    blocksAr: maximumAboutSaved.blocksAr, sourceRevision: maximumAboutSaved.sourceRevision }, 'main')).status, 200)
  const maximumAboutResaved = await get('fa', true)
  assert.deepEqual(maximumAboutResaved.blocks, maximumAboutSaved.blocks)
  assert.deepEqual(maximumAboutResaved.blocksAr, maximumAboutSaved.blocksAr)
  passed('6000 About field IDs and source proofs do not reduce legacy content limits or prevent HTTP review and saves')

  await db.delete(contentAbout)
  const concurrent = await Promise.all([save(legacy), save(legacy)])
  assert.equal(concurrent.filter(response => response.status === 200).length, 1)
  assert.equal(concurrent.filter(response => response.status === 422).length, 1)
  assert.equal((await db.select().from(contentAbout)).length, 1)
  passed('concurrent first saves preserve the singleton row')
  console.log(`${count} About API checks passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
