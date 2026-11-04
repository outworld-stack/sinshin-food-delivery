import assert from 'node:assert/strict'
import type { ArticleDto } from '@sinshin/shared'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, HeadContent, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { alternateHrefs, articleJsonLd, langUrl, siteHead } from '../src/lib/seo'
import { SITE_URL } from '../src/lib/site'
import { DEFAULT_SITE_URL, siteOriginFromDomain } from '../src/lib/site-origin'

assert.equal(siteOriginFromDomain(), DEFAULT_SITE_URL)
assert.equal(siteOriginFromDomain('sinshin-foodpark.ir'), 'https://sinshin-foodpark.ir')
assert.equal(siteOriginFromDomain('www.example.org'), 'https://www.example.org')
for (const invalid of ['https://example.org', 'example.org/path', 'example.org?x=1', 'user@example.org', 'example.org#hash']) {
	assert.throws(() => siteOriginFromDomain(invalid), invalid)
}

assert.equal(langUrl('/articles?page=2&lang=fa#top', 'ar'), `${SITE_URL}/articles?page=2&lang=ar`)
assert.equal(langUrl('/articles?page=2&lang=ar', 'fa'), `${SITE_URL}/articles?page=2`)
assert.deepEqual(alternateHrefs('/articles?page=2'), {
	fa: `${SITE_URL}/articles?page=2`, ar: `${SITE_URL}/articles?page=2&lang=ar`, xDefault: `${SITE_URL}/articles?page=2`,
})

const article: ArticleDto = {
	id: 'test', title: 'Article </script><script>alert(1)</script>', excerpt: 'A useful description', content: 'Body',
	author: 'Editor', galleryImages: [], categoryId: 'food', processes: [], views: 2, status: 'ACTIVE',
	publishedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
	categorySlug: null, categoryName: null, subCategorySlug: null, subCategoryName: null,
}
const data = articleJsonLd(article, 'fa')
const articleNode = data['@graph'][0]
assert('headline' in articleNode)
assert.equal(articleNode.dateModified, article.updatedAt)
assert.equal(articleNode.publisher?.url, SITE_URL)
assert.equal(articleNode.mainEntityOfPage?.['@id'], `${SITE_URL}/articles/test`)
const legacyNode = articleJsonLd({ ...article, updatedAt: undefined }, 'fa')['@graph'][0]
assert('headline' in legacyNode)
assert.equal(legacyNode.dateModified, undefined)

// Exercise TanStack's actual head renderer, including parent/child deduplication
// and JSON-LD escaping. Valid JS objects alone do not prove valid meta HTML.
const root = createRootRoute({
	head: () => siteHead({ matches: [{ context: { lang: 'fa' } }] }),
	component: () => <HeadContent />,
})
const child = createRoute({
	getParentRoute: () => root,
	path: '/articles/test',
	head: () => ({
		meta: [
			{ title: article.title },
			{ property: 'og:image', content: `${SITE_URL}/uploads/article.webp` },
			{ name: 'twitter:image', content: `${SITE_URL}/uploads/article.webp` },
			{ 'script:ld+json': data },
		],
		links: [{ rel: 'canonical', href: langUrl('/articles/test', 'fa') }],
	}),
})
const router = createRouter({ routeTree: root.addChildren([child]), history: createMemoryHistory({ initialEntries: ['/articles/test'] }) })
await router.load()
const html = renderToString(<RouterProvider router={router} />)
assert.match(html, /name="twitter:card" content="summary_large_image"/)
assert.equal((html.match(/name="twitter:image"/g) ?? []).length, 1)
assert.match(html, /name="robots" content="index, follow, max-image-preview:large"/)
assert.match(html, /rel="canonical"/)
assert(!html.includes('og:image:width'), 'unknown article dimensions must not inherit the logo dimensions')
assert(!html.includes('</script><script>alert(1)'), 'JSON-LD cannot escape its script element')
const schemas = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]))
assert.equal(schemas.length, 2, 'site and article structured data both survive head composition')
assert(schemas.some(schema => schema['@graph'].some((node: { headline?: string }) => node.headline === article.title)))
assert(schemas.some(schema => schema['@graph'].some((node: { address?: { addressCountry: string } }) => node.address?.addressCountry === 'IR')))
console.log('SEO head passed: canonical origins, paginated language URLs, native metadata rendering, structured data and script escaping.')
