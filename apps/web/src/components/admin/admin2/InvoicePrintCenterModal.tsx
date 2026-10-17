// ═══════════════════════════════════════════════════════════════
// stage-85 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/admin2/InvoicePrintCenterModal.tsx
// وضعیت: جایگزینی کامل فایل stage-84
// «مرکز چاپ فاکتور» نسخهٔ ۲:
//  · پیش‌نمایشِ زندهٔ فاکتور داخل خود مودال — عینِ چیزی که چاپ می‌شود
//    (همان موتور چاپ: buildPrintDocumentHtml + iframe کاغذی ۸۰mm).
//  · پرینترِ پیش‌فرضِ هر نوع فاکتور (فروش / آشپزخانه) یک بار انتخاب و
//    در localStorage ذخیره می‌شود؛ با QZ Tray نصب‌شده، زدنِ «چاپ» دیگر
//    هیچ دیالوگِ انتخابِ پرینتری باز نمی‌کند (چاپ مستقیم — الگوی POS).
//  · بدونِ QZ Tray رفتارِ stage-84 دست‌نخورده: صفِ دیالوگ‌های مرورگر.
//  · فاکتورها هنگامِ باز شدنِ مودال پیش‌ساخته می‌شوند (شبکه + QR) تا
//    کلیکِ چاپ آنی باشد؛ خطای چاپِ مستقیم هرگز سفارش را نمی‌کُشد — همان
//    فاکتور با دیالوگِ مرورگر جایگزین می‌شود.
//  · تیک‌ها (sinshin-invoice-kinds) و پرینترها (sinshin-invoice-printers)
//    جدا ذخیره می‌شوند.
// ═══════════════════════════════════════════════════════════════

// src/components/admin/admin2/InvoicePrintCenterModal.tsx
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Printer, X } from 'reicon-react'
import {
	connectPrintAgent,
	getPrintAgentStatus,
	listAgentPrinters,
	type PrintAgentStatus,
	subscribePrintAgentStatus,
} from '#/lib/printAgent'
import { buildPrintDocumentHtml, RECEIPT_PROBE_PX } from '#/lib/printDocument'
import { getStaffOrderInvoice, type StaffInvoice } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import {
	buildInvoicePrintSpecs,
	type InvoiceKind,
	printOrderInvoices,
} from '#/utils/invoicePrint'

interface InvoicePrintCenterModalProps {
	/** displayId سفارش (ord-…) */
	orderId: string
	/** نوع سفارش برای راهنمای QR (DELIVERY → QR پیک روی فاکتور فروش) —
	 *  ترمیم اسکن: اختیاری شد تا صفحهٔ سفارشات مقدار هاردکد نفرستد */
	deliveryType?: string | null
	onClose: () => void
}

const KIND_STORAGE_KEY = 'sinshin-invoice-kinds'
const PRINTER_STORAGE_KEY = 'sinshin-invoice-printers'
/** عرضِ «کاغذ» پیش‌نمایش (px) — ۸۰mm + کمی حاشیهٔ بصری */
const PAPER_W = 302

function loadDefaultKinds(): { kitchen: boolean; sales: boolean } {
	try {
		const raw = localStorage.getItem(KIND_STORAGE_KEY)
		if (raw) {
			const parsed = JSON.parse(raw) as { kitchen?: unknown; sales?: unknown }
			return {
				kitchen: parsed.kitchen !== false,
				sales: parsed.sales !== false,
			}
		}
	} catch {
		// localStorage خراب/مقدار قدیمی — پیش‌فرض
	}
	return { kitchen: true, sales: true }
}

/** stage-85 — پرینترِ پیش‌فرضِ هر فاکتور؛ '' یعنی دیالوگِ مرورگر */
function loadDefaultPrinters(): { sales: string; kitchen: string } {
	try {
		const raw = localStorage.getItem(PRINTER_STORAGE_KEY)
		if (raw) {
			const parsed = JSON.parse(raw) as { sales?: unknown; kitchen?: unknown }
			return {
				sales: typeof parsed.sales === 'string' ? parsed.sales : '',
				kitchen: typeof parsed.kitchen === 'string' ? parsed.kitchen : '',
			}
		}
	} catch {
		// مقدار قدیمی/خراب — دیالوگ مرورگر
	}
	return { sales: '', kitchen: '' }
}

/** پیش‌نمایش کاغذی ۸۰mm — همان HTML چاپی داخل iframe؛ ارتفاع بعد از
 *  لود (و آماده‌شدنِ فونت‌ها) اندازه‌گیری می‌شود؛ در عرض‌های باریک
 *  scale می‌خورد تا کلِ کاغذ جا شود (بدونِ برشِ افقی). */
function ReceiptPreviewPane({ html }: { html: string | null }) {
	const frameRef = useRef<HTMLIFrameElement | null>(null)
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [contentH, setContentH] = useState(360)
	const [scale, setScale] = useState(1)

	useEffect(() => {
		const el = wrapRef.current
		if (!el) return
		const update = () =>
			setScale(Math.min(1, Math.max(0.5, (el.clientWidth - 6) / PAPER_W)))
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	}, [])

	const handleLoad = useCallback(() => {
		const doc = frameRef.current?.contentDocument
		if (!doc?.body) return
		const measure = () => {
			const h = doc.body.scrollHeight
			if (h > 0) setContentH(h)
		}
		const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
		if (fonts) void fonts.ready.then(measure)
		else measure()
	}, [])

	if (html === null) {
		return (
			<div
				aria-live="polite"
				className="h-40 rounded-lg bg-gray-100 dark:bg-[#220d13] animate-pulse flex items-center justify-center text-xs text-gray-400"
			>
				در حال آماده‌سازی پیش‌نمایش…
			</div>
		)
	}
	return (
		<div
			ref={wrapRef}
			className="w-full overflow-hidden"
			style={{ height: Math.ceil(contentH * scale) + 4 }}
		>
			<div
				className="mx-auto bg-white rounded-lg shadow-md border border-gray-200 dark:border-[#3a151c] overflow-hidden"
				style={{
					width: PAPER_W,
					height: contentH,
					transform: `scale(${scale})`,
					transformOrigin: 'top center',
				}}
			>
				<iframe
					ref={frameRef}
					title="پیش‌نمایش فاکتور چاپی"
					srcDoc={html}
					onLoad={handleLoad}
					className="block mx-auto border-0"
					style={{ width: RECEIPT_PROBE_PX, height: '100%' }}
				/>
			</div>
		</div>
	)
}

/** سلکتِ پرینترِ یک نوع فاکتور — گزینهٔ اول = دیالوگِ مرورگر */
function PrinterSelect({
	id,
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	id: string
	label: string
	value: string
	options: string[]
	disabled: boolean
	onChange: (next: string) => void
}) {
	return (
		<div className="flex items-center gap-2">
			<label
				htmlFor={id}
				className="text-[11px] text-gray-400 shrink-0 font-DanaMedium"
			>
				{label}
			</label>
			<select
				id={id}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#1a0a0e] px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate"
			>
				<option value="">دیالوگ مرورگر (پیش‌فرض)</option>
				{options.map((name) => (
					<option key={name} value={name}>
						{name}
					</option>
				))}
			</select>
		</div>
	)
}

export const InvoicePrintCenterModal = memo(function InvoicePrintCenterModal({
	orderId,
	deliveryType,
	onClose,
}: InvoicePrintCenterModalProps) {
	const showToast = useToastStore((s) => s.showToast)
	const [kinds, setKinds] = useState(loadDefaultKinds)
	const [printing, setPrinting] = useState(false)
	// ترمیم اسکنِ استیج-۸۴ — فاکتور هنگامِ «باز شدنِ» مودال پیش‌واکشی می‌شود:
	// کلیکِ چاپ دیگر منتظرِ شبکه نمی‌ماند و چاپِ مجدد آنی است
	const [invoice, setInvoice] = useState<StaffInvoice | null>(null)
	// stage-85 — پیش‌نمایش + پرینترهای مستقیم
	const [previewHtmls, setPreviewHtmls] = useState<
		Partial<Record<InvoiceKind, string>>
	>({})
	const [previewKind, setPreviewKind] = useState<InvoiceKind>('sales')
	const [agentPrinters, setAgentPrinters] = useState<string[]>([])
	const [printers, setPrinters] = useState(loadDefaultPrinters)
	const [agentStatus, setAgentStatus] = useState<PrintAgentStatus>(
		getPrintAgentStatus(),
	)
	// وضعیتِ زندهٔ سرویس چاپ مستقیم (QZ Tray)
	useEffect(() => subscribePrintAgentStatus(setAgentStatus), [])

	// اتصال به سرویس چاپ مستقیم — یک بار در هر باز شدن؛ دکمهٔ «تلاش
	// مجدد» همین را صدا می‌زند (بدونِ ری‌رانِ کلِ افکت‌ها)
	const reconnectAgent = useCallback(async () => {
		let ok = false
		try {
			ok = await connectPrintAgent()
		} catch {
			ok = false
		}
		if (!ok) return
		try {
			setAgentPrinters(await listAgentPrinters())
		} catch {
			// فهرست پرینترها نیامد — سلکت‌ها روی دیالوگ می‌مانند
		}
	}, [])

	useEffect(() => {
		void reconnectAgent()
	}, [reconnectAgent])

	useEffect(() => {
		let cancelled = false
		setInvoice(null)
		getStaffOrderInvoice(orderId)
			.then((inv) => {
				if (!cancelled) setInvoice(inv)
			})
			.catch(() => {
				// خطا در همان لحظهٔ چاپ (دوباره تلاش می‌شود) توست می‌شود
			})
		return () => {
			cancelled = true
		}
	}, [orderId])

	// پیش‌ساختِ هر دو فاکتور (شبکه + QR) — پیش‌نمایش و چاپِ آنی
	useEffect(() => {
		if (!invoice) return
		let cancelled = false
		void buildInvoicePrintSpecs(invoice, ['kitchen', 'sales'])
			.then((items) => {
				if (cancelled) return
				const htmls: Partial<Record<InvoiceKind, string>> = {}
				for (const item of items) {
					htmls[item.kind] = buildPrintDocumentHtml(item.spec)
				}
				setPreviewHtmls(htmls)
			})
			.catch(() => {
				// پیش‌نمایش اختیاری است — چاپ خودش می‌سازد
			})
		return () => {
			cancelled = true
		}
	}, [invoice])

	// Escape برای بستن (چاپ نباید حین دیالوگ مرورگر باز باشد)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !printing) onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose, printing])

	const saveKinds = useCallback(
		(next: { kitchen: boolean; sales: boolean }) => {
			try {
				localStorage.setItem(KIND_STORAGE_KEY, JSON.stringify(next))
			} catch {
				// ذخیرهٔ انتخاب اختیاری است
			}
		},
		[],
	)

	const setPrinter = useCallback((kind: 'kitchen' | 'sales', name: string) => {
		setPrinters((prev) => {
			const next = { ...prev, [kind]: name }
			try {
				localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(next))
			} catch {
				// ذخیرهٔ انتخاب اختیاری است
			}
			return next
		})
	}, [])

	const handlePrint = useCallback(async () => {
		const selected: InvoiceKind[] = [
			...(kinds.kitchen ? (['kitchen'] as const) : []),
			...(kinds.sales ? (['sales'] as const) : []),
		]
		if (selected.length === 0) {
			showToast('حداقل یک فاکتور را انتخاب کنید', 'error')
			return
		}
		saveKinds(kinds)
		setPrinting(true)
		try {
			const inv = invoice ?? (await getStaffOrderInvoice(orderId))
			setInvoice(inv)
			// پرینترهای مستقیم — فقط فاکتورهایی که هم پرینترِ منتخب دارند و هم
			// سرویس آماده است؛ بقیه با دیالوگِ مرورگر چاپ می‌شوند
			const agentPrintersMap: Partial<Record<InvoiceKind, string>> = {}
			if (agentStatus === 'ready') {
				for (const kind of selected) {
					const name = kind === 'kitchen' ? printers.kitchen : printers.sales
					if (name) agentPrintersMap[kind] = name
				}
			}
			const result = await printOrderInvoices(
				inv,
				selected,
				Object.keys(agentPrintersMap).length > 0
					? { agentPrinters: agentPrintersMap }
					: undefined,
			)
			if (result.agentErrors.length > 0) {
				showToast(
					`${result.agentErrors[0] ?? 'چاپ مستقیم ناموفق بود'}${result.dialogs > 0 ? ' — با دیالوگ مرورگر جایگزین شد' : ''}`,
					'error',
				)
			} else if (result.dialogs === 0 && result.direct > 0) {
				showToast('فاکتورها مستقیم به پرینتر ارسال شد')
			} else {
				showToast('چاپ فاکتور ارسال شد')
			}
		} catch (err) {
			showToast(
				err instanceof Error
					? `چاپ فاکتور ناموفق بود: ${err.message}`
					: 'چاپ فاکتور ناموفق بود',
				'error',
			)
		} finally {
			setPrinting(false)
		}
	}, [agentStatus, invoice, kinds, orderId, printers, saveKinds, showToast])

	const toggle = (key: 'kitchen' | 'sales') =>
		setKinds((prev) => {
			const next = { ...prev, [key]: !prev[key] }
			saveKinds(next)
			return next
		})

	const agentReady = agentStatus === 'ready'

	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-4">
			<button
				type="button"
				aria-label="بستن پنجرهٔ چاپ"
				onClick={() => !printing && onClose()}
				className="absolute inset-0 w-full h-full bg-black/50 backdrop-blur-sm cursor-default"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`چاپ فاکتور سفارش ${orderId}`}
				className="relative bg-white dark:bg-[#2a1015] rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[92dvh]"
			>
				<div className="flex items-center justify-between p-5 pb-2 shrink-0">
					<h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
						چاپ فاکتور — {orderId}
					</h3>
					<button
						type="button"
						onClick={onClose}
						disabled={printing}
						aria-label="بستن"
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition cursor-pointer disabled:opacity-50"
					>
						<X size={20} />
					</button>
				</div>

				<div className="px-5 pb-3 shrink-0">
					{/* وضعیت سرویس چاپ مستقیم (stage-85) */}
					{agentReady ? (
						<div
							aria-live="polite"
							className="flex items-center gap-2 text-[11px] text-green-600 dark:text-green-400 font-DanaMedium"
						>
							<span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400 shrink-0" />
							چاپ مستقیم فعال — پرینترِ پیش‌فرضِ هر فاکتور را یک بار انتخاب کنید
						</div>
					) : agentStatus === 'connecting' ? (
						<div className="text-[11px] text-gray-400 font-DanaMedium">
							در حال جستجوی سرویس چاپ مستقیم…
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-600 dark:text-amber-400 font-DanaMedium">
							<span>چاپ مستقیم (بدون دیالوگ پرینتر): QZ Tray را از</span>
							<a
								href="https://qz.io"
								target="_blank"
								rel="noreferrer"
								className="underline underline-offset-2"
							>
								qz.io
							</a>
							<span>روی همین دستگاه نصب کنید</span>
							<button
								type="button"
								onClick={() => void reconnectAgent()}
								className="rounded-md border border-amber-400/50 dark:border-amber-500/40 px-2 py-0.5 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
							>
								تلاش مجدد
							</button>
						</div>
					)}
					{deliveryType === 'DELIVERY' && (
						<p className="text-[11px] text-gray-400 font-DanaMedium leading-relaxed mt-1.5">
							فاکتور فروش شامل QR اسکن موقعیت مشتری است (۳ ساعت اعتبار).
						</p>
					)}
				</div>

				{/* انتخاب فاکتورها + پرینترِ پیش‌فرضِ هر کدام */}
				<div className="px-5 space-y-2 shrink-0">
					<div
						className={`rounded-xl border transition p-3 space-y-2 ${
							kinds.sales
								? 'border-primary/60 bg-primary/5 dark:border-dark-primary dark:bg-dark-primary/10'
								: 'border-gray-200 dark:border-[#3a151c] bg-gray-50 dark:bg-[#1a0a0e]'
						}`}
					>
						<label
							htmlFor="inv-print-sales"
							className={`flex items-center gap-2.5 ${printing ? '' : 'cursor-pointer'}`}
						>
							<input
								id="inv-print-sales"
								type="checkbox"
								checked={kinds.sales}
								onChange={() => toggle('sales')}
								disabled={printing}
								className="w-5 h-5 accent-primary dark:accent-dark-primary cursor-pointer shrink-0"
							/>
							<span className="text-right">
								<span className="block font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									فاکتور فروش (سالن / مشتری)
								</span>
								<span className="block text-[11px] text-gray-400 mt-0.5">
									اقلام + ریز مبالغ + QR پیک (ارسال با پیک)
								</span>
							</span>
						</label>
						<PrinterSelect
							id="inv-printer-sales"
							label="پرینتر پیش‌فرض:"
							value={printers.sales}
							options={agentPrinters}
							disabled={!agentReady || printing}
							onChange={(name) => setPrinter('sales', name)}
						/>
					</div>

					<div
						className={`rounded-xl border transition p-3 space-y-2 ${
							kinds.kitchen
								? 'border-primary/60 bg-primary/5 dark:border-dark-primary dark:bg-dark-primary/10'
								: 'border-gray-200 dark:border-[#3a151c] bg-gray-50 dark:bg-[#1a0a0e]'
						}`}
					>
						<label
							htmlFor="inv-print-kitchen"
							className={`flex items-center gap-2.5 ${printing ? '' : 'cursor-pointer'}`}
						>
							<input
								id="inv-print-kitchen"
								type="checkbox"
								checked={kinds.kitchen}
								onChange={() => toggle('kitchen')}
								disabled={printing}
								className="w-5 h-5 accent-primary dark:accent-dark-primary cursor-pointer shrink-0"
							/>
							<span className="text-right">
								<span className="block font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									فاکتور آشپزخانه
								</span>
								<span className="block text-[11px] text-gray-400 mt-0.5">
									اقلام بدون قیمت + جدول درشت
								</span>
							</span>
						</label>
						<PrinterSelect
							id="inv-printer-kitchen"
							label="پرینتر پیش‌فرض:"
							value={printers.kitchen}
							options={agentPrinters}
							disabled={!agentReady || printing}
							onChange={(name) => setPrinter('kitchen', name)}
						/>
					</div>
				</div>

				{/* پیش‌نمایش — عینِ خروجی چاپ (stage-85) */}
				<div className="px-5 pt-3 pb-1 shrink-0">
					<div className="flex items-center justify-between mb-1.5 gap-2">
						<span className="text-xs font-DanaDemiBold text-gray-500 dark:text-gray-400 shrink-0">
							پیش‌نمایش فاکتور
						</span>
						<div className="flex gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-[#1a0a0e]">
							<button
								type="button"
								onClick={() => setPreviewKind('sales')}
								aria-pressed={previewKind === 'sales'}
								className={`px-2.5 py-1 rounded-md text-[11px] font-DanaMedium transition cursor-pointer ${
									previewKind === 'sales'
										? 'bg-white dark:bg-[#3a151c] text-gray-800 dark:text-white shadow-sm'
										: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								فروش
							</button>
							<button
								type="button"
								onClick={() => setPreviewKind('kitchen')}
								aria-pressed={previewKind === 'kitchen'}
								className={`px-2.5 py-1 rounded-md text-[11px] font-DanaMedium transition cursor-pointer ${
									previewKind === 'kitchen'
										? 'bg-white dark:bg-[#3a151c] text-gray-800 dark:text-white shadow-sm'
										: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								آشپزخانه
							</button>
						</div>
					</div>
				</div>
				<div className="px-5 pb-4 min-h-0 overflow-y-auto">
					<div className="rounded-xl bg-gray-50 dark:bg-[#160a0d] border border-gray-100 dark:border-[#3a151c] p-2">
						<ReceiptPreviewPane html={previewHtmls[previewKind] ?? null} />
					</div>
				</div>

				<div className="flex items-center gap-3 p-4 pt-0 shrink-0">
					<button
						type="button"
						onClick={() => void handlePrint()}
						disabled={printing}
						className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-60"
					>
						<Printer size={18} />
						{printing ? 'در حال ارسال چاپ…' : 'چاپ فاکتورهای انتخابی'}
					</button>
					<button
						type="button"
						onClick={onClose}
						disabled={printing}
						className="px-4 py-3 rounded-xl border border-gray-200 dark:border-[#3a151c] text-gray-600 dark:text-gray-300 font-DanaMedium text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition disabled:opacity-50"
					>
						بستن
					</button>
				</div>
			</div>
		</div>
	)
})
