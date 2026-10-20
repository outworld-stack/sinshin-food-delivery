import assert from 'node:assert/strict'
import { decodePolyline, normalizeMapPoint, mapBounds } from '../src/utils/mapGeometry'

assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
for (const invalid of ['?', '_', '????_', '\u0000?', '~'.repeat(100), '?'.repeat(200_001)]) {
	assert.deepEqual(decodePolyline(invalid), [], 'malformed provider data must never become a plausible route')
}
assert.deepEqual(normalizeMapPoint({ lat: 37, lng: 409 }), { lat: 37, lng: 49 })
assert.equal(normalizeMapPoint({ lat: 95, lng: 49 }), null)
assert.deepEqual(mapBounds([[37, 49], [36, 48], [38, 50]]), [[48, 36], [50, 38]])

type FakeElement = { tag: string; src?: string; href?: string; onload?: (() => void) | null; onerror?: (() => void) | null; remove(): void }
const elements: FakeElement[] = []
const fakeWindow: { maplibregl?: { default: unknown } } = {}
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
	createElement(tag: string) { const el: FakeElement = { tag, remove() { elements.splice(elements.indexOf(el), 1) } }; return el },
	querySelector() { return elements.find((el) => el.tag === 'link') },
	head: { appendChild(el: FakeElement) { elements.push(el) } },
} })
const { loadNeshanSdk } = await import('../src/lib/neshan-sdk')
const first = loadNeshanSdk()
const second = loadNeshanSdk()
assert.equal(first, second, 'all map component types share one in-flight SDK promise')
assert.equal(elements.filter((el) => el.tag === 'script').length, 1)
const rejection = assert.rejects(first)
elements.find((el) => el.tag === 'script')!.onerror!()
await rejection
const retry = loadNeshanSdk()
assert.notEqual(retry, first, 'CDN failure permits a fresh request')
assert.equal(elements.filter((el) => el.tag === 'script').length, 1, 'failed scripts are removed')
assert.equal(elements.filter((el) => el.tag === 'link').length, 1)
fakeWindow.maplibregl = { default: { Map: class {}, Marker: class {} } }
elements.find((el) => el.tag === 'script')!.onload!()
assert.equal(await retry, fakeWindow.maplibregl.default)
assert.equal(loadNeshanSdk(), retry)
console.log('Neshan SDK and geometry regressions passed: deduplication, retry, cleanup, wrapped coordinates, bounded polyline decoding and route bounds.')
