/** Field lifecycle persistence and fallback on disposable local PostgreSQL; no translator/network calls. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { contentSourceRevision, contentTranslationFields, type ContentEntityType, type TranslationEdit } from '@sinshin/shared'
import { ArticleService } from '../src/domain/article/article.service'
import { GalleryService } from '../src/domain/gallery/gallery.service'
import { TermsService } from '../src/domain/terms/terms.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { Admin2Service } from '../src/domain/admin2/admin2.service'
import { AppError } from '../src/domain/shared/errors'
import { Database } from '../src/infra/db/client'
import { articles, articleSubCategories, galleryImages, terms, SETTING_KEYS } from '../src/infra/db/schema'

const url = new URL(process.env.CONTENT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_content_entities_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
url.pathname = `/${scratch}`
let database: Database | undefined
let created = false
let count = 0
const pass = (message: string) => { count++; console.log(`PASS ${message}`) }
const required = <T>(value: T | null | undefined): T => {
  assert(value !== null && value !== undefined, 'Expected a required fixture or persisted value')
  return value
}
const proof = (type: ContentEntityType, row: object, fieldId: string, value: string): TranslationEdit => {
  const field = contentTranslationFields(type, row).find(field => field.fieldId === fieldId)
  assert(field, `Field ${fieldId} is whitelisted`)
  return { fieldId: field.fieldId, fieldPath: field.fieldPath, sourceText: field.sourceText, revision: field.revision, value, origin: 'manual' }
}
const originalFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in content lifecycle tests') }) as unknown as typeof fetch
try {
  await admin.unsafe(`create database "${scratch}"`); created = true
  database = new Database(url.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
  const gallery = new GalleryService({ db })
  await gallery.add({ src: '/one.webp', alt: 'تصویر اول', altAr: 'الصورة الأولى', span: 'normal' })
  await gallery.add({ src: '/two.webp', alt: 'تصویر دوم', altAr: 'الصورة الثانية', span: 'wide' })
  const originalGallery = await gallery.listAdmin()
  const first = required(originalGallery[0]), second = required(originalGallery[1])
  await gallery.update(first.id, { src: '/replaced.webp', span: 'wide' })
  assert.equal(required((await gallery.listAdmin())[0]).altAr, first.altAr)
  assert.deepEqual(required((await gallery.listAdmin())[0]).translationState, first.translationState)
  pass('gallery image URL and span updates preserve alt translation and provenance')
  await gallery.update(first.id, { alt: 'تصویر ویرایش‌شده', altAr: first.altAr })
  const changedGallery = required((await gallery.listAdmin())[0])
  assert.equal(changedGallery.altAr, null)
  assert.equal(changedGallery.translationState?.fields[0]?.status, 'needs-review')
  assert.equal(changedGallery.translationState?.fields[0]?.staleValue, first.altAr)
  assert.equal(required((await gallery.listPublic('ar'))[0]).alt, changedGallery.alt)
  assert.equal(required((await gallery.listAdmin())[1]).altAr, second.altAr)
  assert.equal(Object.hasOwn(required((await gallery.listPublic('ar'))[0]), 'translationState'), false)
  pass('changing one gallery alt invalidates only that image and public Arabic falls back to current Persian')
  await gallery.update(first.id, { translationEdits: [proof('gallery', changedGallery, 'alt', 'الصورة الجديدة')] })
  const approvedGallery = required((await gallery.listAdmin())[0])
  assert.equal(approvedGallery.altAr, 'الصورة الجديدة')
  await assert.rejects(gallery.update(first.id, { alt: first.alt, sourceRevision: contentSourceRevision('gallery', first) }), AppError)
  assert.equal(required((await gallery.listAdmin())[0]).altAr, approvedGallery.altAr)
  pass('manual gallery approval binds the latest source and stale full forms cannot restore old source')

  const termsService = new TermsService({ db })
  const sourceSections = [{ title: 'خرید', items: ['بند اول', 'بند دوم'] }, { title: 'ارسال', items: ['بند سوم'] }]
  const arabicSections = [{ title: 'شراء', items: ['البند الأول', 'البند الثاني'] }, { title: 'توصيل', items: ['البند الثالث'] }]
  await termsService.update(sourceSections, arabicSections)
  const firstTerms = await termsService.latest('fa', true)
  const changedSections = [{ title: 'ارسال', items: ['بند سوم'] }, { title: 'خرید', items: ['بند دوم', 'بند تازه'] }]
  await termsService.update(changedSections, arabicSections, [], contentSourceRevision('terms', firstTerms))
  const changedTerms = await termsService.latest('fa', true)
  assert.deepEqual(changedTerms.sectionsAr, [{ title: 'توصيل', items: ['البند الثالث'] }, { title: 'شراء', items: ['البند الثاني', ''] }])
  assert.deepEqual(required(await termsService.byVersion(1, 'ar')).sections, arabicSections)
  assert.deepEqual((await termsService.latest('ar')).sections, [{ title: 'توصيل', items: ['البند الثالث'] }, { title: 'شراء', items: ['البند الثاني', 'بند تازه'] }])
  assert.equal((await termsService.latest('ar')).sectionsAr, undefined)
  pass('terms reorder and one-item replacement retain exact matching manual fields and immutable accepted versions')
  const changedItem = required(contentTranslationFields('terms', changedTerms).find(field => field.sourceText === 'بند تازه'))
  await termsService.update(changedTerms.sections, changedTerms.sectionsAr, [proof('terms', changedTerms, changedItem.fieldId, 'البند الجديد')])
  const approvedTerms = await termsService.latest('fa', true)
  assert.deepEqual(approvedTerms.sectionsAr, [{ title: 'توصيل', items: ['البند الثالث'] }, { title: 'شراء', items: ['البند الثاني', 'البند الجديد'] }])
  await assert.rejects(termsService.update(sourceSections, arabicSections, [], contentSourceRevision('terms', firstTerms)), AppError)
  assert.equal((await termsService.latest()).version, approvedTerms.version)
  pass('terms individual manual retranslation fills only its field and outdated versions cannot save')
  const latestRevision = contentSourceRevision('terms', approvedTerms)
  const concurrent = await Promise.allSettled([1, 2].map(() => termsService.update(approvedTerms.sections, approvedTerms.sectionsAr, [], latestRevision)))
  // Same unchanged source can create consecutive versions; exact source edits serialize safely.
  assert(concurrent.every(result => result.status === 'fulfilled'))
  assert.equal(new Set((await db.select().from(terms)).map(row => row.version)).size, approvedTerms.version + 2)
  pass('concurrent terms saves allocate distinct versions without changing historical data')

  const cache = new Map<string, unknown>()
  const redis = { get: async (key: string) => cache.get(key) ?? null, getJson: async (key: string) => cache.get(key) ?? null,
    setJson: async (key: string, value: unknown) => { cache.set(key, structuredClone(value)) },
    incr: async (key: string) => { const value = Number(cache.get(key) ?? 0) + 1; cache.set(key, value); return value } }
  const articleService = new ArticleService({ db, redis: redis as never })
  await articleService.createCategory({ name: 'مقاله‌ها', nameAr: 'المقالات', hasSubCategories: true,
    subCategories: ['پیتزا', 'برگر'], subCategoriesAr: ['بيتزا', 'برجر'] })
  const category = required((await articleService.categories('fa', true)).find(category => category.name === 'مقاله‌ها'))
  const pizza = required(category.subCategories.find(sub => sub.name === 'پیتزا')), burger = required(category.subCategories.find(sub => sub.name === 'برگر'))
  const article = { title: 'عنوان', titleAr: 'العنوان', excerpt: 'خلاصه', excerptAr: 'الملخص', content: 'متن', contentAr: 'النص', categoryId: category.id,
    processes: [{ title: 'مرحله', items: ['اول', 'دوم'] }], processesAr: [{ title: 'المرحلة', items: ['الأول', 'الثاني'] }] }
  const { id } = await articleService.create(article); assert(id)
  await articleService.byId(id, 'ar')
  const cacheVersion = Number(cache.get('articles:ver') ?? 0)
  await articleService.update(id, { ...article, title: 'عنوان تازه' })
  const changedArticle = required(await articleService.adminDetail(id))
  assert.equal(changedArticle.titleAr, null)
  assert.equal(changedArticle.excerptAr, article.excerptAr)
  assert.equal(changedArticle.contentAr, article.contentAr)
  assert.deepEqual(changedArticle.processesAr, article.processesAr)
  assert.equal(required(await articleService.byId(id, 'ar')).title, 'عنوان تازه')
  assert(Number(cache.get('articles:ver') ?? 0) > cacheVersion)
  pass('changing article title isolates invalidation from manual excerpt/content/process fields and invalidates Arabic cache')
  await articleService.updateCategory(category.id, { name: 'مقاله‌ها تازه', nameAr: category.nameAr, hasSubCategories: true,
    subCategoryEntries: [{ id: burger.id, name: burger.name, nameAr: burger.nameAr }, { id: pizza.id, name: 'پیتزای تازه', nameAr: pizza.nameAr }] })
  const changedCategory = required((await articleService.categories('fa', true)).find(row => row.id === category.id))
  assert.equal(changedCategory.nameAr, null)
  assert.equal(required(changedCategory.subCategories.find(row => row.id === pizza.id)).nameAr, null)
  assert.equal(required(changedCategory.subCategories.find(row => row.id === burger.id)).nameAr, burger.nameAr)
  assert.equal(required((await db.select().from(articleSubCategories).where(eq(articleSubCategories.id, pizza.id)))[0]).id, pizza.id)
  await assert.rejects(articleService.updateCategory(category.id, { name: 'bad', hasSubCategories: true,
    subCategoryEntries: [{ id: crypto.randomUUID(), name: 'foreign' }] }), AppError)
  assert.equal(required((await articleService.categories()).find(row => row.id === category.id)).name, changedCategory.name)
  pass('article category and stable subcategory renames invalidate independently, preserve siblings, and reject foreign IDs transactionally')
  await articleService.update(id, { ...article, title: changedArticle.title,
    processes: [{ title: 'مرحله', items: ['دوم', 'تازه'] }] })
  const changedProcess = required(await articleService.adminDetail(id))
  assert.deepEqual(changedProcess.processesAr, [{ title: 'المرحلة', items: ['الثاني', ''] }])
  assert.equal(changedProcess.excerptAr, article.excerptAr)
  assert.equal(changedProcess.contentAr, article.contentAr)
  assert.equal(required((await db.select().from(articles).where(eq(articles.id, id)))[0]).titleAr, null)
  pass('article process item reorder/edit does not assign a sibling translation to changed text')
  await db.insert(galleryImages).values({ src: '/legacy.webp', alt: 'قدیمی', altAr: 'قديم', arAuto: true })
  const legacy = required((await gallery.listAdmin()).find(row => row.src === '/legacy.webp'))
  await gallery.update(legacy.id, { src: '/legacy-replaced.webp' })
  const preservedLegacy = required((await gallery.listAdmin()).find(row => row.id === legacy.id))
  assert.equal(preservedLegacy.altAr, 'قديم')
  assert.equal(required(preservedLegacy.translationState?.fields[0]).origin, 'legacy')
  pass('legacy populated Arabic is preserved conservatively regardless of record-wide arAuto')
  const settingsService = new SettingsService({ db })
  const admin2 = new Admin2Service({ db, settings: settingsService, config: {} as never, hub: {} as never })
  const reason = 'تعمیرات ضروری آشپزخانه رستوران'
  const translatedReason = 'صيانة ضرورية في مطبخ المطعم'
  await admin2.setTemporaryClose(crypto.randomUUID(), 'admin', true, reason, '21:30', translatedReason, true)
  const closeBefore = await settingsService.readTemporaryCloseContent()
  assert.equal((await settingsService.restaurantStatus('ar')).temporaryCloseReason, translatedReason)
  await admin2.setTemporaryClose(crypto.randomUUID(), 'admin', true, reason, '22:30', undefined, false)
  assert.deepEqual((await settingsService.readTemporaryCloseContent()).translationState, closeBefore.translationState)
  assert.equal((await settingsService.restaurantStatus('ar')).temporaryCloseReason, translatedReason)
  assert.equal(await settingsService.orderPaymentsDisabled(), false)
  pass('temporary closure time/payment metadata changes preserve the independently tracked manual Arabic reason')
  const newReason = 'تعمیرات ضروری دستگاه جدید آشپزخانه'
  await admin2.setTemporaryClose(crypto.randomUUID(), 'admin', true, newReason, null, translatedReason, true)
  const staleClose = await settingsService.readTemporaryCloseContent()
  assert.equal(staleClose.reasonAr, '')
  const staleReasonState = required(staleClose.translationState?.fields[0])
  assert.equal(staleReasonState.staleValue, translatedReason)
  assert.equal(staleReasonState.status, 'needs-review')
  assert.equal((await settingsService.restaurantStatus('ar')).temporaryCloseReason, newReason)
  await assert.rejects(admin2.setTemporaryClose(crypto.randomUUID(), 'admin', true, reason, null, translatedReason, false,
    [], contentSourceRevision('temporaryClose', closeBefore)), AppError)
  assert.equal((await settingsService.readTemporaryCloseContent()).reason, newReason)
  assert.equal(await settingsService.orderPaymentsDisabled(), true)
  pass('temporary closure reason changes use Persian fallback and stale forms cannot modify the reason or payment policy')
  await admin2.setTemporaryClose(crypto.randomUUID(), 'admin', true, newReason, null, undefined, true,
    [proof('temporaryClose', staleClose, 'reason', 'صيانة الجهاز الجديد في مطبخ المطعم')], contentSourceRevision('temporaryClose', staleClose))
  assert.equal((await settingsService.restaurantStatus('ar')).temporaryCloseReason, 'صيانة الجهاز الجديد في مطبخ المطعم')
  await admin2.setTemporaryClose(crypto.randomUUID(), 'admin', false, 'باز شد', null, undefined, true)
  assert.equal((await settingsService.readTemporaryCloseContent()).reason, '')
  assert.equal((await settingsService.readTemporaryCloseContent()).reasonAr, '')
  assert.equal(await settingsService.orderPaymentsDisabled(), false)
  assert.equal(await settingsService.get(SETTING_KEYS.temporaryReopenTime, ''), '')
  pass('manual closure approval invalidates localized cache, and reopening retains the existing metadata/payment reset rules')
  console.log(`${count} content entity lifecycle regressions passed`)
} finally {
  globalThis.fetch = originalFetch
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
