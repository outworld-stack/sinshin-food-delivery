// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 3 از 7
// مسیر مقصد: apps/web/src/lib/seo.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-39 — sinshin-food-delivery — فایل 3 از 5
// مسیر مقصد: apps/web/src/lib/seo.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-five
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 3 از 18
// مسیر مقصد: web/src/lib/seo.ts
// وضعیت: فایل جدید — ایجاد شود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/lib/seo.ts
// رارد ۳۸ — سئوی دوزبانه: منطق ساخت تگ‌های head (بدون هیچ متن هاردکد).
//
// همه‌ی رشته‌ها از i18n/seo.ts می‌آیند؛ این فایل فقط «چسب» است:
//   • seoHead(key)     → head آماده‌ی صفحات ایندکس‌شونده‌ی عمومی
//   • noindexHead(key) → head صفحات خصوصی (عنوان دوزبانه + noindex)
//   • siteHead(ctx)    → head ریشه (متادیتای سایت + og + JSON-LD سایت)
//   • productJsonLd / articleJsonLd / breadcrumbJsonLd → داده‌ی ساختاریافته
//
// قرارداد URL زبان (هم‌راستا با sitemap و hreflang):
//   • فارسی = پیش‌فرض → URL تمیز      https://site/products
//   • عربی  = واریانت  → ?lang=ar     https://site/products?lang=ar
//   سرور در beforeLoad ریشه ?lang= را می‌خواند (اولویت بالاتر از کوکی)،
//   همان زبان را SSR می‌کند و کوکی را هم‌راستا می‌کند — لینک‌های hreflang
//   برای کرالر بدون کوکی همیشه رندر درست می‌گیرند.
//
// JSON-LD با کلید اختصاصی 'script:ld+json' در meta داده می‌شود — تان‌استک
// رائوتر آن را به <script type="application/ld+json"> اسکیپ‌شده (\u003c)
// در head تبدیل می‌کند (همان حفاظت jsonLdScript، به‌صورت بومی).
import type { ArticleDto, Product } from '@sinshin/shared'
import type { Lang } from '#/i18n'
import { SEO, type SeoStrings } from '#/i18n/seo'
import { absoluteUrl, DEFAULT_OG_IMAGE, SITE_URL } from './site'

/** کلیدهای صفحات ایندکس‌شونده‌ای که URL ثابت دارند */
export type SeoPathKey = 'home' | 'products' | 'articles' | 'gallery' | 'about'

/** مسیر (بدون دامنه) هر صفحه‌ی عمومی — منبع واحد canonical/hreflang/sitemap */
export const SEO_PATHS: Record<SeoPathKey, string> = {
    home: '/',
    products: '/products',
    articles: '/articles',
    gallery: '/gallery',
    about: '/about',
}

/** کلیدهای صفحات noindex که فقط عنوان دوزبانه می‌خواهند */
export type SeoNoindexKey = 'login' | 'cart' | 'checkout' | 'geoBlocked'

/** برچسب زبان برای inLanguage در JSON-LD */
const LOCALE_TAG: Record<Lang, string> = { fa: 'fa-IR', ar: 'ar-IQ' }

/** og:locale + واریانت مقابل */
const OG_LOCALE: Record<Lang, string> = { fa: 'fa_IR', ar: 'ar_IQ' }

// ── کانتکست head ──

/**
 * زیرمجموعه‌ی ساختاریِ کانتکستی که تان‌استک به head می‌دهد — فقط چیزی
 * که لازم داریم: مچ‌های رندر (matches[0] = ریشه، حامل lang از beforeLoad).
 */
export interface HeadFnCtx {
    matches: ReadonlyArray<{ context?: unknown }>
}

/**
 * زبان فعال — قبل از هر چیز در همه‌ی headها صدا زده می‌شود.
 *
 * رارد ۳۹ — سمت کلاینت، کوکیِ زنده مرجع است: router.invalidate لودرها را
 * دوباره اجرا می‌کند ولی beforeLoad ریشه را نه → matches[0].context.lang
 * زبانِ لحظه‌ی لود صفحه می‌ماند؛ بدون این، بعد از سوییچِ بدون ناوبری،
 * عنوان/برند/canonical صفحه یک زبان عقب می‌ماندند (setLang کوکی را همان
 * لحظه می‌نویسد و head بعد از invalidate دوباره ارزیابی می‌شود → زبانِ
 * تازه بی‌درنگ اعمال می‌شود). سمت سرور بدون تغییر: context قبل‌لود ریشه
 * (?lang= > کوکی درخواست) — کرالرها کوکی کلاینت ندارند که این شاخه چرخیده
 * باشد. الگوی regex همان lang-header.ts — بدون وابستگی جدید به i18n.
 */
export function headLang(matches: HeadFnCtx['matches']): Lang {
    if (typeof document !== 'undefined') {
        if (/(?:^|;\s*)sinshin-lang=ar(?:;|$)/.test(document.cookie)) return 'ar'
        if (/(?:^|;\s*)sinshin-lang=fa(?:;|$)/.test(document.cookie)) return 'fa'
    }
    const lang = (matches[0]?.context as { lang?: Lang } | undefined)?.lang
    return lang === 'ar' ? 'ar' : 'fa'
}

// ── URL builders ──

/** URL مطلق یک مسیر در زبان داده‌شده — fa تمیز، ar با ?lang=ar */
export function langUrl(path: string, lang: Lang): string {
    return lang === 'ar' ? `${SITE_URL}${path}?lang=ar` : `${SITE_URL}${path}`
}

/** سه href یک صفحه برای hreflang/sitemap — fa تمیز، ar واریانت، x-default = fa */
export function alternateHrefs(path: string): {
    fa: string
    ar: string
    xDefault: string
} {
    return {
        fa: `${SITE_URL}${path}`,
        ar: `${SITE_URL}${path}?lang=ar`,
        xDefault: `${SITE_URL}${path}`,
    }
}

/** لینک‌های hreflang صفحه — در هر رندر (فارسی یا عربی) هر سه زبان حاضرند.
 *  نکته (رارد ۴۰): پراپ React با فرم camelCase «hrefLang» داده می‌شود —
 *  React آن را به اتریبیوت استانداردِ حروف‌کوچکِ hreflang رندر می‌کند
 *  (خروجی HTML بایت‌به‌بایت همان است) و هشدار dev «Invalid DOM property
 *  hreflang» که در هر بار لود در کنسول ثبت می‌شد، دیگر نمی‌گیرد. */
export function alternateLinks(path: string) {
    const h = alternateHrefs(path)
    return [
        { rel: 'alternate', hrefLang: 'fa', href: h.fa },
        { rel: 'alternate', hrefLang: 'ar', href: h.ar },
        { rel: 'alternate', hrefLang: 'x-default', href: h.xDefault },
    ]
}

/** «${نام} | سین شین» — عنوان داینامیک صفحات محصول/مقاله با برند زبان درست */
export function withBrand(text: string, lang: Lang): string {
    return `${text} ${SEO[lang].brand}`
}

/** انتخاب محتوای عربی با fallback فارسی — همان قرارداد COALESCE رارد ۳۴ */
export function localized(
    ar: string | null | undefined,
    fa: string | null | undefined,
): string {
    const v = ar?.trim()
    return v ? v : (fa ?? '')
}

/**
 * انتخاب محتوا «به زبانِ فعال» — رارد ۳۹.
 *
 * نکته‌ی ظریف: localized() همیشه عربیِ موجود را ترجیح می‌دهد (قرارداد
 * COALESCE برای وقتی که سرور عربی خواسته)؛ در head/JSON-LD که هر دو زبان
 * ممکن‌اند، این یعنی صفحه‌ی فارسی هم عنوان عربی می‌گرفت! اینجا زبان تعیین
 * می‌کند: ar → عربی با fallback فارسی (localized)؛ fa → خودِ فیلد فارسی.
 */
export function localizedFor(
    lang: Lang,
    ar: string | null | undefined,
    fa: string | null | undefined,
): string {
    return lang === 'ar' ? localized(ar, fa) : (fa ?? '')
}

// ── head سازها ──

type RouteSeoAll = SeoStrings[SeoPathKey]

/** head صفحات ایندکس‌شونده‌ی عمومی — متا + canonical + hreflang، همه دوزبانه */
export function seoHead(key: SeoPathKey) {
    return (ctx: HeadFnCtx) => {
        const lang = headLang(ctx.matches)
        const s: RouteSeoAll = SEO[lang][key]
        const canonical = langUrl(SEO_PATHS[key], lang)
        return {
            meta: [
                { title: s.title },
                { name: 'description', content: s.description },
                ...(s.keywords ? [{ name: 'keywords', content: s.keywords }] : []),
                { property: 'og:title', content: s.ogTitle },
                { property: 'og:description', content: s.ogDescription },
                { property: 'og:type', content: s.ogType ?? 'website' },
                { property: 'og:url', content: canonical },
            ],
            links: [
                { rel: 'canonical', href: canonical },
                ...alternateLinks(SEO_PATHS[key]),
            ],
        }
    }
}

/** head صفحات خصوصی — عنوان دوزبانه + noindex؛ بدون canonical/hreflang */
export function noindexHead(key: SeoNoindexKey) {
    return (ctx: HeadFnCtx) => ({
        meta: [
            { title: SEO[headLang(ctx.matches)][key].title },
            { name: 'robots', content: 'noindex, nofollow' },
        ],
    })
}

/**
 * head ریشه — متادیتای سایت + og پایه + JSON-LD سایت، همه به زبان فعال.
 * صفحات فرزند با metaByAttribute عنوان/og خودشان را override می‌کنند
 * (تان‌استک از عمیق‌ترین مچ به بالا dedup می‌کند)؛ og:image و og:locale
 * و twitter فقط همین‌جا تعریف می‌شوند تا تکرار نشوند.
 */
export function siteHead(ctx: HeadFnCtx) {
    const lang = headLang(ctx.matches)
    const s = SEO[lang]
    return {
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: s.home.title },
            { name: 'description', content: s.home.description },
            ...(s.home.keywords
                ? [{ name: 'keywords', content: s.home.keywords }]
                : []),
            { name: 'robots', content: 'index, follow' },
            { name: 'theme-color', content: '#f6339a' },
            { name: 'apple-mobile-web-app-capable', content: 'yes' },
            { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
            { name: 'apple-mobile-web-app-title', content: s.appleTitle },
            { property: 'og:title', content: s.home.ogTitle },
            { property: 'og:description', content: s.home.ogDescription },
            { property: 'og:type', content: 'website' },
            { property: 'og:locale', content: OG_LOCALE[lang] },
            {
                property: 'og:locale:alternate',
                content: OG_LOCALE[lang === 'fa' ? 'ar' : 'fa'],
            },
            { property: 'og:site_name', content: s.siteName },
            { property: 'og:image', content: DEFAULT_OG_IMAGE },
            { property: 'og:image:width', content: '1155' },
            { property: 'og:image:height', content: '1155' },
            ...(s.home.ogImageAlt
                ? [{ property: 'og:image:alt', content: s.home.ogImageAlt }]
                : []),
            { 'twitter:card': 'summary_large_image' },
            { 'twitter:image': DEFAULT_OG_IMAGE },
            ...(s.home.ogImageAlt
                ? [{ 'twitter:image:alt': s.home.ogImageAlt }]
                : []),
            { 'script:ld+json': siteJsonLd(lang) },
        ],
    }
}

// ── JSON-LD ──

/** داده‌ی ساختاریافته‌ی سایت — WebSite + Restaurant به زبان فعال */
export function siteJsonLd(lang: Lang) {
    const s = SEO[lang]
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebSite',
                '@id': `${SITE_URL}/#website`,
                url: SITE_URL,
                name: s.siteName,
                inLanguage: LOCALE_TAG[lang],
            },
            {
                '@type': 'Restaurant',
                '@id': `${SITE_URL}/#restaurant`,
                name: s.restaurantName,
                url: SITE_URL,
                logo: `${SITE_URL}/icons/icon-512-v1.png`,
                image: DEFAULT_OG_IMAGE,
                telephone: '+982112345678',
                servesCuisine: s.servesCuisine,
            },
        ],
    }
}

/** BreadcrumbList — مسیر کنونی با نام‌های زبان فعال */
export function breadcrumbJsonLd(
    items: Array<{ name: string; path: string }>,
    lang: Lang,
) {
    return {
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: it.name,
            item: langUrl(it.path, lang),
        })),
    }
}

/** اسکیمای Product — نام/توضیح دوزبانه + Offer (قیمت تومان → ریال ×۱۰) */
export function productJsonLd(product: Product, lang: Lang) {
    const s = SEO[lang]
    const name = localizedFor(lang, product.nameAr, product.name)
    const description = localizedFor(lang, product.descriptionAr, product.description)
    const images = [
        absoluteUrl(product.profileImage) ?? DEFAULT_OG_IMAGE,
        ...product.galleryImages
            .map((g) => absoluteUrl(g))
            .filter((u): u is string => !!u)
            .slice(0, 3),
    ].filter((v, i, arr) => arr.indexOf(v) === i)
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Product',
                name,
                ...(description ? { description } : {}),
                image: images,
                inLanguage: LOCALE_TAG[lang],
                offers: {
                    '@type': 'Offer',
                    url: langUrl(`/products/${product.id}`, lang),
                    // قیمت‌های دامنه تومان‌اند؛ ارز رسمی ایران ریال است (IRR) → ×۱۰
                    price: String(product.finalPrice * 10),
                    priceCurrency: 'IRR',
                    availability:
                        product.status === 'ACTIVE'
                            ? 'https://schema.org/InStock'
                            : 'https://schema.org/SoldOut',
                },
            },
            breadcrumbJsonLd(
                [
                    { name: s.breadcrumb.home, path: '/' },
                    { name: s.breadcrumb.products, path: '/products' },
                    { name, path: `/products/${product.id}` },
                ],
                lang,
            ),
        ],
    }
}

/** اسکیمای Article — عنوان/خلاصه دوزبانه + نویسنده + BreadcrumbList */
export function articleJsonLd(article: ArticleDto, lang: Lang) {
    const s = SEO[lang]
    const title = localizedFor(lang, article.titleAr, article.title)
    const ogImage =
        absoluteUrl(article.profileImage) ??
        absoluteUrl(article.galleryImages?.[0]) ??
        DEFAULT_OG_IMAGE
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Article',
                headline: title,
                description: localizedFor(lang, article.excerptAr, article.excerpt),
                image: [ogImage],
                ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
                inLanguage: LOCALE_TAG[lang],
                author: article.author
                    ? { '@type': 'Person', name: article.author }
                    : { '@type': 'Organization', name: s.siteName },
                mainEntityOfPage: langUrl(`/articles/${article.id}`, lang),
            },
            breadcrumbJsonLd(
                [
                    { name: s.breadcrumb.home, path: '/' },
                    { name: s.breadcrumb.articles, path: '/articles' },
                    { name: title, path: `/articles/${article.id}` },
                ],
                lang,
            ),
        ],
    }
}
