/** Articles integration regressions. Creates/drops only a uniquely named scratch database on local PostgreSQL. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
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
  await db.update(articles).set({ arAuto: true }).where(eq(articles.id, id))
  await articlesService.update(id, { title: 'ویرایش', excerpt: 'خلاصه جدید', content: 'ignored for blocks', categoryId: category.id })
  const edited = (await articlesService.adminDetail(id))!
  check(edited.content === 'متن بلوکی' && edited.blocks?.blocks.length === 1, 'omitting blocks preserves the layout and its derived content')
  check(edited.titleAr === input.titleAr && edited.arAuto === true && edited.author === input.author
    && edited.profileImage === input.profileImage && edited.galleryImages.length === 1
    && edited.processes.length === 2 && edited.subCategoryId === sub.id && edited.isFeatured,
  'PATCH preserves omitted translations, media, processes, author, sub-category and flags')
  const arabic = (await articlesService.byId(id, 'ar'))!
  check(arabic.processes[0]?.title === 'مرحله اول' && arabic.processes[0]?.items.join('|') === 'یک|اثنان'
    && arabic.processes[1]?.items[0] === 'سه', 'Arabic process placeholders fall back to the corresponding Persian fields')
  check(arabic.blocks === null && arabic.content === 'محتوى', 'Arabic detail serves translated text without Persian blocks')
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
    processesAr: [{ title: '', items: ['', 'اثنان'] }, { title: '', items: [] }] }
  const request = (token?: string) => new Request('http://localhost/admin/articles', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  check((await app.handle(request('admin'))).status === 200, 'HTTP article creation accepts aligned blank Arabic process translations')
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
