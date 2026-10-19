// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/receiptCanvas.ts (فایل جدید)
// رندرِ «رسید حرارتی» روی canvas → بیت‌مپِ 1bpp برایِ چاپِ مستقیم.
//
// چرا canvas؟ حقیقتِ قطعیِ ESC/POS (تحقیق استیج-۸۸): هیچ کدپیجی از
// پرینترهای فیش، شکل‌گیریِ حروفِ فارسی (اتصال/ترتیبِ راست‌به‌چپ) را
// ندارد — متنِ کدپیجی حروفِ جدا و وارونه چاپ می‌کند. راهِ استانداردِ
// POSهای واقعی: متن در مرورگر رندر شود (شکل‌گیریِ کامل با خودِ مرورگر)،
// به تصویرِ تک‌بیتی تبدیل شود و با GS v 0 به چاپگر برود — طولِ کاغذ
// هم دقیقاً = طولِ محتوا (بدونِ کاغذِ هدرِ اضافه).
//
// قراردادِ خروجی با سرور (apps/api/src/domain/print/escpos.ts):
//  · عرض = widthPx dot سرِ چاپ (۵۷۶ = ۸۰mm · ۳۸۴ = ۵۸mm · ۴۲۰ = اپسون ۵۸)
//  · ردیف‌ها از بالا · هر بایت ۸ dot · MSB = چپ‌ترین dot
//  · bit=1 یعنی «مشکی/چاپ» (وارونهٔ luminance)
//  · rows = base64
// ═══════════════════════════════════════════════════════════════

// src/lib/receiptCanvas.ts
import type { PrintDocumentSpec, PrintSectionSpec } from '#/lib/printDocument'

export interface ReceiptBitmap {
	widthPx: number
	heightPx: number
	/** بایت‌های 1bpp (MSB-first، ردیف‌major) — base64 */
	rows: string
}

/** سقفِ ارتفاع — همانِ سمتِ سرور (۴۰۰۰ dot ≈ نیم‌متر) */
const MAX_HEIGHT_DOTS = 4000
/** آستانهٔ سیاه/سفید — متنِ 203dpi با آستانهٔ سادهً تیزترین خروجی را می‌دهد */
const INK_THRESHOLD = 128

const FONT_BODY = 'DanaMedium'
const FONT_BOLD = 'DanaDemiBold'
const FONT_BRAND = 'MorabbaBold'

async function ensurePrintFonts(): Promise<void> {
	try {
		await Promise.all([
			document.fonts.load(`32px '${FONT_BRAND}'`),
			document.fonts.load(`24px '${FONT_BOLD}'`),
			document.fonts.load(`20px '${FONT_BODY}'`),
		])
		await Promise.race([
			document.fonts.ready,
			new Promise<void>((r) => setTimeout(r, 1_500)),
		])
	} catch {
		// فونتِ غایب = Tahoma سیستم (شکل‌گیریِ فارسی را سیستم انجام می‌دهد)
	}
}

async function svgToImage(svg: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image()
		const timer = setTimeout(() => resolve(null), 2_500)
		img.onload = () => {
			clearTimeout(timer)
			resolve(img)
		}
		img.onerror = () => {
			clearTimeout(timer)
			resolve(null)
		}
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
	})
}

/** شکستنِ متن به سطرهای داخلِ maxW — بر مبنایِ کلمه */
function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxW: number,
): string[] {
	const words = text.split(/\s+/).filter((w) => w.length > 0)
	if (words.length === 0) return ['']
	const lines: string[] = []
	let line = ''
	for (const w of words) {
		const candidate = line ? `${line} ${w}` : w
		if (ctx.measureText(candidate).width <= maxW || !line) {
			line = candidate
		} else {
			lines.push(line)
			line = w
		}
	}
	if (line) lines.push(line)
	return lines
}

/** همه‌ی اندازه‌ها بر حسبِ dot — برایِ ۵۷۶ تعریف شده و با u مقیاس می‌گیرند */
interface Metrics {
	w: number
	u: number
	pad: number
	gap: number
	brand: number
	heading: number
	meta: number
	body: number
	big: number
	small: number
	lineH: (font: number) => number
}

function metricsFor(widthPx: number): Metrics {
	const u = widthPx / 576
	return {
		w: widthPx,
		u,
		pad: Math.round(10 * u),
		gap: Math.round(6 * u),
		brand: Math.round(32 * u),
		heading: Math.round(24 * u),
		meta: Math.round(20 * u),
		body: Math.round(20 * u),
		big: Math.round(27 * u),
		small: Math.round(17 * u),
		lineH: (font: number) => Math.round(font * 1.55),
	}
}

// ── اجزای رسم — همگی y جلو می‌برند (textBaseline همه‌جا = middle) ──

function drawCentered(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	text: string,
	font: number,
): void {
	ctx.font = `${font}px '${FONT_BODY}', Tahoma`
	const lineH = m.lineH(font)
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	for (const ln of wrapText(ctx, text, m.w - m.pad * 2)) {
		y.value += Math.round(lineH / 2)
		ctx.fillText(ln, m.w / 2, y.value)
		y.value += Math.round(lineH / 2)
	}
	ctx.textAlign = prevAlign
}

/** مکان‌نما — هر رندر شیءٔ خودش را دارد (هم‌زمانی امن) */
const y = { value: 0 }

function drawBrand(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	brand: string,
): void {
	ctx.font = `${m.brand}px '${FONT_BRAND}', Tahoma`
	const lineH = Math.round(m.brand * 1.3)
	y.value += Math.round(m.gap * 0.8)
	y.value += Math.round(lineH / 2)
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	ctx.fillText(brand, m.w / 2, y.value)
	ctx.textAlign = prevAlign
	y.value += Math.round(lineH / 2)
	ctx.fillRect(
		m.pad,
		y.value,
		m.w - m.pad * 2,
		Math.max(2, Math.round(3 * m.u)),
	)
	y.value += Math.max(2, Math.round(3 * m.u)) + m.gap
}

function drawHeading(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	heading: string,
): void {
	ctx.font = `${m.heading}px '${FONT_BOLD}', Tahoma`
	const lineH = m.lineH(m.heading)
	const lines = wrapText(ctx, heading, m.w - m.pad * 4)
	const barH = lines.length * lineH + Math.round(6 * m.u)
	ctx.fillRect(m.pad, y.value, m.w - m.pad * 2, barH)
	ctx.fillStyle = '#fff'
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	let ly = y.value + Math.round((barH - lines.length * lineH) / 2)
	for (const ln of lines) {
		ctx.fillText(ln, m.w / 2, ly + Math.round(lineH / 2))
		ly += lineH
	}
	ctx.textAlign = prevAlign
	ctx.fillStyle = '#000'
	y.value += barH + m.gap
}

function drawStats(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	stats: Array<{ label: string; value: string }>,
): void {
	const labelFont = Math.round(m.meta * 0.95)
	const valueFont = Math.round(m.meta * 1.05)
	const rowH = m.lineH(m.meta) + Math.round(4 * m.u)
	const prevAlign = ctx.textAlign
	for (const s of stats) {
		const midY = y.value + Math.round(rowH / 2)
		ctx.font = `${labelFont}px '${FONT_BODY}', Tahoma`
		ctx.textAlign = 'right'
		ctx.fillText(s.label, m.w - m.pad, midY)
		ctx.font = `${valueFont}px '${FONT_BOLD}', Tahoma`
		ctx.textAlign = 'left'
		ctx.fillText(s.value, m.pad, midY)
		// خط‌چین زیرِ ردیف
		const dash = Math.round(5 * m.u)
		for (let x = m.pad; x < m.w - m.pad; x += dash * 2) {
			ctx.fillRect(x, y.value + rowH - 1, Math.min(dash, m.w - m.pad - x), 1)
		}
		y.value += rowH
	}
	ctx.textAlign = prevAlign
	y.value += m.gap
}

interface ColSpec {
	/** لبهٔ راستِ ستون */
	right: number
	w: number
	align: 'right' | 'center'
}

function drawTable(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	head: string[],
	rows: string[][],
	big: boolean,
): void {
	const bodyFont = big ? m.big : m.body
	const headFont = Math.round((big ? m.big : m.body) * 0.95)
	const lineH = m.lineH(bodyFont)
	const cellPad = Math.round(4 * m.u)
	const tableW = m.w - m.pad * 2
	// ستون‌ها از راست: ستونِ اول (نام) انعطاف؛ بقیه سرِهِ محتوا
	ctx.font = `${headFont}px '${FONT_BOLD}', Tahoma`
	const tailCount = Math.max(0, head.length - 1)
	let tailW = 0
	for (let i = 1; i < head.length; i++) {
		tailW +=
			Math.max(ctx.measureText(head[i] as string).width, Math.round(64 * m.u)) +
			cellPad * 2
	}
	tailW = Math.min(Math.round(tailW), Math.round(tableW * 0.55))
	const cols: ColSpec[] = [
		{ right: m.w - m.pad, w: tableW - tailW, align: 'right' },
	]
	let x = m.w - m.pad - (tableW - tailW)
	for (let i = 0; i < tailCount; i++) {
		const share =
			i === tailCount - 1 ? x - m.pad : Math.round(tailW / (tailCount || 1))
		const cw = Math.max(share, Math.round(48 * m.u))
		x -= cw
		cols.push({ right: x + cw, w: cw, align: 'center' })
	}

	const drawCellText = (
		text: string,
		col: ColSpec,
		yTop: number,
		h: number,
	): void => {
		ctx.save()
		ctx.beginPath()
		ctx.rect(col.right - col.w, yTop, col.w, h)
		ctx.clip()
		ctx.font = `${bodyFont}px '${FONT_BODY}', Tahoma`
		const lines = wrapText(ctx, text, col.w - cellPad * 2)
		let ly = yTop + Math.round((h - lines.length * lineH) / 2)
		const prevAlign = ctx.textAlign
		for (const ln of lines) {
			if (col.align === 'right') {
				ctx.textAlign = 'right'
				ctx.fillText(ln, col.right - cellPad, ly + Math.round(lineH / 2))
			} else {
				ctx.textAlign = 'center'
				ctx.fillText(ln, col.right - col.w / 2, ly + Math.round(lineH / 2))
			}
			ly += lineH
		}
		ctx.textAlign = prevAlign
		ctx.restore()
	}

	// سربرگ — نوارِ مشکی + متنِ سفید
	const headH = lineH + Math.round(5 * m.u)
	ctx.fillRect(m.pad, y.value, tableW, headH)
	ctx.fillStyle = '#fff'
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	for (let i = 0; i < head.length; i++) {
		const col = cols[i] as ColSpec
		const midY = y.value + Math.round(headH / 2)
		if (col.align === 'right') {
			ctx.textAlign = 'right'
			ctx.fillText(head[i] as string, col.right - cellPad, midY)
			ctx.textAlign = 'center'
		} else {
			ctx.fillText(head[i] as string, col.right - col.w / 2, midY)
		}
	}
	ctx.textAlign = prevAlign
	ctx.fillStyle = '#000'
	y.value += headH

	// ردیف‌ها — اول متن (کلیپ‌شده) بعد قاب
	for (let r = 0; r < rows.length; r++) {
		const row = rows[r] as string[]
		let maxLines = 1
		ctx.font = `${bodyFont}px '${FONT_BODY}', Tahoma`
		for (let c = 0; c < head.length; c++) {
			const col = cols[c] as ColSpec
			maxLines = Math.max(
				maxLines,
				wrapText(ctx, row[c] ?? '', col.w - cellPad * 2).length,
			)
		}
		const rowH = maxLines * lineH + cellPad * 2
		if (r % 2 === 1) {
			ctx.fillStyle = '#f3f3f3'
			ctx.fillRect(m.pad, y.value, tableW, rowH)
			ctx.fillStyle = '#000'
		}
		for (let c = 0; c < head.length; c++) {
			drawCellText(row[c] ?? '', cols[c] as ColSpec, y.value, rowH)
		}
		ctx.lineWidth = 1
		ctx.strokeStyle = '#000'
		ctx.strokeRect(m.pad + 0.5, y.value + 0.5, tableW - 1, rowH - 1)
		for (let c = 0; c < head.length - 1; c++) {
			const col = cols[c] as ColSpec
			const vx = col.right - col.w
			ctx.beginPath()
			ctx.moveTo(vx + 0.5, y.value)
			ctx.lineTo(vx + 0.5, y.value + rowH)
			ctx.stroke()
		}
		y.value += rowH
	}
	if (rows.length === 0) {
		const rowH = lineH + cellPad * 2
		ctx.strokeRect(m.pad + 0.5, y.value + 0.5, tableW - 1, rowH - 1)
		const pa = ctx.textAlign
		ctx.textAlign = 'center'
		ctx.fillText('موردی یافت نشد', m.w / 2, y.value + Math.round(rowH / 2))
		ctx.textAlign = pa
		y.value += rowH
	}
	y.value += m.gap
}

function drawNote(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	note: string,
): void {
	const font = m.small + 3
	ctx.font = `${font}px '${FONT_BODY}', Tahoma`
	const lineH = m.lineH(font)
	const pad = Math.round(6 * m.u)
	const lines = wrapText(ctx, note, m.w - m.pad * 2 - pad * 2)
	const boxH = lines.length * lineH + pad * 2
	ctx.save()
	ctx.setLineDash([Math.round(5 * m.u), Math.round(4 * m.u)])
	ctx.lineWidth = 1
	ctx.strokeStyle = '#000'
	ctx.strokeRect(m.pad + 0.5, y.value + 0.5, m.w - m.pad * 2 - 1, boxH - 1)
	ctx.restore()
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	let ly = y.value + pad
	for (const ln of lines) {
		ctx.fillText(ln, m.w / 2, ly + Math.round(lineH / 2))
		ly += lineH
	}
	ctx.textAlign = prevAlign
	y.value += boxH + m.gap
}

async function drawQr(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	qr: NonNullable<PrintSectionSpec['qr']>,
): Promise<void> {
	const size = Math.round(168 * m.u)
	const top = y.value + m.gap
	const img = qr.svg ? await svgToImage(qr.svg) : null
	if (img) {
		// نزدیک‌ترین‌همسایه — ماژول‌های QR نرم نشوند
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(img, (m.w - size) / 2, top, size, size)
		ctx.imageSmoothingEnabled = true
	} else {
		ctx.strokeRect((m.w - size) / 2 + 0.5, top + 0.5, size - 1, size - 1)
	}
	let ly = top + size + Math.round(6 * m.u)
	const prevAlign = ctx.textAlign
	ctx.textAlign = 'center'
	if (qr.orderId) {
		const font = m.meta + 2
		const lineH = m.lineH(font)
		ctx.font = `${font}px '${FONT_BOLD}', Tahoma`
		const prevDir = ctx.direction
		ctx.direction = 'ltr'
		ctx.fillText(qr.orderId, m.w / 2, ly + Math.round(lineH / 2))
		ctx.direction = prevDir
		ly += lineH
	}
	if (qr.caption) {
		ctx.font = `${m.small}px '${FONT_BODY}', Tahoma`
		const lineH = m.lineH(m.small)
		for (const ln of wrapText(ctx, qr.caption, m.w - m.pad * 2)) {
			ctx.fillText(ln, m.w / 2, ly + Math.round(lineH / 2))
			ly += lineH
		}
	}
	ctx.textAlign = prevAlign
	y.value = ly + m.gap
}

function drawFooter(
	ctx: CanvasRenderingContext2D,
	m: Metrics,
	note: string,
): void {
	y.value += m.gap
	ctx.fillRect(m.pad, y.value, m.w - m.pad * 2, 1)
	y.value += Math.round(4 * m.u)
	drawCentered(ctx, m, note, m.small)
}

async function doRender(
	spec: PrintDocumentSpec,
	widthPx: number,
): Promise<ReceiptBitmap> {
	const canvas = document.createElement('canvas')
	canvas.width = widthPx
	canvas.height = MAX_HEIGHT_DOTS
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('canvas 2d در دسترس نیست.')

	const m = metricsFor(widthPx)
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, widthPx, MAX_HEIGHT_DOTS)
	ctx.fillStyle = '#000'
	// استایلِ mono فیش‌پرینتر: همه‌چیز مشکی · چیدمانِ راست‌به‌چپ
	ctx.direction = 'rtl'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'

	y.value = 0
	drawBrand(ctx, m, spec.brand)
	for (const section of spec.sections) {
		drawHeading(ctx, m, section.heading)
		if (section.metaLines && section.metaLines.length > 0) {
			for (const ln of section.metaLines) drawCentered(ctx, m, ln, m.meta)
			y.value += Math.round(m.gap * 0.6)
		}
		if (section.stats && section.stats.length > 0) {
			drawStats(ctx, m, section.stats)
		}
		for (const t of section.tables) {
			drawTable(ctx, m, t.head, t.rows, section.bigTables === true)
		}
		if (section.note) drawNote(ctx, m, section.note)
		if (section.qr) await drawQr(ctx, m, section.qr)
	}
	if (spec.footerNote) {
		const fa = new Date().toLocaleDateString('fa-IR')
		drawFooter(ctx, m, `${spec.footerNote} — ${fa}`)
	}

	const contentEnd = y.value + Math.round(8 * m.u)
	if (contentEnd > MAX_HEIGHT_DOTS) {
		throw new Error('رسید بلندتر از سقفِ ۴۰۰۰ dot است.')
	}
	const heightPx = Math.max(contentEnd, 16)

	// ── بسته‌بندیِ 1bpp — MSB-first · ردیف‌major · bit=1 مشکی ──
	const image = ctx.getImageData(0, 0, widthPx, heightPx)
	const bytesPerRow = Math.ceil(widthPx / 8)
	const packed = new Uint8Array(bytesPerRow * heightPx)
	const data = image.data
	for (let yy = 0; yy < heightPx; yy++) {
		for (let xx = 0; xx < widthPx; xx++) {
			const i = (yy * widthPx + xx) * 4
			const lum =
				((data[i] as number) +
					(data[i + 1] as number) +
					(data[i + 2] as number)) /
				3
			if (lum < INK_THRESHOLD) {
				packed[yy * bytesPerRow + Math.floor(xx / 8)] |= 1 << (7 - (xx % 8))
			}
		}
	}
	return { widthPx, heightPx, rows: bytesToBase64(packed) }
}

/** صفِ تک‌به‌تک — cursor مشترک است؛ رندرهای هم‌زمان بر هم نمی‌غلتند */
let renderChain: Promise<unknown> = Promise.resolve()

/**
 * رندرِ کاملِ یک PrintDocumentSpec به بیت‌مپِ حرارتی.
 *  · fitHeight همیشه روشن: heightPx = همانِ محتوا (تا سقف ۴۰۰۰ dot)
 *  · فقط client — سرور canvas ندارد (اینجا شکل‌گیریِ فارسی انجام می‌شود)
 */
export function renderSpecToReceiptBitmap(
	spec: PrintDocumentSpec,
	widthPx: number,
): Promise<ReceiptBitmap> {
	if (typeof document === 'undefined') {
		return Promise.reject(
			new Error('renderSpecToReceiptBitmap فقط در مرورگر اجرا می‌شود.'),
		)
	}
	if (widthPx !== 576 && widthPx !== 384 && widthPx !== 420) {
		return Promise.reject(new Error(`عرضِ کاغذِ نامعتبر: ${widthPx}`))
	}
	const run = renderChain.then(() =>
		ensurePrintFonts().then(() => doRender(spec, widthPx)),
	)
	renderChain = run.catch(() => {})
	return run
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	const CHUNK = 0x8000
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
	}
	return btoa(binary)
}
