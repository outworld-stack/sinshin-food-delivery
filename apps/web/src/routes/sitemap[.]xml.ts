// src/routes/sitemap[.]xml.ts
// سئو-۳: sitemap داینامیک — صفحات ثابت + همه‌ی محصولات + همه‌ی مقالات.
// نام فایل [.] یعنی «نقطه‌ی literal» — مسیر نهایی /sitemap.xml است.
//
// مکانیزم: server handlers روی خودِ route (بدون کامپوننت) — قبل از SSR
// پاسخ می‌دهد و Content-Type درست (application/xml) برمی‌گرداند.
//
// مقاوم بودن: اگر API در دسترس نباشد، sitemap با «صفحات ثابت» برمی‌گردد
// (خطا فقط بخش داینامیک را حذف می‌کند، کل sitemap نمی‌میرد) + کش ۱ ساعته.
import { createFileRoute } from '@tanstack/react-router'
// فقط برای اعمال augmentation نوعِ گزینه‌ی `server` روی FilebaseRouteOptions —
// بدون این، tsc نمی‌داند روت‌ها handler سرور می‌پذیرند
import type {} from '@tanstack/react-start'
import { getActiveMainCategories, getProductsByMain } from '#/server/products'
import { getArticles } from '#/server/articles'
import { SITE_URL } from '#/lib/site'

interface SitemapEntry {
  loc: string
  changefreq?: 'daily' | 'weekly' | 'monthly'
  priority?: string
  lastmod?: string
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const urls: SitemapEntry[] = [
          { loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' },
          { loc: `${SITE_URL}/products`, changefreq: 'daily', priority: '0.9' },
          { loc: `${SITE_URL}/articles`, changefreq: 'weekly', priority: '0.7' },
          { loc: `${SITE_URL}/gallery`, changefreq: 'monthly', priority: '0.5' },
          { loc: `${SITE_URL}/about`, changefreq: 'monthly', priority: '0.5' },
        ]

        // ── محصولات — از هر main فعال (dedup با id) ──
        try {
          const mains = await getActiveMainCategories()
          const seen = new Set<string>()
          for (const m of mains) {
            // روت عمومی منو، همه‌ی محصولات فعالِ آن main را یک‌جا می‌دهد
            const products = await getProductsByMain({ data: { mainSlug: m.slug } })
            for (const p of products) {
              if (seen.has(p.id)) continue
              seen.add(p.id)
              urls.push({
                loc: `${SITE_URL}/products/${p.id}`,
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
            urls.push({
              loc: `${SITE_URL}/articles/${a.id}`,
              changefreq: 'monthly',
              priority: '0.6',
              ...(a.publishedAt ? { lastmod: a.publishedAt.slice(0, 10) } : {}),
            })
          }
        } catch (e) {
          console.warn('[sitemap] articles unavailable:', e)
        }

        const xml =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          urls
            .map(
              (u) =>
                '  <url>' +
                `<loc>${escapeXml(u.loc)}</loc>` +
                (u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : '') +
                (u.priority ? `<priority>${u.priority}</priority>` : '') +
                (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
                '</url>',
            )
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
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  )
}
