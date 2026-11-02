import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const react = { ...await import('react') }
const query = { ...await import('@tanstack/react-query') }
const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
mock.module('react', () => ({
	...react,
	useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useRef: (value: unknown) => ({ current: value }),
	useEffect: () => {},
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
}))
mock.module('@tanstack/react-query', () => ({ ...query, useQueryClient: () => client }))
mock.module('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate() {} }) }))

Object.defineProperty(globalThis, 'document', {
	configurable: true,
	value: { cookie: 'sinshin-lang=fa', documentElement: { lang: 'fa' } },
})
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: { matchMedia: () => ({ matches: true }) },
})

const { I18nProvider } = await import('../src/i18n')
const { qk } = await import('../src/utils/queryKeys')
const { invalidateProductQueries, invalidateCategoryQueries, invalidatePackagingQueries } =
	await import('../src/utils/productCache')

const activeKeys = [
	qk.similarProducts('11111111-1111-1111-1111-111111111111'),
	qk.similarProducts('pizza'),
	qk.similarProducts('cart-anchor', { context: 'cart', exclude: ['11111111-1111-1111-1111-111111111111'] }),
]
const inactiveKey = qk.similarProducts('another-product')
const unrelatedKey = ['unrelated'] as const
const calls = new Map<string, number>()
const cleanups: Array<() => void> = []
let available = true
let price = 100

try {
	for (const key of activeKeys) {
		const options = {
			queryKey: key,
			queryFn: async () => {
				calls.set(key[1], (calls.get(key[1]) ?? 0) + 1)
				return {
					products: [{ name: document.cookie.includes('sinshin-lang=ar') ? 'بيتزا' : 'پیتزا', isAvailable: available, finalPrice: price }],
					strict: false,
				}
			},
		}
		await client.fetchQuery(options)
		const observer = new query.QueryObserver(client, options)
		cleanups.push(observer.subscribe(() => {}))
	}
	client.setQueryData(inactiveKey, { products: [{ name: 'قدیمی' }], strict: false })
	client.setQueryData(unrelatedKey, { stable: true })

	const provider = I18nProvider({ initialLang: 'fa', children: null })
	provider.props.value.setLang('ar')
	// The provider starts active refetches immediately; await those existing requests.
	await Promise.all(activeKeys.map((queryKey) => client.getQueryCache().find({ queryKey })!.promise))
	for (const key of activeKeys) {
		assert.equal(client.getQueryData<any>(key).products[0].name, 'بيتزا',
			'Changing language refreshes mounted recommendations without waiting for staleTime')
		assert.equal(calls.get(key[1]), 2, 'Each active anchor refetches once')
	}
	assert.equal(client.getQueryState(inactiveKey)?.isInvalidated, true,
		'Inactive recommendations must refresh when visited in the new language')
	assert.equal(client.getQueryState(unrelatedKey)?.isInvalidated, false)

	available = false
	await invalidateProductQueries(client)
	for (const key of activeKeys) {
		assert.equal(client.getQueryData<any>(key).products[0].isAvailable, false,
			'A product change refreshes recommendations for every anchor containing it')
	}
	available = true
	await invalidateCategoryQueries(client)
	assert.equal(client.getQueryData<any>(activeKeys[0]).products[0].isAvailable, true,
		'Category changes refresh derived recommendation data')
	price = 200
	await invalidatePackagingQueries(client)
	assert.equal(client.getQueryData<any>(activeKeys[1]).products[0].finalPrice, 200,
		'Packaging changes refresh recommendation pricing')
	assert.equal(client.getQueryState(unrelatedKey)?.isInvalidated, false)
	console.log('PASS recommendation language switching and product/category/packaging cache refresh')
} finally {
	for (const cleanup of cleanups) cleanup()
	client.clear()
}
