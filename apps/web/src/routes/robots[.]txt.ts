import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/react-start'
import { SITE_URL } from '#/lib/site'

export const Route = createFileRoute('/robots.txt')({
	server: {
		handlers: {
			GET: () =>
				new Response(
					[
						'User-agent: *',
						'Allow: /',
						'Disallow: /admin',
						'Disallow: /dashboard',
						'Disallow: /courier',
						'Disallow: /referral/',
						'Disallow: /offline.html',
						'Disallow: /sw-reset.html',
						// Keep public data crawlable for rendering hydrated pages.
						'Disallow: /api/',
						'Allow: /api/articles',
						'Allow: /api/menu/',
						'Allow: /api/about',
						'Allow: /api/gallery',
						'Allow: /api/products/',
						'Allow: /api/orders/restaurant-status',
						'Allow: /api/terms',
						// Login/cart/checkout/geo-blocked remain crawlable so Google can
						// read their noindex directives. robots.txt is not access control.
						'',
						`Sitemap: ${SITE_URL}/sitemap.xml`,
						'',
					].join('\n'),
					{
						headers: {
							'content-type': 'text/plain; charset=utf-8',
							'cache-control': 'public, max-age=300',
						},
					},
				),
		},
	},
})
