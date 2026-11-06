/** Uses only a uniquely named local scratch database and a mock translator. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentSourceRevision, contentTranslationFields, getArticleBlockTranslationStatus, normalizeArticleBlocksTranslation, readArticleBlockText, reconcileArticleBlocksTranslation, setArticleBlockText, setArticleBlockTranslation, type ArticleBlockTextPath, type ArticleBlockType, type ArticleBlocksDoc } from '@sinshin/shared'
import { ArticleService } from '../src/domain/article/article.service'
import { TranslationService } from '../src/domain/translation/translation.service'
import { AppError } from '../src/domain/shared/errors'
import { Database } from '../src/infra/db/client'
import { articles, articleCategories, translationJobs } from '../src/infra/db/schema'
import { adminTranslateRoutes } from '../src/http/routes/admin-translate.routes'
import type { AppConfig } from '../src/infra/config/env'
import type { MenuService } from '../src/domain/menu/menu.service'
import type { RedisService } from '../src/infra/redis/redis'
import type { SessionService } from '../src/domain/auth/session.service'
import type { Admin2Service } from '../src/domain/admin2/admin2.service'

const local = new URL(process.env.ARTICLES_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname), 'Translation tests require local PostgreSQL')
const scratch = `sinshin_block_translations_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(local)
adminUrl.pathname = '/postgres'
const testUrl = new URL(local)
testUrl.pathname = `/${scratch}`
const boot = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
const originalFetch = globalThis.fetch
let database: Database | undefined
let articleService: ArticleService | undefined
let created = false
let checks = 0
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; console.log(`  ✓ ${message}`) }
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined
const payloads: string[][] = []
let prefix = 'عربي '
let rejectText: string | undefined
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  assert.ok(url.startsWith('http://article-translator.test/'), `Unexpected network request: ${url}`)
  if (url.endsWith('/health')) return Response.json({ ready: true, model: 'regression-mock' })
  assert.ok(url.endsWith('/translate'))
  const body = JSON.parse(String(init?.body)) as { texts: string[]; source: string; target: string }
  assert.ok(Array.isArray(body.texts) && body.texts.every((text) => typeof text === 'string'))
  assert.equal(body.source, 'pes')
  assert.equal(body.target, 'arb')
  payloads.push(body.texts)
  if (body.texts.includes(rejectText ?? '')) { rejectText = undefined; return Response.json({ error: 'Rejected fixture' }, { status: 422 }) }
  const pending = gate
  gate = undefined
  if (pending) { pending.entered.resolve(); await pending.release.promise }
  return Response.json({ translations: body.texts.map((text) => `${prefix}${text}`) })
}) as typeof fetch

const source: ArticleBlocksDoc = { version: 1, blocks: [
  { id: 'hero', type: 'hero', width: 'full', anim: 'fade', props: { src: '/uploads/hero.webp', title: 'عنوان هیرو', text: 'متن هیرو' } },
  { id: 'heading', type: 'heading', width: 'md', props: { text: 'عنوان بخش', level: 3 } },
  { id: 'paragraph', type: 'paragraph', anim: 'slide', props: { text: 'متن پاراگراف' } },
  { id: 'image', type: 'image', width: 'sm', props: { src: 'https://cdn.example/one.webp', alt: 'توضیح تصویر', caption: 'زیرنویس تصویر' } },
  { id: 'gallery', type: 'gallery', props: { images: [{ src: '/uploads/gallery-one.webp', alt: 'توضیح اول' }, { src: '/uploads/gallery-two.webp', alt: 'توضیح دوم' }], layout: 'slider' } },
  { id: 'quote', type: 'quote', props: { text: 'متن نقل قول', author: 'نویسنده نقل قول' } },
  { id: 'callout', type: 'callout', style: { bg: '#aBcDeF', fg: '#123456', align: 'center', pad: 'lg' }, props: { title: 'عنوان نکته', text: 'متن نکته' } },
  { id: 'list', type: 'list', props: { items: ['مورد اول', 'مورد دوم', 'مورد سوم'], ordered: true } },
  { id: 'cta', type: 'cta', props: { title: 'عنوان سفارش', text: 'متن سفارش', label: 'دکمه سفارش', to: 'url', href: '/products?from=article' } },
  { id: 'link', type: 'link', props: { title: 'عنوان پیوند', text: 'متن پیوند', label: 'دکمه پیوند', href: 'https://example.com/?q=fa', variant: 'card' } },
  { id: 'location-one', type: 'location', width: 'lg', anim: 'zoom', props: { lat: 37.48220561234, lng: 49.44182739876, title: 'عنوان شعبه اول', address: 'آدرس شعبه اول' } },
  { id: 'location-two', type: 'location', width: 'sm', anim: 'blur', props: { lat: 35.12345678901, lng: 51.98765432109, title: 'عنوان شعبه دوم', address: 'آدرس شعبه دوم' } },
  { id: 'divider', type: 'divider', props: { variant: 'dots' } },
] }
const expected: Array<[string, ArticleBlockTextPath, string]> = [
  ['hero', ['title'], 'عنوان هیرو'], ['hero', ['text'], 'متن هیرو'], ['heading', ['text'], 'عنوان بخش'], ['paragraph', ['text'], 'متن پاراگراف'],
  ['image', ['alt'], 'توضیح تصویر'], ['image', ['caption'], 'زیرنویس تصویر'], ['gallery', ['images', 0, 'alt'], 'توضیح اول'], ['gallery', ['images', 1, 'alt'], 'توضیح دوم'],
  ['quote', ['text'], 'متن نقل قول'], ['quote', ['author'], 'نویسنده نقل قول'], ['callout', ['title'], 'عنوان نکته'], ['callout', ['text'], 'متن نکته'],
  ['list', ['items', 0], 'مورد اول'], ['list', ['items', 1], 'مورد دوم'], ['list', ['items', 2], 'مورد سوم'],
  ['cta', ['title'], 'عنوان سفارش'], ['cta', ['text'], 'متن سفارش'], ['cta', ['label'], 'دکمه سفارش'],
  ['link', ['title'], 'عنوان پیوند'], ['link', ['text'], 'متن پیوند'], ['link', ['label'], 'دکمه پیوند'],
  ['location-one', ['title'], 'عنوان شعبه اول'], ['location-one', ['address'], 'آدرس شعبه اول'], ['location-two', ['title'], 'عنوان شعبه دوم'], ['location-two', ['address'], 'آدرس شعبه دوم'],
]
const text = (doc: ArticleBlocksDoc, id: string, path: ArticleBlockTextPath) => readArticleBlockText(doc.blocks.find((block) => block.id === id), path)
const plainDoc = (doc: ArticleBlocksDoc) => ({ version: doc.version, blocks: doc.blocks })

try {
  await boot.unsafe(`create database "${scratch}"`)
  created = true
  const migration = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], { cwd: `${import.meta.dir}/..`, env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(migration.stdout).text(), new Response(migration.stderr).text(), migration.exited])
  assert.equal(exit, 0, `Scratch migrations failed:\n${stdout}\n${stderr}`)
  database = new Database(testUrl.toString(), { max: 8 })
  const db = database.db
  const cache = new Map<string, unknown>()
  const redis = {
    get: async (key: string) => cache.get(key) ?? null, getJson: async (key: string) => cache.get(key) ?? null,
    setJson: async (key: string, value: unknown) => { cache.set(key, structuredClone(value)) },
    incr: async (key: string) => { const value = Number(cache.get(key) ?? 0) + 1; cache.set(key, value); return value },
  } as unknown as RedisService
  articleService = new ArticleService({ db, redis })
  const service = articleService
  const translator = new TranslationService({ db, articles: service, menu: { bustCache: async () => {} } as unknown as MenuService, config: { translatorUrl: 'http://article-translator.test' } as AppConfig })
  const [category] = await db.insert(articleCategories).values({ name: 'مقالات', nameAr: 'مقالات', slug: 'translation-test' }).returning()
  assert.ok(category)
  const input = { title: 'عنوان مقاله', excerpt: 'خلاصه مقاله', content: 'متن مقاله', categoryId: category.id, blocks: source }
  const { id } = await service.create(input)
  assert.ok(id)
  const beforePreview = (await service.adminDetail(id))!
  const beforeSource = structuredClone(source)
  const preview = await translator.previewBlocks({ blocks: source })
  check(expected.every(([blockId, path, original]) => text(preview, blockId, path) === `عربي ${original}`), 'all twelve types translate every textual field, including list entries, gallery alt text and two locations')
  let expectedDocument = structuredClone(source)
  for (const [blockId, path, original] of expected) expectedDocument = setArticleBlockText(expectedDocument, blockId, path, `عربي ${original}`)
  assert.deepEqual(plainDoc(preview), expectedDocument)
  check(preview.translation?.fields.length === expected.length && expected.every(([blockId, path, original]) =>
    preview.translation?.fields.some(field => field.blockId === blockId && JSON.stringify(field.fieldPath) === JSON.stringify(path)
      && field.sourceText === original && field.status === 'translated')),
    'first-time full preview binds every translated field to its exact Persian source')
  assert.deepEqual(source, beforeSource)
  assert.deepEqual((await service.adminDetail(id))!.blocks, beforePreview.blocks)
  check((await service.adminDetail(id))!.blocksAr === null && (await db.select().from(translationJobs)).length === 0, 'preview preserves exact source structures and coordinates without writing articles or queue jobs')
  assert.deepEqual(payloads.flat(), expected.map(([, , original]) => original))
  check(true, 'only textual values enter translator payloads; IDs, coordinates, URLs and styles never do')
  const manual = setArticleBlockText(normalizeArticleBlocksTranslation(source, null)!, 'hero', ['title'], 'عنوان عربي يدوي')
  payloads.length = 0
  const withManual = await translator.previewBlocks({ blocks: source, blocksAr: manual })
  check(text(withManual, 'hero', ['title']) === 'عنوان عربي يدوي' && !payloads.flat().includes('عنوان هیرو'), 'preview retains manually edited Arabic fields and excludes them from automatic translation')
  payloads.length = 0
  const oneBlock = await translator.previewBlocks({ blocks: source, blocksAr: manual, blockId: 'location-two' })
  assert.deepEqual(payloads.flat(), ['عنوان شعبه دوم', 'آدرس شعبه دوم'])
  check(oneBlock.blocks.length === source.blocks.length && text(oneBlock, 'location-two', ['address']) === 'عربي آدرس شعبه دوم' && text(oneBlock, 'location-one', ['address']) === '' && text(oneBlock, 'hero', ['title']) === 'عنوان عربي يدوي', 'per-block translation targets the selected location while preserving other drafts and every block')
  payloads.length = 0
  const divider = await translator.previewBlocks({ blocks: source, blocksAr: manual, blockId: 'divider' })
  check(payloads.length === 0 && divider.blocks.length === source.blocks.length, 'divider translation keeps structure without contacting the translator')
  await assert.rejects(translator.previewBlocks({ blocks: null }), (error) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  await assert.rejects(translator.previewBlocks({ blocks: source, blockId: 'missing' }), (error) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  check(true, 'invalid documents and missing selected IDs fail with validation errors')
  const sessions = { authenticate: async () => ({ user: { id: crypto.randomUUID(), role: 'admin' }, ctx: {} }) } as unknown as SessionService
  const admin2 = { permissionsOf: async () => ({ articlesRead: true, articlesWrite: true }) } as unknown as Admin2Service
  const app = new Elysia().use(adminTranslateRoutes({ sessions, admin2, translation: translator })).compile()
  const response = await app.handle(new Request('http://localhost/admin/translate/blocks', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin' }, body: JSON.stringify({ blocks: source, blocksAr: manual, blockId: 'location-one' }) }))
  const body = await response.json() as { blocksAr: ArticleBlocksDoc }
  check(response.status === 200 && text(body.blocksAr, 'location-one', ['title']) === 'عربي عنوان شعبه اول' && (await service.adminDetail(id))!.blocksAr === null, 'admin HTTP preview returns reviewable Arabic documents without saving them')

  const postField = (value: unknown) => app.handle(new Request('http://localhost/admin/translate/block-field', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin' }, body: JSON.stringify(value),
  }))
  const selected = { blockId: 'location-two', blockType: 'location' as const, fieldPath: ['title'], text: '  عنوان [پیوند](https://example.com)\nخط دوم  ' }
  payloads.length = 0
  const selectedResponse = await postField(selected)
  assert.equal(selectedResponse.status, 200)
  assert.deepEqual(await selectedResponse.json(), { blockId: selected.blockId, blockType: selected.blockType,
    fieldPath: selected.fieldPath, sourceText: selected.text, translation: `${prefix}${selected.text}`.trim() })
  assert.deepEqual(payloads, [[selected.text]])
  check(true, 'field HTTP preview sends exactly one unchanged source string without adjacent Persian, Arabic or document content')
  const invalidPaths: Array<[ArticleBlockType, ArticleBlockTextPath]> = [
    ['location', ['lat']], ['location', ['lng']], ['hero', ['src']], ['link', ['href']], ['heading', ['level']],
    ['list', ['ordered']], ['paragraph', ['style']], ['paragraph', ['__proto__']], ['paragraph', ['constructor']],
    ['paragraph', ['text', 'extra']], ['divider', ['text']], ['hero', ['images', 0, 'alt']],
    ['list', ['items', -1]], ['list', ['items', 30]], ['list', ['items', 0.5]], ['list', ['items', '1']], ['list', ['items', 0, 'text']],
    ['gallery', ['images', -1, 'alt']], ['gallery', ['images', 12, 'alt']], ['gallery', ['images', 0.5, 'alt']],
    ['gallery', ['images', '0', 'alt']], ['gallery', ['images', 0, 'src']],
  ]
  payloads.length = 0
  for (const [blockType, fieldPath] of invalidPaths) {
    await assert.rejects(translator.previewBlockField({ ...selected, blockType, fieldPath }),
      error => error instanceof AppError && error.code === 'VALIDATION_ERROR')
    const rejected = await postField({ ...selected, blockType, fieldPath })
    assert.ok(rejected.status >= 400 && rejected.status < 500, `Rejected ${blockType} ${JSON.stringify(fieldPath)}`)
  }
  for (const invalid of [{ ...selected, blockType: 'unknown' }, { ...selected, blockType: '__proto__' },
    { ...selected, text: '   ' }, { ...selected, text: 'x'.repeat(30001) }, { ...selected, blockId: '' }]) {
    const rejected = await postField(invalid)
    assert.ok(rejected.status >= 400 && rejected.status < 500)
  }
  assert.deepEqual(payloads, [])
  check(true, 'field service and HTTP reject structural keys, invalid types, nested paths, and list/gallery bounds before translation')
  for (const [blockType, fieldPath] of [['list', ['items', 29]], ['gallery', ['images', 11, 'alt']]] as Array<[ArticleBlockType, ArticleBlockTextPath]>) {
    const accepted = await postField({ ...selected, blockType, fieldPath, text: 'آخرین مورد' })
    assert.equal(accepted.status, 200)
  }
  check(true, 'last valid list and gallery field indexes remain translatable')

  const fieldSource: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'branch', type: 'location', props: { lat: 37.48220561234, lng: 49.44182739876, title: 'نام شعبه', address: 'آدرس شعبه' } },
  ] }
  let fieldArabic = setArticleBlockTranslation(fieldSource, null, 'branch', ['title'], 'اسم الفرع')!
  fieldArabic = setArticleBlockTranslation(fieldSource, fieldArabic, 'branch', ['address'], 'عنوان يدوي')!
  const fieldInput = { ...input, blocks: fieldSource, blocksAr: fieldArabic, titleAr: 'عنوان', excerptAr: 'ملخص', contentAr: 'محتوى' }
  const { id: fieldId } = await service.create(fieldInput)
  assert.ok(fieldId)
  const fieldHold = { entered: deferred(), release: deferred() }
  gate = fieldHold
  const latePreview = translator.previewBlockField({ blockId: 'branch', blockType: 'location', fieldPath: ['title'], text: 'نام شعبه' })
  await fieldHold.entered.promise
  const editedFieldSource = setArticleBlockText(fieldSource, 'branch', ['title'], 'نام جدید شعبه')
  await service.update(fieldId, { ...fieldInput, blocks: editedFieldSource })
  fieldHold.release.resolve()
  const staleField = await latePreview
  const lateArabic = setArticleBlockTranslation(fieldSource, fieldArabic, staleField.blockId, staleField.fieldPath, staleField.translation)!
  await service.update(fieldId, { ...fieldInput, blocks: editedFieldSource, blocksAr: lateArabic })
  const afterLate = (await service.adminDetail(fieldId))!
  check(text(afterLate.blocksAr!, 'branch', ['title']) === '' && text(afterLate.blocksAr!, 'branch', ['address']) === 'عنوان يدوي'
    && getArticleBlockTranslationStatus(afterLate.blocks, afterLate.blocksAr, 'branch', ['title']) === 'needs-retranslation'
    && text((await service.byId(fieldId, 'ar'))!.blocks!, 'branch', ['title']) === 'نام جدید شعبه',
    'late field responses and stale source proofs cannot restore outdated Arabic or disturb an adjacent manual address')
  payloads.length = 0
  await translator.previewBlocks({ blocks: afterLate.blocks, blocksAr: afterLate.blocksAr })
  assert.deepEqual(payloads, [], 'bulk preview preserves stale manually reviewed fields until explicit review')
  const changedField = await translator.previewBlockField({ blockId: 'branch', blockType: 'location', fieldPath: ['title'], text: 'نام جدید شعبه' })
  const changedPreview = setArticleBlockTranslation(editedFieldSource, afterLate.blocksAr, changedField.blockId, changedField.fieldPath, changedField.translation)!
  assert.deepEqual(payloads, [['نام جدید شعبه']])
  check(text(changedPreview, 'branch', ['address']) === 'عنوان يدوي', 'changed-field preview excludes every completed sibling from translator payloads')
  await service.update(fieldId, { ...fieldInput, blocks: editedFieldSource, blocksAr: changedPreview })
  const freshSaved = (await service.adminDetail(fieldId))!
  check(getArticleBlockTranslationStatus(freshSaved.blocks, freshSaved.blocksAr, 'branch', ['title']) === 'translated'
    && freshSaved.blocksAr?.translation?.fields.some(field => field.blockId === 'branch' && field.fieldPath[0] === 'title' && field.sourceText === 'نام جدید شعبه')
    && text(freshSaved.blocksAr!, 'branch', ['address']) === 'عنوان يدوي',
    'fresh source-bound preview metadata survives a save and clears only the changed field status')

  check((await translator.enqueue('article', id)).queued && !(await translator.enqueue('article', id)).queued, 'article jobs deduplicate pending work')
  check(await translator.processNext() === 'done', 'queue worker translates and persists builder documents')
  const queued = (await service.adminDetail(id))!
  assert.deepEqual(queued.blocks, beforePreview.blocks)
  assert.deepEqual(queued.blocksAr, preview)
  check(queued.arAuto === true && queued.contentAr?.includes('عربي متن پاراگراف'), 'queue derives Arabic article text while preserving the original Persian document')
  assert.deepEqual((await service.byId(id, 'ar'))!.blocks, expectedDocument)
  check(true, 'Arabic public detail receives translated documents with exact independent location coordinates')
  const { id: machineId } = await service.create({ ...input, blocksAr: queued.blocksAr, titleAr: 'عنوان مكتمل', excerptAr: 'ملخص مكتمل', contentAr: 'محتوى مكتمل' })
  assert.ok(machineId)
  await db.update(articles).set({ arAuto: true }).where(eq(articles.id, machineId))
  const machineSource = setArticleBlockText(source, 'heading', ['text'], 'فقط تیتر جدید برای صف')
  await service.update(machineId, { ...input, blocks: machineSource })
  await translator.enqueue('article', machineId)
  const beforeMachineField = payloads.length
  check(await translator.processNext() === 'done', 'queue fills a changed field in an otherwise completed machine document')
  check(JSON.stringify(payloads.slice(beforeMachineField).flat()) === JSON.stringify(['فقط تیتر جدید برای صف']),
    'queue sends only the changed block field and does not retranslate completed article titles, excerpts or siblings')
  const savedManual = setArticleBlockTranslation(source, queued.blocksAr!, 'hero', ['title'], 'عنوان نهائي يدوي')!
  const captionSource = setArticleBlockText(source, 'image', ['caption'], 'زیرنویس تازه تصویر')
  await service.update(id, { ...input, blocks: captionSource, blocksAr: savedManual })
  prefix = 'ترجمة جديدة '
  await translator.enqueue('article', id)
  check(await translator.processNext() === 'done', 'worker completes partially translated documents')
  const manualQueued = (await service.adminDetail(id))!
  check(text(manualQueued.blocksAr!, 'hero', ['title']) === 'عنوان نهائي يدوي' && text(manualQueued.blocksAr!, 'image', ['caption']) === 'ترجمة جديدة زیرنویس تازه تصویر' && text(manualQueued.blocksAr!, 'paragraph', ['text']) === 'عربي متن پاراگراف' && manualQueued.arAuto === false, 'worker fills missing fields without replacing reviewed Arabic text or its manual flag')
  const { id: raceId } = await service.create(input)
  assert.ok(raceId)
  const raceBefore = (await service.adminDetail(raceId))!
  const oldArabic = setArticleBlockText(normalizeArticleBlocksTranslation(raceBefore.blocks, null)!, 'hero', ['title'], 'قديم يدوي')
  await service.update(raceId, { ...input, blocksAr: oldArabic })
  await translator.enqueue('article', raceId)
  const hold = { entered: deferred(), release: deferred() }
  gate = hold
  const working = translator.processNext()
  await hold.entered.promise
  const newSource = setArticleBlockText(raceBefore.blocks!, 'paragraph', ['text'], 'متن جدید بعد از درخواست')
  newSource.blocks.reverse()
  const movedLocation = newSource.blocks.find((block) => block.id === 'location-one')!
  assert.equal(movedLocation.type, 'location')
  movedLocation.props.lat = 33.98765432109
  movedLocation.props.lng = 48.12345678901
  let concurrentArabic = setArticleBlockTranslation(newSource, oldArabic, 'heading', ['text'], 'تحرير أثناء الطلب')!
  concurrentArabic = setArticleBlockTranslation(newSource, concurrentArabic, 'hero', ['title'], '')!
  await service.update(raceId, { ...input, title: 'عنوان جدید بعد از درخواست', blocks: newSource, blocksAr: concurrentArabic })
  hold.release.resolve()
  check(await working === 'done', 'in-flight translation completes after a concurrent save')
  const afterRace = (await service.adminDetail(raceId))!
  const racePublic = (await service.byId(raceId, 'ar'))!
  assert.deepEqual(afterRace.blocks, newSource)
  const finalLocation = afterRace.blocksAr!.blocks.find((block) => block.id === 'location-one')!
  assert.equal(finalLocation.type, 'location')
  check(text(afterRace.blocksAr!, 'heading', ['text']) === 'تحرير أثناء الطلب' && text(afterRace.blocksAr!, 'paragraph', ['text']) === '' && text(racePublic.blocks!, 'paragraph', ['text']) === 'متن جدید بعد از درخواست' && afterRace.titleAr === null && text(afterRace.blocksAr!, 'hero', ['title']) === '', 'concurrent manual edits and clears win; stale translations fall back to current Persian')
  check(finalLocation.props.lat === 33.98765432109 && finalLocation.props.lng === 48.12345678901 && afterRace.blocksAr!.blocks.map((block) => block.id).join('|') === newSource.blocks.map((block) => block.id).join('|'), 'late translation preserves newest coordinates and block order')
  check(await translator.processNext() === 'done', 'source changes during a running article job remain eligible for a successor job')
  // Populate scalar fields so missing counts exercise block slots alone.
  await db.update(articles).set({ titleAr: 'عنوان', excerptAr: 'ملخص', contentAr: 'محتوى', blocks: source, blocksAr: expectedDocument }).where(eq(articles.id, raceId))
  let partial = setArticleBlockText(expectedDocument, 'list', ['items', 1], '')
  await db.update(articles).set({ blocksAr: partial }).where(eq(articles.id, id))
  check((await translator.status()).missing.article === 1, 'status detects one missing list entry inside an otherwise complete document')
  check((await translator.enqueueBulkMissing('article')).queued === 1 && (await translator.enqueueBulkMissing('article')).queued === 0, 'bulk includes partial documents and deduplicates pending jobs')
  check(await translator.processNext() === 'done' && (await translator.status()).missing.article === undefined, 'bulk completion clears missing count without retranslating populated fields')
  partial = setArticleBlockText((await service.adminDetail(id))!.blocksAr!, 'gallery', ['images', 1, 'alt'], '')
  await db.update(articles).set({ blocksAr: partial }).where(eq(articles.id, id))
  check((await translator.status()).missing.article === 1, 'status detects missing gallery alt text in a nonnull Arabic document')
  partial = setArticleBlockText(expectedDocument, 'location-two', ['address'], '   ')
  await db.update(articles).set({ blocksAr: partial }).where(eq(articles.id, id))
  check((await translator.status()).missing.article === 1, 'status detects whitespace-only Arabic addresses for individual locations')
  const wrongType = structuredClone(expectedDocument)
  const invalidLocation = wrongType.blocks.find((block) => block.id === 'location-two')!
  Object.assign(invalidLocation, { type: 'callout' })
  await db.update(articles).set({ blocksAr: wrongType }).where(eq(articles.id, id))
  check((await translator.status()).missing.article === 1, 'status matches translations by both stable ID and type')
  check(await translator.processNext() === 'empty', 'preview and status leave no unexpected queue work')
  await db.update(articles).set({ blocksAr: expectedDocument, titleAr: 'عنوان', excerptAr: 'ملخص', contentAr: null, arAuto: false }).where(eq(articles.id, id))
  await translator.enqueue('article', id)
  const beforeCompleteManual = payloads.length
  check(await translator.processNext() === 'done', 'fully reviewed block documents can rebuild missing Arabic article text')
  const completeManual = (await service.adminDetail(id))!
  check(payloads.length === beforeCompleteManual && !!completeManual.contentAr && completeManual.arAuto === false,
    'deriving missing article text needs no translator calls and preserves manually reviewed blocks')
  check((await translator.status()).missing.article === undefined, 'complete manual block documents do not remain stuck in bulk missing counts')
  const blankDraft = setArticleBlockText(normalizeArticleBlocksTranslation(source, null)!, 'hero', ['title'], 'عنوان يدوي باقٍ')
  const { id: clearedFieldId } = await service.create({ ...input, blocksAr: blankDraft, processes: [{ title: 'مراحل', items: ['گام'] }] })
  assert.ok(clearedFieldId)
  await db.update(articles).set({ arAuto: true, titleAr: 'عنوان آلي', excerptAr: 'ملخص آلي', contentAr: 'محتوى آلي', processesAr: [{ title: 'خطوات', items: ['خطوة'] }] }).where(eq(articles.id, clearedFieldId))
  await translator.enqueue('article', clearedFieldId)
  const fieldClearGate = { entered: deferred(), release: deferred() }
  gate = fieldClearGate
  const fieldClearWork = translator.processNext()
  await fieldClearGate.entered.promise
  const beforeFieldClear = (await service.adminDetail(clearedFieldId))!
  const reviewedBlankCaption = setArticleBlockTranslation(source, beforeFieldClear.blocksAr, 'image', ['caption'], '')!
  await service.update(clearedFieldId, { ...input, blocksAr: reviewedBlankCaption, titleAr: null, excerptAr: null, contentAr: null, processesAr: null,
    translationEdits: contentTranslationFields('article', beforeFieldClear).map(field => ({ fieldId: field.fieldId, fieldPath: field.fieldPath,
      sourceText: field.sourceText, revision: field.revision, value: '', origin: 'manual' as const })),
  })
  fieldClearGate.release.resolve()
  check(await fieldClearWork === 'done', 'queued suggestions defer to a concurrent manual save of blank fields')
  const fieldCleared = (await service.adminDetail(clearedFieldId))!
  check(text(fieldCleared.blocksAr!, 'image', ['caption']) === '' && text(fieldCleared.blocksAr!, 'hero', ['title']) === 'عنوان يدوي باقٍ',
    'an intentionally blank Arabic field stays blank even while another Arabic field remains populated')
  assert.deepEqual({ title: fieldCleared.titleAr, excerpt: fieldCleared.excerptAr, content: fieldCleared.contentAr, arAuto: fieldCleared.arAuto },
    { title: null, excerpt: null, content: null, arAuto: false })
  check(fieldCleared.titleAr === null && fieldCleared.excerptAr === null && fieldCleared.contentAr === null
    && fieldCleared.processesAr?.every(process => !process.title && process.items.every(item => !item)) && fieldCleared.arAuto === false,
    'pending machine suggestions cannot restore manually cleared scalar or process translations')
  const { id: clearedId } = await service.create({ ...input, blocksAr: oldArabic })
  assert.ok(clearedId)
  await translator.enqueue('article', clearedId)
  const clearingGate = { entered: deferred(), release: deferred() }
  gate = clearingGate
  const clearingWork = translator.processNext()
  await clearingGate.entered.promise
  await service.update(clearedId, { ...input, blocksAr: null, sourceRevision: contentSourceRevision('article', (await service.adminDetail(clearedId))!) })
  clearingGate.release.resolve()
  check(await clearingWork === 'done', 'queue finishes after an admin explicitly clears the Arabic document')
  const cleared = (await service.adminDetail(clearedId))!
  check(cleared.blocksAr?.translation?.fields.every(field => field.origin === 'manual' && field.status !== 'translated') && cleared.arAuto === false,
    'late queue suggestions cannot repopulate an explicitly cleared Arabic document or change its manual flag')
  assert.deepEqual((await service.byId(clearedId, 'ar'))!.blocks, cleared.blocks)
  const { id: rejectedId } = await service.create(input)
  assert.ok(rejectedId)
  await translator.enqueue('article', rejectedId)
  rejectText = 'متن پاراگراف'
  check(await translator.processNext() === 'failed', 'translator failure leaves work eligible for retry')
  const rejectedArticle = (await service.adminDetail(rejectedId))!
  const rejectedPublic = (await service.byId(rejectedId, 'ar'))!
  const failedBlockState = rejectedArticle.blocksAr?.translation?.fields.find(field => field.blockId === 'paragraph')
  assert(failedBlockState?.error && failedBlockState.error.length <= 500, 'failed block state retains its bounded field-specific error')
  assert(rejectedArticle.blocksAr?.translation?.fields.every(field => field.blockId === 'paragraph' || !field.error), 'unrelated block fields never acquire the failed field error')
  assert.deepEqual(rejectedArticle.blocks, source)
  check(rejectedArticle.blocksAr && text(rejectedArticle.blocksAr, 'paragraph', ['text']) === ''
    && text(rejectedPublic.blocks!, 'paragraph', ['text']) === 'متن پاراگراف'
    && text(rejectedPublic.blocks!, 'hero', ['title']) === `${prefix}عنوان هیرو`
    && rejectedPublic.blocks?.blocks.length === source.blocks.length,
    'one failed block field falls back to Persian while unrelated completed translations remain available')
  await db.update(translationJobs).set({ nextAttemptAt: new Date() }).where(eq(translationJobs.entityId, rejectedId))
  const beforeBlockRetry = payloads.length
  check(await translator.processNext() === 'done', 'a single failed block field is retryable')
  assert.deepEqual(payloads.slice(beforeBlockRetry), [['متن پاراگراف']])
  check(text((await service.adminDetail(rejectedId))!.blocksAr!, 'paragraph', ['text']) === `${prefix}متن پاراگراف`,
    'block retry fills only the failed field without retranslating any completed siblings')
  assert.equal((await service.adminDetail(rejectedId))!.blocksAr?.translation?.fields.find(field => field.blockId === 'paragraph')?.error, undefined,
    'successful retry clears only the failed field error')

  const clearSource: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'clear-heading', type: 'heading', props: { text: 'عنوان پیش از تغییر منبع', level: 2 } },
    { id: 'manual-sibling', type: 'paragraph', props: { text: 'متن فارسی همسایه' } },
  ] }
  let clearArabic = setArticleBlockTranslation(clearSource, null, 'clear-heading', ['text'], 'العنوان المترجم', 'automatic')
  clearArabic = setArticleBlockTranslation(clearSource, clearArabic, 'manual-sibling', ['text'], 'نص يدوي محفوظ', 'manual')
  assert(clearArabic)
  const { id: explicitClearId } = await service.create({ ...input, blocks: clearSource, blocksAr: clearArabic,
    titleAr: 'عنوان المقالة اليدوي', excerptAr: 'ملخص المقالة اليدوي', contentAr: 'محتوى المقالة اليدوي' })
  assert(explicitClearId)
  const beforeExplicitClear = await service.adminDetail(explicitClearId); assert(beforeExplicitClear?.blocksAr)
  const previousHeadingProof = beforeExplicitClear.blocksAr.translation?.fields.find(field => field.blockId === 'clear-heading'); assert(previousHeadingProof)
  const siblingProof = beforeExplicitClear.blocksAr.translation?.fields.find(field => field.blockId === 'manual-sibling'); assert(siblingProof)
  const editedSource = setArticleBlockText(clearSource, 'clear-heading', ['text'], 'عنوان تازه برای حذف صریح ترجمه')
  const rebasedClear = reconcileArticleBlocksTranslation(clearSource, editedSource, beforeExplicitClear.blocksAr)
  const explicitClear = setArticleBlockTranslation(editedSource, rebasedClear, 'clear-heading', ['text'], '', 'manual'); assert(explicitClear)
  const clearProof = explicitClear.translation?.fields.find(field => field.blockId === 'clear-heading'); assert(clearProof)
  // An explicit blank review is a current-source tombstone, rather than an unreviewed invalidation.
  clearProof.status = 'missing'
  assert.equal(clearProof.sourceText, text(editedSource, 'clear-heading', ['text']))
  assert.equal(clearProof.revision, (previousHeadingProof.revision ?? 0) + 2, 'one source change plus one explicit review supplies the exact saved proof')
  await service.update(explicitClearId, { ...input, blocks: editedSource, blocksAr: explicitClear,
    sourceRevision: contentSourceRevision('article', beforeExplicitClear) })
  const savedExplicitClear = await service.adminDetail(explicitClearId); assert(savedExplicitClear?.blocksAr)
  assert.equal(text(savedExplicitClear.blocksAr, 'clear-heading', ['text']), '')
  assert.deepEqual(savedExplicitClear.blocksAr.translation?.fields.find(field => field.blockId === 'clear-heading'), clearProof)
  assert.equal(text(savedExplicitClear.blocksAr, 'manual-sibling', ['text']), 'نص يدوي محفوظ')
  assert.deepEqual(savedExplicitClear.blocksAr.translation?.fields.find(field => field.blockId === 'manual-sibling'), siblingProof)
  check(true, 'changing Persian heading and explicitly reviewing its empty Arabic field persists a current-source manual tombstone without altering manual siblings')
  const beforeExplicitClearWork = payloads.length
  await translator.enqueue('article', explicitClearId)
  assert.equal(await translator.processNext(), 'done')
  assert.equal(payloads.length, beforeExplicitClearWork, 'a manually reviewed blank source-changed field never enters the translator')
  const afterExplicitClearWork = await service.adminDetail(explicitClearId); assert(afterExplicitClearWork?.blocksAr)
  assert.deepEqual(afterExplicitClearWork.blocksAr, savedExplicitClear.blocksAr)
  const publicExplicitClear = await service.byId(explicitClearId, 'ar'); assert(publicExplicitClear?.blocks)
  assert.equal(text(publicExplicitClear.blocks, 'clear-heading', ['text']), text(editedSource, 'clear-heading', ['text']))
  assert.equal(text(publicExplicitClear.blocks, 'manual-sibling', ['text']), 'نص يدوي محفوظ')
  check(true, 'queue work cannot refill an explicitly cleared changed heading and public Arabic falls back only for that field')
  console.log(`\n${checks} Article block translation integration checks passed.`)
} finally {
  globalThis.fetch = originalFetch
  await articleService?.close()
  await database?.close()
  if (created) await boot.unsafe(`drop database "${scratch}" with (force)`)
  await boot.close({ timeout: 5 })
}
