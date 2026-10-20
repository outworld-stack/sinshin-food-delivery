import assert from 'node:assert/strict'
import { spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import { AppError } from '../src/domain/shared/errors'
import { geoRoutes } from '../src/http/routes/geo.routes'
import { NeshanService, decodePolyline, type LatLng } from '../src/infra/maps/neshan.service'

const config = { neshan: { serviceApiKey: 'test-service-key', timeoutMs: 1000, cacheTtlSeconds: 300 } }
const service = () => new NeshanService(config as never)
const origin = { lat: 35.6892123456789, lng: 51.3890987654321 }
const destination = { lat: 35.7, lng: 51.4 }
const requests: Array<{ url: URL; init?: RequestInit }> = []
let respond: (url: URL) => Promise<Response> = async () => { throw new Error('Unexpected provider request') }
const fetchSpy = spyOn(Bun, 'fetch').mockImplementation((async (input, init) => {
  const url = new URL(String(input))
  assert.equal(url.origin, 'https://api.neshan.org')
  requests.push({ url, init })
  return respond(url)
}) as typeof Bun.fetch)
const warnings = spyOn(console, 'warn').mockImplementation(() => {})

function encode(points: Array<[number, number]>): string {
  let lastLat = 0
  let lastLng = 0
  let encoded = ''
  for (const [lat, lng] of points) {
    for (const delta of [Math.round(lat * 1e5) - lastLat, Math.round(lng * 1e5) - lastLng]) {
      let number = delta < 0 ? -delta * 2 - 1 : delta * 2
      while (number >= 0x20) {
        encoded += String.fromCharCode((number & 0x1f) + 0x20 + 63)
        number = Math.floor(number / 32)
      }
      encoded += String.fromCharCode(number + 63)
    }
    lastLat = Math.round(lat * 1e5)
    lastLng = Math.round(lng * 1e5)
  }
  return encoded
}

const polyline = encode([[35.68, 51.38], [35.69, 51.4], [35.7, 51.39]])
const validRoute = () => ({ routes: [{ overview_polyline: { points: polyline }, legs: [
  { distance: { value: 100 }, duration: { value: 20 }, summary: 'First leg' },
  { distance: { value: 220 }, duration: { value: 45 }, summary: 'Second leg' },
] }] })
const reversePayload = { status: 'OK', formatted_address: 'Tehran', city: 'Tehran', route_name: 'Street' }
const matrixPayload = (rows = 1, columns = 1) => ({ rows: Array.from({ length: rows }, () => ({
  elements: Array.from({ length: columns }, () => ({ status: 'Ok', distance: { value: 100 }, duration: { value: 20 } })),
})) })
const reply = (payload: unknown) => { respond = async () => Response.json(payload) }

try {
  assert.deepEqual(decodePolyline(polyline), [[35.68, 51.38], [35.69, 51.4], [35.7, 51.39]])
  assert.deepEqual(decodePolyline(encode([[0, 0], [-90, -180], [90, 180]])), [[0, 0], [-90, -180], [90, 180]])
  for (const malformed of ['', '_', '????_', '~~~~~~~?', '\u0000?', '\u007f?', 'a'.repeat(200_001), encode([[91, 0]]), encode([[0, 181]])]) {
    assert.deepEqual(decodePolyline(malformed), [], `reject malformed polyline ${malformed.slice(0, 20)}`)
  }
  for (let i = 0; i < 256; i++) {
    const points = decodePolyline(String.fromCharCode(i).repeat(15))
    assert(points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180))
  }
  console.log('PASS bounded polyline decoding: truncated, invalid, oversized and out-of-world coordinates')

  const initial = requests.length
  const noKey = new NeshanService({ neshan: { ...config.neshan, serviceApiKey: '' } } as never)
  assert.equal(await noKey.reverseGeocode(0, 0), null)
  assert.equal(await noKey.routeNoTraffic(origin, destination), null)
  assert.equal(await noKey.distanceMatrix([origin], [destination]), null)
  for (const point of [{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 1 }, { lat: 1, lng: Infinity }]) {
    assert.equal(await service().reverseGeocode(point.lat, point.lng), null)
    assert.equal(await service().routeNoTraffic(point, destination), null)
    assert.equal(await service().distanceMatrix([origin, point], [destination]), null)
  }
  assert.equal(await service().distanceMatrix([], [destination]), null)
  assert.equal(await service().distanceMatrix(Array.from({ length: 11 }, () => origin), [destination]), null)
  assert.equal(await service().routeNoTraffic(origin, destination, { waypoints: Array.from({ length: 6 }, () => origin) }), null)
  assert.equal(requests.length, initial, 'missing keys and invalid coordinates/sizes never spend provider quota')
  console.log('PASS missing keys, invalid coordinates, waypoint limits and matrix limits fail before fetching')

  for (const malformed of [null, {}, [], 'error', { status: 'ERROR' }, { status: 'OK', formatted_address: {} }, { status: 'OK', formatted_address: '  ' }]) {
    reply(malformed)
    assert.equal(await service().reverseGeocode(origin.lat, origin.lng), null)
  }
  reply({ ...reversePayload, neighbourhood: 12, municipality_zone: {}, route_name: null, city: false, in_traffic_zone: 'false', in_odd_even_zone: true })
  const reverse = await service().reverseGeocode(origin.lat, origin.lng)
  assert.deepEqual(reverse, { formattedAddress: 'Tehran', routeName: '', neighbourhood: null, city: '', state: '', municipalityZone: null, inTrafficZone: false, inOddEvenZone: true })
  const last = requests.at(-1)!
  assert.equal(last.url.searchParams.get('lat'), String(origin.lat), 'GPS precision is preserved for the provider')
  assert.equal(last.url.searchParams.get('lng'), String(origin.lng))
  assert.equal(new Headers(last.init?.headers).get('Api-Key'), 'test-service-key')
  assert(last.init?.signal instanceof AbortSignal)
  console.log('PASS reverse payload validation, optional fields, full GPS precision and service-key header')

  reply(validRoute())
  const routed = await service().routeNoTraffic(origin, destination, { waypoints: [{ lat: 0, lng: 0 }] })
  assert.equal(routed?.distanceMeters, 320)
  assert.equal(routed?.durationSeconds, 65)
  assert.equal(routed?.summary, 'First leg — Second leg')
  assert.equal(requests.at(-1)?.url.searchParams.get('waypoints'), '0,0')
  for (const malformed of [null, {}, { routes: [] }, { routes: [null] }, { routes: [{ overview_polyline: { points: '_' }, legs: validRoute().routes[0]!.legs }] }, { routes: [{ overview_polyline: { points: polyline }, legs: null }] }, { routes: [{ overview_polyline: { points: polyline }, legs: [{ distance: { value: -1 }, duration: { value: 2 } }] }] }]) {
    reply(malformed)
    assert.equal(await service().routeNoTraffic(origin, destination), null)
  }
  const overflowing = validRoute()
  for (const leg of overflowing.routes[0]!.legs) leg.distance.value = 1e308
  reply(overflowing)
  assert.equal(await service().routeNoTraffic(origin, destination), null, 'valid individual legs cannot produce an infinite route total')
  console.log('PASS all route legs are summed and malformed/nonfinite route totals fail softly')

  for (const malformed of [null, {}, { rows: [] }, matrixPayload(2, 1), matrixPayload(1, 2), { rows: [null] }, { rows: [{ elements: null }] }]) {
    reply(malformed)
    assert.equal(await service().distanceMatrix([origin], [destination]), null, 'provider dimensions must match caller row/column identities')
  }
  reply({ rows: [{ elements: [
    { status: 'Ok', distance: { value: 0 }, duration: { value: 0 } },
    { status: 'NoRoute', distance: { value: 999 }, duration: { value: 999 } },
    { status: 'Ok', distance: { value: -1 }, duration: { value: 1 } },
    null,
  ] }] })
  const matrix = await service().distanceMatrix([origin], [destination, destination, destination, destination], { type: 'motorcycle', traffic: true })
  assert.deepEqual(matrix, [[
    { status: 'Ok', distanceMeters: 0, durationSeconds: 0 },
    { status: 'NoRoute', distanceMeters: null, durationSeconds: null },
    { status: 'UnknownError', distanceMeters: null, durationSeconds: null },
    { status: 'UnknownError', distanceMeters: null, durationSeconds: null },
  ]])
  assert.equal(requests.at(-1)?.url.pathname, '/v1/distance-matrix')
  assert.equal(requests.at(-1)?.url.searchParams.get('type'), 'motorcycle')
  console.log('PASS matrix dimensions, zero distances and invalid/no-route elements preserve positions')

  for (const operation of [
    (maps: NeshanService) => maps.reverseGeocode(0, 0),
    (maps: NeshanService) => maps.routeNoTraffic(origin, destination),
    (maps: NeshanService) => maps.distanceMatrix([origin], [destination]),
  ]) {
    const maps = service()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    respond = async (url) => {
      await gate
      return Response.json(url.pathname.includes('reverse') ? reversePayload : url.pathname.includes('matrix') ? matrixPayload() : validRoute())
    }
    const before = requests.length
    const simultaneous = Array.from({ length: 8 }, () => operation(maps))
    assert.equal(requests.length, before + 1, 'identical requests share one in-flight fetch')
    release()
    const results = await Promise.all(simultaneous)
    assert(results.every((value) => value !== null))
    assert.deepEqual(await operation(maps), results[0])
    assert.equal(requests.length, before + 1, 'successful requests are cached')
  }
  const retryable = service()
  respond = async () => { throw new Error('provider offline') }
  assert.equal(await retryable.reverseGeocode(0, 0), null)
  respond = async () => new Response('not json', { status: 200 })
  assert.equal(await retryable.reverseGeocode(0, 0), null)
  reply(reversePayload)
  assert.equal((await retryable.reverseGeocode(0, 0))?.formattedAddress, 'Tehran', 'failed flights are removed and failures do not poison the cache')
  console.log('PASS reverse/route/matrix coalescing and successful caching with retry after provider/JSON errors')

  const routeCalls: Array<{ origin: LatLng; destination: LatLng }> = []
  const reverseCalls: Array<[number, number]> = []
  const matrixCalls: Array<{ origins: LatLng[]; destinations: LatLng[] }> = []
  const maps = service()
  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(geoRoutes({
    geo: {} as never,
    sessions: { authenticate: async () => ({ user: { role: 'customer' }, ctx: {} }) } as never,
    redis: { incr: async () => 1, expire: async () => {} } as never,
    neshan: {
      reverseGeocode: async (lat: number, lng: number) => { reverseCalls.push([lat, lng]); return null },
      routeNoTraffic: async (from: LatLng, to: LatLng) => { routeCalls.push({ origin: from, destination: to }); return null },
      distanceMatrix: async (origins: LatLng[], destinations: LatLng[]) => { matrixCalls.push({ origins, destinations }); return null },
      haversineMeters: maps.haversineMeters.bind(maps),
    } as never,
  })).compile()
  const request = (path: string, query: Record<string, string>, authorized = true) => app.handle(new Request(`http://localhost/geo/${path}?${new URLSearchParams(query)}`, {
    headers: authorized ? { authorization: 'Bearer test-session' } : {},
  }))
  assert.equal((await request('reverse', { lat: '0', lng: '0' }, false)).status, 401)
  for (const [lat, lng] of [[String(origin.lat), String(origin.lng)], ['0', '0'], ['1e-8', '-1e-8']]) {
    const response = await request('reverse', { lat: lat!, lng: lng! })
    assert.equal(response.status, 200)
    assert.deepEqual(reverseCalls.at(-1), [Number(lat), Number(lng)])
  }
  for (const pair of ['0,0', `${origin.lat},${origin.lng}`, '1e-8,-1e-8']) {
    const response = await request('route', { from: pair, to: pair })
    assert.equal(response.status, 200)
    const body = await response.json() as { available: boolean; fallback?: { distanceMeters: number } }
    assert.equal(body.available, false)
    assert.equal(body.fallback?.distanceMeters, 0)
    assert.deepEqual(routeCalls.at(-1)?.origin, { lat: Number(pair.split(',')[0]), lng: Number(pair.split(',')[1]) })
  }
  for (const pair of [',1', '1,', ' , ', '1,2,3', 'NaN,1', 'Infinity,0', '91,0', '0,181', '0x1,2']) {
    const before = routeCalls.length
    const response = await request('route', { from: pair, to: '0,0' })
    if (response.status === 200) assert.deepEqual(await response.json(), { available: false })
    else assert.equal(response.status, 422)
    assert.equal(routeCalls.length, before, 'invalid route pairs never reach the provider')
  }
  const beforeMatrix = matrixCalls.length
  assert.equal((await request('distance-matrix', { origins: `0,0|${origin.lat},${origin.lng}`, destinations: '0,0' })).status, 200)
  assert.deepEqual(matrixCalls.at(-1)?.origins, [{ lat: 0, lng: 0 }, origin])
  await request('distance-matrix', { origins: '0,0|,1', destinations: '0,0' })
  assert.equal(matrixCalls.length, beforeMatrix + 1, 'invalid points reject the complete matrix instead of dropping one row')
  for (const values of [{ lat: '91', lng: '0' }, { lat: '0', lng: '181' }, { lat: '', lng: '0' }, { lat: 'NaN', lng: '1' }]) {
    assert.equal((await request('reverse', values)).status, 422)
  }
  assert(Number.isFinite(maps.haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })))
  console.log('PASS authenticated geo routes accept full-precision GPS, scientific notation and zero coordinates; reject malformed pairs')
} finally {
  fetchSpy.mockRestore()
  warnings.mockRestore()
}

console.log('OK maps service and geo route regressions (no external provider requests)')
