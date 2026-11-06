import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { TranslationJobDto } from '@sinshin/shared'
import type { QueryKey } from '@tanstack/react-query'
import type { EffectCallback } from 'react'

// Real query cache and invalidation paths; React lifecycle and server reads are controlled.
const react = { ...await import('react') }
const query = { ...await import('@tanstack/react-query') }
const cache = new query.QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
type Host = { cells: unknown[]; cursor: number; mounted: boolean; cleanups: (() => void)[] }
const host: Host = { cells: [], cursor: 0, mounted: true, cleanups: [] }
mock.module('react', () => ({ ...react,
	useCallback: (callback: unknown) => callback,
	useRef<T>(initial: T) {
		const index = host.cursor++
		if (!(index in host.cells)) host.cells[index] = { current: initial }
		return host.cells[index]
	},
	useEffect(effect: EffectCallback, deps: unknown[]) {
		const index = host.cursor++
		const before = host.cells[index] as unknown[] | undefined
		if (!before || deps.some((value, at) => !Object.is(value, before[at]))) {
			const cleanup = effect()
			if (cleanup) host.cleanups.push(cleanup)
		}
		host.cells[index] = deps
	},
}))
mock.module('@tanstack/react-query', () => ({ ...query,
	useQueryClient: () => cache,
	useQuery: (options: { queryKey: QueryKey }) => ({ data: cache.getQueryData(options.queryKey),
		isLoading: false, isFetching: false, isError: false, refetch: async () => cache.getQueryData(options.queryKey) }),
	useMutation: () => ({ isPending: false, mutate: () => assert.fail('Queue reads cannot start new translation work') }),
}))
mock.module('#/server/translation', () => ({
	getTranslationJobs: async () => assert.fail('Queue snapshots are provided by the deterministic test cache'),
	getTranslationStatus: async () => assert.fail('Queue status reads are mocked'),
	enqueueBulkTranslation: async () => assert.fail('No translation may be queued by a status refresh'),
	translatePreview: async () => assert.fail('No translator may be contacted by a status refresh'),
}))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (store: { showToast: () => void }) => unknown) =>
	select({ showToast: () => assert.fail('A queue read must not show a translation mutation toast') }) }))
const { useTranslationQueue: renderQueueHook } = await import('../src/hooks/admin/useTranslationQueue')
const { qk } = await import('../src/utils/queryKeys')

const aboutKeys = [[...qk.aboutContent, 'ar'], [...qk.adminAboutContent]]
const galleryKeys = [[...qk.galleryImages, 'ar'], [...qk.adminGalleryImages]]
const unaffectedKey = [...qk.productByIdAll, 'unrelated-product', 'ar']
const invalidated: QueryKey[] = []
const unsubscribe = cache.getQueryCache().subscribe(event => {
	if (event.type === 'updated' && event.action.type === 'invalidate') invalidated.push(event.query.queryKey)
})
const freshContent = (keys: QueryKey[]) => { for (const key of keys) cache.setQueryData(key, { arabic: 'Current server snapshot' }) }
const assertInvalid = (keys: QueryKey[], expected: boolean) => {
	for (const key of keys) assert.equal(cache.getQueryState(key)?.isInvalidated, expected, JSON.stringify(key))
}
const render = (enabled = true) => {
	assert(host.mounted)
	host.cursor = 0
	return renderQueueHook({ enabled })
}
const poll = (jobs: TranslationJobDto[], enabled = true) => {
	cache.setQueryData(qk.translationJobs, { jobs })
	return render(enabled)
}
const job = (overrides: Partial<TranslationJobDto> = {}): TranslationJobDto => ({
	id: 'about-job', entityType: 'about', entityId: '1', status: 'pending', attempts: 0, maxAttempts: 3,
	lastError: null, createdAt: '2026-01-01T00:00:00.000Z', startedAt: null, finishedAt: null, ...overrides,
})
let checks = 0
const pass = (name: string) => { checks++; console.log(`PASS ${name}`) }

try {
	freshContent([...aboutKeys, ...galleryKeys, unaffectedKey])
	poll([])
	poll([job()])
	poll([job({ status: 'running', attempts: 1, startedAt: '2026-01-01T00:01:00.000Z' })])
	assert.equal(invalidated.length, 0)
	pass('new pending and running jobs never refresh content or request translation')

	const firstBackoff = job({ status: 'pending', attempts: 1, startedAt: '2026-01-01T00:01:00.000Z', lastError: 'One block field failed' })
	poll([firstBackoff])
	assertInvalid(aboutKeys, true); assertInvalid(galleryKeys, false); assertInvalid([unaffectedKey], false)
	assert.equal(invalidated.length, aboutKeys.length)
	pass('a failed attempt awaiting retry refreshes its public and admin content without touching another entity')

	freshContent(aboutKeys)
	const galleryPending = job({ id: 'gallery-job', entityType: 'gallery', entityId: 'gallery-image' })
	poll([{ ...firstBackoff }, galleryPending])
	assertInvalid(aboutKeys, false); assertInvalid(galleryKeys, false)
	assert.equal(invalidated.length, aboutKeys.length)
	pass('repeated settled snapshots do not invalidate again when unrelated queue rows change')

	const retry = job({ status: 'running', attempts: 2, startedAt: '2026-01-01T00:02:00.000Z', lastError: firstBackoff.lastError })
	poll([retry, galleryPending])
	assertInvalid(aboutKeys, false)
	const secondBackoff = { ...retry, status: 'pending' as const }
	poll([secondBackoff, galleryPending])
	assertInvalid(aboutKeys, true)
	assert.equal(invalidated.length, aboutKeys.length * 2)
	pass('each newly settled retry refreshes even when the same field fails with the same error')

	freshContent(aboutKeys)
	const runningGallery = { ...galleryPending, status: 'running' as const, attempts: 1, startedAt: '2026-01-01T00:03:00.000Z' }
	poll([{ ...secondBackoff }, runningGallery])
	assertInvalid(aboutKeys, false); assertInvalid(galleryKeys, false)
	const finalFailure = job({ status: 'failed', attempts: 3, startedAt: '2026-01-01T00:03:00.000Z',
		finishedAt: '2026-01-01T00:04:00.000Z', lastError: 'One block field failed' })
	const galleryDone = { ...runningGallery, status: 'done' as const, finishedAt: '2026-01-01T00:04:00.000Z' }
	poll([finalFailure, galleryDone])
	assertInvalid(aboutKeys, true); assertInvalid(galleryKeys, true); assertInvalid([unaffectedKey], false)
	assert.equal(invalidated.length, aboutKeys.length * 3 + galleryKeys.length)
	pass('permanently failed and completed jobs refresh only their affected content caches')

	freshContent([...aboutKeys, ...galleryKeys])
	const unrelatedRunning = job({ id: 'product-job', entityType: 'product', entityId: 'unrelated-product', status: 'running', attempts: 1 })
	poll([{ ...finalFailure }, { ...galleryDone }, unrelatedRunning])
	assertInvalid([...aboutKeys, ...galleryKeys, unaffectedKey], false)
	assert.equal(invalidated.length, aboutKeys.length * 3 + galleryKeys.length)
	pass('polling completed and failed attempts again cannot repeatedly refetch settled content')

	// Status participates in deduplication even if a server snapshot keeps all other attempt fields.
	const repairedDone = { ...finalFailure, status: 'done' as const }
	poll([repairedDone, galleryDone, unrelatedRunning])
	assertInvalid(aboutKeys, true); assertInvalid(galleryKeys, false)
	assert.equal(invalidated.length, aboutKeys.length * 4 + galleryKeys.length)
	pass('a newly settled state of the same attempt has its own refresh identity')

	freshContent(aboutKeys)
	const nextDone = { ...repairedDone, attempts: 4, startedAt: '2026-01-01T00:05:00.000Z', finishedAt: '2026-01-01T00:06:00.000Z' }
	poll([nextDone, galleryDone], false)
	assertInvalid(aboutKeys, false)
	assert.equal(invalidated.length, aboutKeys.length * 4 + galleryKeys.length)
	render(true)
	assertInvalid(aboutKeys, true)
	assert.equal(invalidated.length, aboutKeys.length * 5 + galleryKeys.length)
	pass('disabled hooks ignore cached settlements and refresh once when explicitly enabled again')

	freshContent([...aboutKeys, ...galleryKeys])
	host.mounted = false
	for (const cleanup of host.cleanups) cleanup()
	cache.setQueryData(qk.translationJobs, { jobs: [{ ...nextDone, attempts: 5 }] })
	assertInvalid([...aboutKeys, ...galleryKeys, unaffectedKey], false)
	assert.equal(invalidated.length, aboutKeys.length * 5 + galleryKeys.length)
	pass('queue cache updates after unmount cannot refetch content through the removed hook')
	console.log(`${checks} translation queue refresh regressions passed`)
} finally { unsubscribe(); cache.clear() }
