import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/react-start'
import { alternateHrefs } from '#/lib/seo'
import { getArticles } from '#/server/articles'
import { getActiveMainCategories, getProductsByMain } from '#/server/products'

interface SitemapEntry {
	path: string
	lastmod?: string
}

export const Route = createFileRoute('/sitemap.xml')({
	server: {
		handlers: {
			GET: async () => {
				try {
					// Public APIs return all published articles and active menu items.
					const [mains, articles] = await Promise.all([
						getActiveMainCategories(),
						getArticles({ data: {} }),
					])
					const menus = await Promise.all(
						mains.map((main) =>
							getProductsByMain({ data: { mainSlug: main.slug } }),
						),
					)
					const entries: SitemapEntry[] = [
						{ path: '/' },
						{ path: '/products' },
						{ path: '/articles' },
						{ path: '/gallery' },
						{ path: '/about' },
					]
					const seen = new Set<string>()
					for (const products of menus) {
						for (const product of products) {
							if (seen.has(product.id)) continue
							seen.add(product.id)
							entries.push({
								path: `/products/${encodeURIComponent(product.slug || product.id)}`,
							})
						}
					}
					for (const article of articles) {
						entries.push({
							path: `/articles/${encodeURIComponent(article.id)}`,
							lastmod:
								sitemapDate(article.updatedAt) ??
								sitemapDate(article.publishedAt),
						})
					}

					// Every language URL needs its own entry, with the same reciprocal
					// alternates, including itself. These match the HTML canonical URLs.
					const xml =
						'<?xml version="1.0" encoding="UTF-8"?>\n' +
						'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
						entries
							.flatMap((entry) => {
								const hrefs = alternateHrefs(entry.path)
								return [hrefs.fa, hrefs.ar].map(
									(url) =>
										'  <url>' +
										`<loc>${escapeXml(url)}</loc>` +
										(entry.lastmod
											? `<lastmod>${entry.lastmod}</lastmod>`
											: '') +
										`<xhtml:link rel="alternate" hreflang="fa" href="${escapeXml(hrefs.fa)}"/>` +
										`<xhtml:link rel="alternate" hreflang="ar" href="${escapeXml(hrefs.ar)}"/>` +
										`<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(hrefs.xDefault)}"/>` +
										'</url>',
								)
							})
							.join('\n') +
						'\n</urlset>'

					return new Response(xml, {
						headers: {
							'content-type': 'application/xml; charset=utf-8',
							'cache-control': 'public, max-age=300',
						},
					})
				} catch (error) {
					// A temporary outage must not publish/cache an incomplete inventory.
					console.warn('[sitemap] content unavailable:', error)
					return new Response('Sitemap temporarily unavailable', {
						status: 503,
						headers: {
							'content-type': 'text/plain; charset=utf-8',
							'cache-control': 'no-store',
							'retry-after': '60',
						},
					})
				}
			},
		},
	},
})

function sitemapDate(value?: string): string | undefined {
	if (!value) return undefined
	const date = new Date(value)
	return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function escapeXml(value: string): string {
	return value.replace(
		/[<>&'"]/g,
		(char) =>
			({
				'<': '&lt;',
				'>': '&gt;',
				'&': '&amp;',
				"'": '&apos;',
				'"': '&quot;',
			})[char] ?? char,
	)
}
