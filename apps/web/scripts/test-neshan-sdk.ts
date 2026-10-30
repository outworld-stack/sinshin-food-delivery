import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { decodePolyline, normalizeMapPoint, mapBounds } from '../src/utils/mapGeometry'

assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
for (const invalid of ['?', '_', '????_', '\u0000?', '~'.repeat(100), '?'.repeat(200_001)]) {
	assert.deepEqual(decodePolyline(invalid), [], 'malformed provider data must never become a plausible route')
}
assert.deepEqual(normalizeMapPoint({ lat: 37, lng: 409 }), { lat: 37, lng: 49 })
assert.equal(normalizeMapPoint({ lat: 95, lng: 49 }), null)
assert.deepEqual(mapBounds([[37, 49], [36, 48], [38, 50]]), [[48, 36], [50, 38]])

// Exercise the loader boundary without evaluating WebGL or claiming to test CSS.
// A separate browser check covers the actual package, canvas and marker layout.
let clientLoads = 0
mock.module('../src/lib/neshan-sdk-client', () => {
	clientLoads++
	throw new Error('Simulated SDK chunk failure')
})
const { loadNeshanSdk } = await import('../src/lib/neshan-sdk')
await assert.rejects(loadNeshanSdk(), /requires a browser/)
assert.equal(clientLoads, 0, 'server rendering never evaluates the browser-only SDK module')

Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
const first = loadNeshanSdk()
const second = loadNeshanSdk()
assert.equal(first, second, 'all map component types share one in-flight SDK promise')
await assert.rejects(first, /Simulated SDK chunk failure/)
assert.equal(clientLoads, 1, 'concurrent maps evaluate the SDK module once')

const sdk = { Map: class {}, Marker: class {} }
mock.module('../src/lib/neshan-sdk-client', () => {
	clientLoads++
	return { default: sdk }
})
const retry = loadNeshanSdk()
assert.notEqual(retry, first, 'a failed SDK chunk does not poison the cached promise')
assert.equal(await retry, sdk, 'the loader exposes the package default export')
assert.equal(loadNeshanSdk(), retry, 'subsequent maps reuse the successfully loaded SDK')
assert.equal(clientLoads, 2)

Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
await assert.rejects(loadNeshanSdk(), /requires a browser/)
assert.equal(clientLoads, 2, 'the browser guard still applies after a successful load')
console.log('Neshan SDK and geometry regressions passed: SSR guard, shared package loading, retry, cached success, wrapped coordinates, bounded polyline decoding and route bounds.')
