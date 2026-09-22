// src/components/admin/reports/ReportsBox.tsx
// round-12 — مرکز گزارشات داشبورد ادمین اصلی — بازطراحی کامل.
//
// چه چیزی عوض شد:
//  • باکس دوم «نتیجه» حذف شد (دوباره‌کاری — همان اطلاعات در صفحات
//    سفارشات/کاربران/کوپن‌ها با فیلتر قابل مشاهده است). این‌جا فقط:
//    فیلتر پیشرفته + دکمهٔ تولید + نوار خلاصه + چاپ.
//  • چاپ قبلی (کلون DOM داخل #dynamic-print-area + @media print اپ) در
//    هر دو نسخهٔ قبلی صفحهٔ سفید می‌داد: CSS چاپ اپ، ارتفاع/overflow لایه‌ها
//    و جدول داخل max-h-96 همه روی خروجی اثر می‌گذاشتند. حالا چاپ = سند
//    HTML مستقل در iframe مخفی (lib/printDocument) — مصون از استایل اپ،
//    با @page و فونت خودش و thead تکرارشونده در صفحه‌بندی.
//  • مرز «از» = ابتدای روز (قبلاً ظهر روز اول بود و نیمهٔ اول روزِ اول
//    از همهٔ گزارش‌ها حذف می‌شد).
//  • دراپ‌داون ادمین فقط برای گزارش «کار ادمین‌های سطح ۲» — audit خودش
//    لاگ ادمین اصلی است و فیلتر ادمین بی‌معنا بود.
//  • پریست‌های سریع بازه + شمار ردیف‌ها + انتخاب خودکار landscape برای
//    جدول‌های پهن (سفارشات ۱۱ ستونه در A4 عمودی بریده می‌شد).
//
//  • سیستم کشی: React Query با کلیدِ کامل فیلترها + staleTime ۵ دقیقه.

import { useQuery } from '@tanstack/react-query'
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useState,
} from 'react'
import { FileText, Printer, Search, X } from 'reicon-react'
import { Skeleton } from '#/components/LoadingSkeletons'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { type PrintPaper, printHtmlDocument } from '#/lib/printDocument'
import { type AdminReportType, queryAdminReport } from '#/server/reports'
import { useToastStore } from '#/stores/toastStore'
import { formatDate } from '#/utils/format'
import {
	formatJalali,
	gregorianToJalali,
	type JalaliDate,
	jalaliFromISO,
	jalaliToGregorian,
	jalaliToISO,
	todayJalali,
} from '#/utils/persianDate'
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

// ── پریست‌های بازه — بر پایهٔ تقویم شمسی ──
type PresetKey = 'today' | 'last7' | 'last30' | 'thisMonth' | 'prevMonth'

const PRESETS: { key: PresetKey; label: string }[] = [
	{ key: 'today', label: 'امروز' },
	{ key: 'last7', label: '۷ روز اخیر' },
	{ key: 'last30', label: '۳۰ روز اخیر' },
	{ key: 'thisMonth', label: 'این ماه' },
	{ key: 'prevMonth', label: 'ماه گذشته' },
]

/** N روز قبل (شمسی) — از میان گریگورین برای دقت مرز ماه‌ها */
function jalaliDaysAgo(base: JalaliDate, days: number): JalaliDate {
	const g = jalaliToGregorian(base)
	g.setDate(g.getDate() - days)
	return gregorianToJalali(g)
}

function prevJalaliMonth(base: JalaliDate): JalaliDate {
	return base.month > 1
		? { year: base.year, month: base.month - 1, day: 1 }
		: { year: base.year - 1, month: 12, day: 1 }
}

function presetRange(key: PresetKey): { from: string; to: string } {
	const today = todayJalali()
	switch (key) {
		case 'today':
			return { from: jalaliToISO(today), to: jalaliToISO(today) }
		case 'last7':
			return {
				from: jalaliToISO(jalaliDaysAgo(today, 6)),
				to: jalaliToISO(today),
			}
		case 'last30':
			return {
				from: jalaliToISO(jalaliDaysAgo(today, 29)),
				to: jalaliToISO(today),
			}
		case 'thisMonth':
			return {
				from: jalaliToISO({ year: today.year, month: today.month, day: 1 }),
				to: jalaliToISO(today),
			}
		case 'prevMonth': {
			const start = prevJalaliMonth({
				year: today.year,
				month: today.month,
				day: 1,
			})
			// روز آخر ماه قبل = یک روز قبل از روز اول همین ماه
			const end = jalaliDaysAgo(
				{ year: today.year, month: today.month, day: 1 },
				1,
			)
			return { from: jalaliToISO(start), to: jalaliToISO(end) }
		}
	}
}

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
	| { type: 'SET_RANGE'; payload: { from: string; to: string } }
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
		case 'SET_RANGE':
			return {
				...state,
				fromJalali: action.payload.from,
				toJalali: action.payload.to,
			}
		case 'CLEAR_DATES':
			return { ...state, fromJalali: null, toJalali: null }
		default:
			return state
	}
}

/** شمسی ISO → میلادی ISO — از: ابتدای روز / تا: پایان روز (رفع باگ ظهر) */
function jalaliToGregorianISO(
	iso: string | null,
	endOfDay: boolean,
): string | null {
	if (!iso) return null
	const j = jalaliFromISO(iso)
	if (!j) return null
	const d = jalaliToGregorian(j)
	if (endOfDay) d.setHours(23, 59, 59, 999)
	else d.setHours(0, 0, 0, 0) // round-12: قبلاً ظهر بود — نیمهٔ اول روز اول حذف می‌شد
	return d.toISOString()
}

const faJalali = (iso: string | null): string => {
	const j = iso ? jalaliFromISO(iso) : null
	return j ? formatJalali(j) : 'ابتدای داده‌ها'
}

// round-14 — قالب چاپ گزارش: ستونی/رسیدی (موبایل) یا دسکتاپ/A4 — انتخاب
// کاربر در localStorage می‌ماند تا هر بار دوباره تنظیم نشود.
const PRINT_MODE_KEY = 'sinshin-report-print-mode'
function loadPrintMode(): PrintPaper {
	try {
		const v = localStorage.getItem(PRINT_MODE_KEY)
		return v === 'receipt' ? 'receipt' : 'a4'
	} catch {
		return 'a4'
	}
}

export const ReportsBox = memo(function ReportsBox() {
	const [state, dispatch] = useReducer(reportsReducer, initialState)
	// فیلترهای «کامیت‌شده» — کوئری فقط با دکمه‌ی تولید شروع می‌شود؛
	// تغییر فیلترها نتیجه‌ی روی صفحه را وسط کار عوض نمی‌کند.
	const [committed, setCommitted] = useState<ReportsState | null>(null)
	const showToast = useToastStore((s) => s.showToast)

	// round-14 — قالب چاپ (ستونی/موبایل ↔ دسکتاپ) — پس از mount از localStorage
	const [printMode, setPrintMode] = useState<PrintPaper>('a4')
	useEffect(() => {
		setPrintMode(loadPrintMode())
	}, [])
	const changePrintMode = useCallback((mode: PrintPaper) => {
		setPrintMode(mode)
		try {
			localStorage.setItem(PRINT_MODE_KEY, mode)
		} catch {
			/* noop */
		}
	}, [])

	// دراپ‌داون‌ها — ادمین‌های سطح ۲ فقط برای گزارشِ کارشان؛ audit لاگِ
	// ادمین اصلی است و فیلتر ادمین رویش بی‌معنا بود (round-12 حذف شد)
	const needsAdmins = state.type === 'admin2'
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

	// ── چاپ — سند مستقل؛ landscape خودکار برای جدول‌های پهن (فقط A4) ──
	const handlePrint = useCallback(() => {
		if (!report) return
		const widest = Math.max(0, ...report.tables.map((t) => t.head.length))
		printHtmlDocument({
			fileName: `sinshin-report-${committed?.type ?? 'report'}`,
			brand: 'سین‌شین فودپارک',
			paper: printMode,
			landscape: printMode === 'a4' && widest >= 8,
			sections: [
				{
					heading: report.title,
					metaLines: [
						report.subtitle,
						committed?.fromJalali || committed?.toJalali
							? `بازه: از ${faJalali(committed?.fromJalali ?? null)} تا ${faJalali(committed?.toJalali ?? null)}`
							: 'بازه: همهٔ زمان‌ها',
						`زمان تولید: ${formatDate(new Date())}`,
					],
					stats: report.stats,
					tables: report.tables,
				},
			],
			footerNote: 'گزارش رسمی سین‌شین',
		})
		showToast(
			printMode === 'receipt'
				? 'قالب ستونی (رسیدی) — در پنجره چاپ، پرینتر رسیدی خود را انتخاب کنید'
				: 'از گزینه «Save as PDF» در پنجره چاپ استفاده کنید',
		)
	}, [report, committed, printMode, showToast])

	const activeType = REPORT_TYPES.find((t) => t.key === state.type)
	const hasDates = state.fromJalali || state.toJalali

	// پریست فعال؟ (برای هایلایت)
	const activePreset = useMemo(() => {
		if (!state.fromJalali || !state.toJalali) return null
		for (const p of PRESETS) {
			const r = presetRange(p.key)
			if (r.from === state.fromJalali && r.to === state.toJalali) return p.key
		}
		return null
	}, [state.fromJalali, state.toJalali])

	const totalRows = report?.tables.reduce((s, t) => s + t.rows.length, 0) ?? 0

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
							فیلتر را انتخاب و گزارش را چاپ/PDF کنید — داده‌های کامل در صفحات
							مدیریت همان بخش‌ها قابل مشاهده است
						</p>
					</div>
				</div>
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

			{/* ── بازهٔ سریع — پریست‌ها ── */}
			<div className="mb-4">
				<p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-3">
					بازهٔ سریع
				</p>
				<div className="flex flex-wrap gap-2">
					{PRESETS.map((p) => (
						<button
							key={p.key}
							type="button"
							onClick={() =>
								dispatch({ type: 'SET_RANGE', payload: presetRange(p.key) })
							}
							className={`px-3.5 py-1.5 rounded-xl text-xs font-DanaMedium transition cursor-pointer ${
								activePreset === p.key
									? 'bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary border border-primary/30 dark:border-dark-primary/30'
									: 'bg-gray-50 dark:bg-[#1a0a0e] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] hover:bg-gray-100 dark:hover:bg-[#3a151c]'
							}`}
							aria-pressed={activePreset === p.key}
						>
							{p.label}
						</button>
					))}
				</div>
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

				{/* نوع‌محور: ادمین سطح ۲ */}
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

			{/* ── خلاصهٔ نتیجه — بدون جدول‌ها؛ فقط آمار + چاپ ── */}
			{isLoading && (
				<div className="mt-6 space-y-4">
					<Skeleton className="h-8 w-1/2" />
					<Skeleton className="h-24 w-full" />
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
				<div className="mt-6 pt-6 border-t border-gray-100 dark:border-white/5">
					<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
						<div className="text-center lg:text-right">
							<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
								{report.title}
							</h3>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-DanaMedium">
								{report.subtitle} · {totalRows.toLocaleString('fa-IR')} ردیف در{' '}
								{report.tables.length.toLocaleString('fa-IR')} جدول
							</p>
						</div>
						<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
							{/* round-14 — انتخاب قالب چاپ: ستونی (رسیدی/موبایل) یا دسکتاپ (A4) */}
							<div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
								<button
									type="button"
									onClick={() => changePrintMode('receipt')}
									aria-pressed={printMode === 'receipt'}
									title="چاپ ستونی در سایز موبایل — مناسب پرینترهای رسیدی مغازه"
									className={`px-3 py-2 rounded-lg text-xs font-DanaDemiBold transition cursor-pointer whitespace-nowrap ${
										printMode === 'receipt'
											? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
											: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
									}`}
								>
									ستونی / موبایل
								</button>
								<button
									type="button"
									onClick={() => changePrintMode('a4')}
									aria-pressed={printMode === 'a4'}
									title="چاپ در سایز دسکتاپ — A4 (افقی برای جدول‌های پهن)"
									className={`px-3 py-2 rounded-lg text-xs font-DanaDemiBold transition cursor-pointer whitespace-nowrap ${
										printMode === 'a4'
											? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
											: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
									}`}
								>
									دسکتاپ / A4
								</button>
							</div>
							<button
								type="button"
								onClick={handlePrint}
								disabled={totalRows === 0 && report.stats.length === 0}
								className="px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
							>
								<Printer size={16} />
								چاپ / ذخیره PDF
							</button>
						</div>
					</div>

					{report.stats.length > 0 && (
						<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
							{report.stats.map((s) => (
								<div
									key={s.label}
									className="bg-gray-50 dark:bg-[#1a0a0e] p-3.5 rounded-xl text-center"
								>
									<p className="text-[11px] text-gray-400 font-DanaMedium mb-1">
										{s.label}
									</p>
									<p className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">
										{s.value}
									</p>
								</div>
							))}
						</div>
					)}

					{totalRows === 0 && report.stats.length === 0 && (
						<div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm font-DanaMedium bg-gray-50 dark:bg-[#1a0a0e] rounded-xl">
							موردی در این بازه یافت نشد — بازه یا فیلترها را تغییر دهید.
						</div>
					)}
				</div>
			)}
		</div>
	)
})
