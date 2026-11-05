/** Articles integration regressions. Creates/drops only a uniquely named scratch database on local PostgreSQL. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { getArticleBlockTextFields, getArticleBlockTranslationStatus, readArticleBlockText, setArticleBlockText, setArticleBlockTranslation, setArticleBlockTranslations, type ArticleBlocksDoc, type ArticleBlockTextPath } from '@sinshin/shared'
import { ArticleService, type ArticleInput } from '../src/domain/article/article.service'
import { AppError } from '../src/domain/shared/errors'
import { Database } from '../src/infra/db/client'
import { articles, articleCategories } from '../src/infra/db/schema'
import { articlesRoutes } from '../src/http/routes/articles.routes'
import type { RedisService } from '../src/infra/redis/redis'
import type { SessionService } from '../src/domain/auth/session.service'
import type { Admin2Service } from '../src/domain/admin2/admin2.service'

const source = new URL(process.env.ARTICLES_TEST_DATABASE_URL ?? process.env.DATABASE_URL
  ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Articles tests require a local PostgreSQL server')
const scratch = `sinshin_articles_test_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const testUrl = new URL(source)
testUrl.pathname = `/${scratch}`
const boot = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
let database: Database | undefined
let service: ArticleService | undefined
let created = false
let checks = 0
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message)
  checks++
  console.log(`  ✓ ${message}`)
}
const errorCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code
const blockText = (doc: ArticleBlocksDoc | null | undefined, id: string, path: ArticleBlockTextPath) =>
  readArticleBlockText(doc?.blocks.find(block => block.id === id), path)

try {
  await boot.unsafe(`create database "${scratch}"`)
  created = true
  const migration = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], {
    cwd: `${import.meta.dir}/..`, env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(migration.stdout).text(), new Response(migration.stderr).text(), migration.exited,
  ])
  assert.equal(exit, 0, `Scratch migrations failed:\n${stdout}\n${stderr}`)
  database = new Database(testUrl.toString(), { max: 8 })
  const db = database.db
  const cache = new Map<string, unknown>()
  const redis = {
    get: async (key: string) => cache.get(key) ?? null,
    getJson: async (key: string) => cache.get(key) ?? null,
    setJson: async (key: string, value: unknown) => { cache.set(key, structuredClone(value)) },
    incr: async (key: string) => {
      const value = Number(cache.get(key) ?? 0) + 1
      cache.set(key, value)
      return value
    },
  } as unknown as RedisService
  const articlesService = new ArticleService({ db, redis })
  service = articlesService
  const findCategory = async (name: string) => {
    const category = (await articlesService.categories()).find((item) => item.name === name)
    assert.ok(category, `Category ${name} exists`)
    return category
  }

  await Promise.all([1, 2].map(() => articlesService.createCategory({ name: 'م'.repeat(60), hasSubCategories: false })))
  const longCategories = (await articlesService.categories()).filter((c) => c.name === 'م'.repeat(60))
  check(longCategories.length === 2 && new Set(longCategories.map((c) => c.slug)).size === 2
    && longCategories.every((c) => c.slug.length <= 60), 'concurrent 60-character category names allocate unique, bounded slugs')
  await articlesService.createCategory({ name: 'all', hasSubCategories: false })
  check((await findCategory('all')).slug !== 'all', 'the all filter sentinel is not allocated as a category slug')

  await articlesService.createCategory({
    name: 'اصلی', nameAr: 'رئيسية', hasSubCategories: true,
    subCategories: [' بخش ', 'بخش', 'دوم'], subCategoriesAr: ['قسم', 'تکراری', 'الثاني'],
  })
  const category = await findCategory('اصلی')
  const sub = category.subCategories.find((s) => s.name === 'بخش')!
  check(category.subCategories.length === 2 && sub.nameAr === 'قسم', 'duplicate trimmed sub-categories are saved once with the aligned translation')
  await assert.rejects(articlesService.createCategory({
    name: 'rollback category', hasSubCategories: true, subCategories: ['valid sub', 'x'.repeat(61)],
  }))
  check(!(await articlesService.categories()).some((c) => c.name === 'rollback category'), 'failed sub-category insertion rolls back the entire category')

  const input: ArticleInput = {
    title: 'مقاله', excerpt: 'خلاصه', content: 'متن اولیه', author: 'نویسنده', categoryId: category.id,
    subCategoryId: sub.id, profileImage: '/uploads/profile.webp', galleryImages: ['/uploads/gallery.webp'],
    processes: [{ title: 'مرحله اول', items: ['یک', 'دو'] }, { title: 'مرحله دوم', items: ['سه'] }],
    titleAr: 'مقالة', excerptAr: 'موجز', contentAr: 'محتوى',
    processesAr: [{ title: '', items: ['', 'اثنان'] }, { title: '', items: [] }],
    isFeatured: true,
    blocks: { version: 1, blocks: [{ id: 'body', type: 'paragraph', props: { text: 'متن بلوکی' } }] },
  }
  const { id } = await articlesService.create(input)
  assert.ok(id)
  const publishedAt = new Date('2026-01-01T10:00:00.000Z')
  await db.update(articles).set({ arAuto: true, createdAt: publishedAt, updatedAt: publishedAt }).where(eq(articles.id, id))
  await articlesService.update(id, { title: 'ویرایش', excerpt: 'خلاصه جدید', content: 'ignored for blocks', categoryId: category.id })
  const edited = (await articlesService.adminDetail(id))!
  const summary = (await articlesService.listPublic()).find((article) => article.id === id)!
  check(edited.publishedAt === publishedAt.toISOString()
    && Date.parse(edited.updatedAt) > publishedAt.getTime()
    && summary.updatedAt === edited.updatedAt && summary.publishedAt === edited.publishedAt,
  'article detail and sitemap summaries expose actual edit time without changing publication time')
  check(edited.content === 'متن بلوکی' && edited.blocks?.blocks.length === 1, 'omitting blocks preserves the layout and its derived content')
  check(edited.titleAr === input.titleAr && edited.arAuto === true && edited.author === input.author
    && edited.profileImage === input.profileImage && edited.galleryImages.length === 1
    && edited.processes.length === 2 && edited.subCategoryId === sub.id && edited.isFeatured,
  'PATCH preserves omitted translations, media, processes, author, sub-category and flags')
  const arabic = (await articlesService.byId(id, 'ar'))!
  check(arabic.processes[0]?.title === 'مرحله اول' && arabic.processes[0]?.items.join('|') === 'یک|اثنان'
    && arabic.processes[1]?.items[0] === 'سه', 'Arabic process placeholders fall back to the corresponding Persian fields')
  check(arabic.blocks?.blocks[0]?.id === 'body' && arabic.content === 'محتوى'
    && arabic.blocks.blocks[0]?.type === 'paragraph' && arabic.blocks.blocks[0].props.text === 'متن بلوکی',
  'Arabic detail retains the Persian block document when no block translation exists')

  // Simulate a document stored before Arabic block support, including exact coordinates
  // and explicit defaults that ordinary normalization used to round or omit.
  const legacyBlocks: ArticleBlocksDoc = {
    version: 1,
    blocks: [
      { id: 'branch-one', type: 'location', width: 'md', anim: 'fade-up',
        style: { bg: '#123456', fg: '#FFFFFF', align: 'center', pad: 'lg' },
        props: { lat: 37.48220561234, lng: 49.44182739876, title: 'شعبه اول', address: 'آدرس اول' } },
      { id: 'branch-two', type: 'location', width: 'sm', anim: 'zoom',
        props: { lat: 35.12345678901, lng: 51.98765432109, title: 'شعبه دوم', address: 'آدرس دوم' } },
      { id: 'link-old', type: 'link', props: { label: 'منو', href: '/products?branch=one', variant: 'button' } },
      { id: 'items-old', type: 'list', props: { items: ['اول', 'دوم'], ordered: false } },
      { id: 'gallery-old', type: 'gallery', props: { images: [{ src: '/uploads/one.webp', alt: 'تصویر اول' },
        { src: '/uploads/two.webp', alt: 'تصویر دوم' }], layout: 'slider' } },
    ],
  }
  const { id: translatedId } = await articlesService.create({ ...input, title: 'مقاله قدیمی' })
  assert.ok(translatedId)
  await db.update(articles).set({ blocks: legacyBlocks, blocksAr: null }).where(eq(articles.id, translatedId))
  const blockTranslations = structuredClone(legacyBlocks)
  const firstLocation = blockTranslations.blocks[0]!
  assert.equal(firstLocation.type, 'location')
  firstLocation.props = { lat: 0, lng: 0, title: 'الفرع الأول', address: '' }
  firstLocation.width = 'full'
  firstLocation.anim = 'none'
  firstLocation.style = { bg: '#000000' }
  const secondLocation = blockTranslations.blocks[1]!
  assert.equal(secondLocation.type, 'location')
  secondLocation.props = { lat: 1, lng: 1, title: '', address: 'عنوان الفرع الثاني' }
  const translatedLink = blockTranslations.blocks[2]!
  assert.equal(translatedLink.type, 'link')
  translatedLink.props = { label: 'القائمة', href: 'https://changed.example', variant: 'card' }
  const translatedList = blockTranslations.blocks[3]!
  assert.equal(translatedList.type, 'list')
  translatedList.props.items = ['', 'الثاني']
  const translatedGallery = blockTranslations.blocks[4]!
  assert.equal(translatedGallery.type, 'gallery')
  translatedGallery.props.images = [{ src: '/changed.webp', alt: 'الصورة الأولى' }, { src: '/changed-two.webp', alt: '' }]
  await articlesService.update(translatedId, {
    title: 'مقاله قدیمی', excerpt: input.excerpt, content: input.content, categoryId: category.id,
    blocks: legacyBlocks, blocksAr: blockTranslations,
  })
  const oldEdited = (await articlesService.adminDetail(translatedId))!
  assert.deepEqual(oldEdited.blocks, legacyBlocks)
  check(oldEdited.arAuto === false && oldEdited.blocksAr?.blocks.length === legacyBlocks.blocks.length,
    'Arabic saves mark manual translations and preserve older Persian documents exactly without rebuilding')
  const localized = (await articlesService.byId(translatedId, 'ar'))!.blocks!
  const locationOne = localized.blocks[0]!
  const locationTwo = localized.blocks[1]!
  assert.equal(locationOne.type, 'location')
  assert.equal(locationTwo.type, 'location')
  const originalLocationOne = legacyBlocks.blocks[0]!
  const originalLocationTwo = legacyBlocks.blocks[1]!
  assert.equal(originalLocationOne.type, 'location')
  assert.equal(originalLocationTwo.type, 'location')
  check(locationOne.props.lat === originalLocationOne.props.lat
    && locationOne.props.lng === originalLocationOne.props.lng
    && locationTwo.props.lat === originalLocationTwo.props.lat
    && locationTwo.props.lng === originalLocationTwo.props.lng
    && locationOne.width === 'md' && locationOne.anim === 'fade-up' && locationOne.style?.bg === '#123456',
    'multiple translated location blocks preserve their own exact coordinates, styles, widths and animations')
  const publicLink = localized.blocks[2]!
  const publicList = localized.blocks[3]!
  const publicGallery = localized.blocks[4]!
  assert.equal(publicLink.type, 'link')
  assert.equal(publicList.type, 'list')
  assert.equal(publicGallery.type, 'gallery')
  check(locationOne.props.title === 'الفرع الأول' && locationOne.props.address === 'آدرس اول'
    && locationTwo.props.title === 'شعبه دوم' && locationTwo.props.address === 'عنوان الفرع الثاني'
    && publicList.props.items.join('|') === 'اول|الثاني'
    && publicGallery.props.images[0]?.alt === 'الصورة الأولى' && publicGallery.props.images[1]?.alt === 'تصویر دوم',
    'partial Arabic translations fall back independently for locations, list entries and gallery descriptions')
  check(publicLink.props.href === '/products?branch=one' && publicLink.props.variant === 'button'
    && publicGallery.props.images[0]?.src === '/uploads/one.webp' && publicGallery.props.images[1]?.src === '/uploads/two.webp',
    'translation payloads cannot alter links, image URLs or display variants')
  await articlesService.update(translatedId, {
    title: 'حفظ ترجمه', excerpt: input.excerpt, content: input.content, categoryId: category.id,
  })
  assert.deepEqual((await articlesService.adminDetail(translatedId))!.blocksAr, oldEdited.blocksAr)
  check(true, 'omitting Arabic blocks preserves all saved manual block translations')
  const reorderedBlocks = structuredClone(legacyBlocks)
  reorderedBlocks.blocks.reverse()
  await articlesService.update(translatedId, {
    title: 'تغییر ترتیب', excerpt: input.excerpt, content: input.content, categoryId: category.id, blocks: reorderedBlocks,
  })
  const reorderedArabic = (await articlesService.byId(translatedId, 'ar'))!.blocks!
  const reorderedLocation = reorderedArabic.blocks.find((block) => block.id === 'branch-one')!
  assert.equal(reorderedLocation.type, 'location')
  check(reorderedArabic.blocks.map((block) => block.id).join('|') === reorderedBlocks.blocks.map((block) => block.id).join('|')
    && reorderedLocation.props.title === 'الفرع الأول' && reorderedLocation.props.lat === locationOne.props.lat,
    'Persian block reorder rebases Arabic text by stable block IDs while retaining coordinate precision')

  const fieldSource: ArticleBlocksDoc = { version: 1, blocks: [
    { id: 'branch', type: 'location', props: { lat: 37.48220561234, lng: 49.44182739876, title: 'نام شعبه', address: 'آدرس شعبه' } },
    { id: 'note', type: 'callout', props: { title: 'عنوان نکته', text: 'متن نکته' } },
    { id: 'items', type: 'list', props: { items: ['اول', 'دوم', 'سوم'], ordered: true } },
    { id: 'images', type: 'gallery', props: { images: [{ src: '/uploads/a.webp', alt: 'تصویر اول' }, { src: '/uploads/b.webp', alt: 'تصویر دوم' }], layout: 'grid' } },
    { id: 'body-field', type: 'paragraph', props: { text: 'متن ثابت' } },
    { id: 'menu-link', type: 'link', props: { title: 'عنوان پیوند', text: 'متن پیوند', label: 'منو', href: '/products', variant: 'button' } },
  ] }
  const fieldArabic = setArticleBlockTranslations(fieldSource, null, fieldSource.blocks.flatMap(block =>
    getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: `عربي ${field.text}` }))))!
  const fieldInput = { ...input, blocks: fieldSource, blocksAr: fieldArabic }
  const legacyFieldArabic = structuredClone(fieldArabic)
  delete legacyFieldArabic.translation
  const { id: legacyFieldId } = await articlesService.create({ ...fieldInput, blocksAr: legacyFieldArabic })
  assert.ok(legacyFieldId)
  const legacyChangedTitle = setArticleBlockText(fieldSource, 'branch', ['title'], 'نام جدید شعبه قدیمی')
  const legacyStaleArabic = setArticleBlockText(legacyFieldArabic, 'branch', ['address'], '')
  await articlesService.update(legacyFieldId, { ...fieldInput, blocks: legacyChangedTitle, blocksAr: legacyStaleArabic })
  const legacyFieldSaved = (await articlesService.adminDetail(legacyFieldId))!
  check(blockText(legacyFieldSaved.blocksAr, 'branch', ['title']) === ''
    && blockText(legacyFieldSaved.blocksAr, 'branch', ['address']) === 'عربي آدرس شعبه'
    && blockText(legacyFieldSaved.blocksAr, 'items', ['items', 1]) === 'عربي دوم',
    'older Arabic documents without provenance retain every unaffected manual field despite outdated incoming values')
  const { id: fieldId } = await articlesService.create(fieldInput)
  assert.ok(fieldId)
  const beforeFieldEdit = (await articlesService.adminDetail(fieldId))!
  const changedTitle = setArticleBlockText(beforeFieldEdit.blocks!, 'branch', ['title'], 'نام جدید شعبه')
  await articlesService.update(fieldId, { ...fieldInput, blocks: changedTitle, blocksAr: beforeFieldEdit.blocksAr })
  const afterTitleEdit = (await articlesService.adminDetail(fieldId))!
  assert.deepEqual(afterTitleEdit.blocks, changedTitle)
  check(blockText(afterTitleEdit.blocksAr, 'branch', ['title']) === ''
    && getArticleBlockTranslationStatus(afterTitleEdit.blocks, afterTitleEdit.blocksAr, 'branch', ['title']) === 'needs-retranslation'
    && changedTitle.blocks.every(block => getArticleBlockTextFields(block).every(field =>
      block.id === 'branch' && field.path[0] === 'title'
        || blockText(afterTitleEdit.blocksAr, block.id, field.path) === blockText(beforeFieldEdit.blocksAr, block.id, field.path))),
    'a Persian title change clears exactly its Arabic field and preserves every adjacent or unrelated manual translation')
  const staleWithoutProof = structuredClone(beforeFieldEdit.blocksAr!)
  delete staleWithoutProof.translation
  const staleBranch = staleWithoutProof.blocks.find(block => block.id === 'branch')!
  assert.equal(staleBranch.type, 'location')
  staleBranch.props.address = ''
  await articlesService.update(fieldId, { ...fieldInput, blocks: changedTitle, blocksAr: staleWithoutProof })
  const afterUnprovedSave = (await articlesService.adminDetail(fieldId))!
  check(blockText(afterUnprovedSave.blocksAr, 'branch', ['title']) === ''
    && blockText(afterUnprovedSave.blocksAr, 'branch', ['address']) === 'عربي آدرس شعبه',
    'an outdated Arabic document without proof cannot restore changed text or erase a completed sibling')
  const freshArabic = setArticleBlockTranslation(changedTitle, afterUnprovedSave.blocksAr, 'branch', ['title'], 'اسم الفرع الجديد')!
  await articlesService.update(fieldId, { ...fieldInput, blocks: changedTitle, blocksAr: freshArabic })
  const freshlyTranslated = (await articlesService.adminDetail(fieldId))!
  check(blockText(freshlyTranslated.blocksAr, 'branch', ['title']) === 'اسم الفرع الجديد'
    && getArticleBlockTranslationStatus(freshlyTranslated.blocks, freshlyTranslated.blocksAr, 'branch', ['title']) === 'translated'
    && freshlyTranslated.blocksAr?.translation?.fields.some(field => field.blockId === 'branch' && field.fieldPath[0] === 'title'
      && field.sourceText === 'نام جدید شعبه'),
    'matching fresh source proof permits the updated Arabic field and survives database roundtrip')
  const structuralEdit = structuredClone(freshlyTranslated.blocks!)
  structuralEdit.blocks.reverse()
  const structuralBranch = structuralEdit.blocks.find(block => block.id === 'branch')!
  assert.equal(structuralBranch.type, 'location')
  structuralBranch.props.lat = 33.98765432109
  structuralBranch.props.lng = 48.12345678901
  structuralBranch.width = 'full'
  structuralBranch.anim = 'zoom'
  structuralBranch.style = { bg: '#123456', align: 'center', pad: 'lg' }
  const structuralImages = structuralEdit.blocks.find(block => block.id === 'images')!
  assert.equal(structuralImages.type, 'gallery')
  structuralImages.props.images[0]!.src = '/uploads/replaced.webp'
  const structuralLink = structuralEdit.blocks.find(block => block.id === 'menu-link')!
  assert.equal(structuralLink.type, 'link')
  structuralLink.props.href = '/articles'
  structuralLink.props.variant = 'card'
  await articlesService.update(fieldId, { ...fieldInput, blocks: structuralEdit, blocksAr: freshlyTranslated.blocksAr })
  const afterStructuralEdit = (await articlesService.adminDetail(fieldId))!
  assert.deepEqual(afterStructuralEdit.blocks, structuralEdit)
  check(structuralEdit.blocks.every(block => getArticleBlockTextFields(block).every(field =>
    blockText(afterStructuralEdit.blocksAr, block.id, field.path) === blockText(freshlyTranslated.blocksAr, block.id, field.path))),
    'reorders, coordinates, width, animation, colors, media URLs and link variants preserve all Arabic text')
  const identityEdit = setArticleBlockText(structuralEdit, 'items', ['items', 1], 'مورد دوم جدید')
  const pathEdit = setArticleBlockText(identityEdit, 'images', ['images', 1, 'alt'], 'تصویر دوم جدید')
  const replacedBody = pathEdit.blocks.find(block => block.id === 'body-field')!
  replacedBody.id = 'replacement-body'
  const replacedType = pathEdit.blocks.find(block => block.id === 'note')!
  Object.assign(replacedType, { type: 'quote', props: { text: 'متن نکته', author: 'نویسنده جدید' } })
  await articlesService.update(fieldId, { ...fieldInput, blocks: pathEdit, blocksAr: afterStructuralEdit.blocksAr })
  const afterIdentityEdit = (await articlesService.adminDetail(fieldId))!
  check(blockText(afterIdentityEdit.blocksAr, 'items', ['items', 1]) === ''
    && blockText(afterIdentityEdit.blocksAr, 'images', ['images', 1, 'alt']) === ''
    && blockText(afterIdentityEdit.blocksAr, 'replacement-body', ['text']) === ''
    && blockText(afterIdentityEdit.blocksAr, 'note', ['text']) === ''
    && blockText(afterIdentityEdit.blocksAr, 'items', ['items', 0]) === 'عربي اول'
    && blockText(afterIdentityEdit.blocksAr, 'items', ['items', 2]) === 'عربي سوم'
    && blockText(afterIdentityEdit.blocksAr, 'images', ['images', 0, 'alt']) === 'عربي تصویر اول'
    && blockText(afterIdentityEdit.blocksAr, 'branch', ['title']) === 'اسم الفرع الجديد',
    'nested field paths, new block IDs and changed block types invalidate only the affected translation identities')
  const publicIdentity = (await articlesService.byId(fieldId, 'ar'))!.blocks!
  check(!publicIdentity.translation && blockText(publicIdentity, 'items', ['items', 1]) === 'مورد دوم جدید'
    && blockText(publicIdentity, 'images', ['images', 1, 'alt']) === 'تصویر دوم جدید'
    && blockText(publicIdentity, 'note', ['text']) === 'متن نکته',
    'public documents omit provenance and fall back independently to the current Persian fields')
  const removedSource = structuredClone(afterIdentityEdit.blocks!)
  removedSource.blocks = removedSource.blocks.filter(block => block.id !== 'replacement-body')
  await articlesService.update(fieldId, { ...fieldInput, blocks: removedSource, blocksAr: afterIdentityEdit.blocksAr })
  const afterRemoval = (await articlesService.adminDetail(fieldId))!
  check(afterRemoval.blocksAr?.blocks.length === removedSource.blocks.length
    && !afterRemoval.blocksAr.blocks.some(block => block.id === 'body-field' || block.id === 'replacement-body')
    && !afterRemoval.blocksAr.translation?.fields.some(field => field.blockId === 'body-field' || field.blockId === 'replacement-body'),
    'removed blocks leave no orphan Arabic text or translation metadata')
  const largeSource: ArticleBlocksDoc = { version: 1, blocks: Array.from({ length: 200 }, (_, index) => ({
    id: `large-${index}`, type: 'paragraph', props: { text: 'م'.repeat(500) },
  })) }
  const largeArabic = setArticleBlockTranslations(largeSource, null, largeSource.blocks.map(block => ({
    blockId: block.id, path: ['text'], text: 'ع'.repeat(400),
  })))!
  assert.ok(Buffer.byteLength(JSON.stringify(largeArabic), 'utf8') > 262_144)
  const { id: largeId } = await articlesService.create({ ...input, blocks: largeSource, blocksAr: largeArabic })
  check(!!largeId && (await articlesService.adminDetail(largeId!))?.blocksAr?.translation?.fields.length === 200,
    'source proof metadata has its own allowance without lowering the existing translated block content limit')

  await articlesService.update(translatedId, {
    title: 'بدون ترجمه', excerpt: input.excerpt, content: input.content, categoryId: category.id, blocksAr: null,
  })
  check((await articlesService.adminDetail(translatedId))!.blocksAr === null
    && (await articlesService.byId(translatedId, 'ar'))!.blocks?.blocks.length === legacyBlocks.blocks.length,
    'explicitly clearing Arabic blocks keeps the Persian document available to Arabic readers')
  await articlesService.close()
  check((await articlesService.adminDetail(id))?.updatedAt === edited.updatedAt,
    'counting article views does not advertise a content change to search engines')
  const huge = { version: 1, blocks: Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`, type: 'paragraph', props: { text: 'م'.repeat(5000) },
  })) }
  await assert.rejects(articlesService.update(id, { ...input, blocks: huge }), errorCode('VALIDATION_ERROR'))
  check((await articlesService.adminDetail(id))?.blocks?.blocks[0]?.id === 'body', 'oversized UTF-8 documents are rejected without erasing the saved article')

  const blank = { ...input, title: '   ' }
  await assert.rejects(articlesService.create(blank), errorCode('VALIDATION_ERROR'))
  await assert.rejects(articlesService.update(id, blank), errorCode('VALIDATION_ERROR'))
  check((await articlesService.adminDetail(id))?.title === 'ویرایش', 'whitespace-only article titles cannot replace saved content')

  await articlesService.update(id, {
    title: 'ویرایش', excerpt: 'خلاصه', content: 'مقاله متنی', categoryId: category.id,
    blocks: null, titleAr: null, excerptAr: null, contentAr: null, processesAr: null,
    galleryImages: [], profileImage: null, processes: [], subCategoryId: null, isFeatured: false,
  })
  const cleared = (await articlesService.adminDetail(id))!
  check(cleared.blocks === null && cleared.content === 'مقاله متنی' && cleared.titleAr === null
    && cleared.profileImage === null && cleared.processes.length === 0 && cleared.galleryImages.length === 0
    && cleared.subCategoryId === null && cleared.arAuto === false && !cleared.isFeatured,
  'explicit null and empty arrays clear optional fields')

  await articlesService.listPublic()
  await articlesService.updateCategory(category.id, { name: 'تغییر نام', hasSubCategories: false })
  const disabled = await findCategory('تغییر نام')
  check(disabled.subCategories.length === 2 && disabled.nameAr === 'رئيسية', 'disabling sub-categories preserves their names and omitted translations')
  check((await articlesService.listPublic()).find((a) => a.id === id)?.categoryName === 'تغییر نام', 'disabling a category invalidates cached article category names')
  await articlesService.updateCategory(category.id, { name: 'تغییر نام', hasSubCategories: true })
  check((await findCategory('تغییر نام')).subCategories.length === 2, 'omitting sub-categories during a rename does not delete them')
  await articlesService.updateCategory(category.id, {
    name: 'تغییر نام', hasSubCategories: true, subCategories: ['بخش', 'دوم'], subCategoriesAr: null,
  })
  check((await findCategory('تغییر نام')).subCategories.every((s) => s.nameAr === null), 'explicit null clears sub-category translations')

  await Promise.all(Array.from({ length: 10 }, () => articlesService.toggle(id)))
  check((await articlesService.adminDetail(id))?.status === 'ACTIVE', 'concurrent status toggles each apply exactly once')
  await articlesService.toggle(id)
  check(await articlesService.byId(id) === null && !(await articlesService.listPublic()).some((a) => a.id === id),
    'inactive articles are hidden from public detail and lists')
  check((await articlesService.listAdmin()).some((a) => a.id === id), 'administrators can still read inactive articles')
  const missing = crypto.randomUUID()
  await assert.rejects(articlesService.toggle(missing), errorCode('NOT_FOUND'))
  await assert.rejects(articlesService.deleteCategory(missing), errorCode('NOT_FOUND'))
  check(await articlesService.byId('invalid') === null, 'invalid article identifiers never reach a UUID database query')

  await articlesService.createCategory({ name: 'A:B', hasSubCategories: true, subCategories: ['C'] })
  await articlesService.createCategory({ name: 'A', hasSubCategories: true, subCategories: ['B:C'] })
  const collision1 = await findCategory('A:B')
  const collision2 = await findCategory('A')
  await articlesService.create({ ...input, categoryId: collision1.id, subCategoryId: collision1.subCategories[0]!.id, title: 'tuple one' })
  await articlesService.create({ ...input, categoryId: collision2.id, subCategoryId: collision2.subCategories[0]!.id, title: 'tuple two' })
  check((await articlesService.listPublic('a:b', 'c'))[0]?.title === 'tuple one'
    && (await articlesService.listPublic('a', 'b:c'))[0]?.title === 'tuple two', 'category/sub-category cache keys cannot collide through colon-containing slugs')
  await articlesService.update(id, input)
  await articlesService.update(id, { title: 'ویرایش', excerpt: 'خلاصه', content: 'متن', categoryId: collision1.id })
  check((await articlesService.adminDetail(id))?.subCategoryId === null, 'moving articles does not retain a sub-category from the previous category')

  const sessions = {
    authenticate: async (token: string) => ({ user: { id: token, role: token === 'admin' ? 'admin' : 'admin2' }, ctx: {} }),
  } as unknown as SessionService
  const admin2 = { permissionsOf: async () => ({ articlesRead: true, articlesWrite: false }) } as unknown as Admin2Service
  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(articlesRoutes({ sessions, admin2, articles: articlesService })).compile()
  const body = { ...input, categoryId: category.id, subCategoryId: sub.id,
    processesAr: [{ title: '', items: ['', 'اثنان'] }, { title: '', items: [] }],
    blocksAr: { version: 1, blocks: [{ id: 'body', type: 'paragraph', props: { text: '' } }] } }
  const request = (token?: string) => new Request('http://localhost/admin/articles', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  check((await app.handle(request('admin'))).status === 200, 'HTTP article creation accepts aligned blank Arabic process and block translations')
  const httpArabic = setArticleBlockTranslation(input.blocks as ArticleBlocksDoc, null, 'body', ['text'], 'محتوى عربي')!
  const proofResponse = await app.handle(new Request('http://localhost/admin/articles', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin' },
    body: JSON.stringify({ ...body, blocksAr: httpArabic }),
  }))
  assert.equal(proofResponse.status, 200)
  const proofResult = await proofResponse.json() as { id: string }
  const proofArticle = (await articlesService.adminDetail(proofResult.id))!
  check(proofArticle.blocksAr?.translation?.fields[0]?.sourceText === 'متن بلوکی'
    && proofArticle.blocksAr.translation.fields[0].status === 'translated' && !proofArticle.blocks?.translation,
    'article HTTP schema preserves validated Arabic provenance while keeping Persian source documents metadata-free')
  check((await app.handle(request())).status === 401 && (await app.handle(request('reader'))).status === 403,
    'article writes reject unauthenticated users and administrators without write permission')
  check((await app.handle(new Request('http://localhost/articles'))).status === 200,
    'public article lists remain accessible without authentication')
  const adminCategories = await app.handle(new Request('http://localhost/admin/articles/categories', {
    headers: { authorization: 'Bearer reader', 'x-sinshin-lang': 'ar' },
  }))
  const categoriesForEdit = await adminCategories.json() as Array<{ id: string; name: string; nameAr: string | null }>
  check(adminCategories.status === 200 && categoriesForEdit.find((c) => c.id === category.id)?.name === 'تغییر نام'
    && categoriesForEdit.find((c) => c.id === category.id)?.nameAr === 'رئيسية',
  'administrator category data stays in Persian when the public language cookie is Arabic')

  await articlesService.toggle(id)
  const beforeViews = (await articlesService.adminDetail(id))!.views
  await articlesService.byId(id)
  await articlesService.byId(id)
  await articlesService.close()
  check((await articlesService.adminDetail(id))!.views >= beforeViews + 2, 'shutdown flushes queued article views')

  let failViewWrite = true
  const flakyDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'update') return (...args: Parameters<typeof db.update>) => {
        if (failViewWrite) { failViewWrite = false; throw new Error('expected simulated view write failure') }
        return target.update(...args)
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const retryService = new ArticleService({ db: flakyDb, redis })
  const previous = (await articlesService.adminDetail(id))!.views
  await retryService.byId(id)
  await retryService.close()
  await retryService.close()
  check((await articlesService.adminDetail(id))!.views === previous + 1, 'failed view batches are retried without losing or duplicating counts')

  const { id: associatedId } = await articlesService.create(input)
  assert.ok(associatedId)
  await articlesService.updateCategory(category.id, { name: 'تغییر نام', hasSubCategories: true, subCategories: [] })
  check((await articlesService.adminDetail(associatedId))?.subCategoryId === null,
    'removing sub-categories preserves their articles and clears dangling references')

  const categoryDelete = await articlesService.deleteCategory(collision1.id)
  check(categoryDelete.success && await articlesService.adminDetail(id) === null
    && !(await db.select().from(articleCategories).where(eq(articleCategories.id, collision1.id))).length,
  'deleting a category atomically removes its articles and the category')
  console.log(`\n${checks} Articles integration checks passed.`)
} finally {
  await service?.close()
  await database?.close()
  if (created) await boot.unsafe(`drop database "${scratch}" with (force)`)
  await boot.close({ timeout: 5 })
}
