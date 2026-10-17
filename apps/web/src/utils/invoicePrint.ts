// src/utils/invoicePrint.ts
// round-12 — چاپ فاکتور سفارش برای پنل (ادمین اصلی / سطح ۲):
//  • اشپزخانه: اقلام بدون قیمت، جدول درشت برای خوانایی از دور
//  • فروش: اقلام + ریز مبلغ + مشخصات مشتری + QR پیک (فقط ارسال با پیک)
// QR روی «نسخهٔ فروش مشتری» چاپ می‌شود (نه سالن/اشپزخانه) — پیک با دوربین
// گوشی آن را اسکن کرده و به /courier/scan/… می‌رسد.
//
// round-13 — هر فاکتور سندِ چاپ «جداگانه» است: بعد از تایید سفارش،
// فاکتور اشپزخانه و فاکتور فروش پشت‌سرهم (هر کدام یک پنجرهٔ چاپ) ارسال
// می‌شوند تا هر کدام روی پرینتر خودش (آشپزخانه / میز بیرون‌بر) چاپ شود.
//
// round-14 — فرمت «رسیدی 80mm»: پرینترهای مغازه ستونی‌اند و از موبایل چاپ
// می‌گیرند — چاپ A4 دسکتاپی روی آن‌ها بریده/ریز می‌شد. حالا هر دو فاکتور
// با paper:'receipt' ساخته می‌شوند: عرض 80mm، طول رول (auto)، آمار به‌صورت
// ردیف عمودی، QR وسط‌چین. جدول فروش هم باریک‌تر شد (سایز داخل نام محصول).
//
// stage-85 — چاپِ «مستقیم بدون دیالوگ»: هر نوع فاکتور می‌تواند پرینترِ
// پیش‌فرضِ خودش را داشته باشد (QZ Tray محلی — lib/printAgent): فاکتورِ
// دارایِ پرینترِ منتخب بی‌دیالوگ چاپ می‌شود، بقیه همان مسیرِ مرورگر را
// می‌روند؛ خطای مسیرِ مستقیم هرگز سفارشِ چاپ را نمی‌کُشد — همان فاکتور
// با دیالوگِ مرورگر چاپ می‌شود و پیامِ خطا برگردانده می‌شود. ساختِ
// specها عمومی شد (buildInvoicePrintSpecs) تا «پیش‌نمایش» مودال از همان
// موتور استفاده کند (عینِ چیزی که چاپ می‌شود).

import { agentPrintHtml } from '#/lib/printAgent'
import {
	buildPrintDocumentHtml,
	measureReceiptHtmlHeightPx,
	type PrintDocumentSpec,
	printHtmlDocumentAsync,
	receiptPxToMm,
} from '#/lib/printDocument'
import type { StaffInvoice } from '#/server/admin'
import { faNum, formatDate, formatPrice, formatTime } from '#/utils/format'
import { qrSvgMarkup } from '#/utils/qrSvg'

const DELIVERY_LABEL: Record<StaffInvoice['deliveryType'], string> = {
	DELIVERY: 'ارسال با پیک',
	PICKUP: 'بیرون‌بر (تحویل حضوری)',
	DINE_IN: 'سرو در سالن',
}

/** stage-84 — روز هفته‌ی شمسی + تاریخ کامل + ساعت (زمان/ساعت/روز/تاریخ قید فاکتورها)
 *  ترمیم اسکنِ استیج-۸۴: inv.date در زمانِ اجرا رشتهٔ ISO است (قراردادِ Date فقط
 *  تایپ است — JSON بدون reviver می‌آید) و Intl با رشته «Invalid time value»
 *  می‌دهد و کلِ چاپ فاکتور می‌افتاد؛ اینجا نرمال می‌کنیم (الگوی safeDate). */
function invoiceWhenLine(date: Date): string {
	const d = date instanceof Date ? date : new Date(date)
	if (!Number.isFinite(d.getTime())) {
		// تاریخِ خراب فاکتور را نمی‌کشد — فقط خطِ زمان حذف می‌شود
		return formatDate(date)
	}
	const weekday = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' }).format(
		d,
	)
	return `${weekday}، ${formatDate(d)} — ساعت ${formatTime(d)}`
}

export type InvoiceKind = 'kitchen' | 'sales'

/** لینک اسکن پیک — همان فرمول صفحهٔ جزئیات سفارش ادمین */
export function courierScanUrl(order: {
	orderId: string
	courierId: string | null
	courierSecurityEnabled: boolean
}): string {
	const suffix =
		order.courierSecurityEnabled && order.courierId
			? `?courier=${order.courierId}`
			: ''
	return `${window.location.origin}/courier/scan/${order.orderId}${suffix}`
}

/** نام محصول + سایز در یک سلول — جدول باریک رسیدی */
function itemLabel(name: string, sizeName: string | null): string {
	return sizeName ? `${name} (${sizeName})` : name
}

function kitchenSection(inv: StaffInvoice) {
	return {
		heading: `اشپزخانه — ${inv.orderId}`,
		metaLines: [
			// stage-84 — زمان/روز/تاریخ + ساعت قید می‌شود
			`زمان سفارش: ${invoiceWhenLine(inv.date)}`,
			`نوع سفارش: ${DELIVERY_LABEL[inv.deliveryType]}`,
		],
		bigTables: true,
		tables: [
			{
				head: ['محصول', 'سایز', 'تعداد'],
				rows: inv.items.map((i) => [
					i.name,
					i.sizeName ?? '—',
					faNum(i.quantity),
				]),
			},
		],
		note: inv.customerNote ? `نکته مشتری: ${inv.customerNote}` : undefined,
	}
}

async function salesSection(inv: StaffInvoice) {
	const rows = inv.items.map((i) => [
		itemLabel(i.name, i.sizeName),
		faNum(i.quantity),
		formatPrice(i.price * i.quantity),
	])
	const b = inv.breakdown
	// stage-77 (P2-5) — حسابِ رسید سر و ته می‌خورد: قرارداد سرور:
	// totalAmount = کلِ سفارش «قبل از» کیف پول؛ amountPaidOnline = بعد از
	// آن. قبلاً «کسر از کیف پول» ردیفِ منفی بود ولی «مبلغ نهایی» =
	// totalAmount چاپ می‌شد ⇒ جمعِ ردیف‌ها با ردیفِ آخر دقیقاً به‌اندازه‌ی
	// walletDeduction نمی‌خواند (رسیدِ فروش، مبنای تسویه صندوق/پی‌اس‌پی).
	// حالا: مبلغ کل سفارش → کسر کیف پول → مبلغ نهایی (پرداخت آنلاین).
	const stats = [
		{ label: 'جمع اقلام', value: `${formatPrice(b.foodTotal)} تومان` },
		...(b.discount > 0
			? [{ label: 'تخفیف', value: `−${formatPrice(b.discount)}` }]
			: []),
		...(b.deliveryFee > 0
			? [{ label: 'هزینه ارسال', value: formatPrice(b.deliveryFee) }]
			: []),
		...(b.packagingFee > 0
			? [{ label: 'بسته‌بندی', value: formatPrice(b.packagingFee) }]
			: []),
		{ label: 'مبلغ کل سفارش', value: `${formatPrice(b.totalAmount)} تومان` },
		...(b.walletDeduction > 0
			? [
					{
						label: 'کسر از کیف پول',
						value: `−${formatPrice(b.walletDeduction)}`,
					},
				]
			: []),
		{
			label: 'مبلغ نهایی (پرداخت آنلاین)',
			value: `${formatPrice(b.amountPaidOnline)} تومان`,
		},
	]

	const meta = [
		// stage-84 — زمان/روز/تاریخ + ساعت + نوع سفارش (هر دو فاکتور)
		`زمان سفارش: ${invoiceWhenLine(inv.date)}`,
		`نوع سفارش: ${DELIVERY_LABEL[inv.deliveryType]}`,
		inv.userName ? `مشتری: ${inv.userName}` : null,
		inv.userPhone ? `موبایل: ${inv.userPhone}` : null,
		inv.deliveryType === 'DELIVERY' && inv.address
			? `آدرس: ${inv.address}`
			: null,
		inv.courierName
			? `پیک: ${inv.courierName}${inv.courierPhone ? ` — ${inv.courierPhone}` : ''}`
			: null,
	].filter((x): x is string => !!x)

	// QR پیک — فقط سفارش‌های ارسالی، فقط روی نسخهٔ فروش
	const qr =
		inv.deliveryType === 'DELIVERY'
			? {
					svg: await qrSvgMarkup(courierScanUrl(inv), 220),
					orderId: inv.orderId,
					caption: inv.courierSecurityEnabled
						? 'این QR فقط برای پیک تخصیص‌یافتهٔ این سفارش قابل اسکن است.'
						: 'پیک: برای شروع ارسال، این QR را با گوشی خود اسکن کنید.',
				}
			: undefined

	// round-14 — یادداشت ادمین (تاییدکننده): فقط اگر سوییچ «چاپ در فاکتور
	// بیرون‌بر» موقع تایید روشن شده باشد، روی این نسخه چاپ می‌شود.
	const adminNote =
		inv.internalNote && inv.internalNotePrint
			? `یادداشت فروشگاه: ${inv.internalNote}`
			: undefined
	const noteParts = [
		inv.customerNote ? `نکته مشتری: ${inv.customerNote}` : null,
		adminNote,
	].filter((x): x is string => !!x)

	return {
		heading: `فاکتور فروش — ${inv.orderId}`,
		metaLines: meta,
		stats,
		tables: [
			{
				head: ['محصول', 'تعداد', 'جمع (تومان)'],
				rows,
			},
		],
		note: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
		qr,
	}
}

/** یک spec مستقل به‌ازای هر نوع فاکتور — فرمت رسیدی 80mm (round-14).
 *  stage-84 — استایل حرارتی mono (مشکی بولد + سفیدرومشکی) + طولِ چاپ
 *  برابرِ طولِ فاکتور (fitHeight) — نه کلِ رول.
 *  stage-85 — عمومی شد: مودالِ چاپ از همین خروجی «پیش‌نمایش» می‌سازد. */
export interface InvoicePrintSpec {
	kind: InvoiceKind
	spec: PrintDocumentSpec
}

export async function buildInvoicePrintSpecs(
	inv: StaffInvoice,
	kinds: InvoiceKind[],
): Promise<InvoicePrintSpec[]> {
	const specs: InvoicePrintSpec[] = []
	if (kinds.includes('kitchen')) {
		specs.push({
			kind: 'kitchen',
			spec: {
				fileName: `sinshin-kitchen-${inv.orderId}`,
				brand: 'سین‌شین فودپارک',
				paper: 'receipt',
				receiptStyle: 'mono',
				fitHeight: true,
				sections: [kitchenSection(inv)],
				footerNote: 'فاکتور اشپزخانه — بدون قیمت',
			},
		})
	}
	if (kinds.includes('sales')) {
		specs.push({
			kind: 'sales',
			spec: {
				fileName: `sinshin-sales-${inv.orderId}`,
				brand: 'سین‌شین فودپارک',
				paper: 'receipt',
				receiptStyle: 'mono',
				fitHeight: true,
				sections: [await salesSection(inv)],
				footerNote: 'از خرید شما سپاسگزاریم',
			},
		})
	}
	return specs
}

/** نتیجهٔ چاپ — مودال بر اساسِ آن توستِ درست را می‌سازد */
export interface InvoicePrintResult {
	/** فاکتورهایی که بی‌دیالوگ مستقیم چاپ شدند */
	direct: number
	/** فاکتورهایی که با دیالوگِ مرورگر چاپ شدند */
	dialogs: number
	/** خطاهای مسیرِ مستقیم (هر فاکتورِ خطاخورده با دیالوگ جایگزین شد) */
	agentErrors: string[]
}

/**
 * چاپ فاکتور(های) سفارش — هر نوع فاکتور = یک سند چاپ جداگانه.
 *  • بدونِ پرینترِ منتخب: همان صفِ چاپِ قبل — دیالوگ اول (مثلاً اشپزخانه)
 *    بسته شود، دومی (فروش) خودکار باز می‌شود.
 *  • stage-85 — باِ agentPrinters: فاکتورِ دارایِ پرینترِ منتخب مستقیم و
 *    بی‌دیالوگ به همان پرینتر فرستاده می‌شود (QZ Tray)؛ خطا = جایگزینیِ
 *    همان فاکتور با مسیرِ مرورگر (سفارشِ چاپ هرگز نمی‌میرد).
 */
export async function printOrderInvoices(
	inv: StaffInvoice,
	kinds: InvoiceKind[],
	opts?: { agentPrinters?: Partial<Record<InvoiceKind, string>> },
): Promise<InvoicePrintResult> {
	const items = await buildInvoicePrintSpecs(inv, kinds)
	const result: InvoicePrintResult = { direct: 0, dialogs: 0, agentErrors: [] }
	const dialogQueue: PrintDocumentSpec[] = []
	for (const item of items) {
		const target = opts?.agentPrinters?.[item.kind]
		if (target) {
			try {
				const html = buildPrintDocumentHtml(item.spec)
				const heightPx = await measureReceiptHtmlHeightPx(html)
				const heightMm =
					heightPx !== null ? receiptPxToMm(heightPx) + 3 : undefined
				await agentPrintHtml(target, html, {
					heightMm,
					jobName: item.spec.fileName,
				})
				result.direct += 1
				continue
			} catch (err) {
				result.agentErrors.push(
					err instanceof Error
						? `چاپ مستقیم «${item.kind === 'kitchen' ? 'آشپزخانه' : 'فروش'}» ناموفق: ${err.message}`
						: `چاپ مستقیم «${item.kind === 'kitchen' ? 'آشپزخانه' : 'فروش'}» ناموفق`,
				)
			}
		}
		dialogQueue.push(item.spec)
	}
	for (let i = 0; i < dialogQueue.length; i++) {
		await printHtmlDocumentAsync(dialogQueue[i] as PrintDocumentSpec)
		result.dialogs += 1
		if (i < dialogQueue.length - 1) {
			// مکث کوتاه بین دیالوگ‌ها — برخی مرورگرها برای بازسازی
			// فعال‌سازی به چند صد میلی‌ثانیه نیاز دارند
			await new Promise((r) => setTimeout(r, 400))
		}
	}
	return result
}
