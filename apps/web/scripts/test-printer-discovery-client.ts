import assert from 'node:assert/strict'
import { mock } from 'bun:test'

// Exercise the real authenticated fetch helper, including refresh and response
// body deadlines, without waiting 90 seconds for a slow printer scan.
const nativeTimeout = globalThis.setTimeout
const budgets: number[] = []
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
	if (delay === 30_000 || delay === 90_000) budgets.push(delay)
	return nativeTimeout(callback, delay === 30_000 ? 30 : delay === 90_000 ? 1_000 : delay, ...args)
}) as typeof setTimeout

let refreshes = 0
let requests = 0
let requestBody: unknown
let rejectFirst = false
const found = [{ host: '192.168.1.40', port: 9100 }]
const server = Bun.serve({
	hostname: '127.0.0.1',
	port: 0,
	async fetch(request) {
		requests++
		assert.equal(request.headers.get('authorization'), `Bearer ${refreshes ? 'renewed' : 'initial'}`)
		requestBody = await request.json()
		if (rejectFirst) {
			rejectFirst = false
			return Response.json({ error: { message: 'Expired' } }, { status: 401 })
		}
		// Headers arrive first; the budget must cover the slow body as well.
		return new Response(new ReadableStream({
			async start(controller) {
				await new Promise((resolve) => nativeTimeout(resolve, 100))
				controller.enqueue(new TextEncoder().encode(JSON.stringify({ scanned: ['192.168.1.0/24'], found })))
				controller.close()
			},
		}), { headers: { 'content-type': 'application/json' } })
	},
})

mock.module('#/lib/api', () => ({ apiBase: () => `http://127.0.0.1:${server.port}`, ssrFetchSignal: () => undefined }))
mock.module('#/lib/auth-session', () => ({
	getAccessToken: () => refreshes ? 'renewed' : 'initial',
	tryRefresh: async () => { refreshes++; return true },
}))
mock.module('#/lib/lang-header', () => ({ resolveRequestLang: async () => 'fa', langHeaders: async () => ({ 'x-sinshin-lang': 'fa' }) }))

try {
	const { discoverAdminPrinters } = await import('../src/server/admin')
	assert.deepEqual((await discoverAdminPrinters()).found, found)
	assert.deepEqual(requestBody, {})
	assert.deepEqual(budgets, [90_000], 'discovery must outlast the generic 30-second request budget')

	rejectFirst = true
	assert.deepEqual((await discoverAdminPrinters('192.168.1.0/24')).found, found)
	assert.deepEqual(requestBody, { cidr: '192.168.1.0/24' })
	assert.equal(refreshes, 1)
	assert.equal(requests, 3)
	assert.deepEqual(budgets, [90_000, 90_000, 90_000], 'token refresh must preserve the scan deadline')
	console.log('OK — printer discovery timeout, slow response body, subnet and authenticated retry')
} finally {
	globalThis.setTimeout = nativeTimeout
	server.stop(true)
}
