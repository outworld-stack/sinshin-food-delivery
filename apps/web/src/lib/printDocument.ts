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
// مرورگرها: Chrome/Edge/Firefox/Safari دسکتاپ → مسیر iframe؛
// iOS Safari (iframe-print ندارد) → fallback پنجرهٔ جدید با همان سند.

export type PrintPaper = 'a4' | 'receipt'

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
const RECEIPT_CSS = `
@page { size: 80mm 297mm; margin: 2.5mm 2mm; }
body { font-size: 12px; }
.brand { font-size: 17px; }
.doc-sep { margin: 1.5mm 0 3mm; border-top-width: 2px; }
.sheet.page-break { page-break-after: always; }
h1.heading { font-size: 13px; margin: 0 0 2mm; }
.meta { font-size: 10.5px; line-height: 1.9; margin-bottom: 3mm; }
.stats { margin-bottom: 3mm; }
.stat { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; border-bottom: 1px dashed #d1d5db; padding: 1.4mm 0.5mm; }
.stat .l { font-size: 10.5px; color: #6b7280; }
.stat .v { font-size: 12.5px; }
.tbl-title { font-size: 12px; }
table.tbl { margin-bottom: 4mm; font-size: 10px; }
table.tbl.big { font-size: 14px; }
table.tbl th, table.tbl td { border: 1px solid #dfe3e8; padding: 1.8mm 1.4mm; }
.note { padding: 2mm 2.5mm; font-size: 11px; margin-bottom: 4mm; }
.qr-box { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1.5mm; padding: 2.5mm; margin-top: 2mm; }
.qr-box svg { width: 28mm; height: 28mm; }
.qr-box .oid { font-size: 13px; margin-bottom: 0.5mm; }
.qr-box .cap { font-size: 9.5px; line-height: 1.8; }
.footer { margin-top: 4mm; padding-top: 1.5mm; font-size: 9px; }
`

function documentHtml(spec: PrintDocumentSpec): string {
        const origin = window.location.origin
        const font = (family: string, file: string) =>
                `@font-face{font-family:'${family}';src:url('${origin}/fonts/${file}') format('woff2');font-display:block;}`
        const paper: PrintPaper = spec.paper ?? 'a4'
        const orientation = spec.landscape ? 'landscape' : 'portrait'
        const paperCss =
                paper === 'receipt'
                        ? RECEIPT_CSS
                        : A4_CSS.replace('__ORIENTATION__', orientation)
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
${BASE_CSS}
${paperCss}
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
        void printHtmlDocumentAndWait(spec)
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
 * Promise وقتی resolve می‌شود که afterprint روی پنجره‌ی چاپ‌شده (iframe)
 * یا پنجره‌ی والد-fire شود — یا بعد از سقف زمانی (مرورگرهایی که afterprint
 * نمی‌دهند). پایه‌ی صف چاپ چندسندی است.
 *
 * round-15 — در afterprint هیچ دستی به DOM نمی‌زنیم (فریم پایدار است)؛
 * فقط عنوان صفحه برمی‌گردد و فوکوس به اپ بازمی‌گردد. حذف فریم وسط
 * تعطیل‌کردن چاپِ کروم همان باگ «تب قفل می‌شود، کلیک کار نمی‌کند، فقط
 * رفرش» بود.
 */
function printHtmlDocumentAndWait(spec: PrintDocumentSpec): Promise<void> {
        const html = documentHtml(spec)
        const prevTitle = document.title
        document.title = spec.fileName

        const restore = () => {
                document.title = prevTitle
                window.focus() // فوکوس به سند اپ — نه لیمبوی فریم مخفی
        }

        // iOS Safari — چاپ iframe را پشتیبانی نمی‌کند؛ سند در پنجرهٔ جدید
        // (زنجیره‌ی afterprint اینجا قابل اعتماد نیست؛ فراخواننده مقصد بعدی را
        // با تأخیر کوتاه می‌فرستد)
        if (isIOS()) {
                return new Promise<void>((resolve) => {
                        const win = window.open('', '_blank')
                        if (!win) {
                                restore()
                                resolve()
                                return
                        }
                        win.document.open()
                        win.document.write(html)
                        win.document.close()
                        win.focus()
                        win.print()
                        setTimeout(resolve, 1_500)
                })
        }

        return new Promise<void>((resolve) => {
                const iframe = getPrintFrame()
                let settled = false
                const done = () => {
                        if (settled) return
                        settled = true
                        restore()
                        resolve()
                }

                iframe.onload = () => {
                        try {
                                // توجه: focus() روی فریم زده نمی‌شود — صفحهٔ اصلی فوکوس را
                                // نگه می‌دارد و بعد از دیالوگ پاک برمی‌گردد (رفع باگ قفل‌شدن)
                                iframe.contentWindow?.print()
                        } finally {
                                // afterprint روی هر دو پنجره (iframe + والد) گوش می‌دهیم —
                                // کدام زودتر fire شد همان ملاک است؛ سقف ۹۰ ثانیه هم برای
                                // مرورگرهایی که اصلاً afterprint ندارند.
                                window.addEventListener('afterprint', done, { once: true })
                                iframe.contentWindow?.addEventListener('afterprint', done, {
                                        once: true,
                                })
                                setTimeout(done, 90_000)
                        }
                }

                // سند جدید در همان فریم پایدار — تعویض srcdoc فقط وقتی امن است
                // که دیالوگ قبلی بسته شده (صف چاپ await می‌کند)
                iframe.srcdoc = html
        })
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
        for (let i = 0; i < specs.length; i++) {
                await printHtmlDocumentAndWait(specs[i]!)
                if (i < specs.length - 1) {
                        // مکث کوتاه بین دیالوگ‌ها — برخی مرورگرها برای بازسازی
                        // activation به چند صد میلی‌ثانیه نیاز دارند
                        await new Promise((r) => setTimeout(r, 400))
                }
        }
}
