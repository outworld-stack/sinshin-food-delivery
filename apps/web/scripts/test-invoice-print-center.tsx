import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { LocalPrintEnqueueInput, LocalPrintJobDto, LocalPrintKind } from '@sinshin/shared'

const react = { ...await import('react') }
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Host = { cells: Cell[]; cursor: number; effects: Array<() => void>; dirty: boolean; tree: any; render(): void; unmount(): void }
let host: Host
mock.module('react', () => ({
	...react, memo: (component: any) => component,
	useState(initial: any) {
		const owner = host
		const cell = owner.cells[owner.cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
		return [cell.value, (next: any) => {
			const value = typeof next === 'function' ? next(cell.value) : next
			if (!Object.is(cell.value, value)) { cell.value = value; owner.dirty = true }
		}]
	},
	useRef(initial: any) { return (host.cells[host.cursor++] ??= { value: { current: initial } }).value },
	useCallback(fn: any) { return fn },
	useMemo(compute: () => any, deps: unknown[]) {
		const cell = host.cells[host.cursor++] ??= {}
		if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) { cell.value = compute(); cell.deps = deps }
		return cell.value
	},
	useEffect(effect: () => (() => void) | void, deps: unknown[]) {
		const cell = host.cells[host.cursor++] ??= {}
		if (!cell.deps || deps.some((value, i) => !Object.is(value, cell.deps![i]))) {
			host.effects.push(() => { cell.cleanup?.(); cell.deps = deps; cell.cleanup = effect() || undefined })
		}
	},
}))

type Query = { data: any; isPending: boolean; isError: boolean; refetch(): Promise<any> }
const invoiceQueries = new Map<string, Query>()
const jobQueries = new Map<string, Query>()
const jobs = new Map<string, LocalPrintJobDto>()
const target = { agentId: 'agent-1', printerName: 'POS Printer', widthDots: 576, mode: 'driver', cut: false }
const assignmentQuery: Query = { data: { sales: target, kitchen: target }, isPending: false, isError: false, refetch: async () => ({}) }
const agentsQuery: Query = { data: [{ id: 'agent-1', name: 'POS', online: true, printers: [{ name: 'POS Printer', isDefault: true }], lastSeenAt: null }], isPending: false, isError: false, refetch: async () => ({}) }
let role: 'admin' | 'admin2' = 'admin'
let canManage = true
let canRead = true
let refreshFails = false
let syncJobsOnRefresh = false
const queryCalls: { key: string[]; enabled?: boolean }[] = []
function jobsFor(orderId: string): Query {
	let query = jobQueries.get(orderId)
	if (!query) {
		query = { data: [], isPending: false, isError: false, refetch: async () => {
			query!.data = [...jobs.values()].filter(job => job.orderId === orderId).map(job => ({ ...job }))
			return { data: query!.data }
		} }
		jobQueries.set(orderId, query)
	}
	return query
}
function invoiceFor(orderId: string): Query {
	let query = invoiceQueries.get(orderId)
	if (!query) {
		query = { data: { orderId, revision: 'original' }, isPending: false, isError: false, refetch: async () => ({}) }
		invoiceQueries.set(orderId, query)
	}
	return query
}
mock.module('@tanstack/react-query', () => ({
	useQuery(options: { queryKey: string[]; enabled?: boolean }) {
		queryCalls.push({ key: options.queryKey, enabled: options.enabled })
		if (options.queryKey[0] === 'staff-invoice') return invoiceFor(options.queryKey[1])
		if (options.queryKey[0] === 'local-print-jobs') return jobsFor(options.queryKey[1])
		return options.queryKey[0] === 'local-print-agents' ? agentsQuery : assignmentQuery
	},
	useQueryClient: () => ({ setQueryData: (queryKey: string[], update: (value: any) => any) => {
		const query = jobsFor(queryKey[1]); query.data = update(query.data); host.dirty = true
	}, invalidateQueries: async ({ queryKey }: { queryKey: string[] }) => {
		if (refreshFails) throw new Error('Refresh failed')
		if (syncJobsOnRefresh && queryKey[0] === 'local-print-jobs') await jobsFor(queryKey[1]).refetch()
	} }),
}))
mock.module('#/hooks/admin/usePermissions', () => ({ usePermissions: () => ({ permissions: { printingManage: role === 'admin' || canManage, orderDetailsRead: canRead }, isChecking: false }) }))
const toasts: string[] = []
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: any) => select({ showToast: (message: string) => toasts.push(message) }) }))
mock.module('reicon-react', () => ({ Printer: () => null, X: () => null }))
mock.module('#/server/admin', () => ({ getStaffOrderInvoice: async (orderId: string) => invoiceFor(orderId).data }))
function Settings(_props: any) { return null }
mock.module('#/components/admin/admin2/LocalPrinterSettings', () => ({ LocalPrinterSettings: Settings }))
mock.module('#/components/admin/admin2/ReceiptPreviewPane', () => ({ ReceiptPreviewPane: () => null }))

const posted: LocalPrintEnqueueInput[] = []
const built: LocalPrintEnqueueInput[] = []
const lookedUp: string[] = []
const cancelled: string[] = []
const discarded: { jobId: string; orderId: string }[] = []
const printed: any[] = []
const storage = new Map<string, string>()
let storageBlocked = false
let acceptResponseLost = false
let rejectBeforeAccepted = false
let discardError: Error | null = null
let buildPause: ((payload: LocalPrintEnqueueInput) => Promise<LocalPrintEnqueueInput>) | null = null
let enqueuePause: ((payload: LocalPrintEnqueueInput) => Promise<LocalPrintJobDto>) | null = null
let browserPause: (() => Promise<void>) | null = null
const jobFrom = (payload: LocalPrintEnqueueInput): LocalPrintJobDto => ({
	id: payload.jobId, orderId: payload.orderId, kind: payload.kind, agentId: 'agent-1', printerName: 'POS Printer', status: 'queued', error: null,
	createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z',
})
mock.module('#/lib/localPrintQueue', () => ({
	getLocalPrintAgents: async () => agentsQuery.data,
	getLocalPrintAssignment: async () => assignmentQuery.data,
	getLocalPrintJobs: async (orderId: string) => [...jobs.values()].filter(job => job.orderId === orderId),
	getLocalPrintJob: async (id: string) => {
		lookedUp.push(id)
		const job = jobs.get(id)
		if (!job) throw Object.assign(new Error('Not found'), { status: 404 })
		return { ...job }
	},
	enqueueLocalPrintJob: async (payload: LocalPrintEnqueueInput) => {
		const saved = storage.get(`sinshin-pending-print:${payload.orderId}`) ?? ''
		assert(saved.includes(payload.jobId), 'the job ID must be persisted before POST')
		assert(saved.includes(payload.rows), 'the exact bitmap must be persisted before POST')
		posted.push({ ...payload })
		if (enqueuePause) return enqueuePause(payload)
		if (rejectBeforeAccepted) throw new Error('Network unavailable')
		const job = jobs.get(payload.jobId) ?? jobFrom(payload)
		jobs.set(job.id, job)
		if (acceptResponseLost) throw new Error('Response lost after acceptance')
		return { ...job }
	},
	cancelLocalPrintJob: async (id: string) => {
		cancelled.push(id)
		const job = jobs.get(id)!
		if (job.status !== 'queued') throw Object.assign(new Error('Already claimed'), { status: 409 })
		job.status = 'cancelled'
		return { ...job }
	},
	discardPendingLocalPrintJob: async (input: { jobId: string; orderId: string }) => {
		discarded.push(input)
		if (discardError) throw discardError
		const job = jobs.get(input.jobId)
		if (job && ['claimed', 'spooled', 'uncertain'].includes(job.status))
			throw Object.assign(new Error('Printing may have started'), { status: 409 })
		if (job?.status === 'queued') job.status = 'cancelled'
		return { discarded: true, job: job ? { ...job } : null }
	},
}))
mock.module('#/utils/invoicePrint', () => ({
	buildInvoicePrintSpecs: async (invoice: any, kinds: LocalPrintKind[]) => kinds.map(kind => ({ kind, spec: { fileName: `${invoice.orderId}-${kind}`, brand: 'Sinshin', sections: [], paper: 'receipt' } })),
	buildLocalInvoiceJob: async (invoice: any, kind: LocalPrintKind, printTarget: any, jobId: string) => {
		const payload: LocalPrintEnqueueInput = { jobId, orderId: invoice.orderId, kind, widthPx: printTarget.widthDots, heightPx: 120, rows: `bitmap-${invoice.revision}-${kind}` }
		built.push(payload)
		return buildPause ? buildPause(payload) : payload
	},
}))
mock.module('#/lib/printDocument', () => ({
	buildPrintDocumentHtml: (spec: any) => `<html>${spec.fileName}</html>`,
	printHtmlDocumentAsync: async (spec: any) => { printed.push(spec); if (browserPause) await browserPause() },
}))

const originals = new Map(['window', 'sessionStorage', 'crypto'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let nextId = 0
let confirmResult = false
let confirmations = 0
const browser = Object.assign(new EventTarget(), { confirm: () => { confirmations++; return confirmResult } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => { if (storageBlocked) throw new Error('Storage unavailable'); storage.set(key, value) },
	removeItem: (key: string) => storage.delete(key),
} })
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}` } })

const { InvoicePrintCenterModal } = await import('../src/components/admin/admin2/InvoicePrintCenterModal')
function nodes(value: any): any[] {
	if (Array.isArray(value)) return value.flatMap(nodes)
	if (!value?.props) return []
	return [value, ...nodes(value.props.children)]
}
function text(value: any): string {
	if (Array.isArray(value)) return value.map(text).join('')
	if (value?.props) return text(value.props.children)
	return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
const queueButton = (owner: Host) => nodes(owner.tree).find(node => node.type === 'button' && String(node.props.className).includes('flex w-full'))!
const browserButton = (owner: Host) => nodes(owner.tree).find(node => node.type === 'button' && text(node).startsWith('چاپ مرورگر'))!
const discardButton = (owner: Host) => nodes(owner.tree).find(node => node.type === 'button' && text(node).startsWith('کنار گذاشتن درخواست قبلی'))!
const checkboxes = (owner: Host) => nodes(owner.tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')
const alerts = (owner: Host) => nodes(owner.tree).filter(node => node.props.role === 'alert').map(text).join(' ')
const hosts: Host[] = []
function mount(getOrder = () => 'ord-1'): Host {
	const owner: Host = { cells: [], cursor: 0, effects: [], dirty: false, tree: null,
		render() {
			host = owner; owner.cursor = 0; owner.dirty = false
			owner.tree = InvoicePrintCenterModal({ orderId: getOrder(), onClose() {} })
			for (const effect of owner.effects.splice(0)) effect()
		},
		unmount() { for (const cell of owner.cells) { cell.cleanup?.(); cell.cleanup = undefined } },
	}
	hosts.push(owner); owner.render(); return owner
}
async function flush(owner: Host) {
	for (let i = 0; i < 40; i++) { await Promise.resolve(); if (owner.dirty) owner.render() }
}
async function salesOnly(owner: Host) {
	checkboxes(owner)[1].props.onChange(); await flush(owner)
}
function reset() {
	for (const owner of hosts) owner.unmount()
	invoiceQueries.clear(); jobQueries.clear(); jobs.clear(); storage.clear(); posted.length = 0; built.length = 0; lookedUp.length = 0; cancelled.length = 0; discarded.length = 0; printed.length = 0; toasts.length = 0; queryCalls.length = 0
	discardError = null
	role = 'admin'; canManage = true; canRead = true; refreshFails = false; syncJobsOnRefresh = false; storageBlocked = false; acceptResponseLost = false; rejectBeforeAccepted = false; buildPause = null; enqueuePause = null; browserPause = null; confirmResult = false; confirmations = 0
}

try {
	reset()
	let owner = mount(); await flush(owner)
	const mainShape = JSON.stringify(owner.tree)
	role = 'admin2'; owner.unmount(); owner = mount(); await flush(owner)
	assert.equal(JSON.stringify(owner.tree), mainShape, 'both admin levels have the same print center and controls')
	assert(!queueButton(owner).props.disabled)
	assert(!browserButton(owner).props.disabled)
	canManage = false; owner.render(); await flush(owner)
	assert(queueButton(owner).props.disabled, 'direct printing honors the secondary administrator permission')
	assert(nodes(owner.tree).some(node => node.type === Settings && node.props.canManage === false), 'hardware settings remain visible with authorization disabled')
	assert(!browserButton(owner).props.disabled, 'read permission still allows explicit browser fallback')
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 0)
	checkboxes(owner)[0].props.onChange(); await flush(owner)
	browserButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(printed.map(spec => spec.fileName), ['ord-1-sales'], 'browser action uses the preview, not the direct-print checkbox selection')
	assert.equal(posted.length, 0)
	const kitchenTab = nodes(owner.tree).find(node => node.type === 'button' && node.props['aria-pressed'] !== undefined && text(node) === 'آشپزخانه')!
	kitchenTab.props.onClick(); await flush(owner)
	browserButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(printed.map(spec => spec.fileName), ['ord-1-sales', 'ord-1-kitchen'])
	canRead = false; owner.render(); await flush(owner)
	assert(browserButton(owner).props.disabled)
	assert(queryCalls.some(query => query.key[0] === 'staff-invoice' && query.enabled === false))

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	acceptResponseLost = true
	queueButton(owner).props.onClick(); queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 1, 'rapid clicks submit one durable job')
	assert.equal(printed.length, 0, 'an ambiguous queue response never triggers browser fallback')
	assert(browserButton(owner).props.disabled, 'an unresolved submission blocks duplicate browser printing')
	assert(text(queueButton(owner)).includes('شناسه'))
	acceptResponseLost = false
	queueButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(lookedUp, [posted[0].jobId], 'retry first recovers the same job ID')
	assert.equal(posted.length, 1, 'an already accepted job is recovered without a second enqueue')
	assert.equal(built.length, 1)

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	rejectBeforeAccepted = true
	queueButton(owner).props.onClick(); await flush(owner)
	const retainedPayload = { ...posted[0] }
	assert(retainedPayload.jobId)
	owner.unmount()
	invoiceFor('ord-1').data = { orderId: 'ord-1', revision: 'changed-after-close' }
	rejectBeforeAccepted = false
	owner = mount(); await flush(owner); await salesOnly(owner)
	queueButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(posted[1], retainedPayload, 'closing/reopening must retry the retained bitmap, not regenerate changed invoice content with the old ID')
	assert.equal(built.length, 1)
	assert.equal(printed.length, 0)

	reset(); owner = mount(); await flush(owner)
	enqueuePause = async payload => {
		if (payload.kind === 'sales') {
			const saved = JSON.parse(storage.get('sinshin-pending-print:ord-1')!)
			assert(saved.sales && saved.kitchen, 'both bitmaps are saved atomically before the first receipt is sent')
		}
		const job = jobFrom(payload); jobs.set(job.id, job)
		if (payload.kind === 'kitchen') throw new Error('Kitchen response lost')
		return job
	}
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 2)
	assert(!queueButton(owner).props.disabled, 'a queued sales receipt must not block recovery of the pending kitchen receipt')
	assert(jobsFor('ord-1').data.some((job: LocalPrintJobDto) => job.kind === 'sales'), 'successful responses are displayed before a refresh')
	queueButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(lookedUp, [posted[1].jobId])
	assert.equal(posted.length, 2, 'recovering kitchen must not create another sales print')
	assert.equal(built.length, 2)
	assert.equal(confirmations, 0, 'pending-only recovery is not presented as a reprint')
	assert.equal(storage.get('sinshin-pending-print:ord-1'), '{}')

	reset(); owner = mount(); await flush(owner)
	enqueuePause = async payload => {
		if (payload.kind === 'kitchen') throw Object.assign(new Error('Width changed'), { status: 409 })
		const job = jobFrom(payload); jobs.set(job.id, job); return job
	}
	queueButton(owner).props.onClick(); await flush(owner)
	const kitchenPayload = { ...posted[1] }
	owner.unmount(); invoiceFor('ord-1').data = { orderId: 'ord-1', revision: 'new-content' }
	enqueuePause = null; owner = mount(); await flush(owner)
	queueButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(posted[2], kitchenPayload, 'remounted retry sends only the original outstanding kitchen bitmap')
	assert.equal(posted.filter(payload => payload.kind === 'sales').length, 1)
	assert.equal(built.length, 2)

	reset(); owner = mount(); await flush(owner)
	buildPause = async payload => {
		if (payload.kind === 'kitchen') throw new Error('Kitchen preparation failed')
		return payload
	}
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 0, 'both invoice preparations finish before any POST')
	assert.equal(storage.get('sinshin-pending-print:ord-1'), undefined, 'a partial preparation does not leave an incomplete retry batch')

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	enqueuePause = async () => { throw Object.assign(new Error('Width changed'), { status: 409 }) }
	queueButton(owner).props.onClick(); await flush(owner)
	const rejectedPayload = { ...posted[0] }
	assert(browserButton(owner).props.disabled, 'a rejected response alone cannot discard the stable pending ID')
	discardButton(owner).props.onClick(); await flush(owner)
	assert.equal(discarded.length, 0, 'discard requires explicit confirmation')
	confirmResult = true; discardError = new Error('Discard response unavailable')
	discardButton(owner).props.onClick(); await flush(owner)
	assert(storage.get('sinshin-pending-print:ord-1')?.includes(rejectedPayload.jobId), 'an ambiguous discard response retains the payload')
	assert(browserButton(owner).props.disabled)
	discardError = null; discardButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(discarded, [
		{ jobId: rejectedPayload.jobId, orderId: rejectedPayload.orderId },
		{ jobId: rejectedPayload.jobId, orderId: rejectedPayload.orderId },
	], 'discard retries use the original job ID for the atomic server operation')
	assert.equal(storage.get('sinshin-pending-print:ord-1'), '{}')
	assert(!browserButton(owner).props.disabled)
	assert.equal(printed.length, 0, 'successful discard does not automatically print a fallback')

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	acceptResponseLost = true; queueButton(owner).props.onClick(); await flush(owner)
	confirmResult = true; discardButton(owner).props.onClick(); await flush(owner)
	assert.equal(jobsFor('ord-1').data[0].status, 'cancelled', 'discard directly records an accepted but unclaimed job cancellation')
	assert(!browserButton(owner).props.disabled)
	assert.equal(printed.length, 0)

	for (const status of ['claimed', 'spooled', 'uncertain'] as const) {
		reset(); owner = mount(); await flush(owner); await salesOnly(owner)
		acceptResponseLost = true; queueButton(owner).props.onClick(); await flush(owner)
		jobs.get(posted[0].jobId)!.status = status
		confirmResult = true; discardButton(owner).props.onClick(); await flush(owner)
		assert(storage.get('sinshin-pending-print:ord-1')?.includes(posted[0].jobId), `a ${status} job cannot be forgotten on discard rejection`)
		assert(browserButton(owner).props.disabled)
		assert.equal(printed.length, 0)
	}

	reset(); owner = mount(); await flush(owner)
	const queued = jobFrom({ jobId: 'active-job', orderId: 'ord-1', kind: 'sales', widthPx: 576, heightPx: 1, rows: 'x' })
	jobs.set(queued.id, queued); await jobsFor('ord-1').refetch(); owner.render(); await flush(owner)
	assert(queueButton(owner).props.disabled && browserButton(owner).props.disabled, 'active jobs block duplicate queueing and browser fallback')
	queueButton(owner).props.onClick(); browserButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length + printed.length, 0)
	const cancelButton = nodes(owner.tree).find(node => node.type === 'button' && text(node) === 'لغو کار در صف')!
	cancelButton.props.onClick(); await flush(owner)
	assert.deepEqual(cancelled, ['active-job'])
	assert(!browserButton(owner).props.disabled)
	browserButton(owner).props.onClick(); await flush(owner)
	assert.equal(printed.length, 1, 'the explicit fallback becomes available after successful queued-job cancellation')
	queued.status = 'claimed'; await jobsFor('ord-1').refetch(); owner.render(); await flush(owner)
	assert(browserButton(owner).props.disabled)
	assert(!nodes(owner.tree).some(node => node.type === 'button' && text(node) === 'لغو کار در صف'), 'claimed jobs cannot be cancelled from the UI')
	queued.status = 'uncertain'; await jobsFor('ord-1').refetch(); owner.render(); await flush(owner)
	browserButton(owner).props.onClick(); await flush(owner)
	assert.equal(printed.length, 1, 'uncertain spool state requires an explicit reprint decision')
	assert.equal(confirmations, 1)
	confirmResult = true; browserButton(owner).props.onClick(); await flush(owner)
	assert.equal(printed.length, 2)

	reset(); storageBlocked = true; owner = mount(); await flush(owner); await salesOnly(owner)
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 0, 'failed persistence stops the request before it can become ambiguous')
	assert(alerts(owner).includes('Storage unavailable'))
	assert(!queueButton(owner).props.disabled, 'storage errors release the action state')

	reset()
	let order = 'ord-old'
	owner = mount(() => order); await flush(owner); await salesOnly(owner)
	let releaseBuild!: () => void
	buildPause = payload => new Promise(resolve => { releaseBuild = () => resolve(payload) })
	queueButton(owner).props.onClick(); await flush(owner)
	assert(queueButton(owner).props.disabled)
	order = 'ord-new'; owner.render(); await flush(owner)
	assert(!queueButton(owner).props.disabled, 'changing orders resets the old pending UI state')
	releaseBuild(); await flush(owner)
	assert.equal(posted.length, 0, 'an obsolete invoice preparation cannot submit after changing orders')
	assert(!queueButton(owner).props.disabled)

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	buildPause = payload => new Promise(resolve => { releaseBuild = () => resolve(payload) })
	queueButton(owner).props.onClick(); await flush(owner); owner.unmount()
	releaseBuild(); await flush(owner)
	assert.equal(posted.length, 0, 'unmount cancels a prepared-but-unsent invoice')
	assert.equal(toasts.length, 0)

	reset(); order = 'ord-old'; owner = mount(() => order); await flush(owner); await salesOnly(owner)
	const releaseEnqueue = new Map<string, () => void>()
	enqueuePause = payload => new Promise(resolve => {
		releaseEnqueue.set(payload.orderId, () => resolve(jobFrom(payload)))
	})
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 1)
	order = 'ord-new'; owner.render(); await flush(owner)
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 2)
	const newPending = storage.get('sinshin-pending-print:ord-new')
	releaseEnqueue.get('ord-old')!(); await flush(owner)
	assert(queueButton(owner).props.disabled, 'the old queue finalizer cannot unlock the newer request')
	assert(browserButton(owner).props.disabled)
	assert.equal(storage.get('sinshin-pending-print:ord-new'), newPending, 'the old result cannot erase the newer order bitmap')
	assert.equal(toasts.length, 0, 'an obsolete response does not show a success notification for the current invoice')
	queueButton(owner).props.onClick(); browserButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 2)
	assert.equal(printed.length, 0)
	releaseEnqueue.get('ord-new')!(); await flush(owner)
	assert(!checkboxes(owner)[0].props.disabled, 'the newer operation releases its loading state')
	assert(queueButton(owner).props.disabled, 'the accepted newer job immediately prevents a second print')
	assert.equal(storage.get('sinshin-pending-print:ord-new'), '{}')
	assert(storage.get('sinshin-pending-print:ord-old')?.includes(posted[0].jobId), 'the old order retains its stable ID for later reconciliation')
	assert.equal(toasts.length, 1)

	reset(); order = 'ord-old'; owner = mount(() => order); await flush(owner)
	let rejectOldBrowser!: () => void
	let finishNewBrowser!: () => void
	browserPause = () => new Promise((_resolve, reject) => { rejectOldBrowser = () => reject(new Error('Obsolete dialog failed')) })
	browserButton(owner).props.onClick(); await flush(owner)
	order = 'ord-new'; owner.render(); await flush(owner)
	browserPause = () => new Promise(resolve => { finishNewBrowser = resolve })
	browserButton(owner).props.onClick(); await flush(owner)
	assert.deepEqual(printed.map(spec => spec.fileName), ['ord-old-sales', 'ord-new-sales'])
	rejectOldBrowser(); await flush(owner)
	assert(browserButton(owner).props.disabled, 'the old browser finalizer cannot unlock the current dialog')
	assert(!alerts(owner).includes('Obsolete dialog failed'), 'a stale browser failure cannot replace the current invoice state')
	finishNewBrowser(); await flush(owner)
	assert(!browserButton(owner).props.disabled)

	reset(); owner = mount(); await flush(owner); await salesOnly(owner)
	refreshFails = true
	queueButton(owner).props.onClick(); await flush(owner)
	assert.equal(posted.length, 1)
	assert(!checkboxes(owner)[0].props.disabled, 'refresh failure must not strand the print center in a loading state')
	assert(queueButton(owner).props.disabled && browserButton(owner).props.disabled, 'the known accepted job still blocks duplicates when refresh fails')
	console.log('Invoice print center passed: identical admin interface, permission controls, explicit single-receipt fallback, durable retries, ambiguity, queued cancellation and overlapping-operation cleanup.')
} finally {
	for (const owner of hosts) owner.unmount()
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
	mock.restore()
}
