// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/admin2/PrinterManager.tsx (فایل جدید)
// «مدیریت چاپگرهای شبکه» — بخشِ تاشو داخلِ مودالِ چاپ فاکتور.
//
//  · فقط ادمین اصلی (مودال با role==='admin' رندرش می‌کند) — مدیریتِ
//    سخت‌افزار کارِ رئیس است (الگوی ناحیه‌های ارسال/درگاه‌ها).
//  · افزودن: نام + IP + پورت (پیش‌فرض 9100) + عرضِ کاغذ (۸۰mm/۵۸mm) + برش.
//  · تشخیص: اسکنِ زیرشبکه از سمتِ سرور (NAT داکر عبور می‌کند) — نتیجه
//    فقط «پیش‌پرکردنِ فرم» است؛ ثبت نهایی با دکمهٔ افزودن (چیزی پنهانی
//    اضافه نمی‌شود).
//  · تست: صفحهٔ اسکیِ سرور (بدونِ مرورگر) — برایِ تستِ فارسی از خودِ
//    دکمهٔ «چاپ فاکتورهای انتخابی» مودال استفاده کنید (مسیرِ canvas).
//  · حذف: تخصیصِ فاکتورها به‌طورِ خودکار پاک می‌شود (سمتِ سرور).
// ═══════════════════════════════════════════════════════════════

import type { PrinterDiscoveryDto, PrinterDto } from '@sinshin/shared'
// src/components/admin/admin2/PrinterManager.tsx
import { useMutation } from '@tanstack/react-query'
import { memo, useCallback, useState } from 'react'
import { Loader, Plus, Printer, Radar, Trash, Wifi } from 'reicon-react'
import {
	addAdminPrinter,
	discoverAdminPrinters,
	removeAdminPrinter,
	testAdminPrinter,
} from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'

interface PrinterManagerProps {
	printers: PrinterDto[]
	/** پس از هر تغییر — نامعتبرسازیِ کوئری چاپگرها */
	onChanged: () => Promise<void>
}

const WIDTH_LABEL: Record<number, string> = {
	576: 'کاغذ ۸۰mm',
	384: 'کاغذ ۵۸mm',
	420: 'کاغذ ۵۸mm (اپسون)',
}

export const PrinterManager = memo(function PrinterManager({
	printers,
	onChanged,
}: PrinterManagerProps) {
	const showToast = useToastStore((s) => s.showToast)
	const [open, setOpen] = useState(false)
	const [name, setName] = useState('')
	const [host, setHost] = useState('')
	const [port, setPort] = useState('9100')
	const [widthDots, setWidthDots] = useState<576 | 384>(576)
	const [autoCut, setAutoCut] = useState(true)
	const [scanCidr, setScanCidr] = useState('192.168.1.0/24')
	const [found, setFound] = useState<PrinterDiscoveryDto[] | null>(null)

	const addMutation = useMutation({
		mutationFn: () =>
			addAdminPrinter({
				name,
				host,
				port: Number(port) || 9100,
				widthDots,
				autoCut,
			}),
		onSuccess: async () => {
			await onChanged()
			showToast(`چاپگر «${name}» ثبت شد`)
			setName('')
			setHost('')
		},
		onError: (err: Error) =>
			showToast(err.message || 'ثبت چاپگر ناموفق بود', 'error'),
	})

	const removeMutation = useMutation({
		mutationFn: (id: string) => removeAdminPrinter(id),
		onSuccess: async () => {
			await onChanged()
			showToast('چاپگر حذف شد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'حذف چاپگر ناموفق بود', 'error'),
	})

	const testMutation = useMutation({
		mutationFn: (id: string) => testAdminPrinter(id),
		onSuccess: () => showToast('صفحهٔ تست ارسال شد — چاپگر را بررسی کنید'),
		onError: (err: Error) =>
			showToast(err.message || 'ارسال تست ناموفق بود', 'error'),
	})

	const discoverMutation = useMutation({
		mutationFn: () => discoverAdminPrinters(scanCidr || undefined),
		onSuccess: (res) => {
			setFound(res.found)
			showToast(
				res.found.length > 0
					? `${res.found.length} دستگاهِ چاپ در شبکه پیدا شد`
					: 'چیزی در این بازه پیدا نشد — IP را از صفحهٔ تستِ خودِ چاپگر بگیرید',
			)
		},
		onError: (err: Error) =>
			showToast(err.message || 'اسکن شبکه ناموفق بود', 'error'),
	})

	const submitAdd = useCallback(() => {
		if (!name.trim()) {
			showToast('نام چاپگر را وارد کنید', 'error')
			return
		}
		if (!host.trim()) {
			showToast('IP چاپگر را وارد کنید (مثلاً 192.168.1.87)', 'error')
			return
		}
		addMutation.mutate()
	}, [addMutation, host, name, showToast])

	const applyFound = useCallback(
		(f: PrinterDiscoveryDto) => {
			setHost(f.host)
			setPort(String(f.port))
			setOpen(true)
			showToast(`IP ${f.host} در فرم قرار گرفت — نام و عرض کاغذ را کامل کنید`)
		},
		[showToast],
	)

	return (
		<div className="rounded-xl border border-gray-200 dark:border-[#3a151c] bg-gray-50 dark:bg-[#160a0d]">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="w-full flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer"
			>
				<span className="flex items-center gap-2 text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">
					<Printer size={15} />
					مدیریت چاپگرهای شبکه ({printers.length})
				</span>
				<span className="text-[10px] text-gray-400 font-DanaMedium">
					{open ? 'بستن' : 'افزودن / حذف / تست'}
				</span>
			</button>

			{open && (
				<div className="px-3 pb-3 space-y-3">
					{/* فهرست چاپگرها */}
					{printers.length > 0 && (
						<div className="space-y-1.5">
							{printers.map((p) => (
								<div
									key={p.id}
									className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#1a0a0e] px-2.5 py-2"
								>
									<span
										aria-hidden="true"
										title={
											p.status === 'online'
												? 'آنلاین'
												: p.status === 'offline'
													? 'آفلاین'
													: 'نامشخص'
										}
										className={`w-2 h-2 rounded-full shrink-0 ${
											p.status === 'online'
												? 'bg-green-500 dark:bg-green-400'
												: p.status === 'offline'
													? 'bg-red-500 dark:bg-red-400'
													: 'bg-gray-300 dark:bg-gray-600'
										}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block text-xs font-DanaDemiBold text-gray-800 dark:text-white truncate">
											{p.name}
											{p.statusDetail ? (
												<span className="font-DanaMedium text-amber-600 dark:text-amber-400">
													{' '}
													— {p.statusDetail}
												</span>
											) : null}
										</span>
										<span
											className="block text-[10px] text-gray-400 font-DanaMedium truncate"
											dir="ltr"
										>
											{p.host}:{p.port} ·{' '}
											{WIDTH_LABEL[p.widthDots] ?? `${p.widthDots} dot`}
											{p.autoCut ? ' · برش خودکار' : ''}
										</span>
									</span>
									<button
										type="button"
										onClick={() => testMutation.mutate(p.id)}
										disabled={testMutation.isPending}
										className="shrink-0 rounded-md border border-gray-200 dark:border-[#3a151c] px-2 py-1 text-[10px] font-DanaMedium text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#3a151c] transition disabled:opacity-50"
									>
										{testMutation.isPending && testMutation.variables === p.id
											? '…'
											: 'تست'}
									</button>
									<button
										type="button"
										aria-label={`حذف ${p.name}`}
										onClick={() => removeMutation.mutate(p.id)}
										disabled={removeMutation.isPending}
										className="shrink-0 text-red-400 hover:text-red-500 dark:hover:text-red-300 cursor-pointer transition disabled:opacity-50"
									>
										{removeMutation.isPending &&
										removeMutation.variables === p.id ? (
											<Loader size={14} className="animate-spin" />
										) : (
											<Trash size={14} />
										)}
									</button>
								</div>
							))}
						</div>
					)}

					{/* فرم افزودن */}
					<div className="rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#1a0a0e] p-2.5 space-y-2">
						<div className="flex items-center gap-1.5 text-[11px] font-DanaDemiBold text-gray-600 dark:text-gray-300">
							<Plus size={13} />
							افزودن چاپگر شبکه
						</div>
						<div className="grid grid-cols-2 gap-2">
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="نام (چاپگر آشپزخانه)"
								aria-label="نام چاپگر"
								className="col-span-2 rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#160a0d] px-2.5 py-2 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-primary dark:focus:border-dark-primary"
							/>
							<input
								value={host}
								onChange={(e) => setHost(e.target.value)}
								placeholder="192.168.1.87"
								dir="ltr"
								aria-label="IP چاپگر"
								className="rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#160a0d] px-2.5 py-2 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-primary dark:focus:border-dark-primary"
							/>
							<input
								value={port}
								onChange={(e) => setPort(e.target.value)}
								placeholder="9100"
								dir="ltr"
								inputMode="numeric"
								aria-label="پورت چاپگر"
								className="rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#160a0d] px-2.5 py-2 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-primary dark:focus:border-dark-primary"
							/>
							<select
								value={widthDots}
								onChange={(e) =>
									setWidthDots(Number(e.target.value) as 576 | 384)
								}
								aria-label="عرض کاغذ"
								className="rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#160a0d] px-2 py-2 text-xs text-gray-700 dark:text-gray-200 cursor-pointer"
							>
								<option value={576}>کاغذ ۸۰mm (معمول)</option>
								<option value={384}>کاغذ ۵۸mm</option>
							</select>
							<label className="flex items-center gap-2 text-[11px] font-DanaMedium text-gray-600 dark:text-gray-300 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={autoCut}
									onChange={(e) => setAutoCut(e.target.checked)}
									className="w-4 h-4 accent-primary dark:accent-dark-primary cursor-pointer"
								/>
								برش خودکار
							</label>
						</div>
						<button
							type="button"
							onClick={submitAdd}
							disabled={addMutation.isPending}
							className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-xs py-2 cursor-pointer hover:opacity-90 transition disabled:opacity-60"
						>
							{addMutation.isPending ? 'در حال ثبت…' : 'ثبت چاپگر'}
						</button>
					</div>

					{/* تشخیص در شبکه */}
					<div className="rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#1a0a0e] p-2.5 space-y-2">
						<div className="flex items-center gap-1.5 text-[11px] font-DanaDemiBold text-gray-600 dark:text-gray-300">
							<Radar size={13} />
							جست‌وجوی چاپگر در شبکه
						</div>
						<div className="flex gap-2">
							<input
								value={scanCidr}
								onChange={(e) => setScanCidr(e.target.value)}
								placeholder="192.168.1.0/24"
								dir="ltr"
								aria-label="بازهٔ اسکن"
								className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#160a0d] px-2.5 py-2 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-primary dark:focus:border-dark-primary"
							/>
							<button
								type="button"
								onClick={() => discoverMutation.mutate()}
								disabled={discoverMutation.isPending}
								className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-primary/50 dark:border-dark-primary/40 px-3 py-2 text-[11px] font-DanaMedium text-primary dark:text-dark-primary cursor-pointer hover:bg-primary/5 dark:hover:bg-dark-primary/10 transition disabled:opacity-60"
							>
								{discoverMutation.isPending ? (
									<Loader size={13} className="animate-spin" />
								) : (
									<Wifi size={13} />
								)}
								{discoverMutation.isPending ? 'در حال اسکن…' : 'اسکن'}
							</button>
						</div>
						{found && found.length > 0 && (
							<div className="space-y-1">
								{found.map((f) => (
									<button
										key={`${f.host}:${f.port}`}
										type="button"
										onClick={() => applyFound(f)}
										dir="ltr"
										className="w-full flex items-center justify-between rounded-md border border-dashed border-gray-300 dark:border-[#3a151c] px-2.5 py-1.5 text-[11px] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer hover:bg-gray-50 dark:hover:bg-[#160a0d] transition"
									>
										<span>
											{f.host}:{f.port}
										</span>
										<span className="font-DanaDemiBold text-primary dark:text-dark-primary">
											قرار بده در فرم +
										</span>
									</button>
								))}
							</div>
						)}
						<p className="text-[10px] text-gray-400 font-DanaMedium leading-relaxed">
							سرور این بازه را با پورت‌های 9100 و 631 جست‌وجو می‌کند. اگر چاپگر
							پیدا نشد، IP را از «صفحهٔ تستِ خودِ چاپگر» (دکمهٔ FEED هنگام روشن‌شدن)
							بخوانید و دستی وارد کنید. برای چاپگرِ شبکه IP ثابت (DHCP
							Reservation) بگذارید.
						</p>
					</div>
				</div>
			)}
		</div>
	)
})
