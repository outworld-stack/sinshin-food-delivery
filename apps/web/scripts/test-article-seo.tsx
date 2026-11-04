import assert from 'node:assert/strict'
import type { ArticleDto } from '@sinshin/shared'
import { mock } from 'bun:test'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const article: ArticleDto = {
	id: '11111111-1111-4111-8111-111111111111',
	title: 'A useful recipe <script>',
	excerpt: 'A specific description of the recipe.',
	content: 'First complete paragraph.\n\nSecond complete paragraph.',
	author: 'Recipe author',
	profileImage: '/uploads/recipe.webp',
	galleryImages: [],
	categoryId: 'category-id',
	categorySlug: 'recipes',
	categoryName: 'Recipes',
	subCategorySlug: 'rice',
	subCategoryName: 'Rice',
	processes: [],
	views: 0,
	status: 'ACTIVE',
	publishedAt: '2026-01-02T10:00:00.000Z',
	updatedAt: '2026-01-03T10:00:00.000Z',
}
let lang: 'fa' | 'ar' = 'fa'
let result: ArticleDto | null = article
let failure: Error | undefined
const translations = new Proxy({} as Record<string, string>, { get: (_target, key) => String(key) })

mock.module('@tanstack/react-router', () => ({
	createFileRoute: () => (options: object) => ({ ...options, useLoaderData: () => article }),
	notFound: () => Object.assign(new Error('Not found'), { isNotFound: true }),
	Link: ({ to, params, search, children, preload: _preload, ...props }: {
		to: string; params?: Record<string, string>; search?: Record<string, unknown>;
		children: ReactNode; preload?: boolean;
	}) => {
		const path = to.replace(/\$(\w+)/g, (_match, key) => encodeURIComponent(params?.[key] ?? ''))
		const query = new URLSearchParams(Object.entries(search ?? {})
			.filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
		return createElement('a', { ...props, href: `${path}${query.size ? `?${query}` : ''}` }, children)
	},
}))
mock.module('#/i18n', () => ({ useI18n: () => ({ lang, t: translations, fmt: { date: (date: string) => date } }) }))
mock.module('#/hooks/useBack', () => ({ useBack: () => () => {} }))
mock.module('#/components/Gallery', () => ({ Gallery: () => null }))
mock.module('#/components/site/articles/ArticleBlocksRenderer', () => ({ ArticleBlocksRenderer: () => null }))
mock.module('#/components/LoadingSkeletons', () => ({ ArticleDetailSkeleton: () => null }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: () => null, RouteNotFound: () => null }))
mock.module('#/server/articles', () => ({ getArticleById: async () => {
	if (failure) throw failure
	return result
} }))

const { Route } = await import('../src/routes/articles/$articleId')
const { ArticleCard } = await import('../src/components/ArticleCard')
const route = Route as unknown as {
	component: ComponentType;
	loader(ctx: { params: { articleId: string } }): Promise<ArticleDto>;
	head(ctx: { matches: Array<{ context: { lang: 'fa' | 'ar' } }>; loaderData?: ArticleDto }): {
		meta: Array<{ name?: string; property?: string; content?: string; title?: string; 'script:ld+json'?: { '@graph': Array<Record<string, unknown>> } }>;
		links?: Array<{ rel: string; href: string; hrefLang?: string }>;
	};
}

assert.equal(await route.loader({ params: { articleId: article.id } }), article)
result = null
await assert.rejects(route.loader({ params: { articleId: article.id } }), { isNotFound: true })
failure = new Error('API unavailable')
await assert.rejects(route.loader({ params: { articleId: article.id } }), /API unavailable/, 'outages must stay errors instead of soft 404s')
failure = undefined
result = article

for (const language of ['fa', 'ar'] as const) {
	lang = language
	const ctx = { matches: [{ context: { lang } }], loaderData: article }
	const head = route.head(ctx)
	const canonical = `https://sinshin-foodpark.ir/articles/${article.id}${lang === 'ar' ? '?lang=ar' : ''}`
	assert.equal(head.links?.find(link => link.rel === 'canonical')?.href, canonical)
	assert.equal(head.meta.find(meta => meta.property === 'og:url')?.content, canonical)
	assert.equal(head.meta.find(meta => meta.property === 'article:modified_time')?.content, article.updatedAt)
	assert.equal(head.meta.find(meta => meta.name === 'twitter:image')?.content, 'https://sinshin-foodpark.ir/uploads/recipe.webp')
	assert.equal(head.meta.find(meta => meta.name === 'twitter:title')?.content, head.meta.find(meta => meta.title)?.title)
	assert(!head.meta.some(meta => 'twitter:image' in meta), 'social tags use standard name/content attributes')
	const structured = head.meta.find(meta => meta['script:ld+json'])?.['script:ld+json']?.['@graph'].find(node => node['@type'] === 'Article')
	assert.deepEqual(structured?.mainEntityOfPage, { '@type': 'WebPage', '@id': canonical })
	assert.equal(structured?.dateModified, article.updatedAt)
	assert(structured?.publisher)
	assert.equal(route.head({ matches: ctx.matches }).meta.find(meta => meta.name === 'robots')?.content, 'noindex, follow')

	const html = renderToStaticMarkup(createElement(route.component))
	assert(html.includes('<article'))
	assert(html.includes('First complete paragraph.') && html.includes('Second complete paragraph.'), 'the full body is present before client JavaScript runs')
	assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
	assert(html.includes('A useful recipe &lt;script&gt;'))
	assert(html.includes(`dateTime="${article.publishedAt}"`))
	assert(html.includes('fetchPriority="high"'), 'the article hero image can load immediately')
	const categoryHref = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map(match => match[1]!.replaceAll('&amp;', '&'))
	assert(categoryHref.some(href => new URL(href, canonical).searchParams.get('category') === 'recipes'))
	if (lang === 'ar') assert(categoryHref.every(href => new URL(href, canonical).searchParams.get('lang') === 'ar'))
	const card = renderToStaticMarkup(createElement(ArticleCard, { article: { ...article, profileImage: article.profileImage ?? null, publishedAt: new Date(article.publishedAt) } }))
	assert(card.includes(`href="/articles/${article.id}${lang === 'ar' ? '?lang=ar' : ''}"`), 'article links preserve the crawlable language variant')
}

console.log('Article SEO passed: SSR body, escaping, dates, canonical/social metadata, structured data, language links, missing articles and API failures.')
