// src/utils/invoicePrint.ts
// round-12 — چاپ فاکتور سفارش برای پنل (ادمین اصلی / سطح ۲):
//  • اشپزخانه: اقلام بدون قیمت، جدول درشت برای خوانایی از دور
//  • فروش: اقلام + ریز مبلغ + مشخصات مشتری + QR پیک (فقط ارسال با پیک)
// QR روی «نسخهٔ فروش مشتری» چاپ می‌شود (نه سالن/اشپزخانه) — پیک با دوربین
// گوشی آن را اسکن کرده و به /courier/scan/… می‌رسد.

import { type PrintDocumentSpec, printHtmlDocument } from '#/lib/printDocument'
import type { StaffInvoice } from '#/server/admin'
import { formatDate, formatPrice } from '#/utils/format'
import { qrSvgMarkup } from '#/utils/qrSvg'

const DELIVERY_LABEL: Record<StaffInvoice['deliveryType'], string> = {
	DELIVERY: 'ارسال با پیک',
	PICKUP: 'بیرون‌بر (تحویل حضوری)',
	DINE_IN: 'سرو در سالن',
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

function kitchenSection(inv: StaffInvoice, pageBreak: boolean) {
	return {
		heading: `فاکتور اشپزخانه — سفارش ${inv.orderId}`,
		metaLines: [
			`تاریخ: ${formatDate(inv.date)}`,
			`نوع تحویل: ${DELIVERY_LABEL[inv.deliveryType]}`,
		],
		bigTables: true,
		tables: [
			{
				head: ['محصول', 'سایز', 'تعداد'],
				rows: inv.items.map((i) => [
					i.name,
					i.sizeName ?? '—',
					i.quantity.toLocaleString('fa-IR'),
				]),
			},
		],
		note: inv.customerNote ? `نکته مشتری: ${inv.customerNote}` : undefined,
		pageBreakAfter: pageBreak,
	}
}

async function salesSection(inv: StaffInvoice) {
	const rows = inv.items.map((i) => [
		i.name,
		i.sizeName ?? '—',
		i.quantity.toLocaleString('fa-IR'),
		formatPrice(i.price),
		formatPrice(i.price * i.quantity),
	])
	const b = inv.breakdown
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
		...(b.walletDeduction > 0
			? [{ label: 'کسر از کیف پول', value: formatPrice(b.walletDeduction) }]
			: []),
		{ label: 'مبلغ نهایی', value: `${formatPrice(b.totalAmount)} تومان` },
	]

	const meta = [
		`تاریخ: ${formatDate(inv.date)}`,
		`نوع تحویل: ${DELIVERY_LABEL[inv.deliveryType]}`,
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

	return {
		heading: `فاکتور فروش — سفارش ${inv.orderId}`,
		metaLines: meta,
		stats,
		tables: [
			{
				head: ['محصول', 'سایز', 'تعداد', 'قیمت واحد (تومان)', 'جمع (تومان)'],
				rows,
			},
		],
		note: inv.customerNote ? `نکته مشتری: ${inv.customerNote}` : undefined,
		qr,
	}
}

/** ساخت PrintDocumentSpec فاکتور — بدون I/O اگر QR لازم نباشد */
async function buildSpec(
	inv: StaffInvoice,
	kinds: InvoiceKind[],
): Promise<PrintDocumentSpec> {
	const sections = []
	if (kinds.includes('kitchen')) {
		sections.push(kitchenSection(inv, kinds.includes('sales')))
	}
	if (kinds.includes('sales')) {
		sections.push(await salesSection(inv))
	}
	return {
		fileName: `sinshin-invoice-${inv.orderId}`,
		brand: 'سین‌شین فودپارک',
		sections,
		footerNote: 'از خرید شما سپاسگزاریم',
	}
}

/** چاپ فاکتور(های) سفارش — وفق داده + چاپ در سند مستقل */
export async function printOrderInvoices(
	inv: StaffInvoice,
	kinds: InvoiceKind[],
): Promise<void> {
	const spec = await buildSpec(inv, kinds)
	printHtmlDocument(spec)
}
