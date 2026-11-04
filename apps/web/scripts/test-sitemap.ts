import assert from 'node:assert/strict'
import { mock } from 'bun:test'

mock.module('@tanstack/react-router', () => ({
	createFileRoute: () => (options: unknown) => options,
}))

let failure: 'articles' | 'mains' | 'menu' | undefined
const publishedAt = '2026-01-01T10:00:00.000Z'
const updatedAt = '2026-11-01T15:30:00.000Z'
mock.module('#/server/articles', () => ({
	getArticles: async () => {
		if (failure === 'articles') throw new Error('expected article outage')
		return [
			{ id: 'published-article', publishedAt, updatedAt },
			{ id: 'legacy-article', publishedAt },
			{ id: 'invalid-dates', publishedAt: 'invalid', updatedAt: 'invalid' },
		]
	},
}))
mock.module('#/server/products', () => ({
	getActiveMainCategories: async () => {
		if (failure === 'mains') throw new Error('expected category outage')
		return [{ slug: 'food' }, { slug: 'drinks' }]
	},
	getProductsByMain: async () => {
		if (failure === 'menu') throw new Error('expected menu outage')
		return [
			{ id: 'shared-product', slug: 'special-food' },
			{ id: 'uuid-fallback', slug: null },
			{ id: 'encoded-product', slug: 'غذا&"<tag>\'' },
		]
	},
}))

const { SITE_URL } = await import('../src/lib/site')
const { Route: sitemapRoute } = await import('../src/routes/sitemap[.]xml')
const { Route: robotsRoute } = await import('../src/routes/robots[.]txt')
type ServerRoute = { server: { handlers: { GET(): Promise<Response> | Response } } }
const sitemap = () => (sitemapRoute as unknown as ServerRoute).server.handlers.GET()
const robots = () => (robotsRoute as unknown as ServerRoute).server.handlers.GET()

const response = await sitemap()
assert.equal(response.status, 200)
assert.equal(response.headers.get('content-type'), 'application/xml; charset=utf-8')
assert.equal(response.headers.get('cache-control'), 'public, max-age=300')
const xml = await response.text()
const entries = [...xml.matchAll(/<url>(.*?)<\/url>/g)].map((match) => match[1])
assert.equal(entries.length, (5 + 3 + 3) * 2, 'each public page has both language entries; products in multiple categories occur once')
const locations = entries.map((entry) => entry.match(/<loc>(.*?)<\/loc>/)?.[1])
assert.equal(new Set(locations).size, locations.length, 'canonical URLs are unique')
for (const entry of entries) {
	const loc = entry.match(/<loc>(.*?)<\/loc>/)?.[1]
	assert(loc?.startsWith(SITE_URL), 'every location uses the configured canonical origin')
	assert(entry.includes(`href="${loc}"`), 'each alternate cluster includes its own URL')
	for (const lang of ['fa', 'ar', 'x-default']) assert(entry.includes(`hreflang="${lang}"`))
}
assert(locations.includes(`${SITE_URL}/articles/published-article?lang=ar`), 'Arabic URLs are listed as loc entries')
assert.equal(entries.filter((entry) => entry.includes('<loc>') && entry.includes('/articles/published-article')).length, 2)
assert(entries.filter((entry) => entry.includes('/articles/published-article')).every((entry) => entry.includes(`<lastmod>${updatedAt}</lastmod>`)), 'edits update lastmod in both language entries')
assert(entries.filter((entry) => entry.includes('/articles/legacy-article')).every((entry) => entry.includes(`<lastmod>${publishedAt}</lastmod>`)), 'old API responses fall back to the real publication timestamp')
assert(entries.filter((entry) => entry.includes('/articles/invalid-dates')).every((entry) => !entry.includes('<lastmod>')), 'invalid timestamps are never serialized')
assert(!xml.includes('<tag>') && !xml.includes('غذا') && xml.includes('%26%22%3Ctag%3E&apos;'), 'URL encoding and XML escaping preserve dynamic slugs safely')

const originalWarn = console.warn
console.warn = () => {}
try {
	for (const unavailable of ['articles', 'mains', 'menu'] as const) {
		failure = unavailable
		const failed = await sitemap()
		assert.equal(failed.status, 503, `${unavailable}: incomplete inventory must not be published as success`)
		assert.equal(failed.headers.get('cache-control'), 'no-store')
		assert.equal(failed.headers.get('retry-after'), '60')
		assert(!(await failed.text()).includes('<urlset'))
	}
} finally {
	failure = undefined
	console.warn = originalWarn
}
assert.equal((await sitemap()).status, 200, 'recovery immediately restores the full sitemap')

const robotsResponse = await robots()
assert.equal(robotsResponse.headers.get('content-type'), 'text/plain; charset=utf-8')
const text = await robotsResponse.text()
assert(text.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), 'robots and sitemap use one canonical origin')
const rules = [...text.matchAll(/^(Allow|Disallow): (.+)$/gm)].map(([, directive, path]) => ({ directive, path }))
const allowed = (url: string) => rules.filter((rule) => url.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length)[0]?.directive !== 'Disallow'
for (const path of ['/articles/example', '/assets/app.js', '/uploads/cover.webp', '/api/articles?lang=ar', '/api/menu/products/example', '/api/about', '/api/gallery', '/api/products/example/reviews', '/api/orders/restaurant-status', '/api/terms', '/login', '/cart', '/checkout', '/geo-blocked']) {
	assert(allowed(path), `${path} remains crawlable for content, rendering or noindex discovery`)
}
for (const path of ['/admin/settings', '/dashboard/orders', '/api/admin/articles', '/api/payments', '/courier', '/referral/code']) {
	assert(!allowed(path), `${path} remains excluded from crawling`)
}

console.log('Sitemap/robots passed: reciprocal language entries, complete inventory, modification times, escaping, outage/recovery and rendering access.')
