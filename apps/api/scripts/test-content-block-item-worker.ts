/** Disposable local PostgreSQL and a deterministic in-process translator; no live requests. */
import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { bindArticleBlockItemIdentities, getArticleBlockTextFields, readArticleBlockText, reconcileArticleBlocksTranslation, reconcileContentTranslation, setArticleBlockTranslations, type ArticleBlocksDoc } from '@sinshin/shared'
import { ContentTranslationWorker } from '../src/domain/translation/content-translation.worker'
import { readContentRow } from '../src/domain/translation/content-translation.store'
import { Database } from '../src/infra/db/client'
import { articleCategories, articles } from '../src/infra/db/schema'

const url = new URL(process.env.CONTENT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
const scratch = `sinshin_block_identity_worker_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
url.pathname = `/${scratch}`
const admin = new SQL(adminUrl.toString(), { max: 1, connectionTimeout: 5 })
let database: Database | undefined
let created = false
const required = <T>(value: T | null | undefined): T => { assert.ok(value !== null && value !== undefined); return value }
const deferred = () => { let resolve: () => void = () => {}; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined
const calls: string[][] = []
let invalidations = 0
let failText: string | undefined
let checks = 0
const pass = (message: string) => { checks++; console.log(`PASS ${message}`) }
const source = bindArticleBlockItemIdentities({ version: 1, blocks: [
	{ id: 'list', type: 'list', props: { items: ['اول', 'دوم', 'سوم'] } },
	{ id: 'gallery', type: 'gallery', props: { layout: 'grid', images: [{ src: '/a.webp', alt: 'تصویر الف' }, { src: '/b.webp', alt: 'تصویر ب' }] } },
] })
const automatic = required(setArticleBlockTranslations(source, null, source.blocks.flatMap(block => getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: `قديم ${field.text}` }))), 'automatic'))
const reviewed = required(setArticleBlockTranslations(source, automatic, [{ blockId: 'list', path: ['items', 2], text: 'يدوي سوم' }], 'manual'))
try {
	await admin.unsafe(`create database "${scratch}"`); created = true
	database = new Database(url.toString(), { max: 8 })
	const db = database.db
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
	const categoryId = crypto.randomUUID()
	await db.insert(articleCategories).values({ id: categoryId, name: 'دسته', slug: 'blocks' })
	const id = crypto.randomUUID()
	await db.insert(articles).values(reconcileContentTranslation('article', id, null, { id, title: 'مقاله', titleAr: 'مقال', excerpt: 'خلاصه', excerptAr: 'ملخص', content: 'متن', contentAr: 'نص', categoryId, blocks: source, blocksAr: reviewed }))
	const worker = new ContentTranslationWorker({ db, translate: async texts => {
		assert.equal(texts.length, 1); calls.push([...texts])
		const pending = gate; gate = undefined
		if (pending) { pending.entered.resolve(); await pending.release.promise }
		if (texts[0] === failText) { failText = undefined; throw new Error('Mock field failure') }
		return texts.map(text => `جديد ${text}`)
	}, invalidate: async () => { invalidations++ } })
	const row = async () => required(await readContentRow(db, 'article', id))
	const saveBlocks = async (next: ArticleBlocksDoc) => db.transaction(async tx => {
		const current = required(await readContentRow(tx, 'article', id, true))
		const blocksAr = reconcileArticleBlocksTranslation(current.blocks as ArticleBlocksDoc, next, current.blocksAr)
		const reconciled = reconcileContentTranslation('article', id, current, { ...current, blocks: next, blocksAr })
		await tx.update(articles).set({ blocks: next, blocksAr, translationState: reconciled.translationState }).where(eq(articles.id, id))
	})
	const changed = structuredClone(source)
	const list = required(changed.blocks[0]); assert.ok(list.type === 'list')
	const initialIds = [...(list.props.itemIds ?? [])]
	list.props.items = ['سوم', 'دوم تازه', 'اول تازه']
	list.props.itemIds = [initialIds[2] ?? '', initialIds[1] ?? '', initialIds[0] ?? '']
	await saveBlocks(changed)
	await worker.run('article', id)
	assert.deepEqual(calls, [['دوم تازه'], ['اول تازه']])
	const result = await row()
	assert.deepEqual((result.blocksAr as ArticleBlocksDoc).blocks[0]?.type === 'list' ? (result.blocksAr as ArticleBlocksDoc).blocks[0]?.props : undefined,
		{ items: ['يدوي سوم', 'جديد دوم تازه', 'جديد اول تازه'], itemIds: list.props.itemIds })
	assert.equal(invalidations, 2)
	pass('save/reload/worker translates only two simultaneously edited and reordered IDs, retaining manual and gallery siblings')
	await worker.run('article', id)
	assert.equal(calls.length, 2)
	pass('completed nested fields are not retransmitted')

	const pendingSource = structuredClone(changed)
	const pendingList = required(pendingSource.blocks[0]); assert.ok(pendingList.type === 'list')
	pendingList.props.items[2] = 'اول انتظار'
	await saveBlocks(pendingSource)
	const pendingGate = { entered: deferred(), release: deferred() }; gate = pendingGate
	const running = worker.run('article', id)
	await pendingGate.entered.promise
	const movedSource = structuredClone(pendingSource)
	const movedList = required(movedSource.blocks[0]); assert.ok(movedList.type === 'list')
	movedList.props.items = [pendingList.props.items[2] ?? '', pendingList.props.items[0] ?? '', pendingList.props.items[1] ?? '']
	movedList.props.itemIds = [pendingList.props.itemIds?.[2] ?? '', pendingList.props.itemIds?.[0] ?? '', pendingList.props.itemIds?.[1] ?? '']
	await saveBlocks(movedSource)
	pendingGate.release.resolve(); await running
	const movedResult = await row()
	assert.equal(readArticleBlockText((movedResult.blocksAr as ArticleBlocksDoc).blocks[0], ['items', 0]), 'جديد اول انتظار')
	assert.equal(readArticleBlockText((movedResult.blocksAr as ArticleBlocksDoc).blocks[0], ['items', 2]), 'جديد دوم تازه')
	pass('in-flight worker results follow stable item IDs to their latest paths after order-only saves')

	const staleSource = structuredClone(movedSource)
	const staleList = required(staleSource.blocks[0]); assert.ok(staleList.type === 'list')
	staleList.props.items[0] = 'اول قدیمی در انتظار'
	await saveBlocks(staleSource)
	const staleGate = { entered: deferred(), release: deferred() }; gate = staleGate
	const obsolete = worker.run('article', id)
	await staleGate.entered.promise
	const latestSource = structuredClone(staleSource)
	const latestList = required(latestSource.blocks[0]); assert.ok(latestList.type === 'list')
	latestList.props.items[0] = 'اول آخرین'
	await saveBlocks(latestSource)
	staleGate.release.resolve(); await obsolete
	assert.equal(readArticleBlockText(((await row()).blocksAr as ArticleBlocksDoc).blocks[0], ['items', 0]), '')
	await worker.run('article', id)
	assert.equal(readArticleBlockText(((await row()).blocksAr as ArticleBlocksDoc).blocks[0], ['items', 0]), 'جديد اول آخرین')
	assert.deepEqual(calls.slice(-2), [['اول قدیمی در انتظار'], ['اول آخرین']])
	pass('obsolete asynchronous text is discarded and retry sends only the latest changed source field')

	const removedSource = structuredClone(latestSource)
	const removedList = required(removedSource.blocks[0]); assert.ok(removedList.type === 'list')
	const removedManualId = required(removedList.props.itemIds?.[1])
	removedList.props.items.splice(1, 1); removedList.props.itemIds?.splice(1, 1)
	removedList.props.items[0] = 'اول شکست'
	await saveBlocks(removedSource)
	const beforeFailure = await row()
	const oldState = required((beforeFailure.blocksAr as ArticleBlocksDoc).translation)
	assert.ok(oldState?.retiredItemIds?.includes(removedManualId))
	assert.ok(oldState?.orphanedFields?.some(field => field.itemId === removedManualId && field.staleValue === 'يدوي سوم'))
	const revisionBefore = beforeFailure.translationState?.writeRevision
	const invalidationsBefore = invalidations
	failText = 'اول شکست'
	await assert.rejects(() => worker.run('article', id), /Mock field failure/)
	const failureRow = await row()
	const failureState = (failureRow.blocksAr as ArticleBlocksDoc).translation
	assert.deepEqual(failureState?.retiredItemIds, oldState.retiredItemIds)
	assert.deepEqual(failureState?.orphanedFields, oldState.orphanedFields)
	assert.equal(failureRow.translationState?.writeRevision, required(revisionBefore) + 1)
	assert.equal(invalidations, invalidationsBefore + 1)
	pass('failed field writes preserve orphaned manual drafts and tombstones, advance revision, and invalidate only after commit')
	console.log(`Block worker item identity regressions: ${checks} passed`)
} finally {
	await database?.close().catch(() => {})
	if (created) await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
	await admin.close()
}
