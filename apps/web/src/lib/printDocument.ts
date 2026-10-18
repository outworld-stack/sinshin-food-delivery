// src/lib/printDocument.ts
// round-12 — موتور چاپ مشترک (گزارشات ادمین + فاکتورهای سفارش).
//
// چرا سند مستقل؟ موتور قبلی (کلون DOM داخل #dynamic-print-area + window.print)
// به CSS صفحهٔ اصلی گره خورده بود: قواعد @media print اپ، max-h-96/overflow
// لایه‌ها و کلاس‌های dark: همه روی خروجی اثر می‌گذاشتند و نتیجه صفحهٔ سفید/کلیپ‌شده
// بود. این‌جا سند HTML کامل و خودکفا ساخته می‌شود و در iframe چاپ می‌شود —
// مصون از استایل‌های اپ، با @page و فونت خودش.
//
// round-15 — رفع قفل‌شدن کل سایت بعد از چاپ فاکتور:
//  • iframe «پایدار» و صفر-پیکسلی شد (position:fixed; width:0; height:0) —
//    دیگر iframe تمام‌صفحه‌ای روی صفحه نمی‌نشیند که در برخی مرورگرها
//    (به‌ویژه سامسونگ) حتی مخفی هم روی کلیک‌ها سایه می‌انداخت.
//  • iframe دیگر «هرگز» حذف نمی‌شود: حذف فریم در afterprint (وسط تعطیل‌کردن
//    خط لولهٔ چاپ کروم) همان باگ شناخته‌شدهٔ «تب قفل می‌شود، کلیک کار نمی‌کند،
//    فقط رفرش» است. حالا فقط srcdoc عوض می‌شود.
//  • focus() روی پنجرهٔ فریم زده نمی‌شود (صفحه را در limbo فوکوس می‌گذاشت)؛
//    بعد از چاپ window.focus() فوکوس را به اپ برمی‌گرداند.
//
// round-14 — دو قالب کاغذ:
//  • 'a4'     → چاپ A4 (دسکتاپ؛ landscape خودکار با فلگ)
//  • 'receipt'→ رسیدی 80mm برای پرینترهای ستونی مغازه که از موبایل چاپ
//    می‌گیرند: آمار به‌صورت ردیف‌های عمودی «برچسب … مقدار»، QR وسط‌چین،
//    فونت درشت‌تر برای خوانایی از نزدیک.
//    round-15: طول صفحه 297mm ثابت شد — «80mm auto» در کروم قاعدهٔ معتبر
//    نیست و بی‌صدا دور انداخته می‌شد (اندازهٔ کاغذ پیش‌فرض می‌افتاد).
//
// stage-85 — «رسید فشرده»: فاصله‌های هوایی رسید (line-height ۱.۹،
//    margin های ۳-۴mm، QR ۲۸mm، حاشیهٔ @page ۲.۵mm و اَسنک ۸mm) باعث
//    می‌شد چاپِ فیزیکی به‌اندازهٔ محتوا «چند سانتی‌متر» بلندتر باشد. حالا:
//    حاشیهٔ ۱.۵mm، فاصله‌های نصف، QR ۲۴mm، اَسنک ۳mm + عرض پروب ۲۹۱px
//    (80 − 2×1.5mm) — طول چاپ ≈ طولِ واقعی محتوا. دو خروجی عمومی تازه:
//    buildPrintDocumentHtml (همان HTML برای «پیش‌نمایش» داخل مودال) و
//    measureReceiptHtmlHeightPx (اندازه‌گیری ارتفاعِ سند چاپی).
//
// مرورگرها: Chrome/Edge/Firefox/Safari دسکتاپ → مسیر iframe؛
// iOS Safari (iframe-print ندارد) → پشتیبان: پنجرهٔ جدید با همان سند.

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
	 *  stage-84 — طولِ چاپ = طولِ محتوا (نه کلِ رول ۲۹۷mm): بعد از رندرِ
	 *  iframe، ارتفاعِ واقعی اندازه‌گیری و «همان لحظه» به @page تزریق
	 *  می‌شود (کرومِ جدید دو-طول را پشتیبانی می‌کند؛ ۴۰ تا ۲۹۷mm کلمپ).
	 *  فقط با paper:'receipt'؛ پیش‌فرض خاموش (رفتار قبلی حفظ می‌شود).
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

// رسیدی 80mm — پرینتر ستونی مغازه / چاپ از موبایل.
// عرض 80mm و طول 297mm (معتبر در کروم؛ «auto» دور انداخته می‌شد).
// stage-84 — fitHeight طول را به اندازه‌ی محتوا می‌کاهد (تزریق پویا در چاپ).
// stage-85 — نسخهٔ «فشرده»: line-height و margin ها نصف شدند، QR کوچکتر،
// حاشیهٔ @page ۱.۵mm — طول چاپ ≈ طولِ واقعی محتوا (شرح در سربرگ فایل).
const RECEIPT_CSS = `
@page { size: 80mm 297mm; margin: 1.5mm 1.5mm; }
body { font-size: 11px; }
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

/**
 * stage-85 — سند چاپی به‌صورت HTML رشته‌ای (همان موتور چاپ) — برای
 * «پیش‌نمایش داخل مودال» (iframe قابل‌مشاهده) و «چاپ مستقیم» از طریق
 * سرویس چاپ محلی (lib/printAgent)؛ خروجی عینِ چیزی است که چاپ می‌شود.
 */
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

/**
 * فریم چاپ پایدار — یک بار ساخته می‌شود و برای همیشه می‌ماند (round-15).
 * صفر پیکسل در گوشهٔ پایین: هیچ ناحیه‌ای برای ربودن کلیک/لمس ندارد و
 * display:none هم نیست (که رندر چاپ را در برخی مرورگرها می‌شکند).
 */
let printFrame: HTMLIFrameElement | null = null
function getPrintFrame(): HTMLIFrameElement {
	if (printFrame?.isConnected) return printFrame
	printFrame = document.createElement('iframe')
	printFrame.setAttribute('aria-hidden', 'true')
	printFrame.style.cssText =
		'position:fixed;inset:auto 0 0 auto;width:0;height:0;border:0;visibility:hidden;'
	document.body.appendChild(printFrame)
	return printFrame
}

/**
 * round-13 — چاپ سند + انتظار برای بسته‌شدن دیالوگ.
 * Promise وقتی تفسیر می‌شود که afterprint روی پنجره‌ی چاپ‌شده (iframe)
 * یا پنجره‌ی والد اجرا شود — یا بعد از سقف زمانی (مرورگرهایی که afterprint
 * نمی‌دهند). پایه‌ی صف چاپ چندسندی است.
 *
 * round-15 — در afterprint هیچ دستی به DOM نمی‌زنیم (فریم پایدار است)؛
 * فقط عنوان صفحه برمی‌گردد و فوکوس به اپ بازمی‌گردد. حذف فریم وسط
 * تعطیل‌کردن چاپِ کروم همان باگ «تب قفل می‌شود، کلیک کار نمی‌کند، فقط
 * رفرش» بود.
 */
/**
 * stage-84 — طولِ چاپ = طولِ محتوا: ارتفاعِ رندرشده را اندازه می‌گیریم و
 * @pageِ «همان لحظه» با اندازه‌ی واقعی (کلمپ ۴۰..۲۹۷mm + لَخی ۸mm برای
 * حاشیه/فونت‌های در حال لود) بازنویسی می‌شود. مرورگر دو-طولِ اختصاصی
 * (80mm × H) را پشتیبانی می‌کند؛ خطا = ماندن روی ۲۹۷mm (رفتار قبلی).
 */
/**
 * stage-84 — طولِ چاپ = طولِ محتوا: ارتفاعِ رندرشده را اندازه می‌گیریم و
 * @pageِ «همان لحظه» با اندازهٔ واقعی بازنویسی می‌شود. مرورگر دو-طولِ
 * اختصاصی (80mm × H) را پشتیبانی می‌کند؛ خطا = ماندن روی ۲۹۷mm.
 * stage-85 — نسخهٔ فشرده: اَسنک ۸mm → ۳mm (جای برشِ حرارتی)، حاشیهٔ
 * ۱.۵mm و عرضِ پروبِ ۲۹۱px = عرضِ قابل‌چاپِ واقعی — اندازه‌گیری مشترک
 * با measureReceiptHtmlHeightPx شد (measureDocHeightPx).
 */
async function fitReceiptHeight(
	doc: Document | null | undefined,
): Promise<void> {
	if (!doc?.head) return
	const px = await measureDocHeightPx(doc)
	if (px === null) return
	const mm = receiptPxToMm(px) + 3
	const clamped = Math.min(Math.max(mm, 40), 297)
	const style = doc.createElement('style')
	style.textContent = `@page { size: 80mm ${clamped}mm; margin: 1.5mm 1.5mm; }`
	doc.head?.appendChild(style)
}

/**
 * stage-85 — اندازه‌گیریِ ارتفاعِ یک Document چاپی در «عرضِ قابلِچاپ»
 * (پروبِ ۲۹۱px) با انتظارِ فونت‌ها — زیربنایِ fitHeight و اندازه‌گیریِ
 * عمومیِ measureReceiptHtmlHeightPx. null = اندازه‌گیری ناموفق.
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

async function waitForPrintFonts(doc: Document): Promise<void> {
	if (!doc.fonts) return
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			doc.fonts.ready,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 2_500)
			}),
		])
	} catch {
		// A missing font must not prevent printing with the fallback font.
	} finally {
		clearTimeout(timer)
	}
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

async function performDocumentPrint(spec: PrintDocumentSpec): Promise<void> {
	const html = documentHtml(spec)
	const prevTitle = document.title
	document.title = spec.fileName

	const restore = () => {
		document.title = prevTitle
		try {
			window.focus() // فوکوس به سند اپ — نه لیمبوی فریم مخفی
		} catch {
			// Focus restoration is optional in embedded browsers.
		}
	}

	try {
		// iOS Safari — چاپ iframe را پشتیبانی نمی‌کند؛ سند در پنجرهٔ جدید
		// (زنجیره‌ی afterprint اینجا قابل اعتماد نیست؛ فراخواننده مقصد بعدی را
		// با تأخیر کوتاه می‌فرستد)
		if (isIOS()) {
			return await new Promise<void>((resolve, reject) => {
				const win = window.open('', '_blank')
				if (!win) {
					// ترمیم اسکنِ استیج-۸۴ — بلاکِ پاپ‌آپ دیگر «موفقِ بی‌چاپ»
					// نیست؛ خطا می‌دهد تا توستِ واقعی دیده شود
					reject(
						new Error(
							'پنجرهٔ چاپ توسط مرورگر بلاک شد — لطفاً پاپ‌آپ را مجاز کنید و دوباره بزنید',
						),
					)
					return
				}
				win.document.open()
				win.document.write(html)
				win.document.close()
				let settled = false
				let timer: ReturnType<typeof setTimeout> | undefined
				const finish = (error?: unknown) => {
					if (settled) return
					settled = true
					clearTimeout(timer)
					win.removeEventListener('afterprint', onAfterPrint)
					if (error !== undefined) reject(error)
					else resolve()
				}
				const onAfterPrint = () => finish()
				win.addEventListener('afterprint', onAfterPrint)
				const printNow = async () => {
					try {
						if (spec.paper === 'receipt' && spec.fitHeight)
							await fitReceiptHeight(win.document)
						else await waitForPrintFonts(win.document)
						win.focus()
						win.print()
						// Safari does not reliably dispatch afterprint on popup windows.
						if (!settled) timer = setTimeout(() => finish(), 1_500)
					} catch (error) {
						finish(error)
					}
				}
				void printNow()
			})
		}

		return await new Promise<void>((resolve, reject) => {
			const iframe = getPrintFrame()
			let settled = false
			let started = false
			let attemptedPrint = false
			let printingWindow: Window | null = null
			let timeoutId: ReturnType<typeof setTimeout> | null = null
			// stage-85 — ترمیمِ «گیرکردن»: اگر afterprint هرگز نیاید (بعضی
			// نسخه‌های کروم/اندروید بعد از لغوِ دیالوگ)، مودال تا ۹۰ ثانیه
			// «در حال چاپ» می‌ماند. کروم/فایرفاکس هنگامِ بازشدنِ دیالوگ
			// مدیاکوئری «print» را روی صفحه فعال و بعدِ بستن غیرفعال
			// می‌کنند — همان لحظهٔ خروج از چاپ، سیگنالِ اتمام است.
			const printMedia = window.matchMedia('print')
			let enteredPrint = false
			const onPrintMedia = (e: MediaQueryListEvent) => {
				if (e.matches) enteredPrint = true
				else if (enteredPrint) done()
			}
			const done = (error?: unknown) => {
				if (settled) return
				settled = true
				// ترمیم اسکنِ استیج-۸۴ — تایمرِ سقفِ ۹۰ثانیه‌ای هم پاک شود
				if (timeoutId !== null) clearTimeout(timeoutId)
				printMedia.removeEventListener('change', onPrintMedia)
				window.removeEventListener('afterprint', onAfterPrint)
				printingWindow?.removeEventListener('afterprint', onAfterPrint)
				iframe.onload = null
				if (error !== undefined) reject(error)
				else resolve()
			}
			const onAfterPrint = () => done()

			iframe.onload = () => {
				if (started || settled) return
				started = true
				const fire = async () => {
					try {
						if (spec.paper === 'receipt' && spec.fitHeight)
							await fitReceiptHeight(iframe.contentDocument)
						else if (iframe.contentDocument)
							await waitForPrintFonts(iframe.contentDocument)
						if (settled) return
						printingWindow = iframe.contentWindow
						if (!printingWindow)
							throw new Error('پنجرهٔ چاپ آماده نیست — دوباره تلاش کنید')
						// Blocking browsers dispatch afterprint before print() returns.
						window.addEventListener('afterprint', onAfterPrint)
						printingWindow.addEventListener('afterprint', onAfterPrint)
						printMedia.addEventListener('change', onPrintMedia)
						// توجه: focus() روی فریم زده نمی‌شود — صفحهٔ اصلی فوکوس را
						// نگه می‌دارد و بعد از دیالوگ پاک برمی‌گردد (رفع باگ قفل‌شدن)
						attemptedPrint = true
						printingWindow.print()
					} catch (error) {
						done(error)
					}
				}
				void fire()
			}

			// Also bound iframe/font loading, which can fail before printing starts.
			timeoutId = setTimeout(
				() =>
					done(
						attemptedPrint
							? undefined
							: new Error('آماده‌سازی چاپ طولانی شد — دوباره تلاش کنید'),
					),
				90_000,
			)
			// سند جدید در همان فریم پایدار — تعویض srcdoc فقط وقتی امن است
			// که دیالوگ قبلی بسته شده (صف چاپ await می‌کند)
			try {
				iframe.srcdoc = html
			} catch (error) {
				done(error)
			}
		})
	} finally {
		restore()
	}
}

/**
 * round-13 — صف چاپ چندسندی: هر سند پنجره‌ی چاپ «جداگانه» می‌گیرد تا
 * ادمین بتواند هر فاکتور را روی پرینتر خودش بفرستد (مثلاً فاکتور اشپزخانه
 * روی پرینتر آشپزخانه و فاکتور فروش روی پرینتر میز بیرون‌بر).
 * سند بعدی بعد از بسته‌شدن دیالوگِ قبلی + یک مکث کوتاه ارسال می‌شود.
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
