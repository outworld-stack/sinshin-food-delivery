import assert from 'node:assert/strict'

type Callback = (...args: any[]) => void
const originals = new Map(
	['window', 'document', 'navigator', 'setTimeout', 'clearTimeout'].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
)
let now = 0
let timerId = 0
const timers = new Map<number, { at: number; callback: Callback }>()
Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: (callback: Callback, delay = 0) => {
	const id = ++timerId
	timers.set(id, { at: now + delay, callback })
	return id
} })
Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: (id: number) => timers.delete(id) })
const advance = (ms: number) => {
	const until = now + ms
	for (;;) {
		const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
		if (!next) break
		now = next[1].at
		timers.delete(next[0])
		next[1].callback()
	}
	now = until
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

class Events {
	listeners = new Map<string, Set<Callback>>()
	addEventListener(name: string, callback: Callback) {
		if (!this.listeners.has(name)) this.listeners.set(name, new Set())
		this.listeners.get(name)!.add(callback)
	}
	removeEventListener(name: string, callback: Callback) { this.listeners.get(name)?.delete(callback) }
	emit(name: string, event?: unknown) { for (const callback of [...this.listeners.get(name) ?? []]) callback(event) }
	get listenerCount() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0) }
}

class PrintDocument {
	title = 'Sinshin admin'
	fonts?: { ready: Promise<void> }
	styles: Array<{ textContent: string; remove: () => void }> = []
	body = {
		scrollHeight: 280,
		appendChild: (frame: Frame) => { frame.isConnected = true; frames.push(frame) },
	}
	head = { appendChild: (style: typeof this.styles[number]) => this.styles.push(style) }
	writeError: Error | null = null
	createElement(tag: string) {
		if (tag === 'iframe') return new Frame()
		const style = { textContent: '', remove: () => { this.styles = this.styles.filter((entry) => entry !== style) } }
		return style
	}
	open() {}
	write(_html: string) { if (this.writeError) throw this.writeError }
	close() {}
}

let page: PrintDocument
let parentWindow!: Events & { focus: () => void; matchMedia: () => Events; open: () => Popup | null }
let media!: Events
let frames: Frame[] = []
let printCalls: string[] = []
let autoLoad = true
let frameFonts: Promise<void> | undefined
let onPrint: (events: Events) => void = (events) => events.emit('afterprint')
class Frame {
	isConnected = false
	style = { cssText: '' }
	onload: Callback | null = null
	contentDocument = new PrintDocument()
	contentWindow = Object.assign(new Events(), { print: () => {
		printCalls.push(page.title)
		onPrint(this.contentWindow)
	} })
	writes: string[] = []
	setAttribute(_name: string, _value: string) {}
	set srcdoc(html: string) {
		this.writes.push(html)
		this.contentDocument = new PrintDocument()
		if (frameFonts) this.contentDocument.fonts = { ready: frameFonts }
		if (autoLoad) queueMicrotask(() => this.onload?.())
	}
	remove() { this.isConnected = false }
}
class Popup extends Events {
	document = new PrintDocument()
	focus() {}
	print() { printCalls.push(page.title); onPrint(this) }
}
let popup: Popup | null = null
const reset = (ios = false) => {
	assert.equal(timers.size, 0, 'the previous print releases all timers')
	for (const frame of frames) frame.isConnected = false
	frames = []
	printCalls = []
	autoLoad = true
	frameFonts = undefined
	onPrint = (events) => events.emit('afterprint')
	page = new PrintDocument()
	media = new Events()
	popup = new Popup()
	parentWindow = Object.assign(new Events(), { location: { origin: 'https://sinshin.example' }, focus() {}, matchMedia: () => media, open: () => popup })
	Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
	Object.defineProperty(globalThis, 'window', { configurable: true, value: parentWindow })
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
		userAgent: ios ? 'iPhone Safari' : 'Chrome', platform: ios ? 'iPhone' : 'Win32', maxTouchPoints: 0,
	} })
}
const clean = () => {
	assert.equal(page.title, 'Sinshin admin', 'the app title is restored')
	assert.equal(timers.size, 0, 'print and font timeouts are cleared')
	assert.equal(parentWindow.listenerCount + media.listenerCount, 0, 'parent listeners are removed')
	// A nonblocking browser may close preview after the print request resolves.
	for (const frame of frames) {
		frame.contentWindow.emit('afterprint')
		assert.equal(frame.contentWindow.listenerCount, 0, 'completion bookkeeping detaches after the dialog closes')
	}
}

try {
	const { buildPrintDocumentHtml, printHtmlDocumentAsync, measureReceiptHtmlHeightPx } = await import('../src/lib/printDocument')
	const spec = { fileName: 'order-123', brand: 'Sinshin', sections: [] }
	reset()
	const receiptHtml = buildPrintDocumentHtml({ ...spec, paper: 'receipt', fitHeight: true, landscape: true })
	assert(receiptHtml.includes('@page { size: auto; margin: 1.5mm; }'), 'the browser and printer driver control invoice paper stock and margins')
	assert(receiptHtml.includes('width: 77mm; min-width: 77mm; max-width: 77mm;'), 'invoice content keeps its physical width at 100% scale')
	assert(!receiptHtml.includes('landscape') && !receiptHtml.includes('size: 80mm'), 'short invoices cannot acquire a landscape page from measured height')
	assert(!receiptHtml.includes('transform:') && !receiptHtml.includes('<script'), 'the print document cannot animate, rotate or remeasure itself')
	assert(buildPrintDocumentHtml({ ...spec, landscape: true }).includes('size: A4 landscape'), 'A4 reports retain their explicit orientation')

	await printHtmlDocumentAsync(spec)
	assert.deepEqual(printCalls, ['order-123'], 'one print request calls the browser once')
	assert.equal(frames[0].isConnected, true, 'the print iframe stays connected after the dialog closes')
	assert(frames[0].style.cssText.includes('left:-10000px'), 'the isolated print source cannot cover or intercept the admin page')
	clean()

	reset()
	onPrint = () => {}
	await printHtmlDocumentAsync(spec)
	const firstHtml = frames[0].writes[0]
	assert.equal(timers.size, 0, 'missing afterprint does not leave a ninety-second loading state')
	assert.equal(frames[0].isConnected, true, 'a nonblocking preview retains its immutable document')
	media.emit('change', { matches: false })
	media.emit('change', { matches: true })
	media.emit('change', { matches: false })
	parentWindow.emit('afterprint')
	await flush()
	advance(90_000)
	assert.deepEqual(frames[0].writes, [firstHtml], 'margin and orientation preview events never rewrite the print source')
	assert.deepEqual(printCalls, ['order-123'], 'preview setting changes do not reissue printing')
	await printHtmlDocumentAsync({ ...spec, fileName: 'another' })
	assert.equal(frames.length, 2, 'each print request receives a separate immutable document')
	assert.equal(frames[0].isConnected, true, 'a new request cannot remove a preview with no completion signal')
	assert.deepEqual(frames[0].writes, [firstHtml])
	clean()

	reset()
	onPrint = () => { throw new Error('printer unavailable') }
	await assert.rejects(printHtmlDocumentAsync(spec), /printer unavailable/)
	clean()
	// Failure must release the shared print queue so another receipt can print.
	onPrint = (events) => events.emit('afterprint')
	await printHtmlDocumentAsync({ ...spec, fileName: 'retry' })
	clean()

	reset()
	let finishFont!: () => void
	frameFonts = new Promise<void>((resolve) => { finishFont = resolve })
	const hungFonts = printHtmlDocumentAsync({ ...spec, paper: 'receipt', fitHeight: true })
	await flush()
	assert.equal(printCalls.length, 0, 'printing waits briefly for receipt fonts')
	advance(2_500)
	await hungFonts
	assert.deepEqual(printCalls, ['order-123'], 'a stalled font still prints using the fallback font')
	assert(frames[0].contentDocument.styles.some((style) => style.textContent.includes('font-family: Tahoma, sans-serif !important')), 'a late font cannot change the print-preview layout')
	assert(!frames[0].contentDocument.styles.some((style) => style.textContent.includes('@page')), 'printing never injects a measured page size')
	const preparedStyles = frames[0].contentDocument.styles.map((style) => style.textContent)
	finishFont(); await flush()
	assert.deepEqual(frames[0].contentDocument.styles.map((style) => style.textContent), preparedStyles)
	clean()

	reset()
	frameFonts = Promise.reject(new Error('font download failed'))
	await printHtmlDocumentAsync(spec)
	clean()

	reset()
	autoLoad = false
	const noLoad = assert.rejects(printHtmlDocumentAsync(spec), /آماده‌سازی چاپ طولانی شد/)
	const lateLoad = frames[0].onload!
	advance(15_000)
	await noLoad
	assert.equal(printCalls.length, 0, 'a receipt that never loaded is reported as a failure')
	assert.equal(frames[0].isConnected, false, 'a failed preparation can release its unused document')
	lateLoad(); await flush()
	assert.equal(printCalls.length, 0, 'a timed-out load cannot unexpectedly open print preview later')
	clean()

	reset()
	autoLoad = false
	const first = printHtmlDocumentAsync({ ...spec, fileName: 'first' })
	const second = printHtmlDocumentAsync({ ...spec, fileName: 'second' })
	await flush()
	assert.equal(frames.length, 1, 'document preparation is serialized')
	frames[0].onload!()
	await first
	await flush()
	assert.equal(frames.length, 2)
	assert.equal(frames[0].writes.length, 1, 'the next job never replaces a previous document')
	frames[1].onload!()
	await second
	assert.deepEqual(printCalls, ['first', 'second'])
	assert.equal(frames[0].isConnected, true, 'the most recent completed job survives browser teardown')
	autoLoad = true
	await printHtmlDocumentAsync({ ...spec, fileName: 'third' })
	assert.equal(frames[0].isConnected, false, 'a later request can reclaim older positively completed jobs')
	assert.equal(frames[1].isConnected, true, 'reclamation retains the latest completed source')
	clean()

	reset(true)
	await printHtmlDocumentAsync(spec)
	assert.equal(popup!.listenerCount, 0)
	clean()

	reset(true)
	onPrint = () => {}
	await printHtmlDocumentAsync(spec)
	assert.equal(timers.size, 0, 'Safari also completes the request when its print call returns')
	assert.equal(popup!.listenerCount, 0)
	clean()

	reset(true)
	popup!.document.writeError = new Error('popup document unavailable')
	await assert.rejects(printHtmlDocumentAsync(spec), /popup document unavailable/)
	clean()

	reset(true)
	popup = null
	await assert.rejects(printHtmlDocumentAsync(spec), /پنجرهٔ چاپ توسط مرورگر بلاک شد/)
	clean()

	reset()
	frameFonts = new Promise<void>(() => {})
	const measurement = measureReceiptHtmlHeightPx('<html>receipt</html>')
	await flush()
	advance(2_500)
	assert.equal(await measurement, null, 'preview measurement has its own deadline')
	await flush()
	assert.equal(frames[0].isConnected, false, 'preview measurement removes its temporary frame')
	assert.equal(frames[0].contentDocument.styles.length, 0)
	clean()
	console.log('Print document passed: fixed physical invoice width, browser-owned paper and margins, immutable per-job sources, preview reflows, prompt return, font freezing, preparation timeout, queue isolation, iOS and safe cleanup.')
} finally {
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor)
		else Reflect.deleteProperty(globalThis, name)
	}
}
