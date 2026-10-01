// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 27 از 31
// مسیر مقصد: apps/web/src/components/admin/TranslationQueueBox.tsx
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/components/admin/TranslationQueueBox.tsx
// round-35 — کارت «ترجمه‌ی خودکار محتوا (عربی)» روی داشبورد ادمین اصلی.
//
// طراحی (کپی زبانیِ SystemStatusBox):
//  • دو کوئری هوک مرکزی useTranslationQueue با پول تطبیقی
//    (صف فعال → ۵s؛ ساکن → ۳۰s).
//  • خروجی مترجم آفلاین NLLB با بج «خودکار» ذخیره می‌شود؛ اولین
//    ویرایش دستیِ ادمین آن را «دستی» برمی‌گرداند (قرارداد رارد ۳۴).
//  • مترجم آفلاین → صف pending می‌ماند و سایت فارسی سرو می‌کند؛
//    دکمه‌ی bulk در این حالت غیرفعال نمی‌شود (صف‌کردن مجاز است).
//  • خرابی خودِ کوئری = حالت خطای کارت (نه کرش صفحه).

import type { TranslationEntityType, TranslationJobDto } from '@sinshin/shared'
import type { ReactNode } from 'react'
import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Loader,
	Play,
	Repeat,
	Translate,
} from 'reicon-react'
import { Skeleton } from '#/components/LoadingSkeletons'
import { useTranslationQueue } from '#/hooks/admin/useTranslationQueue'
import { faNum, formatRelative } from '#/utils/format'

/** برچسب فارسی انواع موجودیت — ترتیب رسمی رارد ۳۵ */
const ENTITY_LABELS: Record<TranslationEntityType, string> = {
	product: 'محصولات',
	mainCategory: 'دسته‌های اصلی',
	category: 'دسته‌های محصولات',
	article: 'مقالات',
	articleCategory: 'دسته‌های مقاله',
	articleSubCategory: 'ساب‌دسته‌های مقاله',
	gallery: 'گالری',
	terms: 'قوانین و مقررات',
	about: 'صفحه‌ی «درباره ما»',
}

/** بج وضعیت job — رنگ‌ها مطابق بج‌های ترجمه‌ی ArField */
const JOB_STATUS: Record<
	TranslationJobDto['status'],
	{ label: string; cls: string }
> = {
	pending: {
		label: 'در صف',
		cls: 'bg-zinc-100 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
	},
	running: {
		label: 'در حال اجرا',
		cls: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
	},
	done: {
		label: 'انجام شد',
		cls: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
	},
	failed: {
		label: 'ناموفق',
		cls: 'bg-red-100 dark:bg-red-500/10 text-red-500 dark:text-red-400',
	},
}

/** یک خانه‌ی آمار صف — آیکون + برچسب + مقدار (چیدمان یکسان برای همه) */
function QueueStat({
	icon,
	label,
	value,
}: {
	icon: ReactNode
	label: string
	value: number
}) {
	return (
		<div className="flex items-center gap-3 min-w-0 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 px-3 py-2.5">
			<div className="w-9 h-9 rounded-lg bg-white dark:bg-[#2a1015] text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
				{icon}
			</div>
			<div className="min-w-0">
				<p className="text-xs text-gray-400 truncate">{label}</p>
				<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
					{faNum(value)}
				</p>
			</div>
		</div>
	)
}

/** ردیف job اخیر — نوع + شناسه (کوتاه) + بج وضعیت + تلاش + زمان + خطا */
function JobRow({ job }: { job: TranslationJobDto }) {
	const s = JOB_STATUS[job.status]
	return (
		<div className="py-2 border-b border-gray-100 dark:border-white/5 last:border-0">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-sm font-DanaMedium text-gray-800 dark:text-white truncate">
						{ENTITY_LABELS[job.entityType]}
					</span>
					<span
						className="text-[11px] font-mono text-gray-400 shrink-0"
						dir="ltr"
						title={job.entityId}
					>
						{job.entityId.slice(0, 8)}
					</span>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span
						className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-DanaDemiBold ${s.cls}`}
					>
						{s.label}
					</span>
					<span className="text-xs text-gray-400" title="تعداد تلاش / سقف تلاش">
						تلاش {faNum(job.attempts)}/{faNum(job.maxAttempts)}
					</span>
				</div>
			</div>
			<p className="text-xs text-gray-400 mt-0.5">
				{formatRelative(job.createdAt)}
				{job.lastError && (
					<span
						className="block text-red-400 dark:text-red-500/80 truncate"
						title={job.lastError}
					>
						{job.lastError.length > 90
							? `${job.lastError.slice(0, 90)}…`
							: job.lastError}
					</span>
				)}
			</p>
		</div>
	)
}

export function TranslationQueueBox() {
	const {
		status: data,
		isStatusLoading,
		isStatusError,
		refetchStatus,
		isStatusFetching,
		jobs,
		isJobsLoading,
		isBulkPending,
		enqueueAll,
		enqueueType,
	} = useTranslationQueue()

	if (isStatusLoading) {
		return (
			<section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<Skeleton className="h-6 w-56 mb-4" />
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
					{['q1', 'q2', 'q3', 'q4'].map((k) => (
						<Skeleton key={k} className="h-14" />
					))}
				</div>
				<Skeleton className="h-11 w-full sm:w-64" />
			</section>
		)
	}

	// خطای کوئری — کارت جمع می‌شود ولی داشبورد زنده می‌ماند
	if (isStatusError || !data) {
		return (
			<section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-2 text-red-500">
						<AlertTriangle size={20} />
						<h2 className="font-DanaDemiBold text-lg">
							صف ترجمه در دسترس نیست
						</h2>
					</div>
					<button
						type="button"
						onClick={() => void refetchStatus()}
						className="text-sm text-primary dark:text-dark-primary font-DanaDemiBold hover:underline cursor-pointer"
					>
						تلاش دوباره
					</button>
				</div>
			</section>
		)
	}

	// ردیف‌های ناقص — ردیف‌های صفر حذف می‌شوند تا کارت جمع بماند
	const missingRows = (Object.keys(ENTITY_LABELS) as TranslationEntityType[])
		.map((type) => ({ type, count: data.missing[type] ?? 0 }))
		.filter((r) => r.count > 0)
	const totalMissing = missingRows.reduce((sum, r) => sum + r.count, 0)

	return (
		<section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
				<div className="flex items-center gap-3 min-w-0">
					<div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
						<Translate size={22} />
					</div>
					<div className="min-w-0">
						<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
							ترجمه‌ی خودکار محتوا (عربی)
						</h2>
						<p className="text-xs text-gray-400">
							مترجم آفلاین NLLB — خروجی ماشینی با بج "خودکار" مشخص می‌شود
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span
						title={data.translatorModel}
						className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-DanaDemiBold ${
							data.translatorUp
								? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
								: 'bg-red-100 dark:bg-red-500/10 text-red-500 dark:text-red-400'
						}`}
					>
						{data.translatorUp ? 'مترجم آنلاین' : 'مترجم آفلاین'}
					</span>
					<button
						type="button"
						onClick={() => void refetchStatus()}
						disabled={isStatusFetching}
						aria-label="بروزرسانی وضعیت صف ترجمه"
						className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-DanaDemiBold hover:text-primary dark:hover:text-dark-primary transition disabled:opacity-50 cursor-pointer"
					>
						<Repeat
							size={14}
							className={isStatusFetching ? 'animate-spin' : ''}
						/>
						بروزرسانی
					</button>
				</div>
			</div>

			{/* آمار صف */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
				<QueueStat
					icon={<Clock size={18} />}
					label="در صف"
					value={data.queue.pending}
				/>
				<QueueStat
					icon={<Play size={18} />}
					label="در حال اجرا"
					value={data.queue.running}
				/>
				<QueueStat
					icon={<CheckCircle size={18} />}
					label="انجام‌شده"
					value={data.queue.done}
				/>
				<QueueStat
					icon={<AlertTriangle size={18} />}
					label="ناموفق"
					value={data.queue.failed}
				/>
			</div>

			{/* محتوای ناقص + دکمه‌ی bulk */}
			{missingRows.length > 0 ? (
				<div className="mb-6">
					<div className="max-h-64 overflow-y-auto pl-1">
						{missingRows.map((row) => (
							<div
								key={row.type}
								className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-white/5 last:border-0"
							>
								<p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300 min-w-0">
									{ENTITY_LABELS[row.type]}{' '}
									<span className="text-xs text-gray-400">
										{faNum(row.count)} ناقص
									</span>
								</p>
								<button
									type="button"
									onClick={() => enqueueType(row.type)}
									disabled={isBulkPending}
									className="min-h-[44px] px-5 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold hover:bg-primary/20 dark:hover:bg-dark-primary/20 transition cursor-pointer disabled:opacity-50 shrink-0"
								>
									ترجمه
								</button>
							</div>
						))}
					</div>
					<button
						type="button"
						onClick={enqueueAll}
						disabled={isBulkPending || totalMissing === 0}
						className="mt-4 w-full sm:w-auto min-h-[44px] px-6 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2"
					>
						{isBulkPending && <Loader size={16} className="animate-spin" />}
						{isBulkPending ? 'در حال صف‌کردن…' : 'ترجمه‌ی همه‌ی موارد ناقص'}
					</button>
				</div>
			) : (
				<p className="mb-6 flex items-center gap-2 text-sm font-DanaMedium text-emerald-600 dark:text-emerald-400">
					<CheckCircle size={16} />
					همه‌ی محتوا ترجمه شده است ✓
				</p>
			)}

			{/* jobهای اخیر — جدیدترین اول */}
			<div>
				<h3 className="text-sm font-DanaDemiBold text-gray-600 dark:text-gray-300 mb-2">
					آخرین کارهای ترجمه ({faNum(jobs.length)})
				</h3>
				<div className="max-h-80 overflow-y-auto pl-1">
					{isJobsLoading ? (
						<div className="space-y-2 pt-1">
							{['j1', 'j2', 'j3'].map((k) => (
								<Skeleton key={k} className="h-10" />
							))}
						</div>
					) : jobs.length === 0 ? (
						<p className="py-2 text-xs text-gray-400">
							هنوز کاری در صف ثبت نشده است
						</p>
					) : (
						jobs.map((job) => <JobRow key={job.id} job={job} />)
					)}
				</div>
			</div>
		</section>
	)
}
