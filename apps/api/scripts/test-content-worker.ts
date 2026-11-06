/** Complete content worker/queue field matrix with deterministic mocks and isolated local PostgreSQL. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { and, eq, getTableColumns } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import type { AnyPgTable } from 'drizzle-orm/pg-core'
import { contentTranslationFields, eligibleContentTranslationFields, reconcileArticleBlocksTranslation, reconcileContentTranslation, setArticleBlockText, setArticleBlockTranslation,
  type ArticleBlocksDoc, type ContentEntityType, type TranslationEdit } from '@sinshin/shared'
import { ContentTranslationWorker } from '../src/domain/translation/content-translation.worker'
import { readContentRow, type ContentRow } from '../src/domain/translation/content-translation.store'
import { TranslationService } from '../src/domain/translation/translation.service'
import { AppError, Err } from '../src/domain/shared/errors'
import { asCategoryId, asProductId } from '../src/domain/shared/brand'
import { Database } from '../src/infra/db/client'
import { products, productSizes, mainCategories, categories, articles, articleCategories, articleSubCategories,
  contentAbout, galleryImages, terms, packagingItems, settings, SETTING_KEYS, translationJobs } from '../src/infra/db/schema'

const url = new URL(process.env.CONTENT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_content_worker_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
url.pathname = `/${scratch}`
let database: Database | undefined
let created = false
let checks = 0
const pass = (name: string) => { checks++; console.log(`PASS ${name}`) }
const originalFetch = globalThis.fetch
const calls: string[][] = []
const invalidations: ContentEntityType[] = []
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const expectTranslatorRequest = async (pending: { entered: ReturnType<typeof deferred> }, work: Promise<unknown>) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([pending.entered.promise, work.then(() => { throw new Error('Work completed without the expected translator request') }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Expected translator request timed out')), 5000) })])
  } finally { clearTimeout(timeout) }
}
let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined
let failText: string | undefined
const translate = async (texts: string[]) => {
  calls.push([...texts])
  assert.equal(texts.length, 1, 'every request contains exactly one source field')
  const pending = gate; gate = undefined
  if (pending) { pending.entered.resolve(); await pending.release.promise }
  if (texts[0] === failText) { failText = undefined; throw new Error('Deterministic field failure') }
  return texts.map(text => `عربي ${text}`)
}
globalThis.fetch = (async (input, init) => {
  assert(String(input).startsWith('http://content-worker.test/'), 'No live translation/network requests')
  if (String(input).endsWith('/health')) return Response.json({ ready: true, model: 'mock' })
  const payload = JSON.parse(String(init?.body)) as { texts: string[]; source: string; target: string }
  assert.deepEqual(Object.keys(payload).sort(), ['source', 'target', 'texts'])
  assert.equal(payload.source, 'pes'); assert.equal(payload.target, 'arb')
  try { return Response.json({ translations: await translate(payload.texts) }) }
  catch (error) {
    if (error instanceof Error && error.message === 'Deterministic field failure') return Response.json({ error: error.message }, { status: 422 })
    throw error
  }
}) as typeof fetch
try {
  await admin.unsafe(`create database "${scratch}"`); created = true
  database = new Database(url.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
  const tables: Partial<Record<ContentEntityType, AnyPgTable>> = { product: products, productSize: productSizes,
    mainCategory: mainCategories, category: categories, article: articles, articleCategory: articleCategories,
    articleSubCategory: articleSubCategories, about: contentAbout, gallery: galleryImages, terms, packagingItem: packagingItems }
  const ids = Object.fromEntries(Object.keys(tables).map(type => [type, type === 'about' ? '1' : crypto.randomUUID()])) as Record<ContentEntityType, string>
  ids.temporaryClose = 'temporaryCloseReason'
  const insert = async (type: ContentEntityType, row: ContentRow) => {
    const table = tables[type]; assert(table)
    const id = type === 'about' ? 1 : ids[type]
    await db.insert(table).values(reconcileContentTranslation(type, ids[type], null, { ...row, id }))
  }
  const mutate = async (type: ContentEntityType, patch: ContentRow, edits: TranslationEdit[] = []) => db.transaction(async tx => {
    const current = await readContentRow(tx, type, ids[type], true); assert(current)
    const next = reconcileContentTranslation(type, ids[type], current, { ...current, ...patch }, edits)
    const table = tables[type]; assert(table)
    const columns = getTableColumns(table)
    assert(columns.id)
    const values = Object.fromEntries(Object.entries(next).filter(([key]) => Object.hasOwn(columns, key)))
    await tx.update(table).set(values).where(eq(columns.id, type === 'about' ? 1 : ids[type]))
  })
  const row = async (type: ContentEntityType) => { const result = await readContentRow(db, type, ids[type]); assert(result); return result }
  const request = async (type: ContentEntityType, sourceText: string) => {
    const field = contentTranslationFields(type, await row(type)).find(field => field.sourceText === sourceText); assert(field)
    return { entityType: type, entityId: ids[type], fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText, revision: field.revision }
  }
  await insert('mainCategory', { name: 'غذاها', slug: 'food', isActive: true })
  await insert('category', { name: 'پیتزاها', slug: 'pizza', mainCategoryId: ids.mainCategory, sizeNames: ['کوچک', 'بزرگ'] })
  await insert('product', { name: 'پیتزای مخصوص', description: 'توضیح غذا', ingredients: ['پنیر', 'قارچ'], categoryId: ids.category, profileImage: '/pizza.webp' })
  await insert('productSize', { name: 'سایز کوچک', productId: ids.product, price: 100, image: '/size.webp', sortOrder: 0 })
  await insert('articleCategory', { name: 'مقاله‌های غذا', slug: 'articles' })
  await insert('articleSubCategory', { name: 'دانستنی‌ها', slug: 'facts', categoryId: ids.articleCategory })
  await insert('article', { title: 'عنوان مقاله', excerpt: 'خلاصه مقاله', content: 'متن مقاله', categoryId: ids.articleCategory,
    processes: [{ title: 'آماده‌سازی', items: ['گام اول', 'گام دوم'] }] })
  const blocks: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'heading', type: 'heading', width: 'md', anim: 'fade', style: { bg: '#123456' }, props: { text: 'داستان ما', level: 2 } },
    { id: 'list', type: 'list', props: { items: ['عضو اول', 'عضو دوم'] } },
    { id: 'gallery', type: 'gallery', props: { images: [{ src: '/gallery.webp', alt: 'توضیح عکس' }], layout: 'grid' } },
    { id: 'branch-one', type: 'location', props: { title: 'شعبه اول', address: 'نشانی اول', lat: 37.4822056789, lng: 49.4418273456 } },
    { id: 'branch-two', type: 'location', props: { title: 'شعبه دوم', address: 'نشانی دوم', lat: 35.123456789, lng: 51.987654321 } },
  ] }
  await insert('about', { heroTitle: 'درباره ما', heroText: 'متن داستان', heroGradient: '/hero.webp', teamTitle: 'تیم ما', teamAlt: 'تصویر تیم', teamGradient: '/team.webp',
    blocks, blocksAr: null, location: { address: 'نشانی رستوران', lat: 37.4822056789, lng: 49.4418273456 } })
  await insert('gallery', { src: '/gallery-one.webp', alt: 'تصویر سالن', span: 'wide' })
  await insert('terms', { version: 1, sections: [{ title: 'خرید غذا', items: ['قانون اول', 'قانون دوم'] }, { title: 'ارسال غذا', items: ['قانون سوم'] }] })
  await insert('packagingItem', { title: 'ظرف غذا', price: 100 })
  const close = reconcileContentTranslation('temporaryClose', ids.temporaryClose, null, { reason: 'تعمیر ضروری آشپزخانه رستوران', reasonAr: null })
  await db.insert(settings).values([{ key: SETTING_KEYS.temporaryCloseReason, value: close.reason, translationState: close.translationState }, { key: SETTING_KEYS.temporaryCloseReasonAr, value: '' }])
  const worker = new ContentTranslationWorker({ db, translate, invalidate: async type => { invalidations.push(type) } })
  for (const type of [...Object.keys(tables), 'temporaryClose'] as ContentEntityType[]) {
    const before = await row(type)
    const expected = eligibleContentTranslationFields(type, before).map(field => field.sourceText)
    if (type === 'about') expected.push(...worker.blockFields(before).map(field => field.text))
    const start = calls.length
    await worker.run(type, ids[type])
    assert.deepEqual(calls.slice(start).flat(), expected, `initial ${type} translates only whitelisted source fields in deterministic order`)
    assert(!worker.hasEligibleFields(type, await row(type)), `${type} has no completed fields remaining in missing work`)
    const end = calls.length
    await worker.run(type, ids[type]); assert.equal(calls.length, end, `completed ${type} fields never retransmit`)
    pass(`initial/completed ${type} work uses exact individual fields`)
  }
  assert(calls.flat().every(text => !text.includes('.webp') && !text.includes('37.482') && !text.includes('#123456')))
  assert.deepEqual((await row('about')).blocks, blocks)
  assert.deepEqual(((await row('about')).blocksAr as ArticleBlocksDoc).blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]),
    blocks.blocks.map(block => [block.id, block.type, block.width, block.anim, block.style]))
  pass('all About block requests exclude structures, URLs and exact coordinates and preserve source documents')
  const changes: Array<[ContentEntityType, ContentRow, string]> = [
    ['product', { name: 'نام محصول تازه' }, 'نام محصول تازه'], ['product', { description: 'توضیح تازه' }, 'توضیح تازه'],
    ['product', { ingredients: ['پنیر', 'قارچ تازه'] }, 'قارچ تازه'], ['productSize', { name: 'نام سایز تازه' }, 'نام سایز تازه'],
    ['mainCategory', { name: 'غذاهای تازه' }, 'غذاهای تازه'], ['category', { name: 'دسته تازه' }, 'دسته تازه'],
    ['category', { sizeNames: ['کوچک', 'بزرگ تازه'] }, 'بزرگ تازه'], ['articleCategory', { name: 'مقالات تازه' }, 'مقالات تازه'],
    ['articleSubCategory', { name: 'دانستنی تازه' }, 'دانستنی تازه'], ['article', { excerpt: 'خلاصه تازه' }, 'خلاصه تازه'],
    ['article', { processes: [{ title: 'آماده‌سازی', items: ['گام اول', 'گام تازه'] }] }, 'گام تازه'],
    ['about', { heroTitle: 'عنوان درباره تازه' }, 'عنوان درباره تازه'], ['about', { heroText: 'متن درباره تازه' }, 'متن درباره تازه'],
    ['about', { location: { address: 'نشانی رستوران تازه', lat: 37.4822056789, lng: 49.4418273456 } }, 'نشانی رستوران تازه'],
    ['gallery', { alt: 'تصویر سالن تازه' }, 'تصویر سالن تازه'],
    ['terms', { sections: [{ title: 'خرید غذا', items: ['قانون اول', 'قانون تازه'] }, { title: 'ارسال غذا', items: ['قانون سوم'] }] }, 'قانون تازه'],
    ['packagingItem', { title: 'ظرف غذای تازه' }, 'ظرف غذای تازه'],
  ]
  for (const [type, patch, text] of changes) {
    await mutate(type, patch)
    const start = calls.length
    await worker.run(type, ids[type])
    assert.deepEqual(calls.slice(start), [[text]], `a changed ${type} field sends no sibling or article text`)
  }
  pass('one changed field across products, sizes, templates, articles, About, gallery, terms and packaging sends one text')
  for (const [blockId, path, text] of [['heading', ['text'], 'عنوان بلوک تازه'], ['list', ['items', 1], 'عضو فهرست تازه'],
    ['branch-one', ['address'], 'نشانی بلوک تازه']] as const) {
    const current = await row('about'), previous = current.blocks as ArticleBlocksDoc
    const changed = setArticleBlockText(previous, blockId, [...path], text)
    await mutate('about', { blocks: changed, blocksAr: reconcileArticleBlocksTranslation(previous, changed, current.blocksAr) })
    const start = calls.length; await worker.run('about', ids.about)
    assert.deepEqual(calls.slice(start), [[text]])
    assert.deepEqual((await row('about')).blocks, changed)
  }
  pass('About heading, nested list item and location address changes each translate exactly their one field')
  const productBeforeReorder = await row('product')
  await mutate('product', { ingredients: ['قارچ تازه', 'پنیر'] })
  const reorderedProduct = await row('product')
  assert.deepEqual(reorderedProduct.ingredientsAr, (productBeforeReorder.ingredientsAr as string[]).toReversed())
  const nonTextStart = calls.length
  await mutate('productSize', { price: 200, discountPercentage: 10, image: '/new-size.webp', sortOrder: 2 })
  await mutate('about', { location: { address: 'نشانی رستوران تازه', lat: 36.987654321, lng: 50.123456789 } })
  await mutate('gallery', { src: '/new-gallery.webp', sortOrder: 8 })
  await worker.run('product', ids.product); await worker.run('productSize', ids.productSize); await worker.run('about', ids.about); await worker.run('gallery', ids.gallery)
  assert.equal(calls.length, nonTextStart)
  pass('reordering ingredients and editing prices/images/coordinates never invalidates text or retransmits fields')
  await mutate('product', { description: 'توضیح برای پیش‌نمایش' })
  const previewInput = await request('product', 'توضیح برای پیش‌نمایش')
  const hold = { entered: deferred(), release: deferred() }; gate = hold
  const firstPreview = worker.previewField(previewInput)
  await hold.entered.promise
  const secondPreview = worker.previewField(previewInput)
  await new Promise(resolve => setTimeout(resolve, 20))
  const previewStart = calls.length
  hold.release.resolve()
  assert.deepEqual(await firstPreview, await secondPreview)
  assert.equal(calls.length, previewStart, 'simultaneous same-field/revision previews deduplicate translator calls')
  const invalidStart = calls.length
  await assert.rejects(worker.previewField({ ...previewInput, fieldId: 'profileImage', fieldPath: ['profileImage'] }), AppError)
  await assert.rejects(worker.previewField({ ...previewInput, sourceText: 'untrusted source' }), AppError)
  assert.equal(calls.length, invalidStart)
  pass('duplicate field previews deduplicate, and structural paths or stale source text fail before translator calls')
  const productCurrent = await row('product')
  const nameField = contentTranslationFields('product', productCurrent).find(field => field.fieldId === 'name'); assert(nameField)
  await mutate('product', {}, [{ fieldId: nameField.fieldId, fieldPath: nameField.fieldPath, sourceText: nameField.sourceText,
    revision: nameField.revision, value: 'اسم عربي يدوي', origin: 'manual' }])
  await mutate('product', { description: 'توضیح دوم تازه' })
  const manualStart = calls.length; await worker.run('product', ids.product)
  assert.deepEqual(calls.slice(manualStart), [['توضیح دوم تازه']])
  assert.equal((await row('product')).nameAr, 'اسم عربي يدوي')
  await mutate('product', { name: 'نام دستی فارسی تازه' })
  const manualStaleStart = calls.length; await worker.run('product', ids.product)
  assert.equal(calls.length, manualStaleStart)
  assert.equal(contentTranslationFields('product', await row('product')).find(field => field.fieldId === 'name')?.staleValue, 'اسم عربي يدوي')
  pass('manual fields never block siblings or get automatically overwritten when their own source changes')
  await mutate('product', { description: 'منبع درخواست کند' })
  const raceGate = { entered: deferred(), release: deferred() }; gate = raceGate
  const raceStart = calls.length; const work = worker.run('product', ids.product)
  await raceGate.entered.promise
  await mutate('product', { description: 'منبع جدید هنگام درخواست' })
  raceGate.release.resolve(); await work
  assert.equal((await row('product')).descriptionAr, null)
  await worker.run('product', ids.product)
  assert.deepEqual(calls.slice(raceStart), [['منبع درخواست کند'], ['منبع جدید هنگام درخواست']])
  pass('late worker responses are discarded and only the latest version of that field is retried')
  await mutate('product', { description: 'منبع ویرایش دستی همزمان' })
  const manualGate = { entered: deferred(), release: deferred() }; gate = manualGate
  const manualWork = worker.run('product', ids.product); await manualGate.entered.promise
  const pendingProduct = await row('product'), descriptionField = contentTranslationFields('product', pendingProduct).find(field => field.fieldId === 'description'); assert(descriptionField)
  await mutate('product', {}, [{ fieldId: descriptionField.fieldId, fieldPath: descriptionField.fieldPath, sourceText: descriptionField.sourceText,
    revision: descriptionField.revision, value: 'وصف يدوي أحدث', origin: 'manual' }])
  manualGate.release.resolve(); await manualWork
  assert.equal((await row('product')).descriptionAr, 'وصف يدوي أحدث')
  pass('a newer manual edit wins over an in-flight automatic response')
  await mutate('product', { ingredients: ['قارچ تازه', 'پنیر هنگام جابه‌جایی'] })
  const reorderGate = { entered: deferred(), release: deferred() }; gate = reorderGate
  const reorderStart = calls.length
  const reorderingWork = worker.run('product', ids.product); await reorderGate.entered.promise
  await mutate('product', { ingredients: ['پنیر هنگام جابه‌جایی', 'قارچ تازه'] })
  reorderGate.release.resolve(); await reorderingWork
  assert.deepEqual(calls.slice(reorderStart), [['پنیر هنگام جابه‌جایی']])
  assert.deepEqual((await row('product')).ingredientsAr, ['عربي پنیر هنگام جابه‌جایی', 'عربي قارچ تازه'])
  pass('an in-flight ingredient result follows its stable identity to the latest field path with one translator call')
  await mutate('terms', { sections: [{ title: 'خرید غذا', items: ['قانون شکست', 'قانون تازه'] }, { title: 'ارسال غذا', items: ['قانون سوم'] }] })
  failText = 'قانون شکست'
  await assert.rejects(worker.run('terms', ids.terms), /Deterministic field failure/)
  assert.equal(contentTranslationFields('terms', await row('terms')).find(field => field.sourceText === 'قانون شکست')?.error, 'Deterministic field failure')
  const retryStart = calls.length; await worker.run('terms', ids.terms)
  assert.deepEqual(calls.slice(retryStart), [['قانون شکست']])
  pass('single-field failures persist their status and retry only the failed item')
  const queue = new TranslationService({ db, config: { translatorUrl: 'http://content-worker.test' } as never,
    menu: { bustCache: async () => { invalidations.push('product') } } as never,
    articles: { bustCache: async () => { invalidations.push('article') } } as never })
  assert.equal((await queue.enqueueBulkMissing()).queued, 0, 'bulk skips every completed/manual/pending-review field')
  await mutate('gallery', { alt: 'متن جدید برای صف' })
  const queuedStart = calls.length
  assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, true)
  assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, false)
  assert.equal(await queue.processNext(), 'done')
  assert.deepEqual(calls.slice(queuedStart), [['متن جدید برای صف']])
  await mutate('gallery', { alt: 'متن جدید پس از صف کامل' })
  assert.equal((await queue.enqueueBulkMissing('gallery')).queued, 1)
  assert.equal(await queue.processNext(), 'done')
  assert.equal((await queue.enqueueBulkMissing('gallery')).queued, 0)
  assert.equal((await db.select().from(translationJobs).where(eq(translationJobs.status, 'done'))).length, 2)
  pass('entity queue deduplication and completed-job requeue translate only newly eligible fields')
  await mutate('gallery', { alt: 'منبع صف در حال اجرا' })
  await queue.enqueue('gallery', ids.gallery)
  const queueHold = { entered: deferred(), release: deferred() }; gate = queueHold
  const successorStart = calls.length
  const running = queue.processNext(); await queueHold.entered.promise
  await mutate('gallery', { alt: 'منبع تازه صف در حال اجرا' })
  assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, true)
  assert.equal(await queue.processNext(), 'empty', 'a pending successor cannot run beside the same entity')
  queueHold.release.resolve(); assert.equal(await running, 'done')
  assert.equal((await row('gallery')).altAr, null)
  assert.equal(await queue.processNext(), 'done')
  assert.deepEqual(calls.slice(successorStart), [['منبع صف در حال اجرا'], ['منبع تازه صف در حال اجرا']])
  pass('a pending successor safely translates the latest source after a running job discards its stale response')
  await mutate('gallery', { alt: 'منبع صف شکست خورده' })
  await queue.enqueue('gallery', ids.gallery)
  failText = 'منبع صف شکست خورده'
  const failingHold = { entered: deferred(), release: deferred() }; gate = failingHold
  const failing = queue.processNext(); await failingHold.entered.promise
  await mutate('gallery', { alt: 'منبع جانشین پس از شکست' })
  assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, true)
  failingHold.release.resolve(); assert.equal(await failing, 'failed')
  assert.equal(await queue.processNext(), 'done')
  assert.equal((await row('gallery')).altAr, 'عربي منبع جانشین پس از شکست')
  pass('a failed running job cannot suppress or collide with an already pending changed-source successor')
  await mutate('product', { ingredients: ['پنیر هنگام جابه‌جایی', 'قارچ تازه صف'] })
  await mutate('productSize', { name: 'سایز تازه صف' })
  const sizeBulkStart = calls.length
  assert.equal((await queue.enqueueBulkMissing()).queued, 2)
  while (await queue.processNext() !== 'empty') { /* Drain the explicitly queued fixtures. */ }
  assert.deepEqual(calls.slice(sizeBulkStart).flat().sort(), ['قارچ تازه صف', 'سایز تازه صف'].sort())
  pass('bulk product and stable size jobs translate each field once without duplicate sibling-size requests')
  const storedArticleBlocks: ArticleBlocksDoc = { version: 1, blocks: [{ id: 'saved-heading', type: 'heading', props: { text: 'عنوان ذخیره‌شده', level: 2 } }] }
  await mutate('article', { blocks: storedArticleBlocks, blocksAr: null })
  const storedArticleInput = { entityType: 'article' as const, entityId: ids.article, blockId: 'saved-heading', blockType: 'heading' as const,
    fieldPath: ['text'], text: 'عنوان ذخیره‌شده', revision: 0 }
  const storedStart = calls.length
  assert.equal((await queue.previewBlockField(storedArticleInput)).translation, 'عربي عنوان ذخیره‌شده')
  assert.deepEqual(calls.slice(storedStart), [['عنوان ذخیره‌شده']])
  assert.equal((await row('article')).blocksAr, null, 'saved-source previews never persist an unreviewed suggestion')
  const savedAbout = await row('about'), savedAboutSource = savedAbout.blocks as ArticleBlocksDoc
  const aboutPreviewSource = setArticleBlockText(savedAboutSource, 'heading', ['text'], 'تیتر ذخیره‌شده درباره')
  const aboutPreviewArabic = reconcileArticleBlocksTranslation(savedAboutSource, aboutPreviewSource, savedAbout.blocksAr)
  await mutate('about', { blocks: aboutPreviewSource, blocksAr: aboutPreviewArabic })
  const storedAboutInput = { entityType: 'about' as const, entityId: '1', blockId: 'heading', blockType: 'heading' as const, fieldPath: ['text'],
    text: 'تیتر ذخیره‌شده درباره', revision: aboutPreviewArabic?.translation?.fields.find(field => field.blockId === 'heading')?.revision ?? 0 }
  const aboutPreviewStart = calls.length
  assert.equal((await queue.previewBlockField(storedAboutInput)).translation, 'عربي تیتر ذخیره‌شده درباره')
  assert.deepEqual(calls.slice(aboutPreviewStart), [['تیتر ذخیره‌شده درباره']])
  pass('stored article and About block previews validate entity/source/revision and send only one field without saving')
  const badStoredStart = calls.length
  await assert.rejects(queue.previewBlockField({ ...storedArticleInput, text: 'منبع قدیمی' }), AppError)
  await assert.rejects(queue.previewBlockField({ ...storedArticleInput, entityId: 'invalid-id' }), AppError)
  await assert.rejects(queue.previewBlockField({ ...storedAboutInput, entityId: 'wrong-singleton' }), AppError)
  await assert.rejects(queue.previewBlockField({ ...storedArticleInput, blockId: 'foreign' }), AppError)
  assert.equal(calls.length, badStoredStart)
  pass('stored block previews reject stale source and invalid entity/block identities before translator calls')
  const storedManualGate = { entered: deferred(), release: deferred() }; gate = storedManualGate
  const storedManualWork = queue.previewBlockField(storedArticleInput); await storedManualGate.entered.promise
  const manuallyReviewedBlocks = setArticleBlockTranslation(storedArticleBlocks, null, 'saved-heading', ['text'], 'عنوان عربي راجعه المحرر'); assert(manuallyReviewedBlocks)
  await mutate('article', { blocksAr: manuallyReviewedBlocks })
  storedManualGate.release.resolve()
  await assert.rejects(storedManualWork, AppError)
  assert.equal(((await row('article')).blocksAr as ArticleBlocksDoc).blocks[0]?.type, 'heading')
  const completedStoredStart = calls.length
  const reviewedRevision = manuallyReviewedBlocks.translation?.fields.find(field => field.blockId === 'saved-heading')?.revision ?? 0
  assert.equal((await queue.previewBlockField({ ...storedArticleInput, revision: reviewedRevision })).translation, 'عنوان عربي راجعه المحرر')
  assert.equal(calls.length, completedStoredStart)
  pass('late stored-block previews reject a newer manual revision and completed reviewed fields never retransmit')

  await mutate('mainCategory', { name: 'متن تازه برای شناسه یکسان' })
  const uuidInput = await request('mainCategory', 'متن تازه برای شناسه یکسان')
  const uuidGate = { entered: deferred(), release: deferred() }; gate = uuidGate
  const uuidStart = calls.length
  const lowerPreview = worker.previewField(uuidInput)
  let upperPreview: ReturnType<ContentTranslationWorker['previewField']> | undefined
  try {
    await expectTranslatorRequest(uuidGate, lowerPreview)
    upperPreview = worker.previewField({ ...uuidInput, entityId: uuidInput.entityId.toUpperCase() })
    void upperPreview.catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(calls.length, uuidStart + 1)
  } finally {
    uuidGate.release.resolve()
    await Promise.allSettled([lowerPreview, ...(upperPreview ? [upperPreview] : [])])
  }
  assert(upperPreview)
  assert.equal((await lowerPreview).value, (await upperPreview).value)
  assert.deepEqual(calls.slice(uuidStart), [[uuidInput.sourceText]])
  pass('uppercase and lowercase UUID field previews share exactly one in-flight translation')

  const leaseId = crypto.randomUUID()
  const leaseName = 'نام محصول برای آزمون اجاره صف'
  const leaseDescription = 'توضیح محصول برای آزمون اجاره صف'
  await db.insert(products).values(reconcileContentTranslation('product', leaseId, null, {
    id: asProductId(leaseId), name: leaseName, description: leaseDescription, ingredients: [], categoryId: asCategoryId(ids.category), profileImage: '/lease.webp',
  }))
  assert.equal((await queue.enqueue('product', leaseId.toUpperCase())).queued, true)
  assert.equal((await queue.enqueue('product', leaseId)).queued, false)
  const leaseStart = calls.length
  const oldGate = { entered: deferred(), release: deferred() }; gate = oldGate
  const oldAttempt = queue.processNext()
  const restartGate = { entered: deferred(), release: deferred() }
  let restartedAttempt: ReturnType<TranslationService['processNext']> | undefined
  try {
    await expectTranslatorRequest(oldGate, oldAttempt)
    const [claimed] = await db.select().from(translationJobs).where(and(eq(translationJobs.entityType, 'product'),
      eq(translationJobs.entityId, leaseId), eq(translationJobs.status, 'running')))
    assert(claimed?.startedAt)
    const expiredAt = new Date(Date.now() - 60_000)
    await db.update(translationJobs).set({ startedAt: expiredAt, nextAttemptAt: new Date() }).where(eq(translationJobs.id, claimed.id))
    assert.equal(await queue.reapStuck(1000), 0, 'an old start with a fresh heartbeat retains its lease')
    pass('queue reaping preserves a long-running attempt with a fresh heartbeat')

    await db.update(translationJobs).set({ nextAttemptAt: expiredAt }).where(eq(translationJobs.id, claimed.id))
    const [staleSelection] = await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id))
    assert(staleSelection?.startedAt)
    const cutoff = new Date(Date.now() - 1000)
    await db.update(translationJobs).set({ nextAttemptAt: new Date() }).where(eq(translationJobs.id, claimed.id))
    const reaper = queue as unknown as { returnToPending: (job: { id: string; entityType: ContentEntityType; entityId: string;
      attempts: number; maxAttempts: number; startedAt: Date }, patch: { nextAttemptAt: Date; lastError: string }, staleBefore: Date) => Promise<boolean> }
    assert.equal(await reaper.returnToPending({ ...staleSelection, startedAt: staleSelection.startedAt, entityType: 'product' },
      { nextAttemptAt: new Date(), lastError: 'Test stale selection' }, cutoff), false)
    assert.equal((await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id)))[0]?.status, 'running')
    pass('a heartbeat renewed after reaper selection is protected by the atomic update condition')

    await db.update(translationJobs).set({ nextAttemptAt: expiredAt }).where(eq(translationJobs.id, claimed.id))
    assert.equal(await queue.reapStuck(1000), 1, 'only an old start and old heartbeat are reaped')
    assert.equal((await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id)))[0]?.status, 'pending')
    const restartedQueue = new TranslationService({ db, config: { translatorUrl: 'http://content-worker.test' } as never,
      menu: { bustCache: async () => { invalidations.push('product') } } as never,
      articles: { bustCache: async () => { invalidations.push('article') } } as never })
    gate = restartGate
    restartedAttempt = restartedQueue.processNext(); await expectTranslatorRequest(restartGate, restartedAttempt)
    const [restarted] = await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id))
    assert(restarted?.startedAt)
    assert.notEqual(restarted.startedAt.getTime(), claimed.startedAt.getTime())
    oldGate.release.resolve(); assert.equal(await oldAttempt, 'done')
    const [stillRunning] = await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id))
    assert.equal(stillRunning?.status, 'running', 'an old completion cannot finish the replacement attempt')
    assert.equal(stillRunning?.startedAt?.getTime(), restarted.startedAt.getTime())
    const untouched = await readContentRow(db, 'product', leaseId); assert(untouched)
    assert.equal(untouched.nameAr, null); assert.equal(untouched.descriptionAr, null)
    assert.deepEqual(calls.slice(leaseStart), [[leaseName], [leaseName]], 'the lost attempt sends no sibling and saves no late result')
    restartGate.release.resolve(); assert.equal(await restartedAttempt, 'done')
    const translatedLease = await readContentRow(db, 'product', leaseId); assert(translatedLease)
    assert(String(translatedLease.nameAr).endsWith(leaseName)); assert(String(translatedLease.descriptionAr).endsWith(leaseDescription))
    assert.deepEqual(calls.slice(leaseStart), [[leaseName], [leaseName], [leaseDescription]])
    assert.equal((await db.select().from(translationJobs).where(eq(translationJobs.id, claimed.id)))[0]?.status, 'done')
    pass('reaped attempts discard late responses and sibling work while the restarted attempt completes with its own token')
  } finally {
    oldGate.release.resolve(); restartGate.release.resolve()
    await Promise.allSettled([oldAttempt, ...(restartedAttempt ? [restartedAttempt] : [])])
  }

  await mutate('gallery', { alt: 'متن صف قدیمی با شناسه حروف بزرگ' })
  await db.insert(translationJobs).values({ entityType: 'gallery', entityId: ids.gallery.toUpperCase() })
  assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, false, 'legacy uppercase pending jobs deduplicate')
  const legacyPending = await db.select().from(translationJobs).where(eq(translationJobs.status, 'pending'))
  assert.equal((await queue.enqueueBulkMissing('gallery')).queued, 0)
  assert.deepEqual(await db.select().from(translationJobs).where(eq(translationJobs.status, 'pending')), legacyPending)
  pass('bulk missing translation preserves legacy uppercase pending jobs without adding duplicate work')
  failText = 'متن صف قدیمی با شناسه حروف بزرگ'
  const legacyGate = { entered: deferred(), release: deferred() }; gate = legacyGate
  const legacyStart = calls.length
  const legacyAttempt = queue.processNext()
  try {
    await expectTranslatorRequest(legacyGate, legacyAttempt)
    await mutate('gallery', { alt: 'متن جانشین شناسه یکسان' })
    assert.equal((await queue.enqueue('gallery', ids.gallery)).queued, true)
    assert.equal(await queue.processNext(), 'empty', 'lowercase successors cannot run beside legacy uppercase jobs')
  } finally { legacyGate.release.resolve() }
  assert.equal(await legacyAttempt, 'failed')
  assert.equal(await queue.processNext(), 'done')
  assert.deepEqual(calls.slice(legacyStart), [['متن صف قدیمی با شناسه حروف بزرگ'], ['متن جانشین شناسه یکسان']])
  assert(String((await row('gallery')).altAr).endsWith('متن جانشین شناسه یکسان'))
  pass('legacy uppercase queue IDs deduplicate, serialize claims and preserve lowercase changed-source successors on failure')

  const outageId = crypto.randomUUID()
  await db.insert(products).values(reconcileContentTranslation('product', outageId, null, {
    id: asProductId(outageId), name: 'نام هنگام قطع مترجم', description: 'توضیح هنگام قطع مترجم', ingredients: ['ماده هنگام قطع مترجم'],
    categoryId: asCategoryId(ids.category), profileImage: '/outage.webp',
  }))
  const outageCalls: string[][] = []
  const outageWorker = new ContentTranslationWorker({ db, translate: async texts => { outageCalls.push([...texts]); throw Err.serviceUnavailable('Mock translator offline') },
    invalidate: async () => { assert.fail('failed translation cannot invalidate a persisted content value') } })
  await assert.rejects(outageWorker.run('product', outageId), error => error instanceof AppError && error.code === 'SERVICE_UNAVAILABLE')
  assert.deepEqual(outageCalls, [['نام هنگام قطع مترجم']])
  const outageFields = contentTranslationFields('product', await readContentRow(db, 'product', outageId))
  assert.equal(outageFields.find(field => field.fieldId === 'name')?.error, 'Mock translator offline')
  assert(outageFields.filter(field => field.fieldId !== 'name').every(field => !field.error && field.value === null))
  pass('translator outages stop after exactly one field and never request or mark unattempted siblings as failed')

  await mutate('packagingItem', { title: 'عنوان برای نتیجه بیش از حد' })
  const oversizedInput = await request('packagingItem', 'عنوان برای نتیجه بیش از حد')
  const oversizedField = contentTranslationFields('packagingItem', await row('packagingItem')).find(field => field.fieldId === oversizedInput.fieldId); assert(oversizedField)
  const oversizedCalls: string[][] = []
  const oversizedWorker = new ContentTranslationWorker({ db, translate: async texts => { oversizedCalls.push([...texts]); return ['ا'.repeat(oversizedField.maxLength + 1)] },
    invalidate: async () => { assert.fail('oversized output must never be saved') } })
  await assert.rejects(oversizedWorker.previewField(oversizedInput), /translation exceeds/)
  await assert.rejects(oversizedWorker.run('packagingItem', ids.packagingItem), /translation exceeds/)
  assert.deepEqual(oversizedCalls, [[oversizedInput.sourceText], [oversizedInput.sourceText]])
  const oversizedSaved = contentTranslationFields('packagingItem', await row('packagingItem')).find(field => field.fieldId === oversizedInput.fieldId)
  assert.equal(oversizedSaved?.value, null)
  assert.match(oversizedSaved?.error ?? '', /translation exceeds/)
  pass('oversized Arabic output rejects in previews and workers without truncating or persisting content')

  const longSource = 'م'.repeat(40_000)
  await mutate('article', { content: longSource })
  const longInput = await request('article', longSource)
  const longStart = calls.length
  const longResult = await queue.previewField(longInput)
  assert(longResult.value.endsWith(longSource))
  assert.deepEqual(calls.slice(longStart), [[longSource]])
  assert.equal((await row('article')).contentAr, null, 'large targeted previews remain reviewable without persistence')
  pass('targeted article text beyond thirty thousand characters sends exactly its one source field')

  const jobsBeforeInvalid = await db.select().from(translationJobs)
  const invalidEnqueueStart = calls.length
  await assert.rejects(queue.enqueue('product', 'invalid-product-id'), AppError)
  await assert.rejects(queue.enqueue('gallery', crypto.randomUUID()), AppError)
  await assert.rejects(queue.enqueue('temporaryClose', 'wrong-singleton'), AppError)
  assert.deepEqual(await db.select().from(translationJobs), jobsBeforeInvalid)
  assert.equal(calls.length, invalidEnqueueStart)
  pass('invalid and unknown queued entity IDs create no jobs and send no translator requests')

  const oversizedPreviewStart = calls.length
  await assert.rejects(queue.preview(['م'.repeat(500_001), 'ن'.repeat(500_000)]), /total translation payload limit/)
  assert.equal(calls.length, oversizedPreviewStart)
  pass('bulk previews reject an oversized combined payload before contacting the translator')

  const obsoleteSource = 'بند نسخه قبلی پیش از اجرای صف'
  const latestSource = 'بند نسخه جدید قوانین'
  const existingTerms = await row('terms')
  const oldSections = structuredClone(existingTerms.sections) as Array<{ title: string; items: string[] }>
  assert(oldSections[0]?.items[0])
  oldSections[0].items[0] = obsoleteSource
  await mutate('terms', { sections: oldSections })
  assert.equal((await queue.enqueue('terms', ids.terms)).queued, true)
  const [historicalTerms] = await db.select().from(terms).where(eq(terms.id, ids.terms)); assert(historicalTerms)
  assert(worker.hasEligibleFields('terms', historicalTerms))
  const latestTermsId = crypto.randomUUID()
  const latestSections = structuredClone(historicalTerms.sections)
  assert(latestSections[0]?.items[0]); latestSections[0].items[0] = latestSource
  await db.insert(terms).values(reconcileContentTranslation('terms', latestTermsId, historicalTerms, {
    ...historicalTerms, id: latestTermsId, version: historicalTerms.version + 1, sections: latestSections,
  }))
  const obsoleteStart = calls.length
  assert.equal(await queue.processNext(), 'done')
  assert.equal(calls.length, obsoleteStart, 'obsolete queued terms never enter the translator')
  assert.deepEqual((await db.select().from(terms).where(eq(terms.id, historicalTerms.id)))[0], historicalTerms)
  assert.equal(await readContentRow(db, 'terms', historicalTerms.id), null, 'historical versions are excluded from mutable translation reads')
  const latestTermsRow = await readContentRow(db, 'terms', latestTermsId); assert(latestTermsRow)
  assert(worker.hasEligibleFields('terms', latestTermsRow), 'skipping old work cannot suppress the latest changed field')
  assert.equal((await queue.enqueueBulkMissing('terms')).queued, 1)
  assert.equal(await queue.processNext(), 'done')
  assert.deepEqual(calls.slice(obsoleteStart), [[latestSource]])
  assert.deepEqual((await db.select().from(terms).where(eq(terms.id, historicalTerms.id)))[0], historicalTerms)
  pass('obsolete queued terms versions send no requests, preserve accepted Arabic snapshots and leave the latest changed item translatable')

  ids.terms = latestTermsId
  const inFlightTermsSections = structuredClone(latestSections)
  assert(inFlightTermsSections[0]?.items[0]); inFlightTermsSections[0].items[0] = 'بند قوانین هنگام ترجمه نسخه قدیمی'
  await mutate('terms', { sections: inFlightTermsSections })
  const [inFlightSnapshot] = await db.select().from(terms).where(eq(terms.id, latestTermsId)); assert(inFlightSnapshot)
  const obsoleteGate = { entered: deferred(), release: deferred() }; gate = obsoleteGate
  const lateTermsStart = calls.length
  const lateTermsWork = worker.run('terms', latestTermsId)
  try {
    await expectTranslatorRequest(obsoleteGate, lateTermsWork)
    const replacementId = crypto.randomUUID()
    const replacementSections = structuredClone(inFlightTermsSections)
    assert(replacementSections[0]?.items[0]); replacementSections[0].items[0] = 'بند آخرین نسخه پس از درخواست ترجمه'
    await db.insert(terms).values(reconcileContentTranslation('terms', replacementId, inFlightSnapshot, {
      ...inFlightSnapshot, id: replacementId, version: inFlightSnapshot.version + 1, sections: replacementSections,
    }))
    obsoleteGate.release.resolve(); await lateTermsWork
    assert.deepEqual((await db.select().from(terms).where(eq(terms.id, latestTermsId)))[0], inFlightSnapshot)
    const replacement = await readContentRow(db, 'terms', replacementId); assert(replacement)
    assert(worker.hasEligibleFields('terms', replacement))
    await worker.run('terms', replacementId)
    assert.deepEqual(calls.slice(lateTermsStart), [[inFlightTermsSections[0].items[0]], [replacementSections[0].items[0]]])
    assert.deepEqual((await db.select().from(terms).where(eq(terms.id, latestTermsId)))[0], inFlightSnapshot)
    pass('terms responses arriving after a new version are discarded without updating historical Arabic or retransmitting sibling items')
  } finally { obsoleteGate.release.resolve(); await Promise.allSettled([lateTermsWork]) }
  assert(invalidations.includes('product') && invalidations.includes('article') && invalidations.includes('temporaryClose'))
  console.log(`${checks} content worker regressions passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
