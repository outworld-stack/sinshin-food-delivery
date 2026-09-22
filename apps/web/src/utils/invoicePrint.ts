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

import {
        type PrintDocumentSpec,
        printHtmlDocument,
        printHtmlDocumentQueue,
} from '#/lib/printDocument'
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

/** نام محصول + سایز در یک سلول — جدول باریک رسیدی */
function itemLabel(name: string, sizeName: string | null): string {
        return sizeName ? `${name} (${sizeName})` : name
}

function kitchenSection(inv: StaffInvoice) {
        return {
                heading: `اشپزخانه — ${inv.orderId}`,
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
        }
}

async function salesSection(inv: StaffInvoice) {
        const rows = inv.items.map((i) => [
                itemLabel(i.name, i.sizeName),
                i.quantity.toLocaleString('fa-IR'),
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

/** یک spec مستقل به‌ازای هر نوع فاکتور — فرمت رسیدی 80mm (round-14) */
async function buildSpecs(
        inv: StaffInvoice,
        kinds: InvoiceKind[],
): Promise<PrintDocumentSpec[]> {
        const specs: PrintDocumentSpec[] = []
        if (kinds.includes('kitchen')) {
                specs.push({
                        fileName: `sinshin-kitchen-${inv.orderId}`,
                        brand: 'سین‌شین فودپارک',
                        paper: 'receipt',
                        sections: [kitchenSection(inv)],
                        footerNote: 'فاکتور اشپزخانه — بدون قیمت',
                })
        }
        if (kinds.includes('sales')) {
                specs.push({
                        fileName: `sinshin-sales-${inv.orderId}`,
                        brand: 'سین‌شین فودپارک',
                        paper: 'receipt',
                        sections: [await salesSection(inv)],
                        footerNote: 'از خرید شما سپاسگزاریم',
                })
        }
        return specs
}

/**
 * چاپ فاکتور(های) سفارش — هر نوع فاکتور = یک سند چاپ جداگانه.
 * چند فاکتور → صف چاپ: دیالوگ اول (مثلاً اشپزخانه) بسته شود، دومی (فروش)
 * خودکار باز می‌شود — هر کدام را روی پرینتر خودش بفرستید.
 */
export async function printOrderInvoices(
        inv: StaffInvoice,
        kinds: InvoiceKind[],
): Promise<void> {
        const specs = await buildSpecs(inv, kinds)
        if (specs.length <= 1) {
                printHtmlDocument(specs[0]!)
                return
        }
        await printHtmlDocumentQueue(specs)
}
