import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { RestaurantHoursDto } from '@sinshin/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { fa } from '../src/i18n/fa'
import { ar } from '../src/i18n/ar'
import { qk } from '../src/utils/queryKeys'

let saved: RestaurantHoursDto = { openingTime: '11:00', closingTime: '00:00' }
let failure: Error | null = null
const requests: Array<{ path: string; method: string }> = []
mock.module('#/lib/api-fetch', () => ({
	getJson: async (path: string) => {
		requests.push({ path, method: 'GET' })
		if (failure) throw failure
		return { ...saved }
	},
	authJson: async (path: string, method: string, body: RestaurantHoursDto) => {
		requests.push({ path, method })
		if (failure) throw failure
		saved = { ...body }
		return { ...saved }
	},
}))
const { getRestaurantHours } = await import('../src/server/restaurant')
const { setRestaurantHours } = await import('../src/server/admin')
mock.module('#/utils/queryOptions', () => ({
	restaurantHoursOptions: { queryKey: qk.restaurantHours, queryFn: getRestaurantHours },
}))
mock.module('#/components/Brand', () => ({ Brand: () => null }))
mock.module('#/pwa/PwaInstallButton', () => ({ PwaInstallButton: () => null }))
mock.module('@tanstack/react-router', () => ({ Link: () => null }))
let lang: 'fa' | 'ar' = 'fa'
mock.module('#/i18n', () => ({
	useI18n: () => ({
		t: lang === 'fa' ? fa : ar,
		fmt: {
			num: (value: number) => value.toLocaleString(lang === 'fa' ? 'fa-IR' : 'ar-EG'),
			year: String,
		},
	}),
	tpl: (template: string, { n }: { n: string }) => template.replace('{n}', n),
}))
const { Footer } = await import('../src/components/Footer')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const render = () => renderToStaticMarkup(
	<QueryClientProvider client={client}><Footer /></QueryClientProvider>,
)

try {
	const loading = render()
	assert(loading.includes(fa['footer.hoursLoading']))
	assert(!loading.includes('۱۱ صبح'), 'loading must not present hard-coded hours as saved hours')
	client.setQueryData(qk.restaurantHours, await getRestaurantHours())
	assert(render().includes('هر روز از ۱۱:۰۰ تا ۰۰:۰۰'), 'default midnight hours retain leading zeroes')

	const updated = await setRestaurantHours({ data: { openingTime: '09:05', closingTime: '01:30' } })
	client.setQueryData(qk.restaurantHours, updated)
	assert(render().includes('هر روز از ۰۹:۰۵ تا ۰۱:۳۰'), 'footer follows the same cache updated after an admin save')
	lang = 'ar'
	assert(render().includes('كل يوم من ٠٩:٠٥ حتى ٠١:٣٠'), 'Arabic uses the saved times and Arabic digits')
	assert.deepEqual(await getRestaurantHours(), updated, 'subsequent public loads receive saved hours')
	assert.deepEqual(requests, [
		{ path: '/menu/restaurant-hours', method: 'GET' },
		{ path: '/admin/settings/restaurant-hours', method: 'POST' },
		{ path: '/menu/restaurant-hours', method: 'GET' },
	])

	failure = new Error('Hours could not be loaded')
	await assert.rejects(getRestaurantHours, /Hours could not be loaded/)
	await assert.rejects(() => setRestaurantHours({ data: updated }), /Hours could not be loaded/)
	assert(render().includes('٠٩:٠٥'), 'a failed refresh retains the last successfully loaded hours')
	console.log('PASS restaurant hours footer: public/admin API wiring, saved values, Persian/Arabic clocks, midnight and load failures')
} finally {
	client.clear()
}
