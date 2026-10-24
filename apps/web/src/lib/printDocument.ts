// Shared invoice/report documents are isolated from application CSS and DOM.
// Each browser print request owns an immutable document. Chrome may re-render
// it repeatedly while margins, paper or scaling are changed in print preview.
// Never use print media-query changes to replace that document mid-preview.

export type PrintPaper = 'a4' | 'receipt'

// ── stage-85 — ثابت‌های کاغذ رسیدی (اشتراکِ چاپ/اندازه‌گیری/پیش‌نمایش) ──
/** عرض فیزیکی کاغذ حرارتی (mm) */
export const RECEIPT_WIDTH_MM = 80
/** حاشیهٔ هر طرف (mm) — پیش‌تر ۲.۵mm بالا/پایین و ۲mm چپ/راست بود */
export const RECEIPT_MARGIN_MM = 1.5
/** عرض قابل‌چاپ در پیکسل CSS (80 − 3mm = 77mm @96dpi) — عرض پروبِ اندازه‌گیری */
export const RECEIPT_PROBE_PX = 291
/** تبدیل پیکسل CSS → میلی‌متر (رُند به بالا) */
export function receiptPxToMm(px: number): number {
	return Math.ceil((px * 25.4) / 96)
}

export interface PrintTableSpec {
	title?: string
	head: string[]
	rows: string[][]
}

export interface PrintQrSpec {
	/** مارک‌آپ خام SVG (خروجی QRCodeSVG از qrSvgMarkup) */
	svg: string
	caption?: string
	/** شناسه‌ای که زیر QR با فونت درشت چاپ می‌شود */
	orderId?: string
}

export interface PrintSectionSpec {
	heading: string
	metaLines?: string[]
	stats?: { label: string; value: string }[]
	tables: PrintTableSpec[]
	note?: string
	qr?: PrintQrSpec
	/** جدول‌های درشت — فاکتور آشپزخانه برای خوانایی از دور */
	bigTables?: boolean
	/** صفحه‌بندی بعد از این سکشن (وقتی چند فاکتور پشت‌سرهم چاپ می‌شوند) */
	pageBreakAfter?: boolean
}

export interface PrintDocumentSpec {
	/** نام پیشنهادی فایل PDF (عنوان سند لحظهٔ چاپ) */
	fileName: string
	brand: string
	sections: PrintSectionSpec[]
	landscape?: boolean
	footerNote?: string
	/** round-14 — قالب کاغذ؛ پیش‌فرض a4 (رفتار قبلی) */
	paper?: PrintPaper
	/**
	 *  stage-84 — استایل «حرارتی» فاکتور: اعداد/نوشته‌ها «مشکیِ بولد» و
	 *  هدرها/برچسب‌ها «سفید روی نوارِ مشکیِ پررنگ». فقط با paper:'receipt'.
	 */
	receiptStyle?: 'classic' | 'mono'
	/**
	 * Retained for existing spec consumers. Browser printing always leaves page
	 * height to the selected printer stock; dynamically changing @page dimensions
	 * destabilizes Chrome preview and rotates receipts shorter than their width.
	 */
	fitHeight?: boolean
}

// ── ابزارها ──

const esc = (s: string): string =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')

const isIOS = (): boolean =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) ||
	(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function tableHtml(t: PrintTableSpec, big: boolean): string {
	const cls = big ? 'tbl big' : 'tbl'
	const head = t.head.map((h) => `<th>${esc(h)}</th>`).join('')
	const body = t.rows.length
		? t.rows
				.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
				.join('')
		: `<tr><td colspan="${t.head.length}" class="empty">موردی یافت نشد</td></tr>`
	const title = t.title ? `<p class="tbl-title">${esc(t.title)}</p>` : ''
	return `${title}<table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function sectionHtml(s: PrintSectionSpec): string {
	const meta =
		s.metaLines && s.metaLines.length > 0
			? `<div class="meta">${s.metaLines.map((m) => `<div>${esc(m)}</div>`).join('')}</div>`
			: ''
	const stats =
		s.stats && s.stats.length > 0
			? `<div class="stats">${s.stats
					.map(
						(x) =>
							`<div class="stat"><div class="l">${esc(x.label)}</div><div class="v">${esc(x.value)}</div></div>`,
					)
					.join('')}</div>`
			: ''
	const tables = s.tables
		.map((t) => tableHtml(t, s.bigTables === true))
		.join('')
	const note = s.note ? `<div class="note">${esc(s.note)}</div>` : ''
	const qr = s.qr
		? `<div class="qr-box">${s.qr.svg}<div>${
				s.qr.orderId
					? `<div class="oid" dir="ltr">${esc(s.qr.orderId)}</div>`
					: ''
			}${s.qr.caption ? `<div class="cap">${esc(s.qr.caption)}</div>` : ''}</div></div>`
		: ''
	const brk = s.pageBreakAfter ? ' page-break' : ''
	return `<section class="sheet${brk}"><h1 class="heading">${esc(s.heading)}</h1>${meta}${stats}${tables}${note}${qr}</section>`
}

// ── استایل مشترک (رقم‌گذاری/ساختار DOM یکسان است؛ فقط چیدمان با کاغذ عوض می‌شود) ──

const BASE_CSS = `
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'DanaFaNum-Medium', Tahoma, sans-serif; color: #1f2937; direction: rtl; }
.brand { text-align: center; font-family: 'MorabbaBold', sans-serif; color: #f6339a; }
.doc-sep { border: none; border-top: 3px solid #f6339a; }
h1.heading { font-family: 'DanaFaNum-DemiBold'; text-align: center; }
.meta { text-align: center; color: #6b7280; }
.stat .v { font-family: 'DanaFaNum-DemiBold'; color: #f6339a; }
.tbl-title { font-family: 'DanaFaNum-DemiBold'; margin: 0 0 2mm; }
table.tbl { width: 100%; border-collapse: collapse; }
table.tbl th { background: #f3f4f6; font-family: 'DanaFaNum-DemiBold'; }
table.tbl th, table.tbl td { text-align: right; word-break: break-word; }
table.tbl tbody tr:nth-child(even) { background: #fafafa; }
table.tbl thead { display: table-header-group; }
table.tbl tr { page-break-inside: avoid; }
td.empty, .empty { text-align: center; color: #9ca3af; }
.note { border: 1px dashed #d1d5db; border-radius: 3mm; color: #374151; line-height: 1.9; }
.qr-box { border: 1px solid #e5e7eb; border-radius: 3mm; }
.qr-box svg { display: block; }
.qr-box .oid { font-family: 'DanaFaNum-DemiBold'; letter-spacing: 1px; }
.qr-box .cap { color: #6b7280; }
.footer { border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; }
`

// A4 — همان چیدمان round-12 (دسکتاپ)
const A4_CSS = `
@page { size: A4 __ORIENTATION__; margin: 14mm 12mm; }
body { font-size: 11px; }
.brand { font-size: 21px; }
.doc-sep { margin: 2mm 0 6mm; }
.sheet.page-break { page-break-after: always; }
h1.heading { font-size: 16px; margin: 0 0 2.5mm; }
.meta { font-size: 11px; line-height: 2; margin-bottom: 5mm; }
.stats { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 6mm; }
.stat { flex: 1 1 32mm; border: 1px solid #e5e7eb; border-radius: 3mm; padding: 2.5mm 3mm; text-align: center; }
.stat .l { font-size: 10px; color: #6b7280; margin-bottom: 1mm; }
.stat .v { font-size: 13px; }
.tbl-title { font-size: 12.5px; }
table.tbl { margin-bottom: 5mm; font-size: 10.5px; }
table.tbl.big { font-size: 15px; }
table.tbl th, table.tbl td { border: 1px solid #e5e7eb; padding: 2.2mm 2.6mm; }
.note { border-radius: 3mm; padding: 3mm 4mm; font-size: 11px; margin-bottom: 5mm; }
.qr-box { display: flex; align-items: center; gap: 6mm; padding: 4mm; }
.qr-box svg { width: 30mm; height: 30mm; }
.qr-box .oid { font-size: 15px; margin-bottom: 1mm; }
.qr-box .cap { font-size: 10.5px; line-height: 2; }
.footer { margin-top: 8mm; padding-top: 2mm; font-size: 9.5px; }
`

// The driver/browser owns paper size, orientation and adjustable page margins.
// Content stays 77mm wide at 100% scale (80mm stock minus default 1.5mm margins).
// No max-width:100%, transforms or measured @page height may shrink/rotate it.
const RECEIPT_CSS = `
@page { size: auto; margin: 1.5mm; }
body { width: 77mm; min-width: 77mm; max-width: 77mm; font-size: 11px; overflow: visible; }
.brand { font-size: 15px; }
.doc-sep { margin: 1mm 0 1.5mm; border-top-width: 2px; }
.sheet.page-break { page-break-after: always; }
h1.heading { font-size: 12px; margin: 0 0 1.5mm; }
.meta { font-size: 10px; line-height: 1.55; margin-bottom: 1.5mm; }
.stats { margin-bottom: 1.5mm; }
.stat { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5mm; border-bottom: 1px dashed #d1d5db; padding: 0.8mm 0.4mm; }
.stat .l { font-size: 9.5px; color: #6b7280; }
.stat .v { font-size: 11.5px; }
.tbl-title { font-size: 11px; }
table.tbl { margin-bottom: 2mm; font-size: 9.5px; }
table.tbl.big { font-size: 13px; }
table.tbl th, table.tbl td { border: 1px solid #dfe3e8; padding: 1.1mm 1mm; }
.note { padding: 1.5mm 2mm; font-size: 10px; margin-bottom: 2mm; line-height: 1.6; }
.qr-box { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1mm; padding: 2mm; margin-top: 1.5mm; }
.qr-box svg { width: 24mm; height: 24mm; }
.qr-box .oid { font-size: 12px; margin-bottom: 0.4mm; }
.qr-box .cap { font-size: 9px; line-height: 1.5; }
.footer { margin-top: 2mm; padding-top: 1.2mm; font-size: 8.5px; }
`

// stage-84 — استایل حرارتی «mono»: اعداد و نوشته‌ها مشکیِ بولد؛ هدرها/برچسب‌ها
// سفیدِ بولد روی نوارِ مشکیِ پررنگ. روی بدنه با کلاس mono اعمال می‌شود
// (فقط receipt؛ کلاس روی A4 اثری ندارد).
const RECEIPT_MONO_CSS = `
body.mono { color: #000; font-weight: bold; }
body.mono .brand { color: #000; font-weight: bold; }
body.mono .doc-sep { border-top: 3px solid #000; }
body.mono h1.heading { background: #000; color: #fff; border-radius: 1.2mm; padding: 1.2mm 0; }
body.mono .meta { color: #000; font-weight: bold; }
body.mono .stat { border-bottom: 2px solid #000; }
body.mono .stat .l { color: #000; font-weight: bold; }
body.mono .stat .v { color: #000; font-weight: bold; }
body.mono .tbl-title { color: #000; font-weight: bold; }
body.mono table.tbl th { background: #000; color: #fff; }
body.mono table.tbl th, body.mono table.tbl td { border: 1px solid #000; font-weight: bold; }
body.mono table.tbl td { color: #000; }
body.mono table.tbl tbody tr:nth-child(even) { background: #fff; }
body.mono .note { border: 2px solid #000; color: #000; font-weight: bold; }
body.mono .qr-box { border: 2px solid #000; }
body.mono .qr-box .oid { color: #000; font-weight: bold; }
body.mono .qr-box .cap { color: #000; font-weight: bold; }
body.mono .footer { border-top: 2px solid #000; color: #000; font-weight: bold; }
`

function documentHtml(spec: PrintDocumentSpec): string {
	const origin = window.location.origin
	const font = (family: string, file: string) =>
		`@font-face{font-family:'${family}';src:url('${origin}/fonts/${file}') format('woff2');font-display:block;}`
	const paper: PrintPaper = spec.paper ?? 'a4'
	const orientation = spec.landscape ? 'landscape' : 'portrait'
	const mono = paper === 'receipt' && spec.receiptStyle === 'mono'
	const paperCss =
		paper === 'receipt'
			? RECEIPT_CSS + (mono ? RECEIPT_MONO_CSS : '')
			: A4_CSS.replace('__ORIENTATION__', orientation)
	const sections = spec.sections.map(sectionHtml).join('')
	const footer = spec.footerNote
		? `<div class="footer">${esc(spec.footerNote)} — ${new Date().toLocaleDateString('fa-IR')}</div>`
		: ''
	const bodyClass = mono ? ' class="mono"' : ''
	return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(spec.fileName)}</title>
<style>
${font('DanaFaNum-Medium', 'DanaFaNum-Medium.woff2')}
${font('DanaFaNum-DemiBold', 'DanaFaNum-DemiBold.woff2')}
${font('MorabbaBold', 'Morabba-Bold.woff2')}
${BASE_CSS}
${paperCss}
</style>
</head>
<body${bodyClass}>
<p class="brand">${esc(spec.brand)}</p>
<hr class="doc-sep" />
${sections}
${footer}
</body>
</html>`
}

/** HTML shared by the invoice preview and isolated browser print document. */
export function buildPrintDocumentHtml(spec: PrintDocumentSpec): string {
	return documentHtml(spec)
}

/**
 * چاپ سند — عنوان صفحه موقتاً به fileName تغییر می‌کند تا «Save as PDF»
 * مرورگر نام درست پیشنهاد دهد و بعد از بسته‌شدن دیالوگ برمی‌گردد.
 */
export function printHtmlDocument(spec: PrintDocumentSpec): void {
	void printHtmlDocumentAsync(spec)
}

type RetainedPrint = { frame: HTMLIFrameElement; completed: boolean }
const retainedPrints: RetainedPrint[] = []

function createPrintFrame(spec: PrintDocumentSpec): RetainedPrint {
	// Reclaim older, positively completed jobs only when another print is
	// requested. Keep the latest completed document through browser teardown.
	// Browsers without afterprint retain their documents until page unload;
	// guessing that a dialog closed can corrupt its still-open print preview.
	let keepLatest = true
	for (let i = retainedPrints.length - 1; i >= 0; i--) {
		const job = retainedPrints[i]
		if (!job.frame.isConnected) {
			retainedPrints.splice(i, 1)
		} else if (job.completed) {
			if (keepLatest) keepLatest = false
			else {
				job.frame.remove()
				retainedPrints.splice(i, 1)
			}
		}
	}
	const frame = document.createElement('iframe')
	frame.setAttribute('aria-hidden', 'true')
	frame.setAttribute('tabindex', '-1')
	frame.setAttribute('title', spec.fileName)
	const width = spec.paper === 'receipt' ? `${RECEIPT_WIDTH_MM}mm` : '210mm'
	frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width};height:1px;border:0;pointer-events:none;`
	const job = { frame, completed: false }
	retainedPrints.push(job)
	return job
}

/**
 * stage-85 — اندازه‌گیریِ ارتفاعِ یک Document چاپی در «عرضِ قابلِچاپ»
 * (پروبِ ۲۹۱px) با انتظارِ فونت‌ها — زیربنایِ fitHeight و اندازه‌گیریِ
 * عمومیِ measureReceiptHtmlHeightPx. null = اندازه‌گیری ناموفق.
 * This temporary measurement is never used to change browser print page size.
 */
async function measureDocHeightPx(
	doc: Document | null | undefined,
): Promise<number | null> {
	let probe: HTMLStyleElement | null = null
	try {
		if (!doc?.body) return null
		// ترمیم اسکنِ استیج-۸۴ — اندازه‌گیری باید در «عرضِ مؤثرِ کاغذ» انجام
		// شود: فریمِ چاپِ صفر-پیکسلی یا پنجرهٔ موبایلِ iOS متن را در عرضِ
		// غلط می‌شکند و ارتفاع را چند برابر می‌کند (آزمون کروم: ۸۶۵px در
		// عرض ۰ در برابر ۲۷۷px در ۳۰۲px). با probe عرضِ ثابت، مستقل از
		// viewport درست اندازه می‌گیریم؛ بعد از اندازه‌گیری حذف می‌شود.
		probe = doc.createElement('style')
		probe.textContent = `html,body{width:${RECEIPT_PROBE_PX}px !important;margin:0 !important;}`
		doc.head?.appendChild(probe)
		await waitForPrintFonts(doc)
		const px = doc.body.scrollHeight
		return px > 0 ? px : null
	} catch {
		return null
	} finally {
		probe?.remove()
	}
}

async function waitForPrintFonts(doc: Document): Promise<boolean> {
	if (!doc.fonts) return true
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			doc.fonts.ready.then(() => true),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), 2_500)
			}),
		])
	} catch {
		return false
	} finally {
		clearTimeout(timer)
	}
}

async function preparePrintFonts(doc: Document): Promise<void> {
	if (await waitForPrintFonts(doc)) return
	// A font that finishes downloading after print() must not reflow the live
	// preview when the user adjusts margins. Freeze the fallback for this job.
	const fallback = doc.createElement('style')
	fallback.textContent =
		'body, body * { font-family: Tahoma, sans-serif !important; }'
	doc.head.appendChild(fallback)
}

/**
 * stage-85 — ارتفاعِ سندِ چاپی (HTML کامل) را در فریمِ مخفیِ در عرضِ کاغذ
 * اندازه می‌گیرد — برای «پیش‌نمایش» (ارتفاعِ iframe داخل مودال) و «چاپِ
 * مستقیم» (اندازهٔ کاغذ سرویس چاپ). سقفِ اندازه‌گیری ۲.۵ ثانیه؛
 * null = ناموفق (تمام‌شدنِ مهلت) — تماس‌گیرنده باید راهکارِ جایگزین داشته باشد.
 */
export function measureReceiptHtmlHeightPx(
	html: string,
	timeoutMs = 2_500,
): Promise<number | null> {
	return new Promise((resolve) => {
		if (typeof document === 'undefined') {
			resolve(null)
			return
		}
		const frame = document.createElement('iframe')
		frame.setAttribute('aria-hidden', 'true')
		frame.style.cssText =
			'position:fixed;inset:auto 0 0 auto;width:0;height:0;border:0;visibility:hidden;'
		document.body.appendChild(frame)
		let settled = false
		const finish = (px: number | null) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			frame.remove()
			resolve(px)
		}
		const timer = setTimeout(() => finish(null), timeoutMs)
		frame.onload = () => {
			void measureDocHeightPx(frame.contentDocument).then(finish)
		}
		frame.srcdoc = html
	})
}

let activeDocumentPrint: Promise<void> | null = null

export function printHtmlDocumentAsync(spec: PrintDocumentSpec): Promise<void> {
	const next = activeDocumentPrint
		? activeDocumentPrint.catch(() => {}).then(() => performDocumentPrint(spec))
		: performDocumentPrint(spec)
	const task = next.finally(() => {
		if (activeDocumentPrint === task) activeDocumentPrint = null
	})
	activeDocumentPrint = task
	return task
}

function invokePrint(win: Window, fileName: string): void {
	const previousTitle = document.title
	document.title = fileName
	try {
		win.print()
	} finally {
		document.title = previousTitle
	}
}

/**
 * Completes when the browser's print() call returns, not when paper is printed.
 * Most desktop browsers block that call until preview closes; other browsers
 * return immediately. Callers must request only one invoice per user action.
 */
async function performDocumentPrint(spec: PrintDocumentSpec): Promise<void> {
	const html = documentHtml(spec)
	if (isIOS()) {
		// A new top-level document is needed on iOS. Leave it open so Safari
		// can keep rendering its preview; the user can close it after printing.
		const win = window.open('', '_blank')
		if (!win) {
			throw new Error(
				'پنجرهٔ چاپ توسط مرورگر بلاک شد — لطفاً پاپ‌آپ را مجاز کنید و دوباره بزنید',
			)
		}
		win.document.open()
		win.document.write(html)
		win.document.close()
		await preparePrintFonts(win.document)
		invokePrint(win, spec.fileName)
		return
	}

	return new Promise<void>((resolve, reject) => {
		const job = createPrintFrame(spec)
		const iframe = job.frame
		let settled = false
		let started = false
		let attemptedPrint = false
		const finish = (error?: unknown) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			iframe.onload = null
			if (error !== undefined) {
				if (!attemptedPrint) iframe.remove()
				reject(error)
			} else resolve()
		}
		// Bound document loading only. A user may legitimately spend minutes
		// adjusting margins; no timer may finish/replace that live document.
		const timer = setTimeout(
			() => finish(new Error('آماده‌سازی چاپ طولانی شد — دوباره تلاش کنید')),
			15_000,
		)
		iframe.onload = () => {
			if (started || settled) return
			started = true
			void (async () => {
				try {
					const doc = iframe.contentDocument
					const win = iframe.contentWindow
					if (!doc || !win)
						throw new Error('پنجرهٔ چاپ آماده نیست — دوباره تلاش کنید')
					await preparePrintFonts(doc)
					if (settled) return
					clearTimeout(timer)
					const onAfterPrint = () => {
						job.completed = true
						win.removeEventListener('afterprint', onAfterPrint)
					}
					win.addEventListener('afterprint', onAfterPrint)
					attemptedPrint = true
					try {
						invokePrint(win, spec.fileName)
					} catch (error) {
						onAfterPrint()
						throw error
					}
					finish()
				} catch (error) {
					finish(error)
				}
			})()
		}
		try {
			// Set the document before insertion, avoiding an initial about:blank
			// load. This frame's srcdoc is never written a second time.
			iframe.srcdoc = html
			document.body.appendChild(iframe)
		} catch (error) {
			finish(error)
		}
	})
}

/**
 * Legacy batch helper for browsers whose print() blocks until the dialog closes.
 * Invoice UI requests one document per click because some browsers return early.
 */
export async function printHtmlDocumentQueue(
	specs: PrintDocumentSpec[],
): Promise<void> {
	let first = true
	for (const spec of specs) {
		if (!first) {
			// مکث کوتاه بین دیالوگ‌ها — برخی مرورگرها برای بازسازی
			// فعال‌سازی به چند صد میلی‌ثانیه نیاز دارند
			await new Promise((r) => setTimeout(r, 400))
		}
		first = false
		await printHtmlDocumentAsync(spec)
	}
}
