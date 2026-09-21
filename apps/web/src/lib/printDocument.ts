// src/lib/printDocument.ts
// round-12 — موتور چاپ مشترک (گزارشات ادمین + فاکتورهای سفارش).
//
// چرا سند مستقل؟ موتور قبلی (کلون DOM داخل #dynamic-print-area + window.print)
// به CSS صفحهٔ اصلی گره خورده بود: قواعد @media print اپ، max-h-96/overflow
// لایه‌ها و کلاس‌های dark: همه روی خروجی اثر می‌گذاشتند و نتیجه صفحهٔ سفید/کلیپ‌شده
// بود. این‌جا سند HTML کامل و خودکفا ساخته می‌شود و در iframe مخفی چاپ می‌شود —
// مصون از استایل‌های اپ، با @page و فونت خودش.
//
// مرورگرها: Chrome/Edge/Firefox/Safari دسکتاپ → مسیر iframe؛
// iOS Safari (iframe-print ندارد) → fallback پنجرهٔ جدید با همان سند.

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

function documentHtml(spec: PrintDocumentSpec): string {
	const origin = window.location.origin
	const font = (family: string, file: string) =>
		`@font-face{font-family:'${family}';src:url('${origin}/fonts/${file}') format('woff2');font-display:block;}`
	const orientation = spec.landscape ? 'landscape' : 'portrait'
	const sections = spec.sections.map(sectionHtml).join('')
	const footer = spec.footerNote
		? `<div class="footer">${esc(spec.footerNote)} — ${new Date().toLocaleDateString('fa-IR')}</div>`
		: ''
	return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(spec.fileName)}</title>
<style>
${font('DanaFaNum-Medium', 'DanaFaNum-Medium.woff2')}
${font('DanaFaNum-DemiBold', 'DanaFaNum-DemiBold.woff2')}
${font('MorabbaBold', 'Morabba-Bold.woff2')}
@page { size: A4 ${orientation}; margin: 14mm 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'DanaFaNum-Medium', Tahoma, sans-serif; color: #1f2937; direction: rtl; }
.brand { text-align: center; font-family: 'MorabbaBold', sans-serif; font-size: 21px; color: #f6339a; }
.doc-sep { border: none; border-top: 3px solid #f6339a; margin: 2mm 0 6mm; }
.sheet.page-break { page-break-after: always; }
h1.heading { font-size: 16px; font-family: 'DanaFaNum-DemiBold'; text-align: center; margin: 0 0 2.5mm; }
.meta { text-align: center; color: #6b7280; font-size: 11px; line-height: 2; margin-bottom: 5mm; }
.stats { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 6mm; }
.stat { flex: 1 1 32mm; border: 1px solid #e5e7eb; border-radius: 3mm; padding: 2.5mm 3mm; text-align: center; }
.stat .l { font-size: 10px; color: #6b7280; margin-bottom: 1mm; }
.stat .v { font-size: 13px; font-family: 'DanaFaNum-DemiBold'; color: #f6339a; }
.tbl-title { font-size: 12.5px; font-family: 'DanaFaNum-DemiBold'; margin: 0 0 2mm; }
table.tbl { width: 100%; border-collapse: collapse; margin-bottom: 5mm; font-size: 10.5px; }
table.tbl.big { font-size: 15px; }
table.tbl th { background: #f3f4f6; font-family: 'DanaFaNum-DemiBold'; }
table.tbl th, table.tbl td { border: 1px solid #e5e7eb; padding: 2.2mm 2.6mm; text-align: right; word-break: break-word; }
table.tbl tbody tr:nth-child(even) { background: #fafafa; }
table.tbl thead { display: table-header-group; }
table.tbl tr { page-break-inside: avoid; }
td.empty, .empty { text-align: center; color: #9ca3af; }
.note { border: 1px dashed #d1d5db; border-radius: 3mm; padding: 3mm 4mm; font-size: 11px; color: #374151; margin-bottom: 5mm; line-height: 1.9; }
.qr-box { display: flex; align-items: center; gap: 6mm; border: 1px solid #e5e7eb; border-radius: 3mm; padding: 4mm; }
.qr-box svg { width: 30mm; height: 30mm; display: block; }
.qr-box .oid { font-size: 15px; font-family: 'DanaFaNum-DemiBold'; letter-spacing: 1px; margin-bottom: 1mm; }
.qr-box .cap { font-size: 10.5px; color: #6b7280; line-height: 2; }
.footer { margin-top: 8mm; border-top: 1px solid #e5e7eb; padding-top: 2mm; text-align: center; color: #9ca3af; font-size: 9.5px; }
</style>
</head>
<body>
<p class="brand">${esc(spec.brand)}</p>
<hr class="doc-sep" />
${sections}
${footer}
</body>
</html>`
}

/**
 * چاپ سند — عنوان صفحه موقتاً به fileName تغییر می‌کند تا «Save as PDF»
 * مرورگر نام درست پیشنهاد دهد و بعد از بسته‌شدن دیالوگ برمی‌گردد.
 */
export function printHtmlDocument(spec: PrintDocumentSpec): void {
	const html = documentHtml(spec)
	const prevTitle = document.title
	document.title = spec.fileName

	const restore = () => {
		document.title = prevTitle
	}

	// iOS Safari — چاپ iframe را پشتیبانی نمی‌کند؛ سند در پنجرهٔ جدید
	if (isIOS()) {
		const win = window.open('', '_blank')
		if (!win) {
			restore()
			return
		}
		win.document.open()
		win.document.write(html)
		win.document.close()
		win.focus()
		win.print()
		return
	}

	// دسکتاپ — iframe مخفی؛ visibility:hidden چون display:none در برخی
	// مرورگرها رندر (و در نتیجه صفحه‌بندی چاپ) را غیرقابل‌اعتماد می‌کند
	const iframe = document.createElement('iframe')
	iframe.setAttribute('aria-hidden', 'true')
	iframe.style.cssText =
		'position:fixed;inset:0;width:100%;height:100%;border:0;visibility:hidden;z-index:-9999;'
	iframe.srcdoc = html

	let cleaned = false
	const cleanup = () => {
		if (cleaned) return
		cleaned = true
		iframe.remove()
		restore()
	}

	iframe.onload = () => {
		try {
			iframe.contentWindow?.focus()
			iframe.contentWindow?.print()
		} finally {
			// print() در اکثر مرورگرها مدال است؛ بعد از بازگشت پاک‌سازی می‌کنیم.
			// afterprint برای مرورگرهای غیرمدال (+ fallback زمانی)
			window.addEventListener('afterprint', cleanup, { once: true })
			setTimeout(cleanup, 60_000)
		}
	}

	document.body.appendChild(iframe)
}
