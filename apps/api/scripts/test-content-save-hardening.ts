/** Mandatory save proofs and same-revision races against disposable local PostgreSQL. No external requests. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq, desc } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import { collectionTranslationIdentities, contentSourceRevision, contentTranslationFields, createContentCollectionItemId, type ContentEntityType } from '@sinshin/shared'
import { ArticleService } from '../src/domain/article/article.service'
import { GalleryService } from '../src/domain/gallery/gallery.service'
import { MenuService } from '../src/domain/menu/menu.service'
import { PackagingService } from '../src/domain/menu/packaging.service'
import { SettingsService } from '../src/domain/settings/settings.service'
import { TermsService } from '../src/domain/terms/terms.service'
import { readContentRow } from '../src/domain/translation/content-translation.store'
import { AppError } from '../src/domain/shared/errors'
import { Database } from '../src/infra/db/client'
import { articleSubCategories, categories, contentAbout, mainCategories, productSizes, type products, terms } from '../src/infra/db/schema'
import { aboutRoutes } from '../src/http/routes/about.routes'

const url = new URL(process.env.CONTENT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is permitted')
const scratch = `sinshin_content_hardening_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
url.pathname = `/${scratch}`
let database: Database | undefined
let created = false
let checks = 0
const pass = (message: string) => { checks++; console.log(`PASS ${message}`) }
const required = <T>(value: T | undefined | null): T => { assert(value != null); return value }
const invalid = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'
type GuardCase = { name: string; type: ContentEntityType; read: () => Promise<Record<string, unknown>>; save: (revision: unknown) => Promise<unknown> }
const fetchBefore = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests are forbidden in hardening tests') }) as unknown as typeof fetch
try {
  await admin.unsafe(`create database "${scratch}"`); created = true
  database = new Database(url.toString(), { max: 12 })
  const db = database.db
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
  const cache = new Map<string, unknown>()
  const redis = { get: async (key: string) => cache.get(key), getJson: async (key: string) => cache.get(key),
    setJson: async (key: string, value: unknown) => { cache.set(key, value) },
    incr: async (key: string) => { const next = Number(cache.get(key) ?? 0) + 1; cache.set(key, next); return next } }
  const menu = new MenuService({ db, redis: redis as never })
  const packaging = new PackagingService({ db })
  const gallery = new GalleryService({ db })
  const articles = new ArticleService({ db, redis: redis as never })
  const termService = new TermsService({ db })
  const settings = new SettingsService({ db })
  const read = async (type: ContentEntityType, id: string) => required(await readContentRow(db, type, id))
  const [main] = await db.insert(mainCategories).values({ name: 'رستوران', nameAr: 'المطعم', slug: 'hardening-main' }).returning()
  const mainId = required(main).id
  const [category] = await db.insert(categories).values({ mainCategoryId: mainId, name: 'غذا', nameAr: 'وجبات', slug: 'hardening-category',
    hasSizes: true, sizeNames: ['کوچک', 'بزرگ'], sizeNamesAr: ['صغير', 'كبير'] }).returning()
  const categoryId = required(category).id
  const productInput = { name: 'غذا', description: 'توضیح', nameAr: 'الوجبة', descriptionAr: 'وصف يدوي',
    originalPrice: 100000, discountPercentage: 0, prepTime: 15, categoryIds: [categoryId], sizesEnabled: true }
  const productId = required((await menu.createProduct({ ...productInput, ingredients: ['پنیر', 'سس'], ingredientsAr: ['جبن', 'صلصة'],
    sizes: [{ name: 'کوچک', nameAr: 'صغير', price: 100000 }, { name: 'بزرگ', nameAr: 'كبير', price: 200000 }] })).id)
  const sizeRows = await db.select().from(productSizes).where(eq(productSizes.productId, productId as typeof products.$inferSelect.id))
  const size = required(sizeRows[0])
  const box = await packaging.add({ title: 'جعبه', titleAr: 'صندوق يدوي', price: 1000 })
  await gallery.add({ src: '/hardening.webp', alt: 'رستوران', altAr: 'المطعم', span: 'normal' })
  const image = required((await gallery.listAdmin())[0])
  await gallery.add({ src: '/hardening-two.webp', alt: 'شعبه', altAr: 'الفرع', span: 'normal' })
  await articles.createCategory({ name: 'مقاله', nameAr: 'المقالات', hasSubCategories: true, subCategories: ['بخش'], subCategoriesAr: ['قسم'] })
  const articleCategory = required((await articles.categories('fa', true))[0])
  const subcategory = required(articleCategory.subCategories[0])
  const articleInput = { title: 'عنوان', excerpt: 'خلاصه', content: 'متن', categoryId: articleCategory.id,
    titleAr: 'عنوان يدوي', excerptAr: 'ملخص', contentAr: 'محتوى' }
  const articleId = required((await articles.create(articleInput)).id)
  const firstSectionId = createContentCollectionItemId('sections')
  const firstTermId = createContentCollectionItemId(`${firstSectionId}:items`)
  const firstSections = [{ title: 'قوانین', items: ['بند اول'] }]
  const firstSectionsAr = [{ title: 'القواعد', items: ['البند الأول'] }]
  const firstTermIdentities = [{ collectionPath: ['sections'], itemIds: [firstSectionId] },
    { collectionPath: ['sections', 0, 'items'], itemIds: [firstTermId] }]
  await termService.update(firstSections, null, [
    { fieldId: firstSectionId, fieldPath: ['sections', 0, 'title'], sourceText: 'قوانین', value: 'القواعد', revision: 0, origin: 'manual' },
    { fieldId: firstTermId, fieldPath: ['sections', 0, 'items', 0], sourceText: 'بند اول', value: 'البند الأول', revision: 0, origin: 'manual' },
  ], undefined, firstTermIdentities)
  const firstTerms = required((await db.select().from(terms))[0])
  assert.deepEqual(firstTerms.sectionsAr, firstSectionsAr)
  assert.deepEqual(collectionTranslationIdentities('terms', firstTerms), firstTermIdentities)
  assert(contentTranslationFields('terms', firstTerms).every(field => field.origin === 'manual' && field.status === 'translated'))
  pass('first Terms save accepts stable section/item identities and explicit manual proofs without a persisted revision')
  const reason = 'تعمیرات ضروری آشپزخانه رستوران'
  await settings.setTemporaryCloseContent({ closed: true, reason, reasonAr: 'صيانة مطبخ المطعم', disablePayments: false })
  const aboutBody = { heroTitle: 'درباره ما', heroText: 'داستان', heroGradient: '', teamTitle: 'تیم', teamGradient: '', teamAlt: 'تیم ما', heroTitleAr: 'من نحن' }
  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(aboutRoutes({ db, sessions: { authenticate: async () => ({ user: { id: crypto.randomUUID(), role: 'admin' }, ctx: {} }) } as never,
    settings: { restaurantLocation: async () => ({ lat: 35, lng: 51 }) } })).compile()
  const aboutSave = async (revision: unknown) => {
    const response = await app.handle(new Request('http://localhost/admin/about', { method: 'PATCH', headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
      body: JSON.stringify({ ...aboutBody, sourceRevision: revision }) }))
    if (response.status !== 200) throw new AppError('VALIDATION_ERROR', 'Expected About revision rejection', response.status)
  }
  await aboutSave(undefined)
  const cases: GuardCase[] = [
    { name: 'main category', type: 'mainCategory', read: () => read('mainCategory', mainId),
      save: revision => menu.updateMainCategory({ id: mainId, name: required(main).name, sourceRevision: revision as string }) },
    { name: 'category', type: 'category', read: () => read('category', categoryId),
      save: revision => menu.updateCategory({ id: categoryId, name: required(category).name, sourceRevision: revision as string }) },
    { name: 'product', type: 'product', read: () => read('product', productId),
      save: revision => menu.updateProduct({ ...productInput, id: productId, sourceRevision: revision as string }) },
    { name: 'product size', type: 'productSize', read: () => read('productSize', size.id), save: async revision => {
      const parent = await read('product', productId)
      const currentSizes = await db.select().from(productSizes).where(eq(productSizes.productId, size.productId))
      return menu.updateProduct({ ...productInput, id: productId, sourceRevision: contentSourceRevision('product', parent),
        sizes: currentSizes.map(item => ({ id: item.id, name: item.name, price: item.price,
          sourceRevision: item.id === size.id ? revision as string : contentSourceRevision('productSize', item) })) })
    } },
    { name: 'packaging', type: 'packagingItem', read: () => read('packagingItem', box.id),
      save: revision => packaging.update(box.id, { price: 1000, sourceRevision: revision as string }) },
    { name: 'gallery', type: 'gallery', read: () => read('gallery', image.id),
      save: revision => gallery.update(image.id, { src: image.src, sourceRevision: revision as string }) },
    { name: 'article', type: 'article', read: () => read('article', articleId),
      save: revision => articles.update(articleId, { ...articleInput, sourceRevision: revision as string }) },
    { name: 'article category', type: 'articleCategory', read: () => read('articleCategory', articleCategory.id),
      save: revision => articles.updateCategory(articleCategory.id, { name: articleCategory.name, hasSubCategories: true, sourceRevision: revision as string }) },
    { name: 'article subcategory', type: 'articleSubCategory', read: () => read('articleSubCategory', subcategory.id), save: async revision => {
      const parent = await read('articleCategory', articleCategory.id)
      return articles.updateCategory(articleCategory.id, { name: articleCategory.name, hasSubCategories: true,
        sourceRevision: contentSourceRevision('articleCategory', parent), subCategoryEntries: [{ id: subcategory.id, name: subcategory.name, sourceRevision: revision as string }] })
    } },
    { name: 'About', type: 'about', read: async () => required((await db.select().from(contentAbout))[0]) as unknown as Record<string, unknown>, save: aboutSave },
    { name: 'terms', type: 'terms', read: async () => required((await db.select().from(terms).orderBy(desc(terms.version)).limit(1))[0]) as unknown as Record<string, unknown>, save: async revision => {
      const current = required((await db.select().from(terms).orderBy(desc(terms.version)).limit(1))[0])
      return termService.update(current.sections, current.sectionsAr, [], revision as string, collectionTranslationIdentities('terms', current))
    } },
    { name: 'temporary closure', type: 'temporaryClose', read: () => settings.readTemporaryCloseContent(),
      save: revision => settings.setTemporaryCloseContent({ closed: true, reason, disablePayments: false, sourceRevision: revision as string }) },
  ]
  for (const entity of cases) {
    const before = await entity.read()
    for (const revision of [undefined, null, '', 'malformed', `sha256:${'f'.repeat(64)}`, contentSourceRevision(entity.type, { ...before, id: 'foreign-entity' })]) {
      await assert.rejects(entity.save(revision), invalid, `${entity.name} must reject absent, malformed, stale and foreign proofs`)
      assert.deepEqual(await entity.read(), before, `${entity.name} rejected saves leave all source, Arabic and metadata untouched`)
    }
    pass(`${entity.name}: missing/null/empty/malformed/foreign revisions reject atomically`)
    const token = contentSourceRevision(entity.type, before)
    const race = await Promise.allSettled([entity.save(token), entity.save(token)])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, `${entity.name} has exactly one winning save`)
    assert.equal(race.filter(result => result.status === 'rejected').length, 1)
    assert.notEqual(contentSourceRevision(entity.type, await entity.read()), token, 'Every accepted no-op or metadata save advances the token')
    await assert.rejects(entity.save(token), invalid)
    pass(`${entity.name}: concurrent same-revision/no-op saves accept one winner and reject later reuse`)
  }
  const parent = await read('product', productId)
  await assert.rejects(menu.updateProduct({ ...productInput, id: productId, sourceRevision: contentSourceRevision('product', parent), ingredients: ['پنیر', 'سس'] }), invalid)
  await assert.rejects(menu.updateCategory({ id: categoryId, name: required(category).name, sourceRevision: contentSourceRevision('category', await read('category', categoryId)), sizeNames: ['کوچک', 'بزرگ'] }), invalid)
  await assert.rejects(articles.updateCategory(articleCategory.id, { name: articleCategory.name, hasSubCategories: true,
    sourceRevision: contentSourceRevision('articleCategory', await read('articleCategory', articleCategory.id)), subCategories: ['بخش'] }), invalid)
  pass('mutable arrays reject omitted stable identity lists; subcategory edits reject name matching')
  const beforeDuplicate = await read('articleCategory', articleCategory.id)
  const beforeDuplicateChild = await read('articleSubCategory', subcategory.id)
  const duplicateEntry = { id: subcategory.id, name: subcategory.name, sourceRevision: contentSourceRevision('articleSubCategory', beforeDuplicateChild) }
  await assert.rejects(articles.updateCategory(articleCategory.id, { name: articleCategory.name, hasSubCategories: true,
    sourceRevision: contentSourceRevision('articleCategory', beforeDuplicate), subCategoryEntries: [duplicateEntry, { ...duplicateEntry, name: 'نام دوم برای یک شناسه' }] }), invalid)
  assert.deepEqual(await read('articleCategory', articleCategory.id), beforeDuplicate)
  assert.deepEqual(await read('articleSubCategory', subcategory.id), beforeDuplicateChild)
  pass('duplicate subcategory database IDs reject the complete transaction without replacing a sibling')
  await articles.createCategory({ name: 'دسته حفاظت از ساب‌دسته', nameAr: 'فئة محفوظة يدويا', hasSubCategories: true,
    subCategories: ['بخش اول', 'بخش دوم'], subCategoriesAr: ['الأول المحرر', 'الثاني المحرر يدويا'] })
  const collisionCategory = required((await articles.categories('fa', true)).find(row => row.name === 'دسته حفاظت از ساب‌دسته'))
  const collisionParent = await read('articleCategory', collisionCategory.id)
  const collisionChildren = await db.select().from(articleSubCategories).where(eq(articleSubCategories.categoryId, collisionCategory.id)).orderBy(articleSubCategories.id)
  const collisionFirst = required(collisionChildren.find(row => row.name === 'بخش اول'))
  const collisionSecond = required(collisionChildren.find(row => row.name === 'بخش دوم'))
  const collisionArticleId = required((await articles.create({ ...articleInput, categoryId: collisionCategory.id, subCategoryId: collisionSecond.id })).id)
  const collisionArticle = await read('article', collisionArticleId)
  const collisionVersion = cache.get('articles:ver')
  const collisionFirstEntry = { id: collisionFirst.id, name: ` ${collisionSecond.name} `, nameAr: collisionFirst.nameAr,
    sourceRevision: contentSourceRevision('articleSubCategory', collisionFirst) }
  const collisionSecondEntry = { id: collisionSecond.id, name: collisionSecond.name, nameAr: collisionSecond.nameAr,
    sourceRevision: contentSourceRevision('articleSubCategory', collisionSecond) }
  for (const entries of [[collisionFirstEntry, collisionSecondEntry], [collisionSecondEntry, collisionFirstEntry]]) {
    await assert.rejects(articles.updateCategory(collisionCategory.id, { name: 'والد نباید تغییر کند', hasSubCategories: true,
      sourceRevision: contentSourceRevision('articleCategory', collisionParent), subCategoryEntries: entries }), invalid)
    assert.deepEqual(await read('articleCategory', collisionCategory.id), collisionParent)
    assert.deepEqual(await db.select().from(articleSubCategories).where(eq(articleSubCategories.categoryId, collisionCategory.id)).orderBy(articleSubCategories.id), collisionChildren)
    assert.deepEqual(await read('article', collisionArticleId), collisionArticle)
    assert.equal(cache.get('articles:ver'), collisionVersion, 'Rejected ambiguous saves publish no cache invalidation')
  }
  pass('distinct subcategory IDs with duplicate trimmed names reject in either order and preserve untouched manual Arabic and linked articles')
  await assert.rejects(articles.updateCategory(collisionCategory.id, { name: 'والد نباید تغییر کند', hasSubCategories: true,
    sourceRevision: contentSourceRevision('articleCategory', collisionParent), subCategoryEntries: [
      { ...collisionFirstEntry, name: collisionFirst.name }, { ...collisionSecondEntry, name: '   ' },
    ] }), invalid)
  assert.deepEqual(await read('articleCategory', collisionCategory.id), collisionParent)
  assert.deepEqual(await db.select().from(articleSubCategories).where(eq(articleSubCategories.categoryId, collisionCategory.id)).orderBy(articleSubCategories.id), collisionChildren)
  assert.deepEqual(await read('article', collisionArticleId), collisionArticle)
  assert.equal(cache.get('articles:ver'), collisionVersion)
  pass('blank persisted subcategory names reject atomically without deleting their manual Arabic or clearing article links')
  const galleryRows = await gallery.listAdmin()
  const maps = Object.fromEntries(galleryRows.map(row => [row.id, row.sourceRevision]))
  await assert.rejects(gallery.reorder(image.id, 'down', { [image.id]: required(maps[image.id]) }), invalid)
  await gallery.reorder(image.id, 'down', maps)
  await assert.rejects(gallery.reorder(image.id, 'up', maps), invalid)
  assert.equal(required((await gallery.listAdmin()).find(row => row.id === image.id)).altAr, image.altAr)
  pass('gallery reorder requires both row proofs, advances both revisions and preserves manual alt text')
  const atBoundary = required((await gallery.listAdmin()).find(row => row.id === image.id))
  const boundaryMap = { [image.id]: atBoundary.sourceRevision }
  const boundaryRace = await Promise.allSettled([gallery.reorder(image.id, 'down', boundaryMap), gallery.reorder(image.id, 'down', boundaryMap)])
  assert.equal(boundaryRace.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(boundaryRace.filter(result => result.status === 'rejected').length, 1)
  assert.notEqual(required((await gallery.listAdmin()).find(row => row.id === image.id)).sourceRevision, atBoundary.sourceRevision)
  pass('gallery boundary no-op advances its target revision and rejects concurrent same-token reuse')
  const articleToken = contentSourceRevision('article', await read('article', articleId))
  await assert.rejects(articles.toggle(articleId, undefined as unknown as string), invalid)
  await articles.toggle(articleId, articleToken)
  await assert.rejects(articles.toggle(articleId, articleToken), invalid)
  assert.equal((await read('article', articleId)).titleAr, articleInput.titleAr)
  pass('article status actions require a fresh proof and preserve manual Arabic')
  const singleActions: GuardCase[] = [
    { name: 'main visibility', type: 'mainCategory', read: () => read('mainCategory', mainId), save: revision => menu.toggleMainCategory(mainId, revision as string) },
    { name: 'main purchase', type: 'mainCategory', read: () => read('mainCategory', mainId), save: async revision => menu.setMainPurchase(mainId, Boolean((await read('mainCategory', mainId)).purchaseEnabled), revision as string) },
    { name: 'category purchase', type: 'category', read: () => read('category', categoryId), save: async revision => menu.setCategoryPurchase(categoryId, Boolean((await read('category', categoryId)).purchaseEnabled), revision as string) },
    { name: 'product status', type: 'product', read: () => read('product', productId), save: revision => menu.toggleProductStatus(productId, revision as string) },
    { name: 'product availability', type: 'product', read: () => read('product', productId), save: async revision => menu.setProductAvailability(productId, Boolean((await read('product', productId)).isAvailable), revision as string) },
  ]
  for (const action of singleActions) {
    const before = await action.read()
    for (const proof of [undefined, null, '', `sha256:${'e'.repeat(64)}`]) {
      await assert.rejects(action.save(proof), invalid)
      assert.deepEqual(await action.read(), before)
    }
    const token = contentSourceRevision(action.type, before)
    const race = await Promise.allSettled([action.save(token), action.save(token)])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(race.filter(result => result.status === 'rejected').length, 1)
    await assert.rejects(action.save(token), invalid)
    assert.deepEqual((await action.read()).translationState && ((await action.read()).translationState as { fields: unknown }).fields,
      (before.translationState as { fields: unknown }).fields)
    pass(`${action.name}: bypass/stale proofs reject, one same-revision action wins and manual text stays valid`)
  }
  const [otherMain] = await db.insert(mainCategories).values({ name: 'دسته دوم', nameAr: 'قسم يدوي آخر', slug: 'hardening-main-two', sortOrder: 1, isDefault: true, isActive: true }).returning()
  const otherMainId = required(otherMain).id
  const mainProofs = async () => Object.fromEntries((await menu.adminMainCategories()).map(row => [row.id, row.sourceRevision]))
  const beforeDefaults = await menu.adminMainCategories()
  const firstDefaultProofs = await mainProofs()
  await assert.rejects(menu.setDefaultMainCategory(mainId, { [mainId]: required(firstDefaultProofs[mainId]) }), invalid)
  assert.deepEqual(await menu.adminMainCategories(), beforeDefaults, 'Missing peer proof rolls back all default changes')
  assert.equal((await menu.setDefaultMainCategory(mainId, firstDefaultProofs)).success, true)
  await assert.rejects(menu.setDefaultMainCategory(otherMainId, firstDefaultProofs), invalid)
  const currentDefaults = await mainProofs()
  const defaultRace = await Promise.allSettled([menu.setDefaultMainCategory(otherMainId, currentDefaults), menu.setDefaultMainCategory(otherMainId, currentDefaults)])
  assert.equal(defaultRace.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(defaultRace.filter(result => result.status === 'rejected').length, 1)
  assert(defaultRace.some(result => result.status === 'fulfilled' && result.value.success))
  assert.equal((await menu.adminMainCategories()).filter(row => row.isDefault).length, 1)
  pass('default selection requires every affected row proof, rolls back missing peers and accepts one race winner')
  const beforeMainOrder = await menu.adminMainCategories()
  const reorderProofs = await mainProofs()
  await assert.rejects(menu.reorderMainCategory(mainId, 'down', { [mainId]: required(reorderProofs[mainId]) }), invalid)
  assert.deepEqual(await menu.adminMainCategories(), beforeMainOrder)
  await menu.reorderMainCategory(mainId, 'down', reorderProofs)
  await assert.rejects(menu.reorderMainCategory(mainId, 'up', reorderProofs), invalid)
  const mainBoundaryProofs = await mainProofs()
  const mainBoundaryRace = await Promise.allSettled([menu.reorderMainCategory(mainId, 'down', mainBoundaryProofs), menu.reorderMainCategory(mainId, 'down', mainBoundaryProofs)])
  assert.equal(mainBoundaryRace.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(mainBoundaryRace.filter(result => result.status === 'rejected').length, 1)
  const finalMains = await menu.adminMainCategories()
  assert.equal(required(finalMains.find(row => row.id === mainId)).nameAr, required(main).nameAr)
  assert.equal(required(finalMains.find(row => row.id === otherMainId)).nameAr, required(otherMain).nameAr)
  pass('main reorder and boundary no-op require fresh proofs and preserve all manual category Arabic')
  assert.equal((await db.select().from(articleSubCategories).where(eq(articleSubCategories.id, subcategory.id))).length, 1)
  console.log(`${checks} database save-hardening groups passed`)
} finally {
  globalThis.fetch = fetchBefore
  await database?.close()
  if (created) await admin.unsafe(`drop database "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
