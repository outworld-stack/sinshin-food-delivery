// ═══════════════════════════════════════════════════════════════
// stage-64 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/routes/admin/notifications/index.tsx
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی stage-49)
// تغییر: ① کارت «آزمایش خط پوش این دستگاه» — وضعیت محلی مرورگر +
//        اشتراک‌های سرور + دکمه‌ی فعال‌سازی (کلیک = مجوز) + «پوش تستی»
//        واقعی به اشتراک‌های خودم با تفسیر نتیجه (مثلث عیب‌یابی) — ابزارِ
//        راستی‌آزمایی سرِتا‌سرِ خط بعد از فلوی مجوزِ مبتنی بر کلیک.
//        ② متن راهنمای «گیرندگان» هم‌راستای stage-64 شد: پوشِ broadcast
//        حالا فقط به کاربران عادیِ غیربن می‌رود (هم‌راستای صندوق) —
//        ادمین‌ها با «پوش تستی» خط خودشان را می‌سنجند.
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/routes/admin/notifications/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (بازخورد ۱ + ۶):
//   • دکمه‌ی «اعمال فیلتر / پاک‌سازی» در باکس تاریخچه بازطراحی شد:
//     ردیف کاملِ اختصاصی (col-span-full)، دو دکمه کنار هم، متن یک‌خطی
//     (whitespace-nowrap)، پدینگ مناسب، آیکون، ریسپانسیو در همه‌ی سایزها
//   • زیر سربرگ تاریخچه: راهنمای کوتاه معنای «گیرندگان» (شمارش صندوق
//     کاربران عادی؛ پوش به همه‌ی مشترکان فعال — حتی ادمین — می‌رسد)
// ═══════════════════════════════════════════════════════════════
// stage-48 — تاریخچه‌ی ارسال + فیلتر پیشرفته (بدون باکس تست) حفظ شد

// src/routes/admin/notifications/index.tsx
import type {
	NotificationHistoryData,
	NotificationLogDto,
} from '@sinshin/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
	BellRing,
	CalendarSearch,
	Eraser,
	Filter,
	Send,
} from 'reicon-react'
import {
	FILTER_INPUT_CLS,
	FILTER_LABEL_CLS,
	MobileFilterTrigger,
} from '#/components/admin/filters'
import { Pagination } from '#/components/Pagination'
import { BottomSheet } from '#/components/shared/BottomSheet'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { useI18nSafe } from '#/i18n'
import { authJson } from '#/lib/api-fetch'
import { enablePush, getPushState, type PushState } from '#/lib/push-subscription'
import { jalaliFromISO, jalaliToGregorian } from '#/utils/persianDate'

/**
 * stage-48 — آهنگساز نوتیفیکیشن ادمین (+ ادمین۲).
 *  • پخش عمومی: همه‌ی کاربران (صندوق + پوش مشترکان) — ثبت در تاریخچه
 *  • تاریخچه: همه‌ی ارسال‌های گروهی با فیلتر پیشرفته
 * گارد: روت /admin هم admin و هم admin2 را رد می‌کند؛ مجوزهای
 * notificationsRead/notificationsSend داخل همین صفحه چک می‌شوند.
 */
export const Route = createFileRoute('/admin/notifications/')({
	ssr: false,
	component: AdminNotificationsPage,
})

/**
 * stage-50 — صفحه‌بندی: پیش‌فرض ۵ + گزینه‌ی ۵/۱۰/۲۰/۵۰
 * (خواسته‌ی صریح — مثل بقیه‌ی صفحات پنل)
 */
const DEFAULT_PAGE_SIZE = 5
const PAGE_SIZES = [5, 10, 20, 50]

const TYPE_OPTIONS = [
	{ value: 'all', label: 'همه انواع' },
	{ value: 'broadcast', label: 'پیام عمومی' },
	{ value: 'product_discount', label: 'تخفیف محصول' },
	{ value: 'coupon', label: 'کوپن' },
	{ value: 'coupon_nudge', label: 'یادآور کوپن' },
	{ value: 'system', label: 'سیستم' },
] as const

const SENDER_OPTIONS = [
	{ value: 'all', label: 'همه فرستنده‌ها' },
	{ value: 'admin', label: 'ادمین اصلی' },
	{ value: 'admin2', label: 'ادمین سطح ۲' },
	{ value: 'system', label: 'سیستم (خودکار)' },
] as const

/** بج نوع + بج فرستنده — مشترک ردیف‌ها */
function TypeBadge({ type }: { type: string }) {
	const cfg =
		type === 'product_discount'
			? 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
			: type === 'broadcast'
				? 'bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary'
				: type === 'coupon' || type === 'coupon_nudge'
					? 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-300'
					: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400'
	const label = TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
	return (
		<span
			className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full shrink-0 ${cfg}`}
		>
			{label}
		</span>
	)
}

function SenderBadge({ role, name }: { role: string; name: string | null }) {
	const cfg =
		role === 'admin'
			? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
			: role === 'admin2'
				? 'bg-teal-100 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400'
				: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400'
	const label =
		role === 'admin'
			? 'ادمین اصلی'
			: role === 'admin2'
				? 'ادمین سطح ۲'
				: 'سیستم'
	return (
		<span
			className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full shrink-0 ${cfg}`}
		>
			{name ? `${label} · ${name}` : label}
		</span>
	)
}

/** زمان نسبی فارسی — همان سبک زنگ هدر */
function relativeFa(iso: string | Date): string {
	const d = typeof iso === 'string' ? new Date(iso) : iso
	const ms = Date.now() - d.getTime()
	if (!Number.isFinite(ms) || ms < 0) {
		return new Intl.DateTimeFormat('fa-IR', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		}).format(d)
	}
	const minutes = Math.floor(ms / 60_000)
	if (minutes < 1) return 'همین حالا'
	if (minutes < 60) return `${minutes} دقیقه پیش`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours} ساعت پیش`
	const days = Math.floor(hours / 24)
	if (days < 7) return `${days} روز پیش`
	return new Intl.DateTimeFormat('fa-IR', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(d)
}

function AdminNotificationsPage() {
	// stage-47/۴۸ — ادمین خارج از I18nProvider است؛ نسخه‌ی امن = فارسی خالص
	const { t } = useI18nSafe()
	const { isMainAdmin, permissions } = usePermissions()

	const canSend = isMainAdmin || permissions.notificationsSend
	const canReadHistory = isMainAdmin || permissions.notificationsRead

	// ── فرم پخش ──
	const [title, setTitle] = useState('')
	const [body, setBody] = useState('')
	const [url, setUrl] = useState('')
	const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
		'idle',
	)
	const [targeted, setTargeted] = useState(0)

	// ── stage-64 — آزمایش خط پوش این دستگاه ──
	const [localPush, setLocalPush] = useState<PushState | null>(null)
	const [serverSubs, setServerSubs] = useState<number | null>(null)
	const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
	const [testResult, setTestResult] = useState<{
		targeted: number
		acceptedByPushService: number
		gone: number
		durationMs: number
	} | null>(null)

	const refreshLocalPush = useCallback(async () => {
		const s = await getPushState().catch(() => null)
		setLocalPush(s)
		if (s?.state === 'granted') {
			// مجوز هست — وضعیت ثبت سرور را هم تازه کن (push-status سبک است)
			void authJson<{ subscriptions: number }>('/notifications/push-status', 'GET')
				.then((r) => setServerSubs(r.subscriptions))
				.catch(() => setServerSubs(null))
		}
	}, [])

	useEffect(() => {
		void refreshLocalPush()
	}, [refreshLocalPush])

	const onEnablePush = async () => {
		await enablePush().catch(() => null)
		await refreshLocalPush()
	}

	const sendTestPush = async () => {
		setTestStatus('sending')
		setTestResult(null)
		try {
			const json = await authJson<{
				targeted: number
				acceptedByPushService: number
				gone: number
				durationMs: number
			}>('/notifications/test-push', 'POST')
			setTestResult(json)
			setTestStatus('done')
			void refreshLocalPush()
		} catch {
			setTestStatus('error')
		}
	}

	/** برچسب وضعیت محلی — رنگ + متن فارسی */
	const localPushBadge = localPush
		? localPush.state === 'granted' && localPush.subscribed
			? { cls: 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400', text: 'اشتراک این مرورگر: فعال' }
			: localPush.state === 'granted'
				? { cls: 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400', text: 'مجوز هست، اشتراک ساخته نشده' }
				: localPush.state === 'default'
					? { cls: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400', text: 'مجوز نوتیف داده نشده' }
					: localPush.state === 'denied'
						? { cls: 'bg-red-100 text-red-500 dark:bg-red-500/10 dark:text-red-400', text: 'مجوز از مرورگر رد شده' }
						: { cls: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400', text: 'این مرورگر پوش را پشتیبانی نمی‌کند' }
		: null

	// ── فیلترهای تاریخچه (draft → اعمال) ──
	const [tempSearch, setTempSearch] = useState('')
	const [tempType, setTempType] = useState<string>('all')
	const [tempSender, setTempSender] = useState<string>('all')
	const [tempFromJ, setTempFromJ] = useState<string | null>(null)
	const [tempToJ, setTempToJ] = useState<string | null>(null)
	const [isFilterModalOpen, setIsFilterModalOpen] = useState(false)

	// اعمال‌شده‌ها (کلید کوئری)
	// stage-50 — تعداد آیتم هر صفحه (۵ پیش‌فرض؛ ۵/۱۰/۲۰/۵۰)
	const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE)

	const [applied, setApplied] = useState({
		search: '',
		type: 'all',
		sender: 'all',
		from: '',
		to: '',
		page: 1,
	})

	const setAppliedFilters = useCallback(() => {
		setApplied((prev) => ({
			...prev,
			search: tempSearch.trim(),
			type: tempType,
			sender: tempSender,
			from: tempFromJ ?? '',
			to: tempToJ ?? '',
			page: 1,
		}))
		setIsFilterModalOpen(false)
	}, [tempSearch, tempType, tempSender, tempFromJ, tempToJ])

	const resetFilters = useCallback(() => {
		setTempSearch('')
		setTempType('all')
		setTempSender('all')
		setTempFromJ(null)
		setTempToJ(null)
		setApplied({
			search: '',
			type: 'all',
			sender: 'all',
			from: '',
			to: '',
			page: 1,
		})
		setIsFilterModalOpen(false)
	}, [])

	// شمسی (ISO شمسی مثل 1404-07-12) → ISO میلادی (ابتدای/انتهای روز)
	const toIsoDay = useCallback((jalali: string, endOfDay: boolean): string => {
		const j = jalaliFromISO(jalali)
		if (!j) return ''
		const d = jalaliToGregorian(j)
		d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, 0, 0)
		return Number.isNaN(d.getTime()) ? '' : d.toISOString()
	}, [])

	const historyQuery = useQuery({
		queryKey: ['admin-notification-history', applied, limit],
		enabled: canReadHistory,
		queryFn: async () => {
			const params = new URLSearchParams()
			params.set('page', String(applied.page))
			params.set('limit', String(limit))
			if (applied.search) params.set('search', applied.search)
			if (applied.type !== 'all') params.set('type', applied.type)
			if (applied.sender !== 'all') params.set('sender', applied.sender)
			if (applied.from) params.set('from', toIsoDay(applied.from, false))
			if (applied.to) params.set('to', toIsoDay(applied.to, true))
			return authJson<NotificationHistoryData>(
				`/notifications/history?${params}`,
				'GET',
			)
		},
	})

	const items: NotificationLogDto[] = historyQuery.data?.items ?? []
	const total = historyQuery.data?.total ?? 0
	const totalPages = Math.max(1, Math.ceil(total / limit))

	const valid = title.trim().length >= 2 && body.trim().length >= 2
	const urlClean = url.trim() === '' || url.trim().startsWith('/')

	const sendBroadcast = async () => {
		if (!valid || !urlClean) return
		setStatus('sending')
		try {
			const json = await authJson<{ targeted?: number }>(
				'/notifications/broadcast',
				'POST',
				{
					title: title.trim(),
					body: body.trim(),
					...(url.trim() ? { url: url.trim() } : {}),
				},
			)
			setStatus('sent')
			setTargeted(json.targeted ?? 0)
			// تاریخچه فوراً رفرش شود — ارسالِ تازه دیده شود
			void historyQuery.refetch()
		} catch {
			setStatus('error')
		}
	}

	const inputCls =
		'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/10 outline-none text-sm text-gray-800 dark:text-white focus:border-primary dark:focus:border-dark-primary transition'

	const anyFilterActive =
		applied.search !== '' ||
		applied.type !== 'all' ||
		applied.sender !== 'all' ||
		applied.from !== '' ||
		applied.to !== ''

	// ── محتوای باکس فیلتر (مشترک دسکتاپ/موبایل — الگوی UsersFilterBox) ──
	const FilterBox = ({
		isMobileModal = false,
	}: {
		isMobileModal?: boolean
	}) => (
		<div
			className={
				isMobileModal
					? 'grid grid-cols-2 gap-4 items-end'
					: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-end'
			}
		>
			<div
				className={
					isMobileModal
						? 'col-span-2'
						: 'sm:col-span-2 lg:col-span-2 xl:col-span-2'
				}
			>
				<label className={FILTER_LABEL_CLS}>جستجو (عنوان یا متن)</label>
				<input
					type="text"
					value={tempSearch}
					onChange={(e) => setTempSearch(e.target.value)}
					placeholder="مثلا: تخفیف ویژه"
					className={FILTER_INPUT_CLS}
				/>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>نوع نوتیفیکیشن</label>
				<select
					value={tempType}
					onChange={(e) => setTempType(e.target.value)}
					className={`${FILTER_INPUT_CLS} cursor-pointer`}
				>
					{TYPE_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>فرستنده</label>
				<select
					value={tempSender}
					onChange={(e) => setTempSender(e.target.value)}
					className={`${FILTER_INPUT_CLS} cursor-pointer`}
				>
					{SENDER_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>از تاریخ (شمسی)</label>
				<PersianDatePicker
					id={isMobileModal ? 'nh-from-mobile' : 'nh-from'}
					value={tempFromJ}
					onChange={(iso) => setTempFromJ(iso)}
					placeholder="از..."
				/>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>تا تاریخ (شمسی)</label>
				<PersianDatePicker
					id={isMobileModal ? 'nh-to-mobile' : 'nh-to'}
					value={tempToJ}
					onChange={(iso) => setTempToJ(iso)}
					placeholder="تا..."
				/>
			</div>
			{/* stage-49 — دکمه‌ها: ردیف کامل اختصاصی + دو دکمه‌ی کنارِهم؛
				متن همیشه یک‌خطی (nowrap)، پدینگ افقی واقعی، آیکون؛
				در موبایل (BottomSheet) و دسکتاپ (گرید ۶ ستونه) هر دو
				جا دارند — قبلاً در xl دکمه داخل یک ستون ~۸۰ پیکسلی
				گیر می‌کرد و «اعمال فیلتر» دو خطی می‌شد. */}
			<div className="col-span-full flex items-stretch gap-2">
				<button
					type="button"
					onClick={setAppliedFilters}
					className="flex-1 min-w-0 h-10 px-4 sm:px-5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
				>
					<Filter size={16} className="shrink-0" />
					اعمال فیلتر
				</button>
				<button
					type="button"
					onClick={resetFilters}
					title="پاک‌کردن فیلترها"
					className="h-10 px-4 sm:px-5 rounded-lg bg-gray-100 dark:bg-[#2a1015] text-gray-500 dark:text-gray-400 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
				>
					<Eraser size={15} className="shrink-0" />
					پاک‌سازی
				</button>
			</div>
		</div>
	)

	return (
		<div className="max-w-4xl mx-auto space-y-6">
			{/* سربرگ */}
			<div className="flex items-center gap-3">
				<span className="w-12 h-12 rounded-2xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
					<BellRing size={24} />
				</span>
				<div>
					<h1 className="text-xl font-DanaDemiBold text-gray-800 dark:text-gray-100">
						{t['admin.notify.title']}
					</h1>
					<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
						{t['admin.notify.subtitle']}
					</p>
				</div>
			</div>

			{/* ── stage-64 — آزمایش خط پوش این دستگاه (خودم) ── */}
			<div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-4 sm:p-6 space-y-3">
				<div className="flex items-center justify-between gap-3 flex-wrap">
					<h2 className="font-DanaDemiBold text-base text-gray-800 dark:text-gray-100">
						آزمایش خط پوش این دستگاه
					</h2>
					{localPushBadge && (
						<span className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full shrink-0 ${localPushBadge.cls}`}>
							{localPushBadge.text}
						</span>
					)}
				</div>

				<p className="text-[11px] text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
					«پوش تستی» یک پیام واقعی (رمزنگاری + VAPID) به اشتراک‌های «حساب خودتان»
					می‌فرستد — بدون صندوق و تاریخچه. اگر روی دستگاه نمایش داده شد، خط پوش
					سرِتا‌سر سالم است.
				</p>

				{serverSubs !== null && (
					<p className="text-[11px] text-gray-400 dark:text-gray-500 font-DanaMedium">
						اشتراک‌های ثبت‌شده در سرور برای حساب شما: {serverSubs}
					</p>
				)}

				<div className="flex flex-wrap items-center gap-2">
					{(localPush?.state === 'default' || (localPush?.state === 'granted' && !localPush.subscribed)) && (
						<button
							type="button"
							onClick={() => void onEnablePush()}
							className="px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
						>
							{localPush?.state === 'default' ? 'فعال‌سازی نوتیفیکیشن' : 'ساخت اشتراک'}
						</button>
					)}
					<button
						type="button"
						disabled={testStatus === 'sending' || (localPush !== null && localPush.state !== 'granted')}
						onClick={() => void sendTestPush()}
						title={localPush !== null && localPush.state !== 'granted' ? 'اول مجوز نوتیف را فعال کنید' : undefined}
						className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-gray-700 dark:text-gray-200 text-[13px] font-DanaDemiBold hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Send size={15} />
						{testStatus === 'sending' ? 'در حال ارسال…' : 'ارسال پوش تستی'}
					</button>
				</div>

				{testStatus === 'error' && (
					<p className="text-xs text-red-500 font-DanaMedium">
						ارسال پوش تستی ناموفق بود — دوباره تلاش کنید.
					</p>
				)}
				{testStatus === 'done' && testResult && (
					<div
						className={`text-[11px] font-DanaMedium leading-relaxed rounded-xl px-3.5 py-2.5 border space-y-1 ${
							testResult.targeted === 0
								? 'bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20 text-amber-700 dark:text-amber-400'
								: testResult.acceptedByPushService > 0
									? 'bg-green-50 dark:bg-green-500/10 border-green-100 dark:border-green-500/20 text-green-700 dark:text-green-400'
									: 'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400'
							}`}
					>
						<p>
							هدف: {testResult.targeted} · پذیرش سرور پوش: {testResult.acceptedByPushService}
							{testResult.gone > 0 ? ` · اشتراک مرده: ${testResult.gone}` : ''} · {testResult.durationMs}ms
						</p>
						{testResult.targeted === 0 ? (
							<p>هیچ اشتراکی برای حساب شما ثبت نشده — اول «فعال‌سازی نوتیفیکیشن» را بزنید.</p>
						) : testResult.acceptedByPushService > 0 ? (
							<p>
								سرور پوش پیام را پذیرفت ✓ — اگر روی دستگاه چیزی ندیدید، مشکل سمت مرورگر
								است: نوتیف سیستم‌عامل روشن باشد، مرورگر بسته‌ی کامل (نه minimize) و در iOS
								فقط PWA نصب‌شده پوش می‌گیرد.
							</p>
						) : (
							<p>سرور پوش پیام را نپذیرفت — اشتراک مرده/خطا؛ لاگ سرور ([notify] پوش تستی) را ببینید.</p>
						)}
					</div>
				)}
			</div>

			{/* ── فرم ارسال (ادمین اصلی یا notificationsSend) ── */}
			{canSend && (
				<div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-6 space-y-4">
					<div>
						<label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
							{t['admin.notify.notifTitle']}
						</label>
						<input
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value.slice(0, 120))}
							placeholder="مثلاً: 🎉 کمپین ویژه آخر هفته"
							className={inputCls}
							dir="rtl"
						/>
						<p className="text-[10px] text-gray-400 mt-1">{title.length}/120</p>
					</div>

					<div>
						<label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
							{t['admin.notify.body']}
						</label>
						<textarea
							value={body}
							onChange={(e) => setBody(e.target.value.slice(0, 300))}
							placeholder="مثلاً: با کد WEEKEND همه‌ی پیتزاها ۲۰٪ تخفیف دارند!"
							rows={3}
							className={`${inputCls} resize-none`}
							dir="rtl"
						/>
						<p className="text-[10px] text-gray-400 mt-1">{body.length}/300</p>
					</div>

					<div>
						<label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
							{t['admin.notify.url']}
						</label>
						<input
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="/products"
							className={inputCls}
							dir="ltr"
						/>
						{url.trim() !== '' && !urlClean && (
							<p className="text-[10px] text-red-500 mt-1">
								فقط مسیر داخلی (شروع با /) مجاز است.
							</p>
						)}
					</div>

					<button
						type="button"
						disabled={!valid || !urlClean || status === 'sending'}
						onClick={() => void sendBroadcast()}
						className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Send size={18} />
						{status === 'sending'
							? t['admin.notify.sending']
							: t['admin.notify.send']}
					</button>

					{status === 'sent' && (
						<p className="text-xs text-green-600 dark:text-green-400 font-DanaMedium text-center bg-green-50 dark:bg-green-500/10 rounded-xl py-3">
							✓ {t['admin.notify.sent'].replace('{n}', String(targeted))}
						</p>
					)}
					{status === 'error' && (
						<p className="text-xs text-red-500 font-DanaMedium text-center">
							ارسال ناموفق بود — دوباره تلاش کن.
						</p>
					)}
				</div>
			)}

			{/* ادمین۲ بدون هیچ مجوزی → پیام روشن */}
			{!canSend && !canReadHistory && (
				<div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-8 text-center">
					<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
						دسترسی «مشاهده تاریخچه نوتیفیکیشن‌ها» و «ارسال نوتیفیکیشن» برای شما
						فعال نیست — از ادمین اصلی بخواهید در بخش دسترسی‌ها فعالشان کند.
					</p>
				</div>
			)}

			{/* ── تاریخچه‌ی ارسال (ادمین اصلی یا notificationsRead) ── */}
			{canReadHistory && (
				<div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-4 sm:p-6 space-y-4">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-gray-100 flex items-center gap-2">
							<CalendarSearch
								size={20}
								className="text-primary dark:text-dark-primary"
							/>
							{t['admin.notify.historyTitle']}
							{total > 0 && (
								<span className="text-[11px] text-gray-400 font-DanaMedium">
									({total} مورد)
								</span>
							)}
						</h2>
						{anyFilterActive && (
							<button
								type="button"
								onClick={resetFilters}
								className="text-[11px] text-primary dark:text-dark-primary hover:underline font-DanaMedium cursor-pointer"
							>
								حذف فیلترها
							</button>
						)}
					</div>

					{/* stage-64 — معنای «گیرندگان»: پوشِ broadcast هم‌راستای صندوق شد —
						فقط کاربران عادیِ غیربن. ادمین‌ها برای آزمونِ خط خودشان از
						«پوش تستی» بالای همین صفحه استفاده می‌کنند. */}
					<p className="text-[11px] text-gray-400 dark:text-gray-500 font-DanaMedium leading-relaxed bg-gray-50 dark:bg-[#1a0a0e] rounded-xl px-3.5 py-2.5 border border-gray-100 dark:border-[#3a151c]">
						«گیرندگان» = تعداد کاربران عادی (غیربن) که پیام در صندوق‌شان ثبت
						شد؛ پوشِ Web Push هم به همین مخاطبان می‌رود (مشترک‌هایشان).
						ادمین‌ها/ادمین۲ها و کاربران بن‌شده هدف نیستند — برای آزمونِ خط
						پوشِ خودتان از کارت «آزمایش خط پوش این دستگاه» استفاده کنید.
					</p>

					{/* فیلتر دسکتاپ */}
					<div className="hidden md:block">
						<FilterBox />
					</div>

					{/* فیلتر موبایل */}
					<MobileFilterTrigger
						label="فیلترهای تاریخچه"
						onClick={() => setIsFilterModalOpen(true)}
					/>

					{/* لیست */}
					{historyQuery.isLoading ? (
						<div className="space-y-3">
							{Array.from({ length: 5 }).map((_, i) => (
								<div
									key={i}
									className="h-16 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse"
								/>
							))}
						</div>
					) : historyQuery.isError ? (
						<div className="flex flex-col items-center gap-3 py-10 text-center">
							<p className="text-sm text-red-500 font-DanaMedium">
								دریافت تاریخچه ناموفق بود.
							</p>
							<button
								type="button"
								onClick={() => void historyQuery.refetch()}
								className="px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium cursor-pointer"
							>
								تلاش مجدد
							</button>
						</div>
					) : items.length === 0 ? (
						<div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500 font-DanaMedium">
							{anyFilterActive
								? 'نتیجه‌ای برای این فیلترها نیست.'
								: 'هنوز نوتیفیکیشنی ارسال نشده است.'}
						</div>
					) : (
						<>
							<div className="space-y-3">
								{items.map((n) => (
									<div
										key={n.id}
										className="p-3.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c] flex flex-col gap-2"
									>
										<div className="flex items-center gap-2 flex-wrap">
											<TypeBadge type={n.type} />
											<SenderBadge role={n.senderRole} name={n.senderName} />
											<span className="text-[10px] text-gray-400 mr-auto shrink-0">
												{relativeFa(n.createdAt)}
											</span>
										</div>
										<div className="min-w-0">
											<p className="text-sm font-DanaDemiBold text-gray-800 dark:text-gray-100 truncate">
												{n.title}
											</p>
											<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed line-clamp-2 mt-0.5">
												{n.body}
											</p>
										</div>
										<div className="flex items-center gap-3 text-[10px] text-gray-400 font-DanaMedium">
											<span>گیرندگان: {n.audience}</span>
											{n.url && (
												<span dir="ltr" className="truncate max-w-45">
													{n.url}
												</span>
											)}
										</div>
									</div>
								))}
							</div>

							{/* stage-50 — صفحه‌بندی مشترک: «X از Y» + انتخابِ تعداد در
							صفحه (۵ پیش‌فرض — ۵/۱۰/۲۰/۵۰ مثل سایر صفحات پنل) +
							شماره‌صفحه‌های هوشمند؛ قبلاً فقط دو دکمه‌ی قبل/بعد
							با ۲۰ آیتمِ ثابت بود */}
							<Pagination
								currentPage={applied.page}
								totalPages={totalPages}
								itemsPerPage={limit}
								totalItems={total}
								onPageChange={(page) => setApplied((p) => ({ ...p, page }))}
								onItemsPerPageChange={(n) => {
									setLimit(n)
									setApplied((p) => ({ ...p, page: 1 }))
								}}
								pageSizeOptions={PAGE_SIZES}
							/>
						</>
					)}
				</div>
			)}

			{/* مودال فیلتر موبایل */}
			<BottomSheet
				isOpen={isFilterModalOpen}
				onClose={() => setIsFilterModalOpen(false)}
				title="فیلترهای تاریخچه"
			>
				<FilterBox isMobileModal />
			</BottomSheet>
		</div>
	)
}