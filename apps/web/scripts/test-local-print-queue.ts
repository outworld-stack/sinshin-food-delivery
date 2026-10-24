import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type {
	LocalPrintAgentDto,
	LocalPrintAssignment,
	LocalPrintEnqueueInput,
	LocalPrintJobDto,
} from '@sinshin/shared'

const agent: LocalPrintAgentDto = {
	id: 'agent-one', name: 'Restaurant POS', online: true,
	lastSeenAt: '2026-10-24T12:00:00.000Z',
	printers: [{ name: 'POS Printer', isDefault: true }],
}
let assignment: LocalPrintAssignment = { sales: null, kitchen: null }
let refreshes = 0
let rejectNextAuth = false
let truncateNextAcceptedResponse = false
let failNextAcceptedResponse = false
const requests: { path: string; method: string; body?: any }[] = []
const jobs = new Map<string, LocalPrintJobDto>()
const server = Bun.serve({
	hostname: '127.0.0.1', port: 0,
	async fetch(request) {
		const url = new URL(request.url)
		const path = url.pathname
		const method = request.method
		const body = method === 'POST' ? await request.json() as any : undefined
		requests.push({ path, method, body })
		assert.equal(request.headers.get('authorization'), `Bearer ${refreshes ? 'renewed' : 'initial'}`)
		if (rejectNextAuth) {
			rejectNextAuth = false
			return Response.json({ error: { message: 'Expired' } }, { status: 401 })
		}
		if (path === '/admin/print/agents') {
			if (method === 'GET') return Response.json({ agents: [agent] })
			assert.deepEqual(body, { name: 'Restaurant POS' })
			return Response.json({ agent, token: 'one-time-pairing-token' })
		}
		if (path.startsWith('/admin/print/agents/') && method === 'DELETE')
			return new Response(null, { status: 204 })
		if (path === '/admin/print/local-assignment') {
			if (method === 'POST') assignment = body
			return Response.json(assignment)
		}
		if (path === '/admin/print/local-jobs') {
			if (method === 'GET') return Response.json({ jobs: [...jobs.values()].filter(job => job.orderId === url.searchParams.get('orderId')) })
			const input = body as LocalPrintEnqueueInput
			let job = jobs.get(input.jobId)
			if (!job) {
				job = {
					id: input.jobId, orderId: input.orderId, kind: input.kind,
					agentId: agent.id, printerName: 'POS Printer', status: 'queued', error: null,
					createdAt: '2026-10-24T12:00:00.000Z', updatedAt: '2026-10-24T12:00:00.000Z',
				}
				jobs.set(job.id, job)
			}
			if (truncateNextAcceptedResponse) {
				truncateNextAcceptedResponse = false
				return new Response('{"id":', { headers: { 'content-type': 'application/json' } })
			}
			if (failNextAcceptedResponse) {
				failNextAcceptedResponse = false
				return Response.json({ error: { code: 'TEMPORARY', message: 'Response unavailable' } }, { status: 503 })
			}
			return Response.json(job)
		}
		if (path === '/admin/print/local-jobs/discard-pending') {
			const job = jobs.get(body.jobId)
			if (job && ['claimed', 'spooled', 'uncertain'].includes(job.status))
				return Response.json({ error: { message: 'Printing may have started' } }, { status: 409 })
			if (job?.status === 'queued') job.status = 'cancelled'
			return Response.json({ discarded: true, job: job ?? null })
		}
		const suffix = path.slice('/admin/print/local-jobs/'.length)
		const id = decodeURIComponent(suffix.replace(/\/cancel$/, ''))
		const job = jobs.get(id)
		if (!job) return Response.json({ error: { message: 'Not found' } }, { status: 404 })
		if (method === 'POST') {
			if (job.status !== 'queued' && job.status !== 'cancelled')
				return Response.json({ error: { message: 'Already claimed' } }, { status: 409 })
			job.status = 'cancelled'
		}
		return Response.json(job)
	},
})

mock.module('#/lib/api', () => ({ apiBase: () => `http://127.0.0.1:${server.port}`, ssrFetchSignal: () => undefined }))
mock.module('#/lib/auth-session', () => ({
	getAccessToken: () => refreshes ? 'renewed' : 'initial',
	tryRefresh: async () => { refreshes++; return true },
}))
mock.module('#/lib/lang-header', () => ({ resolveRequestLang: async () => 'fa', langHeaders: async () => ({ 'x-sinshin-lang': 'fa' }) }))

try {
	const queue = await import('../src/lib/localPrintQueue')
	assert.deepEqual(await queue.getLocalPrintAgents(), [agent])
	assert.deepEqual(await queue.pairLocalPrintAgent('Restaurant POS'), { agent, token: 'one-time-pairing-token' })
	assert.equal(await queue.revokeLocalPrintAgent('agent/with space'), undefined)
	assert.equal(requests.at(-1)!.path, '/admin/print/agents/agent%2Fwith%20space', 'agent identifiers cannot change the endpoint path')
	assert.deepEqual(await queue.getLocalPrintAssignment(), { sales: null, kitchen: null })
	const nextAssignment: LocalPrintAssignment = {
		sales: { agentId: agent.id, printerName: 'POS Printer', widthDots: 576, mode: 'driver', cut: false }, kitchen: null,
	}
	assert.deepEqual(await queue.saveLocalPrintAssignment(nextAssignment), nextAssignment)
	assert.deepEqual(await queue.getLocalPrintAssignment(), nextAssignment)

	const input: LocalPrintEnqueueInput = {
		jobId: '4d3c5c5c-3b39-4d1a-8ebf-385a1108480b', orderId: 'ord-1', kind: 'sales',
		widthPx: 576, heightPx: 1, rows: 'retained-bitmap',
	}
	truncateNextAcceptedResponse = true
	await assert.rejects(queue.enqueueLocalPrintJob(input), SyntaxError)
	assert.equal(requests.filter(request => request.method === 'POST' && request.path === '/admin/print/local-jobs').length, 1,
		'an ambiguous accepted response never automatically retries or changes the job ID')
	const recovered = await queue.getLocalPrintJob(input.jobId)
	assert.equal(recovered.status, 'queued', 'the original ID recovers a job whose acceptance response was lost')
	assert.deepEqual(await queue.enqueueLocalPrintJob(input), recovered, 'an explicit retry sends the retained payload unchanged')
	assert.equal(jobs.size, 1)
	assert.deepEqual(await queue.getLocalPrintJobs(input.orderId), [recovered])
	assert.deepEqual(await queue.getLocalPrintJobs('ord-1&other=1'), [], 'order filtering is encoded as a single query value')

	rejectNextAuth = true
	const beforeRefresh = requests.length
	await queue.enqueueLocalPrintJob(input)
	assert.equal(refreshes, 1)
	assert.deepEqual(requests.slice(beforeRefresh).map(request => request.body), [input, input],
		'token refresh preserves both the stable job ID and the exact receipt bitmap')

	failNextAcceptedResponse = true
	const beforeFailure = requests.length
	await assert.rejects(queue.enqueueLocalPrintJob(input), (error: unknown) => (error as { status?: number }).status === 503)
	assert.equal(requests.length, beforeFailure + 1, 'server errors propagate without an automatic duplicate submission')
	assert.equal((await queue.getLocalPrintJob(input.jobId)).status, 'queued')
	assert.equal((await queue.cancelLocalPrintJob(input.jobId)).status, 'cancelled')
	assert.equal((await queue.cancelLocalPrintJob(input.jobId)).status, 'cancelled')
	jobs.get(input.jobId)!.status = 'claimed'
	await assert.rejects(queue.cancelLocalPrintJob(input.jobId), (error: unknown) => (error as { status?: number }).status === 409)
	assert.equal(jobs.get(input.jobId)!.status, 'claimed', 'a rejected cancellation cannot be reported as success')
	const mutableInput = { ...input, jobId: '36cd3bde-2c06-4161-8034-9e582b095b0d' }
	const snapshotSubmission = queue.enqueueLocalPrintJob(mutableInput)
	mutableInput.rows = 'different-later-bitmap'
	await snapshotSubmission
	assert.equal(requests.at(-1)!.body.rows, input.rows, 'an in-flight request snapshots the retained bitmap before asynchronous auth preparation')
	const discardInput = { jobId: mutableInput.jobId, orderId: input.orderId }
	const discardSnapshot = { ...discardInput }
	const discardSubmission = queue.discardPendingLocalPrintJob(discardInput)
	discardInput.jobId = 'mutated-after-send'
	assert.equal((await discardSubmission).job?.status, 'cancelled')
	assert.deepEqual(requests.at(-1), { path: '/admin/print/local-jobs/discard-pending', method: 'POST', body: discardSnapshot })
	assert.deepEqual(await queue.discardPendingLocalPrintJob({ jobId: 'unaccepted-id', orderId: input.orderId }), { discarded: true, job: null })
	const beforeRejectedDiscard = requests.length
	await assert.rejects(queue.discardPendingLocalPrintJob({ jobId: input.jobId, orderId: input.orderId }), (error: unknown) => (error as { status?: number }).status === 409)
	assert.equal(requests.length, beforeRejectedDiscard + 1, 'discard rejection propagates without automatic retries')
	console.log('Local print transport passed: pairing, assignment, encoded paths, durable IDs, response ambiguity, explicit retries, authentication refresh and cancellation errors.')
} finally {
	server.stop(true)
	mock.restore()
}
