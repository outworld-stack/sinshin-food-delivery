import assert from 'node:assert/strict'
import { mock } from 'bun:test'

type UploadResult = { success: boolean; accepted?: boolean; stopTracking?: boolean; message?: string }
let upload: () => Promise<UploadResult> = async () => ({ success: true, accepted: true })
let requests = 0
mock.module('#/server/courier', () => ({ updateCourierLocation: async () => { requests++; return upload() } }))
const storage = new Map<string, string>()
let storageBlocked = false
let storageWritesBlocked = false
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => {
  if (storageBlocked) throw new DOMException('Denied', 'SecurityError')
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageWritesBlocked) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      if (storageWritesBlocked) throw new DOMException('Denied', 'SecurityError')
      storage.delete(key)
    },
  }
} })
const { getCourierToken, setCourierToken, clearCourierToken } = await import('../src/utils/courierSession')
const { startCourierTracking } = await import('../src/utils/courierTracking')
const realNow = Date.now
let now = 100000
Date.now = () => now
let position!: (value: GeolocationPosition) => Promise<void>
let geoError!: (value: GeolocationPositionError) => void
let cleared = 0
let gpsStartupBlocked = false
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
  watchPosition: (success: typeof position, error: typeof geoError) => {
    if (gpsStartupBlocked) throw new DOMException('Denied', 'SecurityError')
    position = success; geoError = error; return 10
  },
  clearWatch: () => { cleared++ },
} } })
const gps = (lat = 37, lng = 49) => ({ coords: { latitude: lat, longitude: lng } }) as GeolocationPosition
let sent = 0
let stopped = 0
let lastMessage = ''
let positions = 0
const start = () => startCourierTracking({
  orderId: 'ord-12345678', courierToken: 'token', onPosition: () => { positions++ },
  onSent: () => { sent++ }, onStopped: () => { stopped++ }, onMessage: (message) => { lastMessage = message },
})
try {
  storage.set('courier-token', JSON.stringify({ token: 'restored-session', expiresAt: now + 1000 }))
  assert.equal(getCourierToken(), 'restored-session', 'a fresh tab initializes from persisted authentication')
  clearCourierToken()
  storageBlocked = true
  setCourierToken('private-session')
  assert.equal(getCourierToken(), 'private-session', 'login works with denied storage')
  now += 3 * 60 * 60 * 1000
  assert.equal(getCourierToken(), null, 'memory session expires after three hours')
  storageBlocked = false
  setCourierToken('persisted-session')
  assert.equal(getCourierToken(), 'persisted-session')
  storageWritesBlocked = true
  setCourierToken('newer-session')
  assert.equal(JSON.parse(storage.get('courier-token')!).token, 'persisted-session', 'failed writes leave stale storage readable')
  assert.equal(getCourierToken(), 'newer-session', 'new login remains authoritative despite stale readable storage')
  clearCourierToken()
  assert.equal(getCourierToken(), null, 'failed removal cannot resurrect a logged-out token')
  setCourierToken('fallback-session')
  storage.clear()
  assert.equal(getCourierToken(), 'fallback-session', 'missing storage cannot erase the memory fallback')
  storageWritesBlocked = false
  clearCourierToken()
  assert.equal(getCourierToken(), null)
  const stop = start()
  await position(gps())
  assert.equal(sent, 1)
  await position(gps())
  assert.equal(requests, 1, 'GPS bursts are throttled')
  now += 6000
  let resolve!: (result: UploadResult) => void
  upload = () => new Promise((done) => { resolve = done })
  const pending = position(gps())
  now += 6000
  await position(gps())
  assert.equal(requests, 2, 'slow mobile uploads do not overlap')
  stop()
  const beforeStop = { sent, positions }
  resolve({ success: true })
  await pending
  await position(gps())
  assert.deepEqual({ sent, positions }, beforeStop, 'stopped requests and queued GPS callbacks cannot update the page')
  assert.equal(cleared, 1)

  upload = async () => ({ success: true, accepted: false })
  start()
  await position(gps())
  assert.equal(sent, 1, 'server throttling is not counted as a delivered GPS update')
  now += 6000
  upload = async () => ({ success: false, stopTracking: true, message: 'Delivery completed' })
  await position(gps())
  assert.equal(stopped, 1)
  assert.equal(lastMessage, 'Delivery completed')
  assert.equal(cleared, 2)

  setCourierToken('expiring')
  upload = async () => { throw Object.assign(new Error('Session expired'), { status: 401 }) }
  start()
  await position(gps())
  assert.equal(getCourierToken(), null)
  assert.equal(stopped, 2, 'expired sessions stop GPS and allow login recovery')

  const stopTransient = start()
  upload = async () => { throw new Error('Offline') }
  await position(gps())
  assert.equal(stopped, 2, 'transient failures keep the watcher available')
  now += 6000
  upload = async () => ({ success: true })
  await position(gps())
  assert.equal(sent, 2)
  await position(gps(NaN))
  assert.equal(requests, 7, 'invalid coordinates are discarded')
  stopTransient()
  start()
  geoError({ code: 1 } as GeolocationPositionError)
  assert.equal(stopped, 3, 'denied geolocation releases the watcher')
  gpsStartupBlocked = true
  const cleanupFailedStartup = start()
  assert.equal(stopped, 4, 'synchronous GPS startup errors return the UI to a stopped state')
  assert(lastMessage.length > 0)
  cleanupFailedStartup()
  console.log('Courier client passed: denied/read-only storage, authoritative login/logout, token expiry, upload serialization/throttling, stale callbacks, terminal delivery/auth/GPS errors and transient recovery.')
} finally {
  Date.now = realNow
  clearCourierToken()
}
