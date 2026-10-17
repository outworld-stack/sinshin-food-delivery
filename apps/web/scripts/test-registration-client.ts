import assert from 'node:assert/strict'

let mode: 'ok' | 'rate-limited' | 'stalled-body' = 'ok'
let observedPhone: string | null = null
let language: string | null = null
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/api/auth/refresh') {
      return mode === 'rate-limited'
        ? Response.json({ error: { message: 'Rate limited' } }, { status: 429 })
        : Response.json({ accessToken: 'REFRESHED' })
    }
    if (path === '/api/auth/me') return Response.json({ error: { message: 'Expired access token' } }, { status: 401 })
    if (path === '/api/auth/check') {
      observedPhone = (await request.json() as { phone: string }).phone
      language = request.headers.get('x-sinshin-lang')
      if (mode === 'stalled-body') {
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return Response.json({ isNewUser: true, needsTerms: true })
    }
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://localhost:${server.port}`
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } })
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  get cookie() { throw new DOMException('Cookies blocked', 'SecurityError') },
} })
const originalFetch = globalThis.fetch
const originalTimeout = globalThis.setTimeout
// Keep this hermetic even when the local .env points at a running API.
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  return originalFetch(origin + url.pathname + url.search, init)
}) as typeof fetch

try {
  const auth = await import('../src/server/auth')
  const session = await import('../src/lib/auth-session')
  const { useAuthStore } = await import('../src/stores/authStore')
  await session.tryRefresh()

  assert.deepEqual(await auth.checkIsNewUser('09123456789'), { isNewUser: true, needsTerms: true })
  assert.equal(observedPhone, '09123456789')
  assert.equal(language, 'fa')

  mode = 'rate-limited'
  session.setAccessToken('CURRENT-SESSION')
  useAuthStore.getState().login(false, 'user')
  await assert.rejects(auth.getAccount())
  assert.equal(session.getAccessToken(), 'CURRENT-SESSION')
  assert.equal(useAuthStore.getState().isAuthenticated, true)

  // Exercise the real registration call with headers already received and
  // an incomplete JSON body. Shorten only the HTTP deadline for the test.
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalTimeout(handler, delay === 30_000 ? 50 : delay, ...args)) as typeof setTimeout
  mode = 'stalled-body'
  const started = Date.now()
  await assert.rejects(auth.checkIsNewUser('09123456789'))
  assert.ok(Date.now() - started < 1_500)
  console.log('Registration client: blocked cookies, transient refresh failure, and stalled JSON timeout passed.')
} finally {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalTimeout
  server.stop(true)
}
