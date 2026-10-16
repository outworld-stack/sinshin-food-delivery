// ═══════════════════════════════════════════════════════════════
// stage-79 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/settings/RegistrationPermitCard.tsx
// وضعیت: فایل جدید
// کامیت پیشنهادی: stage seventy-nine
// ═══════════════════════════════════════════════════════════════

import type { RegistrationPermitStatus } from '@sinshin/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/components/admin/settings/RegistrationPermitCard.tsx
// stage-79 — کارت «مجوز ثبت‌نام ویژه» — فقط ادمین اصلی (چیدمان از
// SettingsPage که isMainAdmin چک می‌کند؛ بک هم requireAdmin گارد دارد).
//
// جریان: ادمین شماره را وارد می‌کند → مجوز صادر می‌شود → همان شماره
// می‌تواند (یک‌بار، تا انقضا) ثبت‌نام کند — حتی از دستگاهِ سوخته/مسدود —
// و بعد از ثبت‌نامِ موفق، دستگاهش بلاک می‌شود (سوختنِ سختِ permit-burn).
// مصرفِ مجوز اتمیک و داخل تراکنشِ ثبت‌نام است؛ لغو هر لحظه ممکن است.
import { memo, useCallback, useState } from 'react'
import {
	AlertTriangle,
	Ban,
	Check,
	Clock,
	Refresh,
	UserAdd,
} from 'reicon-react'
import {
	issueRegistrationPermit,
	revokeRegistrationPermit,
} from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { isValidIranPhone } from '#/utils/phone'
import { qk } from '#/utils/queryKeys'
import { settingsRegistrationPermitsOptions } from '#/utils/queryOptions'

/** گزینه‌های اعتبار مجوز (ساعت) — قرارداد بک: ۱ تا ۷۲ */
const TTL_OPTIONS: Array<{ hours: number; label: string }> = [
	{ hours: 12, label: '۱۲ ساعت' },
	{ hours: 24, label: '۲۴ ساعت' },
	{ hours: 48, label: '۴۸ ساعت' },
	{ hours: 72, label: '۷۲ ساعت' },
]

const STATUS_META: Record<
	RegistrationPermitStatus,
	{ label: string; chip: string; hint: string }
> = {
	pending: {
		label: 'در انتظار',
		chip: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
		hint: 'شماره می‌تواند ثبت‌نام کند',
	},
	used: {
		label: 'مصرف شد',
		chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300',
		hint: 'ثبت‌نام انجام شد و دستگاه سوخت',
	},
	expired: {
		label: 'منقضی',
		chip: 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400',
		hint: 'پنجره‌ی اعتبار گذشت',
	},
	revoked: {
		label: 'لغو شد',
		chip: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
		hint: 'ادمین قبل از مصرف لغو کرد',
	},
}

/** تاریخ خوانا برای پنل (ادمین، سمت کلاینت) */
function fmt(iso: string | null): string {
	if (!iso) return '—'
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return '—'
	return new Intl.DateTimeFormat('fa-IR', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(d)
}

/** ۶ رقم آخر uuid دستگاه — شناسه‌ی کوتاه برای ردگیری در پنل دستگاه‌ها */
function shortDevice(id: string): string {
	return id.replace(/-/g, '').slice(-6).toUpperCase()
}

/** نرمال‌سازی ارقام فارسی/عربی هنگام تایپ شماره (درسِ stage-77: کیبورد فارسی) —
 * کشفِ راستی‌آزماییِ مرورگرِ stage-79: کاستنِ خالصِ کد NUL می‌سازد نه رقم؛
 * افستِ کد ASCIIِ ارقام (+0x30) هم لازم است */
function normalizeTypedDigits(v: string): string {
	return v
		.replace(/[\u06F0-\u06F9]/g, (d) =>
			String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30),
		)
		.replace(/[\u0660-\u0669]/g, (d) =>
			String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30),
		)
		.replace(/[^0-9]/g, '')
}

export const RegistrationPermitCard = memo(function RegistrationPermitCard() {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const [phone, setPhone] = useState('')
	const [note, setNote] = useState('')
	const [ttlHours, setTtlHours] = useState(24)

	const {
		data: permits,
		isLoading,
		isFetching,
	} = useQuery(settingsRegistrationPermitsOptions)

	const issueMutation = useMutation({
		mutationFn: issueRegistrationPermit,
		onSuccess: (permit) => {
			queryClient.invalidateQueries({
				queryKey: qk.settingsRegistrationPermits,
			})
			setPhone('')
			setNote('')
			showToast(
				`مجوز ثبت‌نام برای ${permit.phone} صادر شد — تا ${fmt(permit.expiresAt)} معتبر است`,
			)
		},
		onError: (err) => {
			showToast(
				err instanceof Error ? err.message : 'صدور مجوز ناموفق بود',
				'error',
			)
		},
	})

	const revokeMutation = useMutation({
		mutationFn: revokeRegistrationPermit,
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: qk.settingsRegistrationPermits,
			})
			showToast('مجوز لغو شد')
		},
		onError: (err) => {
			showToast(
				err instanceof Error ? err.message : 'لغو مجوز ناموفق بود',
				'error',
			)
		},
	})

	const handlePhoneChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setPhone(normalizeTypedDigits(e.target.value).slice(0, 11))
		},
		[],
	)

	const handleNoteChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setNote(e.target.value.slice(0, 500))
		},
		[],
	)

	const handleIssue = useCallback(() => {
		if (!isValidIranPhone(phone)) {
			showToast('شماره موبایل معتبر نیست — الگوی درست: ۰۹۱۲۳۴۵۶۷۸۹', 'error')
			return
		}
		issueMutation.mutate({
			data: { phone, note: note.trim() || null, ttlHours },
		})
	}, [phone, note, ttlHours, issueMutation, showToast])

	const handleRevoke = useCallback(
		(id: string) => {
			revokeMutation.mutate({ data: { id } })
		},
		[revokeMutation],
	)

	const handleRefresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: qk.settingsRegistrationPermits })
	}, [queryClient])

	const pendingCount =
		permits?.filter((p) => p.status === 'pending').length ?? 0

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			{/* هدر */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-500/10 text-amber-500 flex items-center justify-center">
						<UserAdd size={22} />
					</span>
					<div>
						<p className="font-DanaDemiBold text-gray-800 dark:text-white">
							مجوز ثبت‌نام ویژه
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-xs">
							شماره‌ای که اینجا صادر کنید می‌تواند یک‌بار ثبت‌نام کند — حتی از
							دستگاه سوخته یا مسدود.
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={handleRefresh}
					aria-label="بازخوانی مجوزها"
					className="text-gray-400 hover:text-primary transition-colors p-2 cursor-pointer"
				>
					<Refresh size={16} className={isFetching ? 'animate-spin' : ''} />
				</button>
			</div>

			{/* توضیح جریان — سه گام */}
			<div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 flex items-start gap-2">
				<AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
				<p className="text-xs text-amber-700 dark:text-amber-400 font-DanaMedium leading-relaxed">
					شماره فقط در پنجره‌ی اعتبار و فقط برای «ثبت‌نامِ اول» معتبر است؛ مصرفِ
					مجوز اتمیک است و بعد از ثبت‌نامِ موفق، دستگاهِ همان شخص بلاک می‌شود — او
					برای ورود باید از دستگاه دیگری استفاده کند یا شما دستگاه را در پنل
					دستگاه‌ها باز کنید. ورودِ کاربرانِ موجود هیچ تغییری نمی‌کند.
				</p>
			</div>

			{/* فرم صدور */}
			<div className="mt-5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label
							htmlFor="permit-phone"
							className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2"
						>
							شماره موبایل
						</label>
						<input
							id="permit-phone"
							type="tel"
							inputMode="numeric"
							autoComplete="off"
							dir="ltr"
							value={phone}
							onChange={handlePhoneChange}
							placeholder="09xxxxxxxxx"
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm text-left font-mono"
						/>
					</div>
					<div>
						<label
							htmlFor="permit-ttl"
							className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2"
						>
							اعتبار مجوز
						</label>
						<select
							id="permit-ttl"
							value={ttlHours}
							onChange={(e) => setTtlHours(Number(e.target.value))}
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm cursor-pointer"
						>
							{TTL_OPTIONS.map((opt) => (
								<option key={opt.hours} value={opt.hours}>
									{opt.label}
								</option>
							))}
						</select>
					</div>
					<div className="sm:col-span-2">
						<label
							htmlFor="permit-note"
							className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2"
						>
							یادداشت (اختیاری — دلیل این استثنا در ممیزی می‌ماند)
						</label>
						<input
							id="permit-note"
							type="text"
							value={note}
							onChange={handleNoteChange}
							placeholder="مثلاً: مشتری حضوری، دستگاه قبلی سوخته بود"
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm"
						/>
					</div>
				</div>
				<div className="flex sm:flex-col justify-end items-stretch gap-2">
					<button
						type="button"
						onClick={handleIssue}
						disabled={issueMutation.isPending}
						className="px-5 py-2.5 rounded-xl bg-primary text-white font-DanaDemiBold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 shrink-0"
					>
						{issueMutation.isPending ? 'در حال صدور…' : 'صدور مجوز'}
					</button>
				</div>
			</div>

			{/* فهرست مجوزها */}
			<div className="mt-6">
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-2">
						<p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white">
							مجوزهای اخیر
						</p>
						{pendingCount > 0 && (
							<span className="text-[11px] px-2.5 py-1 rounded-full font-DanaMedium bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400">
								{pendingCount.toLocaleString('fa-IR')} فعال
							</span>
						)}
					</div>
				</div>

				{isLoading ? (
					<div className="h-32 rounded-xl bg-gray-100 dark:bg-black/10 animate-pulse" />
				) : !permits || permits.length === 0 ? (
					<div className="h-32 rounded-xl border border-dashed border-gray-300 dark:border-[#3a151c] flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
						<UserAdd size={22} />
						<p className="text-xs font-DanaMedium">هنوز مجوزی صادر نشده است</p>
					</div>
				) : (
					<ul
						className="max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-[#3a151c] divide-y divide-gray-100 dark:divide-[#2a1015]/80"
						aria-label="فهرست مجوزهای ثبت‌نام"
					>
						{permits.map((p) => {
							const meta = STATUS_META[p.status]
							return (
								<li
									key={p.id}
									className="p-4 flex flex-wrap items-center gap-3 justify-between hover:bg-gray-50/60 dark:hover:bg-black/10 transition-colors"
								>
									<div className="flex items-center gap-3 min-w-0">
										<span
											className={`text-[11px] px-2.5 py-1 rounded-full font-DanaMedium shrink-0 ${meta.chip}`}
										>
											{meta.label}
										</span>
										<span
											dir="ltr"
											className="text-sm font-DanaDemiBold text-gray-800 dark:text-white"
										>
											{p.phone}
										</span>
									</div>
									<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
										<span className="flex items-center gap-1" title={meta.hint}>
											<Clock size={12} />
											{p.status === 'used' && p.usedAt
												? `مصرف: ${fmt(p.usedAt)}`
												: p.status === 'revoked' && p.revokedAt
													? `لغو: ${fmt(p.revokedAt)}`
													: `انقضا: ${fmt(p.expiresAt)}`}
										</span>
										{p.usedDeviceId && (
											<span
												dir="ltr"
												className="font-mono flex items-center gap-1"
												title="دستگاهِ مصرف‌کننده — در پنل دستگاه‌ها جستجو کنید"
											>
												<Ban size={12} />
												DEV-{shortDevice(p.usedDeviceId)}
											</span>
										)}
										{p.note && (
											<span className="max-w-40 truncate" title={p.note}>
												{p.note}
											</span>
										)}
									</div>
									<div className="flex items-center gap-2">
										{p.status === 'pending' ? (
											<button
												type="button"
												onClick={() => handleRevoke(p.id)}
												disabled={revokeMutation.isPending}
												className="text-[11px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-DanaMedium cursor-pointer disabled:opacity-50"
											>
												لغو
											</button>
										) : p.status === 'used' ? (
											<Check
												size={14}
												className="text-green-500"
												aria-label="مصرف شده"
											/>
										) : null}
									</div>
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</div>
	)
})
