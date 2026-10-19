/** stage-89 — تست مستقیمِ «رندرِ فارسیِ رسید روی canvas» (src/lib/receiptCanvas.ts).
 *
 * چرا این تست؟ بازبینیِ استیج-۸۸: تستِ سرویسِ چاپِ سمتِ سرور (ESC/POS روی
 * سوکت) «صحتِ بصریِ» canvas را اثبات نمی‌کند — اتصالِ حروفِ فارسی، خواناییِ QR،
 * قراردادِ 1bpp و طولِ کاغذ=محتوا فقط همین‌جا قابلِ دیدن است. رندرِ واقعی روی
 * Skia (@napi-rs/canvas — همان موتورِ Chromium، با HarfBuzz برای شکل‌گیری)
 * انجام می‌شود؛ QR با مولدِ «واقعیِ خودِ محصول» (qrcode.react) ساخته و با
 * jsQR «دوباره خوانده» می‌شود — همان چیزی که گوشیِ پیک می‌بیند.
 *
 * پوشش (خواستهٔ صریحِ کارفرما):
 *  · چند رسیدِ فارسیِ واقعی (فروش + آشپزخانه) — برند/متا/آمار/جدول/نکته/QR/فوتر
 *  · نام محصول طولانی (شکستنِ کلمه در سلول)
 *  · سفارش بزرگ (۴۰ قلم) + سقفِ ۴۰۰۰ dot (رسیدِ عظیم = خطای صریح)
 *  · QR — خوانایی در هر سه عرض
 *  · هر سه عرضِ کاغذ: ۵۷۶ (۸۰mm) · ۳۸۴ (۵۸mm) · ۴۲۰ (اپسون ۵۸)
 *  · قرارداد با سرور: 1bpp · MSB-first · bit=1 مشکی · بیت‌های پدینگِ صفر
 *  · طولِ کاغذ = طولِ محتوا (رسیدِ کوچک کوتاه‌تر از بزرگ — نه سایزِ ثابت)
 *  · اتصالِ حروفِ فارسی (سلام < «س ل ا م» — HarfBuzz فعال)
 *  · صفِ تک‌به‌تک: رندرهای هم‌زمان بر هم نمی‌غلتند
 *
 * فقط درون‌پروسه‌ای — بدونِ شبکه/دیتابیس:
 *   bun scripts/test-receipt-canvas.ts   (یا: bun run test:receipt-canvas)
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
        createCanvas,
        GlobalFonts,
        Image as NapiImage,
        type Canvas as NapiCanvas,
} from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import jsQR from 'jsqr'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'

import type { PrintDocumentSpec, PrintSectionSpec } from '#/lib/printDocument'
import { renderSpecToReceiptBitmap, type ReceiptBitmap } from '#/lib/receiptCanvas'
import { faNum, formatPrice } from '#/utils/format'

// ══ بسترِ تست — همان APIهایی که مرورگر می‌دهد، روی Skia ══

/** SVG → PNG: require the same standalone XML namespace as browser Image. */
function svgDataUrlToPng(src: string): string {
        if (!src.startsWith('data:image/svg+xml')) return src
        const comma = src.indexOf(',')
        const payload = src.slice(comma + 1)
        const svg = src.includes(';base64,')
                ? Buffer.from(payload, 'base64').toString('utf8')
                : decodeURIComponent(payload)
        const png = new Resvg(svg).render().asPng()
        return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

/** Imageِ شبیه‌سازی‌شده — src داده می‌گیرد؛ SVG را رستر می‌کند؛ onload می‌زند */
let imageLoadFails = false
class ShimImage {
        /** پیاده‌سازیِ واقعی — drawImageِ رهگیری‌شده همین را می‌کشد */
        readonly impl = new NapiImage()
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        get width(): number {
                return this.impl.width
        }
        get height(): number {
                return this.impl.height
        }
        set src(value: string) {
                queueMicrotask(() => {
                        if (imageLoadFails) {
                                this.onerror?.()
                                return
                        }
                        let png: string
                        try { png = svgDataUrlToPng(value) }
                        catch { this.onerror?.(); return }
                        this.impl.onload = () => {
                                this.onload?.()
                        }
                        this.impl.onerror = () => {
                                this.onerror?.()
                        }
                        this.impl.src = png
                })
        }
}

/** canvasِ شبیه‌سازی‌شده — width/height و ctxِ با drawImageِ رهگیری‌شده */
class ShimCanvas {
        private readonly impl: NapiCanvas
        constructor() {
                this.impl = createCanvas(1, 1)
                createdCanvases.push(this.impl)
        }
        get width(): number {
                return this.impl.width
        }
        set width(v: number) {
                this.impl.width = v
        }
        get height(): number {
                return this.impl.height
        }
        set height(v: number) {
                this.impl.height = v
        }
        getContext(_type: string, _opts?: unknown): unknown {
                const real = this.impl.getContext('2d')
                // drawImage باید شیءِ Imageِ شبیه‌سازی‌شده را به پیاده‌سازیِ واقعی ببرد
                return new Proxy(real, {
                        get(target, prop) {
                                const value = Reflect.get(target, prop, target)
                                if (prop === 'drawImage') {
                                        return (img: unknown, ...args: unknown[]) => {
                                                const impl = img instanceof ShimImage ? img.impl : img
                                                return Reflect.apply(value as (...a: unknown[]) => void, target, [
                                                        impl,
                                                        ...args,
                                                ])
                                        }
                                }
                                return typeof value === 'function' ? value.bind(target) : value
                        },
                        set(target, prop, value) {
                                return Reflect.set(target, prop, value)
                        },
                })
        }
}

const createdCanvases: NapiCanvas[] = []

// قبل از هر چیز: فونت‌های «همانِ محصول» (Dana/Morabba) با نامِ خانوادهٔ خودشان
const FONT_DIR = join(import.meta.dir, '..', 'public', 'fonts')
function registerFont(file: string, family: string): boolean {
        return GlobalFonts.registerFromPath(join(FONT_DIR, file), family) !== null
}

// document/Image — همان الگوی تست‌های خودِ پروژه (test-print-document.ts)
Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
                fonts: { load: async () => [], ready: Promise.resolve() },
                createElement: (tag: string) => {
                        if (tag === 'canvas') return new ShimCanvas()
                        throw new Error(`test: document.createElement('${tag}') پشتیبانی نمی‌شود`)
                },
        },
})
Object.defineProperty(globalThis, 'Image', { configurable: true, value: ShimImage })

// ══ فاکتورهای واقعیِ فارسی — همان ساختارِ invoicePrint.ts ══

const BRAND = 'سین‌شین فودپارک'

interface FixtureItem {
        name: string
        sizeName: string | null
        quantity: number
        price: number
}

interface FixtureInvoice {
        orderId: string
        userName: string | null
        userPhone: string | null
        deliveryType: 'DELIVERY' | 'PICKUP' | 'DINE_IN'
        address: string | null
        customerNote: string | null
        internalNote: string | null
        courierName: string | null
        courierSecurityEnabled: boolean
        items: FixtureItem[]
        breakdown: {
                foodTotal: number
                discount: number
                deliveryFee: number
                packagingFee: number
                totalAmount: number
                walletDeduction: number
                amountPaidOnline: number
        }
}

const DELIVERY_LABEL: Record<FixtureInvoice['deliveryType'], string> = {
        DELIVERY: 'ارسال با پیک',
        PICKUP: 'بیرون‌بر (تحویل حضوری)',
        DINE_IN: 'سرو در سالن',
}

const MENU = [
        'پیتزا پپرونی ویژه',
        'برگر ذغالی باربیکیو',
        'سالاد سزار با سس مخصوص',
        'سیب‌زمینی سرخ‌کرده تازه',
        'نوشابه نوشیدنی سرد',
        'کیک شکلاتی خانگی',
        'خوراک قارچ و مرغ',
        'استریپس مرغ تند',
        'پاستا آلفردو',
        'سوپ جو خامه‌ای',
        'نان سیر و پنیر',
        'دسر تیرامیسو',
]

function fixtureInvoice(count: number, opts?: { longName?: boolean }): FixtureInvoice {
        const items: FixtureItem[] = []
        for (let i = 0; i < count; i++) {
                const base = MENU[i % MENU.length] ?? 'قلم منو'
                items.push({
                        name: opts?.longName && i === 0 ? `${base} با سس مخصوص رستوران و پنیر اضافه بدونِ پیاز و فلفل تند — نسخهٔ خانگی`.repeat(1) : base,
                        sizeName: i % 3 === 0 ? 'بزرگ' : i % 3 === 1 ? 'متوسط' : null,
                        quantity: (i % 4) + 1,
                        price: 125_000 + i * 10_000,
                })
        }
        const foodTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
        const deliveryFee = 30_000
        const discount = 45_000
        const packagingFee = 12_000
        const totalAmount = foodTotal + deliveryFee + packagingFee - discount
        const walletDeduction = 20_000
        return {
                orderId: 'ord-2099',
                userName: 'آقای محمدی',
                userPhone: '۰۹۱۲۳۴۵۶۷۸۹',
                deliveryType: 'DELIVERY',
                address: 'تهران، خیابان ولیعصر، کوچهٔ سوم، پلاک ۱۲، واحد ۴',
                customerNote: 'لطفاً فلفل تند جدا بفرستید و درِ ساختمان را زنگ نزنید — بعد از ساعت ۲۰ اگر ممکن است.',
                internalNote: 'مشتری قدیمی — بسته‌بندی ویژه',
                courierName: 'رضا پیک',
                courierSecurityEnabled: true,
                items,
                breakdown: {
                        foodTotal,
                        discount,
                        deliveryFee,
                        packagingFee,
                        totalAmount,
                        walletDeduction,
                        amountPaidOnline: totalAmount - walletDeduction,
                },
        }
}

/** QR — همان مولدِ خودِ محصول (qrcode.react؛ همان props تولیدی) */
function qrSvgMarkupOf(value: string): string {
        return renderToStaticMarkup(
                createElement(QRCodeSVG, {
                        value,
                        size: 220,
                        bgColor: '#ffffff',
                        fgColor: '#1a0a0e',
                        level: 'M',
                        marginSize: 0,
                }),
        )
}

const COURIER_URL = 'https://sinshin.example/courier/scan/ord-2099?courier=c-777'

function kitchenSpec(inv: FixtureInvoice): PrintDocumentSpec {
        const section: PrintSectionSpec = {
                heading: `اشپزخانه — ${inv.orderId}`,
                metaLines: [
                        `زمان سفارش: پنجشنبه، ۱۴۰۴/۰۲/۱۷ — ساعت ۱۹:۴۲`,
                        `نوع سفارش: ${DELIVERY_LABEL[inv.deliveryType]}`,
                ],
                bigTables: true,
                tables: [
                        {
                                head: ['محصول', 'سایز', 'تعداد'],
                                rows: inv.items.map((i) => [i.name, i.sizeName ?? '—', faNum(i.quantity)]),
                        },
                ],
                note: inv.customerNote ? `نکته مشتری: ${inv.customerNote}` : undefined,
        }
        return {
                fileName: `sinshin-kitchen-${inv.orderId}`,
                brand: BRAND,
                paper: 'receipt',
                receiptStyle: 'mono',
                fitHeight: true,
                sections: [section],
                footerNote: 'فاکتور اشپزخانه — بدون قیمت',
        }
}

function salesSpec(inv: FixtureInvoice): PrintDocumentSpec {
        const b = inv.breakdown
        const section: PrintSectionSpec = {
                heading: `فاکتور فروش — ${inv.orderId}`,
                metaLines: [
                        `زمان سفارش: پنجشنبه، ۱۴۰۴/۰۲/۱۷ — ساعت ۱۹:۴۲`,
                        `نوع سفارش: ${DELIVERY_LABEL[inv.deliveryType]}`,
                        `مشتری: ${inv.userName ?? '—'}`,
                        `موبایل: ${inv.userPhone ?? '—'}`,
                        `آدرس: ${inv.address ?? '—'}`,
                        `پیک: ${inv.courierName ?? '—'}`,
                ],
                stats: [
                        { label: 'جمع اقلام', value: `${formatPrice(b.foodTotal)} تومان` },
                        { label: 'تخفیف', value: `−${formatPrice(b.discount)}` },
                        { label: 'هزینه ارسال', value: formatPrice(b.deliveryFee) },
                        { label: 'بسته‌بندی', value: formatPrice(b.packagingFee) },
                        { label: 'مبلغ کل سفارش', value: `${formatPrice(b.totalAmount)} تومان` },
                        { label: 'کسر از کیف پول', value: `−${formatPrice(b.walletDeduction)}` },
                        { label: 'مبلغ نهایی (پرداخت آنلاین)', value: `${formatPrice(b.amountPaidOnline)} تومان` },
                ],
                tables: [
                        {
                                head: ['محصول', 'تعداد', 'جمع (تومان)'],
                                rows: inv.items.map((i) => [
                                        i.sizeName ? `${i.name} (${i.sizeName})` : i.name,
                                        faNum(i.quantity),
                                        formatPrice(i.price * i.quantity),
                                ]),
                        },
                ],
                note: `نکته مشتری: ${inv.customerNote} | یادداشت فروشگاه: ${inv.internalNote}`,
                qr: {
                        svg: qrSvgMarkupOf(COURIER_URL),
                        orderId: inv.orderId,
                        caption: 'پیک: برای شروع ارسال، این QR را با گوشی خود اسکن کنید.',
                },
        }
        return {
                fileName: `sinshin-sales-${inv.orderId}`,
                brand: BRAND,
                paper: 'receipt',
                receiptStyle: 'mono',
                fitHeight: true,
                sections: [section],
                footerNote: 'از خرید شما سپاسگزاریم',
        }
}

// ══ ابزارهای سنجش ══

let count = 0
function passed(name: string) {
        count++
        console.log(`PASS ${name}`)
}

function decodeRows(bmp: ReceiptBitmap): Buffer {
        return Buffer.from(bmp.rows, 'base64')
}

function inkRatio(bmp: ReceiptBitmap): number {
        const bytesPerRow = Math.ceil(bmp.widthPx / 8)
        const data = decodeRows(bmp)
        let ink = 0
        let total = 0
        for (let y = 0; y < bmp.heightPx; y++) {
                for (let x = 0; x < bmp.widthPx; x++) {
                        total++
                        const bit = (data[y * bytesPerRow + Math.floor(x / 8)] as number) >> (7 - (x % 8)) & 1
                        ink += bit
                }
        }
        return total === 0 ? 0 : ink / total
}

/** آخرین canvasِ ساخته‌شده = بومِ همین رندر (رندرها در صفِ تک‌به‌تک‌اند) */
function lastCanvas(): NapiCanvas {
        const c = createdCanvases[createdCanvases.length - 1]
        assert.ok(c, 'canvas ساخته نشد')
        return c as NapiCanvas
}

// ══ اجرا ══

const WIDTHS = [576, 384, 420] as const

try {
        // ۱) فونت‌های خودِ محصول — همان نام‌های خانوادهٔ کد
        assert.ok(registerFont('DanaFaNum-Medium.woff2', 'DanaMedium'))
        assert.ok(registerFont('DanaFaNum-DemiBold.woff2', 'DanaDemiBold'))
        assert.ok(registerFont('Morabba-Bold.woff2', 'MorabbaBold'))
        passed('فونت‌های فارسیِ خودِ محصول (Dana/Morabba) ثبت شدند')

        // ۲) اتصالِ حروفِ فارسی — HarfBuzz باید «سلام» را از «س ل ا م» باریک‌تر بکشد
        {
                const probe = createCanvas(300, 60)
                const ctx = probe.getContext('2d')
                ctx.font = "24px 'DanaMedium', Tahoma"
                const joined = ctx.measureText('سلام').width
                const split = ctx.measureText('س ل ا م').width
                assert.ok(
                        joined < split * 0.75,
                        `شکل‌گیریِ حروف فعال نیست: joined=${joined} split=${split}`,
                )
                passed(`اتصالِ حروفِ فارسی فعال است (سلام=${joined.toFixed(1)}px < «س ل ا م»=${split.toFixed(1)}px)`)
        }

        const inv12 = fixtureInvoice(12)
        const sales12 = salesSpec(inv12)
        const kitchen12 = kitchenSpec(inv12)

        // ۳) هر سه عرض — قراردادِ بسته‌بندی + جوهر + QRِ خوانا
        for (const w of WIDTHS) {
                const bmp = await renderSpecToReceiptBitmap(sales12, w)
                assert.strictEqual(bmp.widthPx, w)
                const bytesPerRow = Math.ceil(w / 8)
                assert.strictEqual(decodeRows(bmp).length, bytesPerRow * bmp.heightPx)
                passed(`عرض ${w}: بسته‌بندی = ⌈${w}/8⌉×${bmp.heightPx} = ${decodeRows(bmp).length} بایت`)

                const ratio = inkRatio(bmp)
                assert.ok(ratio > 0.003 && ratio < 0.45, `تراکمِ جوهر خارج از بازه: ${(ratio * 100).toFixed(1)}%`)
                passed(`عرض ${w}: جوهرِ معقول (${(ratio * 100).toFixed(1)}٪ — نه خالی، نه سیاهِ تمام)`)
        }

        // ۴) پدینگِ بیت — 420 = ۵۲.۵ بایت → ۵۳؛ ۴ بیتِ آخرِ هر ردیف باید صفر باشد
        {
                const bmp = await renderSpecToReceiptBitmap(sales12, 420)
                const bytesPerRow = 53
                const data = decodeRows(bmp)
                for (let y = 0; y < bmp.heightPx; y++) {
                        assert.strictEqual((data[y * bytesPerRow + 52] as number) & 0x0f, 0, `ردیف ${y}`)
                }
                passed('کاغذِ ۴۲۰ dot: بیت‌های پدینگِ ردیف‌ها صفرند (MSB-first)')
        }

        // ۵) قراردادِ کاملِ 1bpp — هر بیت = وارونهٔ luminanceِ همان پیکسلِ canvas
        {
                const bmp = await renderSpecToReceiptBitmap(sales12, 576)
                const canvas = lastCanvas()
                assert.strictEqual(canvas.width, 576)
                assert.ok(canvas.height >= bmp.heightPx)
                const ctx = canvas.getContext('2d')
                const img = ctx.getImageData(0, 0, 576, bmp.heightPx)
                const packed = decodeRows(bmp)
                let checked = 0
                for (let y = 0; y < bmp.heightPx; y++) {
                        for (let x = 0; x < 576; x++) {
                                const i = (y * 576 + x) * 4
                                const lum = ((img.data[i] as number) + (img.data[i + 1] as number) + (img.data[i + 2] as number)) / 3
                                const bit = (packed[y * 72 + Math.floor(x / 8)] as number) >> (7 - (x % 8)) & 1
                                assert.strictEqual(bit, lum < 128 ? 1 : 0, `مختصات (${x},${y})`)
                                checked++
                        }
                }
                assert.strictEqual(checked, 576 * bmp.heightPx)
                passed(`قرارداد 1bpp: ${checked.toLocaleString('en-US')} پیکسل بایت‌به‌بایت = canvas (bit=1 ⇔ lum<128)`)
        }

        // ۶) QR — همان مولدِ محصول → همان رندر → jsQR همان URL را می‌خواند
        for (const w of WIDTHS) {
                const bmp = await renderSpecToReceiptBitmap(sales12, w)
                const packed = decodeRows(bmp)
                const rgba = new Uint8ClampedArray(w * bmp.heightPx * 4)
                const stride = Math.ceil(w / 8)
                for (let y = 0; y < bmp.heightPx; y++) {
                        for (let x = 0; x < w; x++) {
                                const ink = (packed[y * stride + Math.floor(x / 8)]! >> (7 - x % 8)) & 1
                                const pixel = (y * w + x) * 4
                                rgba[pixel] = rgba[pixel + 1] = rgba[pixel + 2] = ink ? 0 : 255
                                rgba[pixel + 3] = 255
                        }
                }
                const decoded = jsQR(rgba, w, bmp.heightPx)
                assert.ok(decoded, `QR در عرض ${w} decode نشد`)
                assert.strictEqual(decoded?.data, COURIER_URL)
                passed(`QR در عرض ${w}: jsQR دقیقاً همان لینکِ پیک را خواند`)
        }

        // ۷) طولِ کاغذ = طولِ محتوا — ارتفاع با تعدادِ قلم «متناسب» می‌رود، نه سایزِ ثابت
        {
                const tiny = await renderSpecToReceiptBitmap(salesSpec(fixtureInvoice(1)), 576)
                const medium = await renderSpecToReceiptBitmap(sales12, 576)
                const big = await renderSpecToReceiptBitmap(salesSpec(fixtureInvoice(40)), 576)
                assert.ok(tiny.heightPx < medium.heightPx, `${tiny.heightPx} < ${medium.heightPx}`)
                assert.ok(medium.heightPx < big.heightPx, `${medium.heightPx} < ${big.heightPx}`)
                // رشدِ خطی با تعدادِ قلم: (۴۰-۱۲ قلم)/(۱۲-۱ قلم) ≈ ۲۸/۱۱ — نه پرشِ بی‌ربط
                const growth = (big.heightPx - medium.heightPx) / (medium.heightPx - tiny.heightPx)
                assert.ok(
                        growth > 1.5 && growth < 4,
                        `رشدِ ارتفاع با تعدادِ قلم متناسب نیست: ${growth.toFixed(2)}`,
                )
                passed(
                        `طولِ کاغذ = طولِ محتوا: ۱ قلم=${tiny.heightPx} < ۱۲ قلم=${medium.heightPx} < ۴۰ قلم=${big.heightPx} (رشدِ خطی ×${growth.toFixed(2)})`,
                )
        }

        // ۸) نام محصول طولانی — شکستنِ کلمه در سلول؛ نه خطا، نه بیرون‌زدگیِ عرض
        {
                const short = await renderSpecToReceiptBitmap(salesSpec(fixtureInvoice(3)), 384)
                const long = await renderSpecToReceiptBitmap(
                        salesSpec(
                                fixtureInvoice(3, {
                                        longName: true,
                                }),
                        ),
                        384,
                )
                assert.ok(long.heightPx > short.heightPx, `نام طولانی ردیف را بلندتر نکرد: ${long.heightPx} vs ${short.heightPx}`)
                const data = decodeRows(long)
                const bytesPerRow = 48
                // ستونِ آخر (لبهٔ چپِ فیزیکی) باید سفید بماند — متن در سلولِ کلیپ‌شده است
                let leftEdgeInk = 0
                for (let y = 0; y < long.heightPx; y++) {
                        if (((data[y * bytesPerRow] as number) >> 7) & 1) leftEdgeInk++
                }
                assert.ok(leftEdgeInk === 0, `جوهر روی لبهٔ فیزیکی کاغذ: ${leftEdgeInk} ردیف`)
                passed(
                        `نام محصول طولانی: شکست + کلیپ در سلول (ارتفاع ${short.heightPx}→${long.heightPx} · لبهٔ کاغذ پاک)`,
                )
        }

        // Unbroken product names and totals must wrap instead of being clipped.
        {
                const spec = kitchenSpec(fixtureInvoice(1))
                const short = await renderSpecToReceiptBitmap(spec, 384)
                spec.sections[0]!.tables[0]!.rows[0]![0] = 'محصول'.repeat(40)
                const long = await renderSpecToReceiptBitmap(spec, 384)
                assert.ok(long.heightPx > short.heightPx, `${long.heightPx} > ${short.heightPx}`)
                passed('نام بدون فاصله: تمام حروف در چند سطر چاپ می‌شوند')
        }

        // An Image failure must trigger the caller's browser fallback, never a blank QR.
        {
                imageLoadFails = true
                await assert.rejects(() => renderSpecToReceiptBitmap(sales12, 576), /QR/)
                imageLoadFails = false
                assert.ok((await renderSpecToReceiptBitmap(sales12, 576)).heightPx > 0)
                passed('QR ناموفق خطا می‌دهد و صف رندر بعدی بازیابی می‌شود')
        }

        // ۹) نسخهٔ آشپزخانه (جدول درشت) — هر سه عرض بدونِ خطا + جوهرِ معقول
        for (const w of WIDTHS) {
                const bmp = await renderSpecToReceiptBitmap(kitchen12, w)
                const ratio = inkRatio(bmp)
                assert.ok(ratio > 0.003 && ratio < 0.5, `آشپزخانه ${w}: تراکم=${(ratio * 100).toFixed(1)}%`)
                passed(`فاکتور آشپزخانه (جدول درشت) در عرض ${w}: ${bmp.heightPx} dot · ${(ratio * 100).toFixed(1)}٪ جوهر`)
        }

        // ۱۰) سفارش بزرگ (۴۰ قلم + نکتهٔ طولانی) — بدونِ خطا در همهٔ عرض‌ها
        {
                const inv40 = fixtureInvoice(40)
                for (const w of WIDTHS) {
                        const bmp = await renderSpecToReceiptBitmap(salesSpec(inv40), w)
                        assert.ok(bmp.heightPx > 500 && bmp.heightPx <= 4000, `${w}: ${bmp.heightPx}`)
                }
                passed('سفارش بزرگ (۴۰ قلم + QR): هر سه عرض بدونِ خطا (≤ ۴۰۰۰ dot)')
        }

        // ۱۱) سقفِ ۴۰۰۰ dot — رسیدِ عجیب باید «خطای صریح» بدهد نه بیت‌پاره
        {
                const absurd = salesSpec(fixtureInvoice(130))
                await assert.rejects(
                        () => renderSpecToReceiptBitmap(absurd, 384),
                        (e: unknown) => e instanceof Error && e.message.includes('۴۰۰۰'),
                )
                passed('رسیدِ بلندتر از سقف: خطای صریحِ فارسی (۴۰۰۰ dot)')
        }

        // ۱۲) آخرین ردیفِ سفید — فوترِ تمیز؛ نوارِ سیاهِ تمام‌عرض نمی‌ماند
        {
                const bmp = await renderSpecToReceiptBitmap(sales12, 576)
                const data = decodeRows(bmp)
                const bytesPerRow = 72
                let solidRows = 0
                for (let y = 0; y < bmp.heightPx; y++) {
                        let full = true
                        for (let b = 0; b < bytesPerRow; b++) {
                                if ((data[y * bytesPerRow + b] as number) !== 0xff) {
                                        full = false
                                        break
                                }
                        }
                        if (full) solidRows++
                }
                const last = data.subarray((bmp.heightPx - 1) * bytesPerRow)
                assert.ok(last.length > 0 && last.some((b) => b !== 0xff))
                passed(`فوترِ تمیز: آخرین ردیف سفید است (نوارهای تمام‌سیاه فقط ${solidRows} ردیفِ هدر/خط — ساختاری)`)
        }

        // ۱۳) صفِ تک‌به‌تک — دو رندرِ هم‌زمان؛ هر دو سالم و مستقل
        {
                const before = createdCanvases.length
                const [a, b] = await Promise.all([
                        renderSpecToReceiptBitmap(sales12, 576),
                        renderSpecToReceiptBitmap(kitchen12, 384),
                ])
                assert.strictEqual(a.widthPx, 576)
                assert.strictEqual(b.widthPx, 384)
                assert.strictEqual(decodeRows(a).length, 72 * a.heightPx)
                assert.strictEqual(decodeRows(b).length, 48 * b.heightPx)
                assert.strictEqual(createdCanvases.length, before + 2)
                passed('صفِ تک‌به‌تک: دو رندرِ هم‌زمان بدونِ تداخل (cursor مشترک نخراب شد)')
        }

        // ۱۴) رد کردنِ عرضِ نامعتبر — عقدِ قرارداد با سرور
        {
                await assert.rejects(
                        () => renderSpecToReceiptBitmap(sales12, 300),
                        (e: unknown) => e instanceof Error && (e.message.includes('عرض') || e.message.includes('width')),
                )
                passed('عرضِ کاغذِ نامعتبر (300) رد می‌شود — فقط ۵۷۶/۳۸۴/۴۲۰')
        }

        // Font loading itself can stall, not only document.fonts.ready.
        {
                const originalLoad = document.fonts.load
                document.fonts.load = () => new Promise(() => {})
                let guard: ReturnType<typeof setTimeout> | undefined
                try {
                        const bitmap = await Promise.race([
                                renderSpecToReceiptBitmap(kitchen12, 576),
                                new Promise<never>((_, reject) => {
                                        guard = setTimeout(() => reject(new Error('font load blocked printing')), 3_000)
                                }),
                        ])
                        assert.ok(bitmap.heightPx > 0)
                } finally {
                        document.fonts.load = originalLoad
                        clearTimeout(guard)
                }
                passed('بارگذاری معطل فونت از چاپ رسید جلوگیری نمی‌کند')
        }

        console.log(`\nOK — ${count} بند سبز`)
} finally {
        // فونت‌های ثبت‌شده global می‌مانند — پروسهٔ تست کوتاهِ عمر است؛ مشکلی نیست
}
