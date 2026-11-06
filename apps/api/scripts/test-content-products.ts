import { fixtureUpdateProduct, fixtureUpdateCategory, fixtureUpdateMainCategory, fixtureUpdatePackaging } from './content-save-fixtures'
/** Field provenance/product persistence regressions. Disposable local PostgreSQL only; no translator network calls. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import { collectionTranslationIdentities, contentSourceRevision, contentTranslationFields, createContentCollectionItemId, type TranslationEdit } from '@sinshin/shared'
import { Database } from '../src/infra/db/client'
import { MenuService, type ProductDto } from '../src/domain/menu/menu.service'
import { PackagingService } from '../src/domain/menu/packaging.service'
import { CartService } from '../src/domain/cart/cart.service'
import { AppError } from '../src/domain/shared/errors'
import { categories, mainCategories, productSizes, products } from '../src/infra/db/schema'
import type { RedisService } from '../src/infra/redis/redis'
import { adminMenuRoutes } from '../src/http/routes/admin-menu.routes'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_content_products_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source); scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
const requireValue = <T>(value: T | null | undefined): T => {
  assert(value !== null && value !== undefined, 'Expected a populated regression fixture value')
  return value
}

let count = 0
const passed = (name: string) => { count++; console.log(`PASS ${name}`) }
const cache = new Map<string, unknown>()
const redis = {
  get: async (key: string) => cache.get(key) ?? null,
  getJson: async (key: string) => cache.get(key) ?? null,
  setJson: async (key: string, value: unknown) => { cache.set(key, value) },
  incr: async (key: string) => { const next = Number(cache.get(key) ?? 0) + 1; cache.set(key, next); return next },
} as unknown as RedisService
const previousFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('External requests forbidden in translation regression tests') }) as unknown as typeof fetch
const validation = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'

try {
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
  const menu = new MenuService({ db, redis })
  const packaging = new PackagingService({ db })
  const cart = new CartService({ db })
  const [main] = await db.insert(mainCategories).values({ name: 'رستوران', nameAr: 'مطعم', slug: 'restaurant', isActive: true }).returning()
  const [category] = await db.insert(categories).values({ mainCategoryId: requireValue(main).id, name: 'غذا', nameAr: 'طعام', slug: 'food',
    hasSizes: true, sizeNames: ['کوچک', 'بزرگ'], sizeNamesAr: ['صغير', 'كبير'] }).returning()
  const base = { name: 'غذا', description: 'توضیح', originalPrice: 100000, discountPercentage: 0, prepTime: 15,
    categoryIds: [requireValue(category).id], sizesEnabled: true }
  const created = await menu.createProduct({ ...base, nameAr: 'وجبة', descriptionAr: 'وصف يدوي',
    ingredients: ['پنیر', 'قارچ', 'سس'], ingredientsAr: ['جبن', 'فطر', 'صلصة'],
    sizes: [{ name: 'کوچک', nameAr: 'صغير', price: 100000 }, { name: 'بزرگ', nameAr: 'كبير', price: 200000 }] })
  assert.equal(created.success, true)
  const pid = requireValue(created.id) as typeof products.$inferSelect.id
  const read = async () => requireValue((await db.select().from(products).where(eq(products.id, pid)))[0])
  const sizes = async () => (await db.select().from(productSizes).where(eq(productSizes.productId, pid))).sort((a, b) => a.sortOrder - b.sortOrder)
  const field = async (id: string) => requireValue(contentTranslationFields('product', await read()).find(item => item.fieldId === id))

  const editDetails = requireValue(await menu.adminProductDetails(pid))
  assert.equal(editDetails.sourceRevision, contentSourceRevision('product', await read()))
  assert.equal(editDetails.nameAr, (await read()).nameAr, 'edit details retain raw Arabic fields')
  for (const size of await sizes()) {
    const editSize = requireValue(editDetails.sizes.find(item => item.id === size.id))
    assert.equal(editSize.nameAr, size.nameAr)
    assert.equal(editSize.sourceRevision, contentSourceRevision('productSize', size), 'edit details retain size revisions')
  }

  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(adminMenuRoutes({
    menu, packaging,
    sessions: { authenticate: async () => ({ user: { id: crypto.randomUUID(), role: 'admin' }, ctx: {} }) } as never,
    admin2: {} as never,
    audit: { log: async () => undefined } as never,
  })).compile()
  const request = (method: string, path: string, body?: unknown) => app.handle(new Request(`http://localhost/admin/menu${path}`, {
    method, headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  const adminCard = async () => {
    const response = await request('GET', '/products?page=1&limit=10')
    assert.equal(response.status, 200)
    const list = await response.json() as { products: ProductDto[] }
    const card = requireValue(list.products.find(product => product.id === pid))
    assert.equal(card.sourceRevision, contentSourceRevision('product', await read()), 'card revision matches the complete persisted product')
    for (const key of ['nameAr', 'descriptionAr', 'ingredientsAr', 'arAuto', 'translationState', 'translationIdentities']) {
      assert.equal(key in card, false, `admin card omits ${key}`)
    }
    assert.equal(card.sizes.length, 2)
    assert(card.sizes.every(size => !('nameAr' in size) && !('translationState' in size)), 'card sizes omit Arabic translation fields')
    return card
  }
  for (const available of [false, true]) {
    const card = await adminCard()
    assert.equal(card.isAvailable, !available)
    const response = await request('POST', `/products/${pid}/availability`, { available, sourceRevision: card.sourceRevision })
    assert.equal(response.status, 200, `admin list revision permits marking the product ${available ? 'available' : 'unavailable'}`)
    const result = await response.json() as { success: boolean; sourceRevision: string }
    assert.equal(result.success, true)
    assert.equal((await read()).isAvailable, available)
    assert.equal(result.sourceRevision, contentSourceRevision('product', await read()))
    assert.notEqual(result.sourceRevision, card.sourceRevision, 'availability change advances the revision')
    const refreshed = await adminCard()
    assert.equal(refreshed.isAvailable, available)
    assert.equal(refreshed.sourceRevision, result.sourceRevision)
    const saved = await read()
    assert.equal((await request('POST', `/products/${pid}/availability`, { available: !available })).status, 422,
      'availability endpoint requires a source revision')
    assert.equal((await request('POST', `/products/${pid}/availability`, { available: !available, sourceRevision: card.sourceRevision })).status, 422,
      'availability endpoint rejects the stale card revision')
    assert.deepEqual(await read(), saved, 'rejected availability requests leave the product unchanged')
    passed(`admin card list revision marks product ${available ? 'available' : 'unavailable'} and rejects missing/stale proofs`)
  }

  const version = Number(cache.get('menu:ver'))
  await menu.productById(pid, 'ar')
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, description: 'توضیح تازه', nameAr: 'وجبة', descriptionAr: 'وصف يدوي' })
  let row = await read()
  assert.equal(row.nameAr, 'وجبة')
  assert.equal(row.descriptionAr, null)
  assert.equal((await field('description')).status, 'needs-review')
  assert.equal((await field('description')).staleValue, 'وصف يدوي')
  assert.deepEqual(row.ingredientsAr, ['جبن', 'فطر', 'صلصة'])
  assert.deepEqual((await sizes()).map(size => size.nameAr), ['صغير', 'كبير'])
  assert.equal(requireValue((await menu.productById(pid, 'ar'))).description, 'توضیح تازه')
  assert(Number(cache.get('menu:ver')) > version)
  passed('only changed description becomes reviewable stale draft; manual siblings and cache fallback stay correct')

  const description = await field('description')
  const edit: TranslationEdit = { fieldId: description.fieldId, fieldPath: description.fieldPath, sourceText: description.sourceText,
    revision: description.revision, value: 'وصف مراجع', origin: 'manual' }
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, description: 'توضیح تازه', translationEdits: [edit] })
  assert.equal((await read()).descriptionAr, 'وصف مراجع')
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', nameAr: 'وجبة' })
  row = await read()
  assert.equal(row.nameAr, null)
  assert.equal(row.descriptionAr, 'وصف مراجع')
  assert.deepEqual(row.ingredientsAr, ['جبن', 'فطر', 'صلصة'])
  passed('manual review binds to current source; name edit invalidates only name')

  const originalIngredientIds = requireValue(collectionTranslationIdentities('product', await read())[0]).itemIds
  const ingredientIds = (itemIds: string[]) => [{ collectionPath: ['ingredients'], itemIds }]
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه',
    ingredients: ['سس', 'پنیر', 'قارچ'], ingredientsAr: ['جبن', 'فطر', 'صلصة'],
    translationIdentities: ingredientIds([requireValue(originalIngredientIds[2]), requireValue(originalIngredientIds[0]), requireValue(originalIngredientIds[1])]) })
  assert.deepEqual((await read()).ingredientsAr, ['صلصة', 'جبن', 'فطر'])
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', ingredients: ['سس', 'پنیر', 'قارچ تازه'] })
  assert.deepEqual((await read()).ingredientsAr, ['صلصة', 'جبن', ''])
  assert.equal(contentTranslationFields('product', await read()).filter(item => item.status === 'needs-review').length, 2)
  const freshIngredientId = createContentCollectionItemId('ingredients')
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', ingredients: ['تازه', 'پنیر', 'سس', 'قارچ تازه'],
    translationIdentities: ingredientIds([freshIngredientId, requireValue(originalIngredientIds[0]), requireValue(originalIngredientIds[2]), requireValue(originalIngredientIds[1])]) })
  assert.deepEqual((await read()).ingredientsAr, ['', 'جبن', 'صلصة', ''])
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', ingredients: ['پنیر', 'سس'],
    translationIdentities: ingredientIds([requireValue(originalIngredientIds[0]), requireValue(originalIngredientIds[2])]) })
  assert.deepEqual((await read()).ingredientsAr, ['جبن', 'صلصة'])
  passed('ingredient reorders, source edits, insertion and deletion never misassign Arabic values')

  const originalSizes = await sizes()
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه',
    sizes: originalSizes.slice().reverse().map(size => ({ id: size.id, name: size.name, price: size.price + 1,
      image: '/uploads/new.webp', discountPercentage: 5 })) })
  assert.deepEqual((await sizes()).map(size => [size.id, size.nameAr]), originalSizes.slice().reverse().map(size => [size.id, size.nameAr]))
  assert((await sizes()).every(size => requireValue(contentTranslationFields('productSize', size)[0]).status === 'translated'))
  const reordered = await sizes()
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', sizes: reordered.map((size, index) => ({
    id: size.id, name: index === 0 ? 'خیلی بزرگ' : size.name, nameAr: size.nameAr, price: size.price,
  })) })
  const renamed = await sizes()
  assert.deepEqual(renamed.map(size => size.id), reordered.map(size => size.id))
  assert.equal(requireValue(renamed[0]).nameAr, null)
  assert.equal(requireValue(renamed[1]).nameAr, requireValue(reordered[1]).nameAr)
  assert.equal(requireValue(contentTranslationFields('productSize', renamed[0])[0]).staleValue, requireValue(requireValue(reordered[0]).nameAr))
  passed('size IDs survive reordering and rename; prices/images/discounts never invalidate names')

  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', sizes: renamed.map((size, index) => ({
    id: size.id, name: requireValue(renamed[1 - index]).name, price: size.price,
  })) })
  assert.deepEqual((await sizes()).map(size => size.id), renamed.map(size => size.id))
  await assert.rejects(fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه',
    sizes: [{ id: crypto.randomUUID(), name: 'ناشناخته', price: 1 }] }), validation)
  await assert.rejects(fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه',
    sizes: [{ id: requireValue(renamed[0]).id, name: 'یک', price: 1 }, { id: requireValue(renamed[0]).id, name: 'دو', price: 2 }] }), validation)
  passed('exchanging size names retains IDs; foreign and duplicate size IDs are rejected atomically')

  row = await read()
  const missingName = requireValue(contentTranslationFields('product', row).find(item => item.fieldId === 'name'))
  const nameProof: TranslationEdit = { ...missingName, value: 'اسم مراجع', origin: 'manual' }
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'غذای تازه', description: 'توضیح تازه', translationEdits: [nameProof] })
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'آخرین غذا', description: 'توضیح تازه' })
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'آخرین غذا', description: 'توضیح تازه',
    nameAr: 'اسم مراجع', translationEdits: [nameProof] })
  assert.equal((await read()).nameAr, null)
  assert.equal((await read()).descriptionAr, 'وصف مراجع')
  passed('old source proof and unchanged old Arabic forms cannot restore stale translations')

  const simple = await menu.createProduct({ ...base, name: 'ترجمه خودکار', description: 'توضیح خودکار', sizesEnabled: false })
  const automaticId = requireValue(simple.id) as typeof products.$inferSelect.id
  const autoRow = requireValue((await db.select().from(products).where(eq(products.id, automaticId)))[0])
  const autoDescription = requireValue(contentTranslationFields('product', autoRow).find(item => item.fieldId === 'description'))
  await fixtureUpdateProduct(menu, db, { ...base, id: automaticId, name: autoRow.name, description: requireValue(autoRow.description), sizesEnabled: false,
    translationEdits: [{ ...autoDescription, value: 'وصف آلي', origin: 'automatic' }] })
  await fixtureUpdateProduct(menu, db, { ...base, id: automaticId, name: autoRow.name, description: 'توضیح جدید', sizesEnabled: false })
  const changedAuto = requireValue((await db.select().from(products).where(eq(products.id, automaticId)))[0])
  const changedField = requireValue(contentTranslationFields('product', changedAuto).find(item => item.fieldId === 'description'))
  assert.equal(changedField.status, 'needs-retranslation')
  await fixtureUpdateProduct(menu, db, { ...base, id: automaticId, name: autoRow.name, description: 'توضیح جدید', sizesEnabled: false,
    translationEdits: [{ ...changedField, value: 'وصف جديد آلي', origin: 'automatic' }] })
  assert.equal(requireValue((await db.select().from(products).where(eq(products.id, automaticId)))[0]).descriptionAr, 'وصف جديد آلي')
  passed('completed automatic field can be invalidated and filled again without changing sibling fields')

  const listed = requireValue((await menu.productsByMain('restaurant', 'ar')).products.find(product => product.id === pid))
  const detailed = requireValue((await menu.productById(pid, 'ar')))
  const cartItem = requireValue((await cart.details([{ productId: pid, quantity: 1 }], 'ar')).items[0])
  assert.deepEqual([listed.name, listed.description, listed.ingredients, listed.categoryName, listed.sizes],
    [detailed.name, detailed.description, detailed.ingredients, detailed.categoryName, detailed.sizes])
  assert.equal(cartItem.name, detailed.name)
  assert.equal(cartItem.sizeName, requireValue(detailed.sizes[0]).name)
  assert.equal(listed.description, 'وصف مراجع')
  assert.deepEqual(listed.ingredients, ['جبن', 'صلصة'])
  assert.equal(listed.name, 'آخرین غذا')
  assert.equal('translationState' in listed, false)
  assert.equal('sourceRevision' in listed, false, 'public product lists omit admin save revisions')
  assert.equal('sourceRevision' in detailed, false, 'public product details omit admin save revisions')
  passed('product list, detail and cart localize the same valid fields without public provenance')

  await fixtureUpdateCategory(menu, db, { id: requireValue(category).id, name: 'غذای تازه' })
  const cat = requireValue((await db.select().from(categories).where(eq(categories.id, requireValue(category).id)))[0])
  assert.equal(cat.nameAr, null)
  assert.deepEqual(cat.sizeNames, ['کوچک', 'بزرگ'])
  assert.deepEqual(cat.sizeNamesAr, ['صغير', 'كبير'])
  const categorySizeIds = requireValue(collectionTranslationIdentities('category', cat)[0]).itemIds
  await fixtureUpdateCategory(menu, db, { id: requireValue(category).id, name: cat.name, sizeNames: ['بزرگ', 'کوچک تازه'],
    translationIdentities: [{ collectionPath: ['sizeNames'], itemIds: [requireValue(categorySizeIds[1]), requireValue(categorySizeIds[0])] }] })
  const changedCategory = requireValue((await db.select().from(categories).where(eq(categories.id, requireValue(category).id)))[0])
  assert.deepEqual(changedCategory.sizeNamesAr, ['كبير', ''])
  assert.equal(requireValue((await menu.productById(pid, 'ar'))).categoryName, 'غذای تازه')
  const publicCategory = requireValue((await menu.allCategories('ar')).find(item => item.id === requireValue(category).id))
  assert.deepEqual(publicCategory.sizeNames, ['كبير', 'کوچک تازه'])
  assert.equal('translationState' in publicCategory, false)
  passed('category name and individual size template lifecycle preserves omitted templates and partial fallback')

  await fixtureUpdateMainCategory(menu, db, { id: requireValue(main).id, name: 'رستوران تازه', nameAr: 'مطعم' })
  const publicMain = requireValue((await menu.activeMainCategories('ar'))[0])
  assert.equal(publicMain.name, 'رستوران تازه')
  assert.equal(publicMain.nameAr, null)
  assert.equal('translationState' in publicMain, false)
  passed('main category name invalidates independently and public fallback strips provenance')

  const box = await packaging.add({ title: 'جعبه', titleAr: 'صندوق', price: 500 })
  await fixtureUpdatePackaging(packaging, db, box.id, { price: 600, isActive: false })
  assert.equal(requireValue((await packaging.adminList()).find(item => item.id === box.id)).titleAr, 'صندوق')
  const changedBox = await fixtureUpdatePackaging(packaging, db, box.id, { title: 'جعبه تازه', titleAr: 'صندوق' })
  assert.equal(changedBox.titleAr, null)
  assert.equal(changedBox.price, 600)
  assert.equal(requireValue(contentTranslationFields('packagingItem', changedBox)[0]).staleValue, 'صندوق')
  passed('packaging title tracks independently while pricing and activity remain unchanged')

  const initialSource = await read()
  const revision = contentSourceRevision('product', initialSource)
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: initialSource.name, description: requireValue(initialSource.description), originalPrice: 150000,
    sourceRevision: revision })
  assert.notEqual(contentSourceRevision('product', await read()), revision, 'price edits advance the save revision without invalidating text')
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'نام جدید سرور', description: requireValue(initialSource.description) })
  await assert.rejects(fixtureUpdateProduct(menu, db, { ...base, id: pid, name: initialSource.name, description: 'فرم قدیمی', sourceRevision: revision }), validation)
  assert.equal((await read()).name, 'نام جدید سرور')
  const sizeBefore = requireValue((await sizes())[0])
  const oldSizeRevision = contentSourceRevision('productSize', sizeBefore)
  await fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'نام جدید سرور', description: requireValue(initialSource.description),
    sizes: (await sizes()).map((size, index) => ({ id: size.id, name: index === 0 ? 'سایز جدید' : size.name, price: size.price })) })
  await assert.rejects(fixtureUpdateProduct(menu, db, { ...base, id: pid, name: 'نام جدید سرور', description: requireValue(initialSource.description),
    sizes: (await sizes()).map((size, index) => ({ id: size.id, name: size.name, price: size.price,
      ...(index === 0 ? { sourceRevision: oldSizeRevision } : {}) })) }), validation)
  passed('stale full product/size forms reject every intervening save, including metadata-only edits')

  const catBefore = requireValue((await db.select().from(categories).where(eq(categories.id, requireValue(category).id)))[0])
  await fixtureUpdateCategory(menu, db, { id: requireValue(category).id, name: 'نام تازه دسته', sourceRevision: contentSourceRevision('category', catBefore) })
  await assert.rejects(fixtureUpdateCategory(menu, db, { id: requireValue(category).id, name: catBefore.name,
    sourceRevision: contentSourceRevision('category', catBefore) }), validation)
  const mainBefore = requireValue((await db.select().from(mainCategories).where(eq(mainCategories.id, requireValue(main).id)))[0])
  await fixtureUpdateMainCategory(menu, db, { id: requireValue(main).id, name: 'نام تازه والد', sourceRevision: contentSourceRevision('mainCategory', mainBefore) })
  await assert.rejects(fixtureUpdateMainCategory(menu, db, { id: requireValue(main).id, name: mainBefore.name,
    sourceRevision: contentSourceRevision('mainCategory', mainBefore) }), validation)
  await fixtureUpdatePackaging(packaging, db, box.id, { title: 'عنوان تازه', sourceRevision: changedBox.sourceRevision })
  await assert.rejects(fixtureUpdatePackaging(packaging, db, box.id, { title: changedBox.title,
    sourceRevision: changedBox.sourceRevision }), validation)
  passed('category/main/packaging source revisions reject outdated admin drafts independently')
  console.log(`Content product regressions: ${count} passed`)
} finally {
  globalThis.fetch = previousFetch
  await database?.close()
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
}
