import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { LocalPrintTarget, StaffInvoice } from '@sinshin/shared'
import type { PrintDocumentSpec } from '#/lib/printDocument'

const rendered: { spec: PrintDocumentSpec; width: number }[] = []
const dialogs: PrintDocumentSpec[] = []
const qrUrls: string[] = []
let renderFailure: Error | null = null
let dialogFailure: Error | null = null
mock.module('#/lib/receiptCanvas', () => ({ renderSpecToReceiptBitmap: async (spec: PrintDocumentSpec, width: number) => {
	rendered.push({ spec, width })
	if (renderFailure) throw renderFailure
	return { widthPx: width, heightPx: 120, rows: 'fixed-1bpp-content' }
} }))
mock.module('#/lib/printDocument', () => ({ printHtmlDocumentAsync: async (spec: PrintDocumentSpec) => {
	dialogs.push(spec)
	if (dialogFailure) throw dialogFailure
} }))
mock.module('#/utils/qrSvg', () => ({ qrSvgMarkup: async (url: string) => {
	qrUrls.push(url)
	return '<svg data-courier-qr="true"></svg>'
} }))
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://sinshin.example' } } })

const invoice: StaffInvoice = {
	orderId: 'ord-123', date: new Date('2026-10-24T12:00:00Z'), status: 'CONFIRMED',
	userName: 'مشتری', userPhone: '09123456789', deliveryType: 'DELIVERY',
	address: 'رشت', customerNote: 'بدون پیاز', internalNote: 'یادداشت فروش', internalNotePrint: true,
	courierId: 'courier-1', courierName: 'پیک', courierPhone: null, courierSecurityEnabled: true,
	items: [{ name: 'غذا', sizeName: 'بزرگ', quantity: 2, price: 100_000 }],
	breakdown: { foodTotal: 200_000, discount: 0, walletDeduction: 50_000, deliveryFee: 0, packagingFee: 0, totalAmount: 200_000, amountPaidOnline: 150_000 },
}
const target: LocalPrintTarget = { agentId: 'agent-1', printerName: 'POS Printer', widthDots: 576, mode: 'driver', cut: false }

try {
	const { buildLocalInvoiceJob, printOrderInvoices } = await import('../src/utils/invoicePrint')
	const id = 'd1cbd1b9-2776-401e-8187-a64b6f3e7ec9'
	const payload = await buildLocalInvoiceJob(invoice, 'sales', target, id)
	assert.deepEqual(payload, { jobId: id, orderId: invoice.orderId, kind: 'sales', widthPx: 576, heightPx: 120, rows: 'fixed-1bpp-content' })
	assert.deepEqual(qrUrls, ['https://sinshin.example/courier/scan/ord-123?courier=courier-1'])
	assert(rendered[0].spec.sections[0].metaLines?.some(line => line.includes('09123456789')), 'the existing customer data survives local-agent rendering')
	assert.equal(rendered[0].spec.sections[0].qr?.orderId, invoice.orderId)
	assert.equal(dialogs.length, 0, 'preparing a local job never opens a browser print dialog')

	await buildLocalInvoiceJob(invoice, 'kitchen', { ...target, widthDots: 384 }, id)
	assert.equal(rendered.at(-1)!.width, 384, 'kitchen rendering uses its assigned printer width')
	assert.equal(rendered.at(-1)!.spec.sections[0].qr, undefined, 'the kitchen receipt does not acquire the sales courier QR')
	assert.equal(rendered.at(-1)!.spec.sections[0].stats, undefined, 'the kitchen receipt remains price-free')
	assert.equal(qrUrls.length, 1, 'kitchen jobs do not regenerate unrelated sales data')

	renderFailure = new Error('Canvas unavailable')
	await assert.rejects(buildLocalInvoiceJob(invoice, 'sales', target, id), /Canvas unavailable/)
	assert.equal(dialogs.length, 0, 'a local rendering failure cannot silently fall back to duplicate-prone browser printing')
	renderFailure = null
	await assert.rejects(buildLocalInvoiceJob(invoice, 'sales', target, ''), /شناسه/)
	await assert.rejects(printOrderInvoices(invoice, ['sales'], { directTargets: { sales: { printerId: 'old-server-printer', widthDots: 576 } } }), /عامل چاپ محلی/)
	await assert.rejects(printOrderInvoices(invoice, ['kitchen', 'sales']), /یک فاکتور/)
	await assert.rejects(printOrderInvoices(invoice, []), /یک فاکتور/)
	assert.equal(dialogs.length, 0, 'obsolete direct printing and implicit multi-dialog calls fail before opening any dialog')
	assert.deepEqual(await printOrderInvoices(invoice, ['kitchen']), { direct: 0, dialogs: 1, agentErrors: [] })
	assert.equal(dialogs.length, 1)
	assert.equal(dialogs[0].fileName, 'sinshin-kitchen-ord-123', 'explicit fallback prints only the selected invoice')
	dialogFailure = new Error('Print dialog unavailable')
	await assert.rejects(printOrderInvoices(invoice, ['sales']), /Print dialog unavailable/)
	console.log('Local invoice preparation passed: shared invoice content, stable IDs and bitmaps, assigned widths, no automatic fallback and one explicit browser receipt per click.')
} finally {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
	else Reflect.deleteProperty(globalThis, 'window')
	mock.restore()
}
