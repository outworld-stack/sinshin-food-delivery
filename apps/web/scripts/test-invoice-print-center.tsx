import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InvoicePrinterAssignmentDto } from '@sinshin/shared'

type QueryResult = { data?: unknown; isPending: boolean; isError: boolean }
const printers = [
	{ id: 'sales-printer', name: 'Sales', host: '192.168.1.20', widthDots: 576 },
	{ id: 'kitchen-printer', name: 'Kitchen', host: '192.168.1.21', widthDots: 384 },
]
const savedAssignment = { sales: 'sales-printer', kitchen: 'kitchen-printer' }
let printerQuery: QueryResult
let assignmentQuery: QueryResult
let role = 'admin'
let canManage = true
let mutationPending = false
const assignments: InvoicePrinterAssignmentDto[] = []
const printed: Array<{ directTargets?: Record<string, unknown> } | undefined> = []

mock.module('@tanstack/react-query', () => ({
	useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === 'admin-printers' ? printerQuery : assignmentQuery,
	useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
	useMutation: () => ({ isPending: mutationPending, mutate: (next: InvoicePrinterAssignmentDto) => assignments.push(next) }),
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
mock.module('#/server/admin', () => ({ getStaffOrderInvoice: async () => ({ orderId: 'ord-1' }), setAdminPrintAssignment: async () => {} }))
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
	renderToStaticMarkup(createElement(Probe))
	const elements = descendants(tree)
	const print = elements.find((element) => element.type === 'button' && Children.toArray(element.props.children as ReactNode).includes('چاپ فاکتورهای انتخابی'))
	const sales = elements.find((element) => element.props.id === 'inv-printer-sales')
	assert(print)
	assert(sales)
	return { print: print.props, sales: sales.props }
}
function reset() {
	printerQuery = { data: printers, isPending: false, isError: false }
	assignmentQuery = { data: savedAssignment, isPending: false, isError: false }
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
await click(center.print)
assert.equal(printed.length, 1)
assert.equal(printed[0], undefined, 'staff without hardware permission can still print with the browser')

console.log('OK — invoice print settings, destination selection, pending mutations and browser fallback')
