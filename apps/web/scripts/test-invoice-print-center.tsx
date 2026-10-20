import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InvoicePrinterAssignmentDto, PrinterDto } from '@sinshin/shared'

type QueryResult = { data?: unknown; isPending: boolean; isError: boolean }
const printers = [
	{ id: 'sales-printer', name: 'Sales', host: '192.168.1.20', port: 9100, widthDots: 576 },
	{ id: 'kitchen-printer', name: 'Kitchen', host: '192.168.1.21', port: 9100, widthDots: 384 },
]
const savedAssignment = { sales: 'sales-printer', kitchen: 'kitchen-printer' }
let printerQuery: QueryResult
let assignmentQuery: QueryResult
let discoveryQuery: QueryResult
let discoveryEnabled: boolean | undefined
let registrationError: Error | null = null
const registered: unknown[] = []
const mutations: Promise<unknown>[] = []
let currentPrinters: unknown[] = printers
let role = 'admin'
let canManage = true
let mutationPending = false
const assignments: InvoicePrinterAssignmentDto[] = []
const printed: Array<{ directTargets?: Record<string, unknown> } | undefined> = []

mock.module('@tanstack/react-query', () => ({
	useQuery: ({ queryKey, enabled }: { queryKey: string[]; enabled?: boolean }) => {
		if (queryKey[0] === 'admin-printer-discovery') { discoveryEnabled = enabled; return discoveryQuery }
		return queryKey[0] === 'admin-printers' ? printerQuery : assignmentQuery
	},
	useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: (key: string[], value: unknown) => {
		const query = key[0] === 'admin-printers' ? printerQuery : assignmentQuery
		query.data = typeof value === 'function' ? value(query.data) : value
	} }),
	useMutation: (options: { mutationFn: (next: InvoicePrinterAssignmentDto) => Promise<InvoicePrinterAssignmentDto>; onSuccess: (next: InvoicePrinterAssignmentDto) => Promise<void>; onError: (error: Error) => void; onSettled: () => void }) => ({
		isPending: mutationPending,
		mutate: (next: InvoicePrinterAssignmentDto) => {
			mutations.push(options.mutationFn(next).then(options.onSuccess, options.onError).finally(options.onSettled))
		},
	}),
}))
mock.module('#/utils/queryOptions', () => ({
	adminPrintersOptions: { queryKey: ['admin-printers'] },
	adminPrintAssignmentOptions: { queryKey: ['admin-print-assignment'] },
}))
mock.module('#/hooks/admin/usePermissions', () => ({ usePermissions: () => ({ permissions: { printingManage: canManage } }) }))
mock.module('#/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ role }) }))
mock.module('#/stores/toastStore', () => ({ useToastStore: (select: (s: unknown) => unknown) => select({ showToast: () => {} }) }))
mock.module('#/components/admin/admin2/PrinterManager', () => ({ PrinterManager: () => null }))
mock.module('#/lib/printDocument', () => ({
	buildPrintDocumentHtml: () => '', measureReceiptHtmlHeightPx: async () => 200, RECEIPT_PROBE_PX: 291,
}))
mock.module('#/server/admin', () => ({
	getStaffOrderInvoice: async () => ({ orderId: 'ord-1' }),
	setAdminPrintAssignment: async (next: InvoicePrinterAssignmentDto) => { assignments.push(next) },
	discoverAdminPrinters: async () => ({ scanned: [], found: [] }),
	addAdminPrinter: async (input: object) => {
		registered.push(input)
		if (registrationError) throw registrationError
		return { id: 'detected-printer', ...input }
	},
	getAdminPrinters: async () => currentPrinters,
}))
mock.module('#/utils/invoicePrint', () => ({
	buildInvoicePrintSpecs: async () => [],
	printOrderInvoices: async (_invoice: unknown, _kinds: unknown, options: { directTargets?: Record<string, unknown> } | undefined) => {
		printed.push(options)
		return { direct: options ? 2 : 0, dialogs: options ? 0 : 2, agentErrors: [] }
	},
}))

const { InvoicePrintCenterModal } = await import('../src/components/admin/admin2/InvoicePrintCenterModal')
type Element = ReactElement<Record<string, unknown>>
function descendants(node: ReactNode): Element[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<Record<string, unknown>>(child)) return []
		return [child, ...descendants(child.props.children as ReactNode)]
	})
}
function renderCenter() {
	let tree: ReactNode
	function Probe() {
		// Invoke the memoized component inside a real React render, retaining its
		// real state/ref hooks and capturing its event handlers before DOM rendering.
		tree = (InvoicePrintCenterModal as unknown as { type: (props: unknown) => ReactNode }).type({ orderId: 'ord-1', onClose: () => {} })
		return tree
	}
	const html = renderToStaticMarkup(createElement(Probe))
	const elements = descendants(tree)
	const print = elements.find((element) => element.type === 'button' && Children.toArray(element.props.children as ReactNode).includes('چاپ فاکتورهای انتخابی'))
	const sales = elements.find((element) => element.props.id === 'inv-printer-sales')
	assert(print)
	assert(sales)
	const kitchen = elements.find((element) => element.props.id === 'inv-printer-kitchen')!
	return { print: print.props, sales: sales.props, kitchen: kitchen.props, html }
}
function reset() {
	printerQuery = { data: printers, isPending: false, isError: false }
	assignmentQuery = { data: savedAssignment, isPending: false, isError: false }
	discoveryQuery = { data: { scanned: ['192.168.1.0/24'], found: [{ host: '192.168.1.20', port: 9100 }, { host: '192.168.1.30', port: 9100 }] }, isPending: false, isError: false }
	currentPrinters = printers
	registrationError = null
	registered.length = 0
	mutations.length = 0
	mutationPending = false
	role = 'admin'
	canManage = true
	printed.length = 0
	assignments.length = 0
}
async function click(button: Record<string, unknown>) {
	(button.onClick as () => void)()
	for (let i = 0; i < 20; i++) await Promise.resolve()
}

reset()
assignmentQuery = { isPending: true, isError: false }
let center = renderCenter()
assert.equal(center.print.disabled, true)
assert.equal(center.sales.disabled, true)
await click(center.print)
;(center.sales.onChange as (id: string) => void)('sales-printer')
assert.equal(printed.length, 0, 'do not print through the browser before assignments arrive')
assert.equal(assignments.length, 0, 'do not overwrite an unknown kitchen assignment with null')

reset()
printerQuery = { isPending: true, isError: false }
center = renderCenter()
assert.equal(center.print.disabled, true)
await click(center.print)
assert.equal(printed.length, 0)

reset()
center = renderCenter()
assert.equal(center.sales.value, savedAssignment.sales, 'cached assignment applies on the first render, before effects')
await click(center.print)
assert.deepEqual(printed[0]?.directTargets, {
	kitchen: { printerId: 'kitchen-printer', widthDots: 384 },
	sales: { printerId: 'sales-printer', widthDots: 576 },
})
// Rerender to release the print guard and exercise a separate user action.
center = renderCenter()
;(center.sales.onChange as (id: string) => void)('')
await Promise.all(mutations)
assert.deepEqual(assignments[0], { sales: null, kitchen: 'kitchen-printer' })

reset()
mutationPending = true
center = renderCenter()
assert.equal(center.print.disabled, true)
await click(center.print)
assert.equal(printed.length, 0, 'do not print using an unsaved printer assignment')

reset()
assignmentQuery = { isPending: false, isError: true }
center = renderCenter()
assert.equal(center.print.disabled, false)
assert.equal(center.sales.disabled, true)
await click(center.print)
assert.equal(printed.length, 1)
assert.equal(printed[0], undefined, 'an unavailable settings API retains the browser fallback')

reset()
role = 'admin2'
canManage = false
printerQuery = { isPending: true, isError: false }
assignmentQuery = { isPending: true, isError: false }
center = renderCenter()
assert.equal(center.print.disabled, false)
assert.equal(center.sales.locked, true)
assert.equal(discoveryEnabled, false, 'staff without hardware authorization never triggers a network scan')
await click(center.print)
assert.equal(printed.length, 1)
assert.equal(printed[0], undefined, 'staff without hardware permission can still print with the browser')
assert.equal(center.html.includes('اسکن دوباره'), false, 'restricted staff do not see the scan action')
assert.deepEqual(center.sales.discovered, [], 'cached discoveries are hidden after permission is revoked')
;(center.sales.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
assert.equal(registered.length, 0, 'a locked selection cannot register a device')
assert.equal(assignments.length, 0)

reset()
role = 'admin2'
center = renderCenter()
assert.equal(discoveryEnabled, true, 'authorized Level 2 administrators can search for printers')
assert.equal(center.sales.locked, false)
assert.equal(center.html.includes('اسکن دوباره'), true, 'authorized staff can rescan')
assert.deepEqual(center.sales.discovered, center.kitchen.discovered)
;(center.kitchen.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
await Promise.all(mutations)
assert.equal(registered.length, 1, 'Level 2 staff can register their selected discovery')
assert.deepEqual(assignments, [{ sales: 'sales-printer', kitchen: 'detected-printer' }])

reset()
role = 'admin2'
discoveryQuery = { isPending: false, isError: true }
center = renderCenter()
assert.equal(center.html.includes('شناسایی خودکار ناموفق بود'), true)
assert.equal(center.sales.disabled, false, 'failed discovery does not block known printers')
;(center.sales.onChange as (id: string) => void)('kitchen-printer')
await Promise.all(mutations)
assert.deepEqual(assignments, [{ sales: 'kitchen-printer', kitchen: 'kitchen-printer' }])

reset()
center = renderCenter()
assert.equal(discoveryEnabled, true, 'opening the owner print center enables automatic discovery')
assert.equal((center.sales.discovered as unknown[]).length, 1, 'registered devices are deduplicated from discovery')
assert.deepEqual(center.sales.discovered, center.kitchen.discovered, 'both default dropdowns offer detected devices')
assert.equal((center.html.match(/value="discovered:192\.168\.1\.30:9100"/g) ?? []).length, 2)
;(center.sales.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
;(center.kitchen.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
await click(center.print)
await Promise.all(mutations)
assert.equal(registered.length, 1, 'same-frame changes do not race a pending registration/default save')
assert.deepEqual(assignments, [{ sales: 'detected-printer', kitchen: 'kitchen-printer' }])
assert.equal(printed.length, 0, 'printing waits for the pending discovered-printer registration')

reset()
registrationError = Object.assign(new Error('duplicate'), { status: 409 })
currentPrinters = [...printers, { id: 'other-station-printer', host: '192.168.1.30', port: 9100 }]
center = renderCenter()
;(center.kitchen.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
await Promise.all(mutations)
assert.deepEqual(assignments, [{ sales: 'sales-printer', kitchen: 'other-station-printer' }], 'reuse concurrent registrations without losing the other default')

reset()
registrationError = Object.assign(new Error('not authorized'), { status: 403 })
center = renderCenter()
;(center.sales.onChange as (id: string) => void)('discovered:192.168.1.30:9100')
await Promise.all(mutations)
assert.deepEqual(assignments, [], 'registration failure cannot persist an invalid default')
assert.deepEqual(assignmentQuery.data, savedAssignment)

const { registerDiscoveredPrinter } = await import('../src/lib/printerDiscovery')
await registerDiscoveredPrinter({ host: '192.168.1.20', port: 9100 }, printers as PrinterDto[])
assert.equal(registered.length, 1, 'known devices do not make another registration request')

console.log('OK — automatic discovery, both default dropdowns, registration conflicts, pending mutations, printer settings and browser fallback')
