// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/admin2/InvoicePrintCenterModal.tsx (فایل جدید)
// «مرکز چاپ فاکتور» — جایگزینِ چاپِ خودکارِ بعد از تایید:
//  · هر فاکتور (سالن/فروش + آشپزخانه) تیک جدا دارد؛ تیک‌خورده‌ها چاپ می‌شوند.
//  · انتخابِ «پرینتر مقصد» در خودِ پنجره‌ی چاپِ مرورگر انجام می‌شود — هر
//    فاکتور دیالوگ خودش را می‌گیرد (صف چاپ موجود) تا روی پرینترِ همان
//    بخش (سالن/آشپزخانه) فرستاده شود؛ انتخابِ آخرین مرورگر به‌صورت خودکار
//    برای دیالوگ بعدی پیشنهاد می‌شود.
//  · بعد از تایید سفارش، فاکتورها «هر زمان» از کارت سفارش قابل چاپ‌اند.
//  · فرمت: رسید حرارتی mono (مشکی بولد + سفیدرومشکی) + طولِ چاپ =
//    طولِ فاکتور (نه کل رول) + زمان/روز/تاریخ/ساعت + نوع سفارش.
//  · انتخاب پیش‌فرض تیک‌ها در localStorage ذخیره می‌شود (sinshin-invoice-kinds).
// ═══════════════════════════════════════════════════════════════

// src/components/admin/admin2/InvoicePrintCenterModal.tsx
import { memo, useCallback, useEffect, useState } from 'react'
import { Printer, X } from 'reicon-react'
import { getStaffOrderInvoice, type StaffInvoice } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { type InvoiceKind, printOrderInvoices } from '#/utils/invoicePrint'

interface InvoicePrintCenterModalProps {
	/** displayId سفارش (ord-…) */
	orderId: string
	/** نوع سفارش برای راهنمای QR (DELIVERY → QR پیک روی فاکتور فروش) —
	 *  ترمیم اسکن: اختیاری شد تا صفحهٔ سفارشات مقدار هاردکد نفرستد */
	deliveryType?: string | null
	onClose: () => void
}

const KIND_STORAGE_KEY = 'sinshin-invoice-kinds'

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

export const InvoicePrintCenterModal = memo(function InvoicePrintCenterModal({
	orderId,
	deliveryType,
	onClose,
}: InvoicePrintCenterModalProps) {
	const showToast = useToastStore((s) => s.showToast)
	const [kinds, setKinds] = useState(loadDefaultKinds)
	const [printing, setPrinting] = useState(false)
	// ترمیم اسکنِ استیج-۸۴ — فاکتور هنگامِ «باز شدنِ» مودال پیش‌واکشی می‌شود:
	// کلیکِ چاپ دیگر منتظرِ شبکه نمی‌ماند (فعال‌سازیِ پاپ‌آپِ iOS در همان
	// لحظهٔ ژستِ کاربر می‌ماند) و چاپِ مجدد آنی است
	const [invoice, setInvoice] = useState<StaffInvoice | null>(null)

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

	// Escape برای بستن (چاپ نباید حین دیالوگ مرورگر باز باشد)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !printing) onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose, printing])

	const handlePrint = useCallback(async () => {
		const selected: InvoiceKind[] = [
			...(kinds.kitchen ? (['kitchen'] as const) : []),
			...(kinds.sales ? (['sales'] as const) : []),
		]
		if (selected.length === 0) {
			showToast('حداقل یک فاکتور را انتخاب کنید', 'error')
			return
		}
		try {
			localStorage.setItem(KIND_STORAGE_KEY, JSON.stringify(kinds))
		} catch {
			// ذخیره‌ی انتخاب اختیاری است
		}
		setPrinting(true)
		try {
			const inv = invoice ?? (await getStaffOrderInvoice(orderId))
			setInvoice(inv)
			await printOrderInvoices(inv, selected)
			showToast('چاپ فاکتور ارسال شد')
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
	}, [invoice, kinds, orderId, showToast])

	const toggle = (key: 'kitchen' | 'sales') =>
		setKinds((prev) => ({ ...prev, [key]: !prev[key] }))

	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center p-4">
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={() => !printing && onClose()}
			></div>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`چاپ فاکتور سفارش ${orderId}`}
				className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md"
			>
				<div className="flex items-center justify-between mb-1">
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
				<p className="text-xs text-gray-400 font-DanaMedium mb-4 leading-relaxed">
					فاکتورهای موردنظر را تیک بزنید. هر فاکتور پنجرهٔ چاپ جداگانه می‌گیرد —
					پرینتر مقصد (سالن / آشپزخانه) را همان‌جا انتخاب کنید.
					{deliveryType === 'DELIVERY' &&
						' فاکتور فروش شامل QR اسکن موقعیت مشتری است (۳ ساعت اعتبار).'}
				</p>

				<div className="space-y-2 mb-4">
					<button
						type="button"
						role="checkbox"
						aria-checked={kinds.sales}
						onClick={() => toggle('sales')}
						disabled={printing}
						className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border transition cursor-pointer disabled:opacity-60 ${
							kinds.sales
								? 'border-primary bg-primary/5 dark:border-dark-primary dark:bg-dark-primary/10'
								: 'border-gray-200 dark:border-[#3a151c] bg-gray-50 dark:bg-[#1a0a0e]'
						}`}
					>
						<span className="flex items-center gap-2.5">
							<span
								className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
									kinds.sales
										? 'border-primary bg-primary text-white dark:border-dark-primary dark:bg-dark-primary'
										: 'border-gray-300 dark:border-[#4a1a24]'
								}`}
							>
								{kinds.sales && (
									<span className="text-[11px] font-bold">✓</span>
								)}
							</span>
							<span className="text-right">
								<span className="block font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									فاکتور فروش (سالن / مشتری)
								</span>
								<span className="block text-[11px] text-gray-400 mt-0.5">
									اقلام + ریز مبالغ + QR پیک (ارسال با پیک)
								</span>
							</span>
						</span>
					</button>

					<button
						type="button"
						role="checkbox"
						aria-checked={kinds.kitchen}
						onClick={() => toggle('kitchen')}
						disabled={printing}
						className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border transition cursor-pointer disabled:opacity-60 ${
							kinds.kitchen
								? 'border-primary bg-primary/5 dark:border-dark-primary dark:bg-dark-primary/10'
								: 'border-gray-200 dark:border-[#3a151c] bg-gray-50 dark:bg-[#1a0a0e]'
						}`}
					>
						<span className="flex items-center gap-2.5">
							<span
								className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
									kinds.kitchen
										? 'border-primary bg-primary text-white dark:border-dark-primary dark:bg-dark-primary'
										: 'border-gray-300 dark:border-[#4a1a24]'
								}`}
							>
								{kinds.kitchen && (
									<span className="text-[11px] font-bold">✓</span>
								)}
							</span>
							<span className="text-right">
								<span className="block font-DanaDemiBold text-sm text-gray-800 dark:text-white">
									فاکتور آشپزخانه
								</span>
								<span className="block text-[11px] text-gray-400 mt-0.5">
									اقلام بدون قیمت + جدول درشت
								</span>
							</span>
						</span>
					</button>
				</div>

				<div className="flex items-center gap-3">
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
