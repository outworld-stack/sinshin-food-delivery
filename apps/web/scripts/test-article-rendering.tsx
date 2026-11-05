import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blocksToPlainText, isArticleBlockUrl, type ArticleBlocksDoc } from '@sinshin/shared'
import { observeArticleBlocks } from '../src/components/site/articles/articleBlockAnimations'
import { defaultParseSearch } from '@tanstack/react-router'

mock.module('@tanstack/react-router', () => ({
        defaultParseSearch,
        Link: ({ to, children, search, hash, ...props }: { to: string; children: ReactNode; search?: Record<string, string>; hash?: string }) => {
                const query = search ? new URLSearchParams(search).toString() : ''
                return createElement('a', { ...props, href: to + (query ? `?${query}` : '') + (hash ? `#${hash}` : '') }, children)
        },
}))
mock.module('#/i18n', () => ({ useI18n: () => ({ t: { 'article.routeMap': 'Route from me', 'article.routeLocating': 'Locating…', 'article.routeGpsDenied': 'Pick the origin on the map yourself' } }) }))
// Public locations must render an actual map even without a configured SDK key.
mock.module('#/lib/neshan-sdk', () => ({ NESHAN_KEY: undefined, NESHAN_STYLE: '', loadNeshanSdk: () => { throw new Error('SSR must not load the SDK') } }))
const { ArticleBlocksRenderer } = await import('../src/components/site/articles/ArticleBlocksRenderer')
const render = (blocks: unknown[]) => renderToStaticMarkup(createElement(ArticleBlocksRenderer, {
        doc: { version: 1, blocks } as ArticleBlocksDoc,
}))

const malformed = [
        null,
        { id: 'missing-props', type: 'paragraph' },
        { id: 'bad-text', type: 'paragraph', props: { text: { unsafe: 'value' } } },
        { id: 'bad-gallery', type: 'gallery', props: { images: [null] } },
        { id: 'bad-list', type: 'list', props: { items: 'not-an-array' } },
        { id: 'bad-image', type: 'image', props: { src: '//untrusted.test/a.png' } },
        { id: 'valid', type: 'paragraph', props: { text: 'Remaining article <script>alert(1)</script>' } },
]
const defensive = render(malformed)
assert(defensive.includes('Remaining article &lt;script&gt;alert(1)&lt;/script&gt;'))
assert(!defensive.includes('<script>'))
assert(!defensive.includes('untrusted.test'))
assert.doesNotThrow(() => renderToStaticMarkup(createElement(ArticleBlocksRenderer, { doc: null })))
assert.doesNotThrow(() => renderToStaticMarkup(createElement(ArticleBlocksRenderer, { doc: { version: 1, blocks: null } as never })))

const ordered = render([{ id: 'ordered', type: 'list', props: { ordered: true, items: ['First', 'Second'] } }])
assert(ordered.includes('<ol'))
assert.equal((ordered.match(/<li class="list-item">/g) ?? []).length, 2, 'ordered items retain CSS list markers')
const unordered = render([{ id: 'unordered', type: 'list', props: { items: ['First'] } }])
assert(unordered.includes('<ul'))
assert(unordered.includes('aria-hidden="true"'))

const styled = render([{ id: 'color', type: 'paragraph', style: { bg: '#000000', align: 'center' }, props: { text: 'Readable text' } }])
assert(styled.includes('background-color:#000000;color:#ffffff'))
assert(styled.includes('ab-pad-md text-center'))
assert(styled.includes('<p style="color:inherit"'), 'theme text classes must not override calculated contrast')
const foreground = render([{ id: 'color-only', type: 'heading', style: { fg: '#123456' }, props: { text: 'Custom foreground', level: 3 } }])
assert(foreground.includes('color:#123456'))
assert(foreground.includes('<h3 style="color:inherit"'))

for (const badUrl of ['javascript:alert(1)', '//untrusted.test', '/\\untrusted.test', 'https://', 'https:///']) {
        assert.equal(isArticleBlockUrl(badUrl), false, badUrl)
        const html = render([{ id: 'cta', type: 'cta', props: { label: 'Order', to: 'url', href: badUrl } }])
        assert(html.includes('href="/products"'), 'invalid links use the safe menu destination')
}
for (const url of ['https://example.com/path?x=1', '/articles/مقاله', '/uploads/image.webp']) {
        assert.equal(isArticleBlockUrl(url), true, url)
        assert(render([{ id: 'cta', type: 'cta', props: { label: 'Open', to: 'url', href: url } }]).includes(`href="${url}"`))
}
assert.equal(blocksToPlainText({ version: 1, blocks: [
        ...malformed,
        { id: 'quote', type: 'quote', props: { text: ' quote ', author: 123 } },
        { id: 'list', type: 'list', props: { items: [42, null, ' item ', {}, ''] } },
] } as ArticleBlocksDoc), 'Remaining article <script>alert(1)</script>\n\nquote\n\nitem')

const linked = render([
        { id: 'link', type: 'link', props: { label: 'Article', href: '/articles/test?lang=ar#location' } },
        { id: 'external', type: 'link', props: { label: 'External', href: 'https://example.com/path' } },
        { id: 'invalid-link', type: 'link', props: { label: 'Unsafe', href: 'javascript:alert(1)' } },
        { id: 'location', type: 'location', props: { lat: 37, lng: 49, address: 'Test address' } },
        { id: 'invalid-location', type: 'location', props: { lat: 91, lng: 49 } },
])
assert(linked.includes('href="/articles/test?lang=ar#location"'))
assert(linked.includes('target="_blank" rel="noopener noreferrer"'))
assert(!linked.includes('Unsafe'))
assert(linked.includes('Test address') && linked.includes('Route from me'))
const mapSources = [...linked.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&')))
assert.equal(mapSources.length, 1, 'only valid location blocks render an embedded map')
assert.equal(mapSources[0]!.origin, 'https://www.openstreetmap.org')
assert.equal(mapSources[0]!.searchParams.get('marker'), '37,49', 'the article map shows the admin-selected coordinates without a map key')
assert(linked.includes('title="Test address"') && linked.includes('loading="lazy"'))
const multipleLocations = render([
        { id: 'first-location', type: 'location', props: { lat: 37.4822056, lng: 49.4418273, title: 'Restaurant' } },
        { id: 'second-location', type: 'location', props: { lat: 38, lng: 50, title: 'Another place' } },
])
const markers = [...multipleLocations.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&')).searchParams.get('marker'))
assert.deepEqual(markers, ['37.4822056,49.4418273', '38,50'], 'each location block keeps its own saved pin and coordinate precision')
const bilingualDoc: ArticleBlocksDoc = { version: 1, blocks: [
        { id: 'hero-ar', type: 'hero', props: { title: 'سرآغاز', text: 'متن هیرو', src: '/hero.webp' } },
        { id: 'heading-ar', type: 'heading', props: { text: 'تیتر فارسی', level: 3 } },
        { id: 'paragraph-ar', type: 'paragraph', props: { text: 'پاراگراف فارسی' } },
        { id: 'image-ar', type: 'image', props: { src: '/image.webp', alt: 'تصویر فارسی', caption: 'شرح فارسی' } },
        { id: 'gallery-ar', type: 'gallery', props: { layout: 'grid', images: [{ src: '/gallery.webp', alt: 'گالری فارسی' }] } },
        { id: 'quote-ar', type: 'quote', props: { text: 'نقل فارسی', author: 'نویسنده فارسی' } },
        { id: 'callout-ar', type: 'callout', props: { title: 'نکته فارسی', text: 'توضیح فارسی' } },
        { id: 'list-ar', type: 'list', props: { ordered: true, items: ['مورد اول فارسی', 'مورد دوم فارسی'] } },
        { id: 'cta-ar', type: 'cta', props: { title: 'عنوان فارسی', text: 'دعوت فارسی', label: 'دکمه فارسی', to: 'url', href: '/articles/test?x=fa#cta' } },
        { id: 'link-ar', type: 'link', props: { label: 'پیوند فارسی', href: 'https://example.com/path', variant: 'card', text: 'مقاله فارسی' } },
        { id: 'location-ar-one', type: 'location', props: { lat: 37.4822056789, lng: 49.4418273456, title: 'محل اول', address: 'آدرس اول فارسی' } },
        { id: 'location-ar-two', type: 'location', props: { lat: -12.987654321, lng: 0, title: 'محل دوم', address: 'آدرس دوم فارسی' } },
        { id: 'divider-ar', type: 'divider', props: { variant: 'dots' } },
] }
const bilingualAr: ArticleBlocksDoc = { version: 1, blocks: [
        { id: 'hero-ar', type: 'hero', props: { title: 'البداية', text: 'نص البداية' } },
        { id: 'heading-ar', type: 'heading', props: { text: 'العنوان العربي', level: 2 } },
        { id: 'paragraph-ar', type: 'paragraph', props: { text: 'الفقرة العربية <script>' } },
        { id: 'image-ar', type: 'image', props: { src: '/changed.webp', alt: 'الصورة العربية', caption: 'الوصف العربي' } },
        { id: 'gallery-ar', type: 'gallery', props: { layout: 'slider', images: [{ src: '/changed.webp', alt: 'المعرض العربي' }] } },
        { id: 'quote-ar', type: 'quote', props: { text: 'الاقتباس العربي', author: 'الكاتب العربي' } },
        { id: 'callout-ar', type: 'callout', props: { title: 'الملاحظة العربية', text: 'التوضيح العربي' } },
        { id: 'list-ar', type: 'list', props: { items: ['العنصر العربي', ''] } },
        { id: 'cta-ar', type: 'cta', props: { title: 'اطلب الآن', text: 'دعوة عربية', label: 'الزر العربي', to: 'menu' } },
        { id: 'link-ar', type: 'link', props: { label: 'الرابط العربي', href: '/changed', text: 'المقال العربي' } },
        { id: 'location-ar-two', type: 'location', props: { lat: 90, lng: 180, title: 'المكان الثاني' } },
        { id: 'location-ar-one', type: 'location', props: { lat: 0, lng: 0, title: 'المكان الأول', address: 'العنوان الأول' } },
] }
const translatedHtml = renderToStaticMarkup(createElement(ArticleBlocksRenderer, { doc: bilingualDoc, docAr: bilingualAr, lang: 'ar' }))
for (const expected of ['البداية', 'نص البداية', 'العنوان العربي', 'الفقرة العربية &lt;script&gt;', 'الصورة العربية', 'الوصف العربي',
        'المعرض العربي', 'الاقتباس العربي', 'الكاتب العربي', 'الملاحظة العربية', 'التوضيح العربي', 'العنصر العربي',
        'مورد دوم فارسی', 'الزر العربي', 'الرابط العربي', 'المكان الأول', 'العنوان الأول', 'المكان الثاني', 'آدرس دوم فارسی']) {
        assert(translatedHtml.includes(expected), `Arabic renderer includes ${expected}`)
}
assert(translatedHtml.includes('lang="ar" dir="rtl"'))
assert(translatedHtml.includes('<h3') && translatedHtml.includes('<ol'), 'heading levels and ordered lists retain Persian structure')
for (const target of ['/hero.webp', '/image.webp', '/gallery.webp', '/articles/test?x=fa#cta', 'https://example.com/path']) {
        assert(translatedHtml.includes(target), `Arabic renderer preserves ${target}`)
}
assert(!translatedHtml.includes('/changed') && !translatedHtml.includes('<script>'))
const arabicMarkers = [...translatedHtml.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&')).searchParams.get('marker'))
assert.deepEqual(arabicMarkers, ['37.4822056789,49.4418273456', '-12.987654321,0'], 'Arabic rendering preserves both coordinates and full precision despite changed translation coordinates/order')
const persianHtml = renderToStaticMarkup(createElement(ArticleBlocksRenderer, { doc: bilingualDoc, docAr: bilingualAr, lang: 'fa' }))
assert(persianHtml.includes('پاراگراف فارسی') && !persianHtml.includes('الفقرة العربية'), 'Persian renderer ignores Arabic document')
const untranslatedHtml = renderToStaticMarkup(createElement(ArticleBlocksRenderer, { doc: bilingualDoc, lang: 'ar' }))
assert(untranslatedHtml.includes('پاراگراف فارسی') && untranslatedHtml.includes('آدرس اول فارسی'), 'older articles render all Persian blocks in Arabic until translated')
// stage-98 — «مشاهده روی نقشه» حذف شد؛ «مسیریابی از موقعیت من» دکمه‌ی واقعی
// با GPS شد (SSR: <button> بدون href — لینک در لحظه‌ی کلیک ساخته می‌شود؛
// رفتارِ GPS موفق/ردشده در test-article-route.tsx تستِ رفتاری تست می‌شود)
assert(!linked.includes('View map'), 'the removed view-map button must not render')
assert(linked.includes('<button'), 'the route action is a real GPS button, not a bare link')
assert(
        !linked.includes('neshan.org/maps'),
        'no destination-only neshan deep links remain in the location block SSR — the origin is filled at click time from GPS',
)

class FakeElement {
        classes = new Set<string>()
        classList = {
                add: (name: string) => this.classes.add(name),
                remove: (name: string) => this.classes.delete(name),
        }
        constructor(private anim = 'fade-up') {}
        getAttribute() { return this.anim }
}
const first = new FakeElement()
const still = new FakeElement('none')
let children = [first, still]
const root = Object.assign(new FakeElement(), { querySelectorAll: () => children })
const browserRoot = root as unknown as HTMLElement
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: undefined })
const noObserverCleanup = observeArticleBlocks(browserRoot)
assert(!root.classes.has('ab-js'), 'without browser APIs content stays visible')
assert(first.classes.has('ab-inview'))
noObserverCleanup()

let observer!: FakeObserver
class FakeObserver {
        observed = new Set<Element>()
        disconnected = false
        constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) { observer = this }
        observe(element: Element) { this.observed.add(element) }
        unobserve(element: Element) { this.observed.delete(element) }
        disconnect() { this.disconnected = true; this.observed.clear() }
}
Object.defineProperty(globalThis, 'IntersectionObserver', { value: FakeObserver })
const cleanup = observeArticleBlocks(browserRoot)
assert(root.classes.has('ab-js'))
assert(!first.classes.has('ab-inview'))
assert(still.classes.has('ab-inview'))
assert.equal(observer.observed.size, 1)
assert.equal(observer.options.threshold, 0, 'very tall blocks reveal on their first intersection')
observer.callback([{ target: first, isIntersecting: true, intersectionRatio: 0.01 }] as unknown as IntersectionObserverEntry[], observer as unknown as IntersectionObserver)
assert(first.classes.has('ab-inview'))
assert.equal(observer.observed.size, 0, 'revealed blocks are observed only once')
const previousObserver = observer
cleanup()
assert(previousObserver.disconnected)
assert(!root.classes.has('ab-js'))

const next = new FakeElement()
children = [next]
const nextCleanup = observeArticleBlocks(browserRoot)
assert(observer.observed.has(next as unknown as Element), 'replacement article blocks are observed')
nextCleanup()
Object.defineProperty(globalThis, 'window', { value: { matchMedia: () => ({ matches: true }) } })
observeArticleBlocks(browserRoot)()
assert(!root.classes.has('ab-js'))
assert(next.classes.has('ab-inview'), 'reduced motion keeps all content readable')

console.log('Article rendering regressions passed: malformed documents, escaped text, list numbering, custom colors, safe links, text extraction, animation fallback, tall blocks, replacement documents, reduced motion.')
