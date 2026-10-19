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
mock.module('#/i18n', () => ({ useI18n: () => ({ t: { 'article.viewMap': 'View map', 'article.routeMap': 'Route from me' } }) }))
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
assert(linked.includes('Test address') && linked.includes('View map'))
assert(linked.includes('Route from me'))
// stage-92 — دو دیپ‌لینکِ راستی‌آزمایی‌شده: نما (@lat,lng) + مسیر (routing/car/destination)
assert(
	linked.includes('href="https://neshan.org/maps/@37.000000,49.000000,15z"'),
	'view deep link opens neshan centered on the block coordinates',
)
assert(
	linked.includes('href="https://neshan.org/maps/routing/car/destination/37.000000,49.000000"'),
	'route deep link pins the block point and routes from the current location',
)
assert.equal((linked.match(/neshan.org\/maps/g) ?? []).length, 2)

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
