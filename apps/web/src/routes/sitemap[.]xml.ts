// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/routes/sitemap[.]xml.ts
// تغییر: URL محصولات از slug انگلیسی (اگر تعیین شده باشد) — همان
//        مسیرهای canonical؛ بدون slug همان UUID قبلی
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 18 از 18
// مسیر مقصد: web/src/routes/sitemap[.]xml.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/sitemap[.]xml.ts
// سئو-۳ → رارد ۳۸ — sitemap داینامیک دوزبانه.
// نام فایل [.] یعنی «نقطه‌ی literal» — مسیر نهایی /sitemap.xml است.
//
// مکانیزم: هندلرهای سروری روی خودِ روت (بدون کامپوننت) — قبل از SSR
// پاسخ می‌دهد و Content-Type درست (application/xml) برمی‌گرداند.
//
// رارد ۳۸ — ساختار hreflang: هر صفحه یک <url> با هر سه واریانت زبان
// (xhtml:link: fa تمیز + ar با ?lang=ar + x-default) — استاندارد گوگل
// برای sitemap چندزبانه. URLها دقیقاً همان‌هایی هستند که canonical/
// hreflang صفحات می‌سازند (lib/seo.ts alternateHrefs — منبع واحد).
//
// مقاوم بودن: اگر API در دسترس نباشد، sitemap با «صفحات ثابت» برمی‌گردد
// (خطا فقط بخش داینامیک را حذف می‌کند، کل sitemap نمی‌میرد) + کش ۱ ساعته.
import { createFileRoute } from '@tanstack/react-router'
// فقط برای اعمال augmentation نوعِ گزینه‌ی `server` روی FilebaseRouteOptions —
// بدون این، tsc نمی‌داند روت‌ها handler سرور می‌پذیرند
import type { } from '@tanstack/react-start'
import { alternateHrefs } from '#/lib/seo'
import { getArticles } from '#/server/articles'
import { getActiveMainCategories, getProductsByMain } from '#/server/products'

interface SitemapEntry {
	/** مسیر نسبی (بدون دامنه) — hreflangها از همین ساخته می‌شوند */
	path: string
	changefreq?: 'daily' | 'weekly' | 'monthly'
	priority?: string
	lastmod?: string
}

export const Route = createFileRoute('/sitemap.xml')({
	server: {
		handlers: {
			GET: async () => {
				const entries: SitemapEntry[] = [
					{ path: '/', changefreq: 'daily', priority: '1.0' },
					{ path: '/products', changefreq: 'daily', priority: '0.9' },
					{ path: '/articles', changefreq: 'weekly', priority: '0.7' },
					{ path: '/gallery', changefreq: 'monthly', priority: '0.5' },
					{ path: '/about', changefreq: 'monthly', priority: '0.5' },
				]

				// ── محصولات — از هر main فعال (dedup با id) ──
				try {
					const mains = await getActiveMainCategories()
					const seen = new Set<string>()
					for (const m of mains) {
						// روت عمومی منو، همه‌ی محصولات فعالِ آن main را یک‌جا می‌دهد
						const products = await getProductsByMain({
							data: { mainSlug: m.slug },
						})
						for (const p of products) {
							if (seen.has(p.id)) continue
							seen.add(p.id)
							// stage-56 — URL سئوپسند: slug اگر باشد، وگرنه UUID
							entries.push({
								path: `/products/${p.slug || p.id}`,
								changefreq: 'weekly',
								priority: '0.8',
							})
						}
					}
				} catch (e) {
					console.warn('[sitemap] products unavailable:', e)
				}

				// ── مقالات — با lastmod اگر تاریخ انتشار باشد ──
				try {
					const articles = await getArticles({ data: {} })
					for (const a of articles) {
						entries.push({
							path: `/articles/${a.id}`,
							changefreq: 'monthly',
							priority: '0.6',
							...(a.publishedAt ? { lastmod: a.publishedAt.slice(0, 10) } : {}),
						})
					}
				} catch (e) {
					console.warn('[sitemap] articles unavailable:', e)
				}

				// هر صفحه: loc = واریانت پیش‌فرض (فارسی تمیز) + سه alternate زبان
				const xml =
					'<?xml version="1.0" encoding="UTF-8"?>\n' +
					'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
					'        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
					entries
						.map((u) => {
							const h = alternateHrefs(u.path)
							return (
								'  <url>' +
								`<loc>${escapeXml(h.fa)}</loc>` +
								`<xhtml:link rel="alternate" hreflang="fa" href="${escapeXml(h.fa)}"/>` +
								`<xhtml:link rel="alternate" hreflang="ar" href="${escapeXml(h.ar)}"/>` +
								`<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(h.xDefault)}"/>` +
								(u.changefreq
									? `<changefreq>${u.changefreq}</changefreq>`
									: '') +
								(u.priority ? `<priority>${u.priority}</priority>` : '') +
								(u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
								'</url>'
							)
						})
						.join('\n') +
					'\n</urlset>'

				return new Response(xml, {
					headers: {
						'content-type': 'application/xml; charset=utf-8',
						// sitemap هر ساعت تازه می‌شود؛ بین‌دو-کرال از کش لبه/مرورگر
						'cache-control': 'public, max-age=3600',
					},
				})
			},
		},
	},
})

function escapeXml(s: string): string {
	return s.replace(
		/[<>&'"]/g,
		(c) =>
			({
				'<': '&lt;',
				'>': '&gt;',
				'&': '&amp;',
				"'": '&apos;',
				'"': '&quot;',
			})[c] ?? c,
	)
}