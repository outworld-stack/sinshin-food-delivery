import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { AboutContentDto, ArticleBlocksDoc } from '@sinshin/shared'
import { defaultParseSearch } from '@tanstack/react-router'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ar } from '../src/i18n/ar'
import { type Dict, fa } from '../src/i18n/fa'

let dictionary: Dict = fa
mock.module('#/i18n', () => ({ useI18n: () => ({ t: dictionary }) }))
mock.module('@tanstack/react-router', () => ({
	defaultParseSearch,
	Link: ({ to, children, ...props }: { to: string; children: ReactNode }) =>
		createElement('a', { ...props, href: to }, children),
}))
mock.module('#/lib/neshan-sdk', () => ({
	NESHAN_KEY: undefined,
	NESHAN_STYLE: 'test-style',
	loadNeshanSdk: () => { throw new Error('About SSR must not load the browser map SDK') },
}))
mock.module('#/components/site/articles/ArticleRouteButton', () => ({
	ArticleRouteButton: ({ lat, lng }: { lat: number; lng: number }) =>
		createElement('button', { 'data-directions': `${lat},${lng}` }, dictionary['article.routeMap']),
}))
const { AboutContentView } = await import('../src/components/site/about/AboutContentView')
const base: AboutContentDto = {
	id: 1, heroTitle: 'داستان سین‌شین', heroText: 'First paragraph\nSecond paragraph',
	heroGradient: '/uploads/restaurant.webp', teamTitle: 'Our team',
	teamGradient: 'https://example.com/team.webp', teamAlt: 'Kitchen team',
	updatedAt: new Date().toISOString(),
	location: { lat: 37.4822056, lng: 49.4418273, address: 'Restaurant address' },
	blocks: { version: 1, blocks: [
		{ id: 'story', type: 'paragraph', props: { text: 'Added story' } },
		{ id: 'value', type: 'heading', props: { text: 'Our values', level: 2 } },
	] },
}
const render = (patch: Partial<AboutContentDto> = {}) =>
	renderToStaticMarkup(createElement(AboutContentView, { content: { ...base, ...patch } }))
function embeddedMap(markup: string) {
	const frame = markup.match(/<iframe\b[^>]*>/)?.[0]
	assert(frame, 'About renders a real embedded map without a Neshan key')
	const src = frame.match(/\bsrc="([^"]+)"/)?.[1]
	assert(src, 'embedded map has a source URL')
	const url = new URL(src.replaceAll('&amp;', '&'))
	assert.equal(url.origin, 'https://www.openstreetmap.org')
	assert.equal(url.pathname, '/export/embed.html')
	assert.equal(url.searchParams.get('layer'), 'mapnik')
	assert(frame.includes('loading="lazy"'), 'map loads lazily below the About content')
	return { frame, url }
}
const html = render()
assert(html.includes('<img src="/uploads/restaurant.webp"'), 'uploaded hero uses an actual image')
assert(html.includes('src="https://example.com/team.webp"') && html.includes('alt="Kitchen team"'))
assert(html.includes('whitespace-pre-line') && html.includes('First paragraph\nSecond paragraph'))
assert(html.indexOf('Added story') < html.indexOf('Our values'), 'blocks retain their saved order')
const map = embeddedMap(html)
assert.equal(map.url.searchParams.get('marker'), '37.4822056,49.4418273')
assert(map.frame.includes(`title="${fa['about.locationTitle']}"`), 'Persian map title describes the restaurant location')
assert(html.includes('data-directions="37.4822056,49.4418273"'))
assert(html.indexOf('<iframe') < html.indexOf('data-directions='), 'directions appears below the map')
assert(html.includes('Restaurant address') && html.includes('href="#restaurant-location"'))

const customLocation = render({ location: { lat: 37.501234, lng: 49.401234, address: 'Saved custom address' } })
assert.equal(embeddedMap(customLocation).url.searchParams.get('marker'), '37.501234,49.401234', 'map follows the saved restaurant location')
assert(customLocation.includes('data-directions="37.501234,49.401234"') && customLocation.includes('Saved custom address'))

const removed = render({ heroGradient: '', teamTitle: '', teamGradient: '', blocks: null })
assert(!removed.includes('<img') && !removed.includes('about-team-heading') && !removed.includes('Added story'))
assert.equal(embeddedMap(removed).url.searchParams.get('marker'), '37.4822056,49.4418273', 'removing optional content retains restaurant map')
const reordered = render({ blocks: { version: 1, blocks: [...base.blocks!.blocks].reverse() } })
assert(reordered.indexOf('Our values') < reordered.indexOf('Added story'))
const gradient = render({ heroGradient: 'from-rose-400 to-red-700' })
assert(gradient.includes('bg-linear-to-br from-rose-400 to-red-700'), 'existing gradient content is preserved')
assert(!gradient.includes('src="from-rose-400'))
const escaped = render({ heroTitle: '<script>alert(1)</script>', heroText: '<img src=x onerror=alert(1)>' })
assert(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;'))
for (const location of [null, { lat: 91, lng: 49, address: '' }, { lat: 37, lng: Number.NaN, address: '' }]) {
	const invalid = render({ location })
	assert(!invalid.includes('<iframe') && !invalid.includes('data-directions='), 'invalid destinations never reach maps/directions')
}
dictionary = ar
const arabic = render({ heroTitle: 'عن المطعم', location: { ...base.location!, address: 'عنوان المطعم' } })
assert(arabic.includes('عن المطعم') && arabic.includes('عنوان المطعم') && arabic.includes(ar['about.locationTitle']))
const arabicMap = embeddedMap(arabic)
assert(arabicMap.frame.includes(`title="${ar['about.locationTitle']}"`), 'Arabic map title is localized')
assert.equal(arabicMap.url.searchParams.get('marker'), '37.4822056,49.4418273', 'localization preserves the restaurant marker')

type RequestCall = { path: string; method?: string; body?: unknown }
const calls: RequestCall[] = []
mock.module('#/lib/api-fetch', () => ({
	getJson: async (path: string) => { calls.push({ path }); return base },
	authJson: async (path: string, method: string, body?: unknown) => { calls.push({ path, method, body }); return base },
}))
const { getAboutContent, getAdminAboutContent, updateAboutContent } = await import('../src/server/about')
await getAboutContent()
await getAdminAboutContent()
assert.deepEqual(calls.slice(0, 2), [{ path: '/about' }, { path: '/admin/about', method: 'GET', body: undefined }])
const doc: ArticleBlocksDoc = { version: 1, blocks: [] }
await updateAboutContent({
	heroTitle: 'Edited', heroText: '', heroGradient: '', teamTitle: '', teamGradient: '', teamAlt: '',
	heroTitleAr: '  عنوان  ', heroTextAr: ' ', teamTitleAr: '', teamAltAr: '',
	blocks: doc, blocksAr: null, location: base.location,
})
assert.equal(calls.at(-1)?.path, '/admin/about')
assert.equal(calls.at(-1)?.method, 'PATCH')
assert.deepEqual(calls.at(-1)?.body, {
	heroTitle: 'Edited', heroText: '', heroGradient: '', teamTitle: '', teamGradient: '', teamAlt: '',
	heroTitleAr: 'عنوان', heroTextAr: null, teamTitleAr: null, teamAltAr: null,
	blocks: doc, blocksAr: null, location: base.location,
})
console.log('PASS About rendering, optional content removal, block order, map/directions coordinates, localization and admin API contract')
