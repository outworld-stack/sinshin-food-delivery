// src/components/admin/reports/ReportsBox.tsx
// stage-10 — مرکز گزارشات داشبورد ادمین اصلی.
// PDFسازی از تمام صفحات حذف شد و همه‌چیز این‌جا آمد:
//  • هفت نوع گزارش: سفارشات / کار ادمین‌های سطح ۲ / پیک‌ها / ریز کوپن‌ها /
//    کاربران / کاربر خاص / لاگ ممیزی (audit-log)
//  • بازه‌ی زمانی دلخواه (تقویم شمسی) + فیلترهای نوع‌محور
//  • سیستم کشی: React Query با کلیدِ کامل فیلترها + staleTime ۵ دقیقه —
//    همان فیلترها = همان کلید = بدون درخواست مجدد
//  • خروجی: همان موتور چاپ قبلی (Save as PDF از پنجره‌ی چاپ)

import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useReducer, useState } from 'react'
import { FileText, Printer, Search, X } from 'reicon-react'
import { Skeleton } from '#/components/LoadingSkeletons'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { type AdminReportType, queryAdminReport } from '#/server/reports'
import { useToastStore } from '#/stores/toastStore'
import { jalaliFromISO, jalaliToGregorian } from '#/utils/persianDate'
import { qk } from '#/utils/queryKeys'
import {
	couriersAssignmentOptions,
	subAdminsOptions,
} from '#/utils/queryOptions'

// ── انواع گزارش ──
const REPORT_TYPES: { key: AdminReportType; label: string; hint: string }[] = [
	{ key: 'orders', label: 'سفارشات', hint: 'با فیلتر وضعیت و نوع تحویل' },
	{ key: 'admin2', label: 'کار ادمین‌های سطح ۲', hint: 'فعالیت‌های ثبت‌شده' },
	{ key: 'couriers', label: 'پیک‌ها', hint: 'تحویل‌ها و مبالغ' },
	{ key: 'coupons', label: 'ریز کوپن‌ها', hint: 'مصرف، گیرندگان، وضعیت' },
	{ key: 'users', label: 'کاربران', hint: 'آمار خرید و کیف پول' },
	{ key: 'user', label: 'کاربر خاص', hint: 'سفارشات و تراکنش‌ها' },
	{ key: 'audit', label: 'لاگ ممیزی', hint: 'عملیات ادمین اصلی' },
]

const ORDER_STATUSES = [
	{ key: 'all', label: 'همه' },
	{ key: 'PENDING_PAYMENT', label: 'در انتظار پرداخت' },
	{ key: 'PAID', label: 'در انتظار تایید' },
	{ key: 'CONFIRMED', label: 'تایید شده' },
	{ key: 'ON_THE_WAY', label: 'در مسیر' },
	{ key: 'DELIVERED', label: 'تحویل شده' },
	{ key: 'CANCELED', label: 'پرداخت ناموفق' },
]

const DELIVERY_TYPES = [
	{ key: 'all', label: 'همه' },
	{ key: 'DELIVERY', label: 'ارسال با پیک' },
	{ key: 'PICKUP', label: 'بیرون‌بر' },
	{ key: 'DINE_IN', label: 'سرو در سالن' },
]

// ── state ──
interface ReportsState {
	type: AdminReportType
	fromJalali: string | null
	toJalali: string | null
	status: string
	deliveryType: string
	adminUserId: string
	courierId: string
	phoneDraft: string
}

type ReportsAction =
	| { type: 'SET_TYPE'; payload: AdminReportType }
	| { type: 'SET_FROM'; payload: string | null }
	| { type: 'SET_TO'; payload: string | null }
	| { type: 'SET_STATUS'; payload: string }
	| { type: 'SET_DELIVERY'; payload: string }
	| { type: 'SET_ADMIN'; payload: string }
	| { type: 'SET_COURIER'; payload: string }
	| { type: 'SET_PHONE'; payload: string }
	| { type: 'CLEAR_DATES' }

const initialState: ReportsState = {
	type: 'orders',
	fromJalali: null,
	toJalali: null,
	status: 'all',
	deliveryType: 'all',
	adminUserId: 'all',
	courierId: 'all',
	phoneDraft: '',
}

function reportsReducer(
	state: ReportsState,
	action: ReportsAction,
): ReportsState {
	switch (action.type) {
		case 'SET_TYPE':
			return { ...state, type: action.payload }
		case 'SET_FROM':
			return { ...state, fromJalali: action.payload }
		case 'SET_TO':
			return { ...state, toJalali: action.payload }
		case 'SET_STATUS':
			return { ...state, status: action.payload }
		case 'SET_DELIVERY':
			return { ...state, deliveryType: action.payload }
		case 'SET_ADMIN':
			return { ...state, adminUserId: action.payload }
		case 'SET_COURIER':
			return { ...state, courierId: action.payload }
		case 'SET_PHONE':
			return {
				...state,
				phoneDraft: action.payload.replace(/[^0-9]/g, '').slice(0, 11),
			}
		case 'CLEAR_DATES':
			return { ...state, fromJalali: null, toJalali: null }
		default:
			return state
	}
}

/** شمسی ISO → میلادی ISO؛ to با پایان روز (تا رکوردهای همان روز بیفتند داخل بازه) */
function jalaliToGregorianISO(
	iso: string | null,
	endOfDay: boolean,
): string | null {
	if (!iso) return null
	const j = jalaliFromISO(iso)
	if (!j) return null
	const d = jalaliToGregorian(j)
	if (endOfDay) d.setHours(23, 59, 59, 999)
	return d.toISOString()
}

export const ReportsBox = memo(function ReportsBox() {
	const [state, dispatch] = useReducer(reportsReducer, initialState)
	// فیلترهای «کامیت‌شده» — کوئری فقط با دکمه‌ی تولید شروع می‌شود؛
	// تغییر فیلترها نتیجه‌ی روی صفحه را وسط کار عوض نمی‌کند.
	const [committed, setCommitted] = useState<ReportsState | null>(null)
	const showToast = useToastStore((s) => s.showToast)

	// دراپ‌داون‌ها — ادمین‌های سطح ۲ و پیک‌ها (فقط وقتی نوع مربوطه انتخاب شده)
	const needsAdmins = state.type === 'admin2' || state.type === 'audit'
	const needsCouriers = state.type === 'couriers'
	const { data: subAdmins } = useQuery({
		...subAdminsOptions,
		enabled: needsAdmins,
	})
	const { data: couriersList } = useQuery({
		...couriersAssignmentOptions,
		enabled: needsCouriers,
	})

	// ── کوئری گزارش — کلید = همه‌ی فیلترها → همان فیلترها از کش (staleTime ۵ دقیقه) ──
	const filters = useMemo(
		() => ({
			type: committed?.type ?? 'orders',
			from: jalaliToGregorianISO(committed?.fromJalali ?? null, false),
			to: jalaliToGregorianISO(committed?.toJalali ?? null, true),
			status: committed?.status ?? 'all',
			deliveryType: committed?.deliveryType ?? 'all',
			adminUserId:
				committed && committed.adminUserId !== 'all'
					? committed.adminUserId
					: null,
			courierId:
				committed && committed.courierId !== 'all' ? committed.courierId : null,
			phone: committed?.type === 'user' ? committed.phoneDraft || null : null,
		}),
		[committed],
	)

	const {
		data: report,
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: qk.adminReport(filters),
		queryFn: () => queryAdminReport(filters),
		enabled: committed !== null,
		staleTime: 5 * 60_000,
		gcTime: 10 * 60_000,
		retry: false,
	})

	const handleGenerate = useCallback(() => {
		if (state.type === 'user' && !/^09[0-9]{9}$/.test(state.phoneDraft)) {
			showToast('موبایل کاربر را با قالب ۰۹XXXXXXXXX وارد کنید', 'error')
			return
		}
		if (
			state.fromJalali &&
			state.toJalali &&
			state.fromJalali > state.toJalali
		) {
			showToast('تاریخ «از» نباید بعد از «تا» باشد', 'error')
			return
		}
		setCommitted({ ...state })
	}, [state, showToast])

	const handlePrint = useCallback(() => {
		const source = document.querySelector('#reports-result')
		if (!source) return
		// همان موتور چاپ قبلی — کلون محتوا + پنجره‌ی چاپ (Save as PDF)
		const area = document.createElement('div')
		area.id = 'dynamic-print-area'
		area.innerHTML = source.innerHTML
		document.body.appendChild(area)
		window.print()
		const cleanup = () => area.remove()
		window.addEventListener('afterprint', cleanup, { once: true })
		setTimeout(cleanup, 10000) // fallback
		showToast('از گزینه «Save as PDF» در پنجره چاپ استفاده کنید')
	}, [showToast])

	const activeType = REPORT_TYPES.find((t) => t.key === state.type)
	const hasDates = state.fromJalali || state.toJalali

	return (
		<div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
						<FileText size={20} />
					</div>
					<div>
						<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
							مرکز گزارشات
						</h2>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-DanaMedium">
							دریافت PDF همه‌ی گزارش‌ها با بازه‌ی زمانی دلخواه
						</p>
					</div>
				</div>
				{committed && report && (
					<button
						type="button"
						onClick={handlePrint}
						className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-2 text-sm shrink-0 self-start sm:self-auto"
					>
						<Printer size={16} />
						چاپ / ذخیره PDF
					</button>
				)}
			</div>

			{/* ── نوع گزارش — چیپ‌های wrap ── */}
			<div className="mb-6">
				<p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-3">
					نوع گزارش
				</p>
				<div className="flex flex-wrap gap-2">
					{REPORT_TYPES.map((t) => (
						<button
							key={t.key}
							type="button"
							onClick={() => dispatch({ type: 'SET_TYPE', payload: t.key })}
							className={`px-4 py-2 rounded-xl text-sm font-DanaMedium transition cursor-pointer ${
								state.type === t.key
									? 'bg-primary dark:bg-dark-primary text-white'
									: 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
							}`}
							aria-pressed={state.type === t.key}
						>
							{t.label}
						</button>
					))}
				</div>
				{activeType && (
					<p className="text-xs text-gray-400 mt-2 font-DanaMedium">
						{activeType.hint}
					</p>
				)}
			</div>

			{/* ── فیلترها — گرید پاسخ‌گو ── */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
				<div>
					<label
						htmlFor="report-from"
						className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
					>
						از تاریخ (اختیاری)
					</label>
					<PersianDatePicker
						id="report-from"
						value={state.fromJalali}
						onChange={(v) => dispatch({ type: 'SET_FROM', payload: v })}
						placeholder="ابتدای بازه..."
					/>
				</div>
				<div>
					<label
						htmlFor="report-to"
						className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
					>
						تا تاریخ (اختیاری)
					</label>
					<PersianDatePicker
						id="report-to"
						value={state.toJalali}
						onChange={(v) => dispatch({ type: 'SET_TO', payload: v })}
						placeholder="انتهای بازه..."
					/>
				</div>

				{/* نوع‌محور: سفارشات */}
				{state.type === 'orders' && (
					<>
						<div>
							<label
								htmlFor="report-status"
								className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
							>
								وضعیت سفارش
							</label>
							<select
								id="report-status"
								value={state.status}
								onChange={(e) =>
									dispatch({ type: 'SET_STATUS', payload: e.target.value })
								}
								className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
							>
								{ORDER_STATUSES.map((s) => (
									<option key={s.key} value={s.key}>
										{s.label}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor="report-delivery"
								className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
							>
								نوع تحویل
							</label>
							<select
								id="report-delivery"
								value={state.deliveryType}
								onChange={(e) =>
									dispatch({ type: 'SET_DELIVERY', payload: e.target.value })
								}
								className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
							>
								{DELIVERY_TYPES.map((d) => (
									<option key={d.key} value={d.key}>
										{d.label}
									</option>
								))}
							</select>
						</div>
					</>
				)}

				{/* نوع‌محور: ادمین سطح ۲ / لاگ ممیزی */}
				{needsAdmins && (
					<div className="md:col-span-2">
						<label
							htmlFor="report-admin"
							className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
						>
							ادمین سطح ۲
						</label>
						<select
							id="report-admin"
							value={state.adminUserId}
							onChange={(e) =>
								dispatch({ type: 'SET_ADMIN', payload: e.target.value })
							}
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
						>
							<option value="all">همه‌ی ادمین‌ها</option>
							{(subAdmins ?? []).map((a) => (
								<option key={a.userId} value={a.userId}>
									{`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.phone}{' '}
									— {a.phone}
								</option>
							))}
						</select>
					</div>
				)}

				{/* نوع‌محور: پیک */}
				{needsCouriers && (
					<div className="md:col-span-2">
						<label
							htmlFor="report-courier"
							className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
						>
							پیک
						</label>
						<select
							id="report-courier"
							value={state.courierId}
							onChange={(e) =>
								dispatch({ type: 'SET_COURIER', payload: e.target.value })
							}
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
						>
							<option value="all">همه‌ی پیک‌ها</option>
							{(couriersList ?? []).map((c) => (
								<option key={c.id} value={c.id}>
									{c.name} — {c.phone}
								</option>
							))}
						</select>
					</div>
				)}

				{/* نوع‌محور: کاربر خاص */}
				{state.type === 'user' && (
					<div className="md:col-span-2">
						<label
							htmlFor="report-phone"
							className="block text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-2"
						>
							موبایل کاربر *
						</label>
						<input
							id="report-phone"
							type="tel"
							dir="ltr"
							inputMode="numeric"
							value={state.phoneDraft}
							onChange={(e) =>
								dispatch({ type: 'SET_PHONE', payload: e.target.value })
							}
							placeholder="09XXXXXXXXX"
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary"
						/>
					</div>
				)}
			</div>

			{/* ── اکشن ── */}
			<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
				<button
					type="button"
					onClick={handleGenerate}
					disabled={isLoading}
					className="flex-1 sm:flex-none sm:min-w-48 px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Search size={16} />
					{isLoading ? 'در حال تولید...' : 'تولید گزارش'}
				</button>
				{hasDates && (
					<button
						type="button"
						onClick={() => dispatch({ type: 'CLEAR_DATES' })}
						className="px-4 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-500 dark:text-gray-400 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-1.5"
					>
						<X size={14} />
						پاک کردن بازه
					</button>
				)}
			</div>

			{/* ── نتیجه ── */}
			{isLoading && (
				<div className="mt-6 space-y-4">
					<Skeleton className="h-8 w-1/2" />
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-48 w-full" />
				</div>
			)}

			{isError && (
				<div className="mt-6 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-center">
					<p className="text-sm text-red-500 font-DanaMedium">
						{error instanceof Error ? error.message : 'خطا در تولید گزارش'}
					</p>
				</div>
			)}

			{report && !isLoading && (
				<div
					id="reports-result"
					className="mt-8 pt-6 border-t border-gray-100 dark:border-white/5"
				>
					<div className="mb-5 text-center">
						<h3 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">
							{report.title}
						</h3>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 font-DanaMedium">
							{report.subtitle}
						</p>
					</div>

					{/* آمار */}
					{report.stats.length > 0 && (
						<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
							{report.stats.map((s, i) => {
								// biome-ignore lint/suspicious/noArrayIndexKey: آمار سرور-ساخته — رشته‌ی خام بدون شناسه؛ ایندکس همان شناسه است
								return (
									<div
										key={i}
										className="bg-gray-50 dark:bg-[#1a0a0e] p-3.5 rounded-xl text-center"
									>
										<p className="text-[11px] text-gray-400 font-DanaMedium mb-1">
											{s.label}
										</p>
										<p className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">
											{s.value}
										</p>
									</div>
								)
							})}
						</div>
					)}

					{/* جدول‌ها */}
					{report.tables.map((table, ti) => (
						<div key={ti} className="mb-6">
							<p className="text-sm font-DanaDemiBold text-gray-700 dark:text-gray-200 mb-3">
								{table.title}
							</p>
							{table.rows.length === 0 ? (
								<div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm font-DanaMedium bg-gray-50 dark:bg-[#1a0a0e] rounded-xl">
									موردی در این بازه یافت نشد.
								</div>
							) : (
								<div className="border border-gray-200 dark:border-[#3a151c] rounded-xl overflow-hidden">
									<div className="max-h-96 overflow-y-auto overflow-x-auto">
										<table className="w-full text-xs">
											<thead className="sticky top-0 bg-gray-100 dark:bg-[#3a151c]">
												<tr>
													{table.head.map((h, hi) => (
														<th
															key={hi}
															className="px-3 py-2.5 text-right font-DanaDemiBold text-gray-600 dark:text-gray-300 whitespace-nowrap"
														>
															{h}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{table.rows.map((row, ri) => (
													<tr
														key={ri}
														className="border-t border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
													>
														{row.map((cell, ci) => {
															// biome-ignore lint/suspicious/noArrayIndexKey: سلول سرور-ساخته
															return (
																<td
																	key={ci}
																	className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap font-DanaMedium"
																>
																	{cell}
																</td>
															)
														})}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
						</div>
					))}

					<p className="text-center text-[11px] text-gray-400 dark:text-gray-500 font-DanaMedium">
						سین‌شین فودپارک — تولید گزارش
					</p>
				</div>
			)}
		</div>
	)
})
