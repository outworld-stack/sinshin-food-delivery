// ═══════════════════════════════════════════════════════════════
// stage-102 (ه) — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/shared/NotificationDetailModal.tsx
// مدال «محتوای کامل اعلان» — برای هر دو سمت:
//   • صندوق اعلان‌های مشتری: کلیک روی اعلانِ بدونِ لینک ⇒ خوانده‌شده +
//     این مدال باز می‌شود (ادامه‌ی متنِ بریده‌شده‌ی لیست، اینجا کامل).
//   • تاریخچه‌ی اعلان‌های ادمین اصلی: کلیک روی ردیفِ بدونِ url ⇒ همین مدال.
// سازنده‌ی همه‌ی متن‌ها caller است (داشبورد دوزبانه از i18n می‌دهد؛ پنل
// ادمین فارسیِ ثابت) — خودِ کامپوننت فقط ظرف است. الگوی ConfirmModal:
// role="dialog" + Escape + کلیکِ پس‌زمینه + بدون وابستگی بیرونی.
// رسپانسیو: موبایل p-4 کانتینر + کارت max-h-[85vh] با اسکرولِ داخلیِ
// overscroll-contain (متنِ بلند، صفحه‌خوان هم اسکرول می‌کند).
// ═══════════════════════════════════════════════════════════════

import { memo, type ReactNode, useEffect, useRef } from 'react'

export interface NotificationDetailMetaRow {
	label: string
	value: string
	/** شماره/لینک‌ها چپ‌چین بمانند داخل متنِ راست‌به‌چپ */
	dir?: 'ltr' | 'rtl'
}

interface NotificationDetailModalProps {
	open: boolean
	onClose: () => void
	/** آیکونِ نوع اعلان (همان iconOf/TypeBadge سمت caller) */
	icon: ReactNode
	/** برچسبِ نوع — چیپِ رنگی بالای عنوان */
	typeLabel: string
	title: string
	body: string
	/** ردیف‌های متادیتا زیر متن (زمان ارسال/گیرندگان/…) */
	meta?: NotificationDetailMetaRow[]
	closeLabel: string
}

export const NotificationDetailModal = memo(function NotificationDetailModal({
	open,
	onClose,
	icon,
	typeLabel,
	title,
	body,
	meta,
	closeLabel,
}: NotificationDetailModalProps) {
	// الگوی ConfirmModal — Escape می‌بندد (فقط وقتی باز است)
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, onClose])

	// فوکوس روی دکمه‌ی بستن — ناوبریِ صفحه‌کلید داخل مدال شروع شود
	const closeRef = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		if (open) closeRef.current?.focus()
	}, [open])

	if (!open) return null

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			className="fixed inset-0 z-100 flex items-center justify-center p-4"
		>
			{/* پرده — کلیک می‌بندد */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
				aria-hidden="true"
			/>
			<div className="relative bg-white dark:bg-[#2a1015] rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh] animate-pop-in">
				{/* سربرگ — آیکون + چیپ نوع + دکمه بستن */}
				<div className="flex items-start gap-3 p-5 sm:p-6 border-b border-gray-100 dark:border-white/5 shrink-0">
					<span
						aria-hidden="true"
						className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary"
					>
						{icon}
					</span>
					<div className="min-w-0 flex-1">
						<span className="inline-block text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1a0a0e] text-gray-500 dark:text-gray-400">
							{typeLabel}
						</span>
						<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mt-2 leading-snug break-words">
							{title}
						</h3>
					</div>
					<button
						type="button"
						ref={closeRef}
						onClick={onClose}
						aria-label={closeLabel}
						className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] transition cursor-pointer"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* متن کامل اعلان — اسکرول داخلی، بدون لِیک اسکرول به پشت */}
				<div className="p-5 sm:p-6 overflow-y-auto overscroll-contain">
					<p className="text-sm text-gray-600 dark:text-gray-300 font-DanaRegular leading-relaxed whitespace-pre-line break-words">
						{body}
					</p>

					{meta && meta.length > 0 && (
						<div className="mt-5 pt-4 border-t border-gray-100 dark:border-white/5 space-y-2">
							{meta.map((row) => (
								<p
									key={row.label}
									className="text-[11px] font-DanaMedium text-gray-400 dark:text-gray-500 flex items-center gap-2 flex-wrap"
								>
									<span>{row.label}:</span>
									<span
										dir={row.dir ?? 'rtl'}
										className="text-gray-500 dark:text-gray-400"
									>
										{row.value}
									</span>
								</p>
							))}
						</div>
					)}
				</div>

				{/* پا — دکمه بستنِ تمام‌عرض (هدف لمسی ≥۴۴px) */}
				<div className="p-5 sm:p-6 pt-0 shrink-0">
					<button
						type="button"
						onClick={onClose}
						className="w-full py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-sm cursor-pointer hover:opacity-90 transition min-h-11"
					>
						{closeLabel}
					</button>
				</div>
			</div>
		</div>
	)
})
