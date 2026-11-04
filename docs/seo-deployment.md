# SEO deployment and publishing

## Canonical domain

Use these root `.env` settings:

```dotenv
DOMAIN=sinshin-foodpark.ir
APEX_DOMAIN=www.sinshin-foodpark.ir
```

`DOMAIN` serves the site. Despite its historical name, `APEX_DOMAIN` is the
redirect alias: Caddy permanently redirects it to `https://${DOMAIN}`, preserving
the path and query. Both DNS names must resolve to the deployment and have valid
HTTPS certificates. The web build now reads `DOMAIN`; rebuild and redeploy the web
service after changing it. Canonicals, social URLs, structured data, robots.txt,
and sitemap.xml then use the same origin in the server and browser.

## Crawling and geography

The existing country restriction remains active. Recognized crawler user agents,
including Googlebot and Google-InspectionTool, may read the same public pages and
images served to customers in allowed countries. This is a public-content
exception: user-agent strings are forgeable and are not proof of crawler identity.
Private pages, private APIs, and mutations keep their normal checks. Do not use
this exception for confidential or geographically licensed content.

Check any CDN, firewall, or hosting-level country blocks too: application code
cannot help a crawler blocked before it reaches the server. Keep CSS, JavaScript,
fonts, public images, and the robots/sitemap endpoints accessible to crawlers.
Do not cache geo-denial responses as public content.

## After deploying

1. Verify the domain property in [Google Search Console](https://search.google.com/search-console/).
2. Submit `https://sinshin-foodpark.ir/sitemap.xml`. It includes published article
   and product URLs in both supported languages. Publication and subsequent
   content changes appear automatically; Google chooses when to fetch them.
3. Inspect a published article with **URL Inspection → Test live URL**. Check its
   rendered content, image, canonical, crawl permission, and HTTP response.
   Inspect its Arabic `?lang=ar` version too. Request indexing for key new pages.
4. Use [Rich Results Test](https://search.google.com/test/rich-results) to check
   Article and Restaurant markup. Confirm that the address, author, dates, and
   images match the visible page. Structured data does not guarantee rich results.
5. Check the `www` URL redirects to the equivalent bare-domain URL, and check a
   nonexistent article returns 404. A temporary sitemap data outage should return
   503 rather than an incomplete successful sitemap.
6. Monitor Page indexing, Crawl stats, search queries, and Core Web Vitals. Use
   [PageSpeed Insights](https://pagespeed.web.dev/) on real article URLs to identify
   image or rendering bottlenecks on mobile devices.

## Article publishing

Write original, helpful articles that answer specific questions from your local
audience. Use a descriptive title, a useful excerpt, clear headings, an accurate
byline, and relevant links to related articles and food pages. Upload a sharp,
compressed lead image; use an image at least 1200 pixels wide when suitable for
large search previews. Describe meaningful images with useful alt text. Review
automatic Arabic translations before relying on them to attract Arabic readers.
Update content when facts change; do not change dates just to imply freshness.

The archive exposes older articles through real pagination links while preserving
the load-more interaction. Filtered/sorted archive variants are marked noindex to
avoid filling search results with repetitive listings. Individual articles remain
indexable and appear in the sitemap.

TanStack Start supplies server rendering and metadata tools. Rankings also depend
on content usefulness, search intent, competition, reputation, and links. No
technical implementation can guarantee the first two results pages or a short
ranking timeline. Google's [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
and [helpful content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
describe the ongoing work beyond crawling and indexing.

## Local checks

From `apps/web`: `bun run test:seo`, `bun run test:articles`,
`bun run typecheck`, and `bun run build`.
From `apps/api`: `bun run test:geo`, `bun run db:test:articles` (requires the test
database/Redis), and `bun run typecheck`.
