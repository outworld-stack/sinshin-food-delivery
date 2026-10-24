import type {
	LocalPrintEnqueueInput,
	LocalPrintJobDto,
	LocalPrintKind,
} from '@sinshin/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, X } from 'reicon-react'
import { usePermissions } from '#/hooks/admin/usePermissions'
import {
	cancelLocalPrintJob,
	discardPendingLocalPrintJob,
	enqueueLocalPrintJob,
	getLocalPrintAgents,
	getLocalPrintAssignment,
	getLocalPrintJob,
	getLocalPrintJobs,
} from '#/lib/localPrintQueue'
import {
	buildPrintDocumentHtml,
	type PrintDocumentSpec,
	printHtmlDocumentAsync,
} from '#/lib/printDocument'
import { getStaffOrderInvoice } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import {
	buildInvoicePrintSpecs,
	buildLocalInvoiceJob,
} from '#/utils/invoicePrint'
import { LocalPrinterSettings } from './LocalPrinterSettings'
import { ReceiptPreviewPane } from './ReceiptPreviewPane'

interface InvoicePrintCenterModalProps {
	orderId: string
	deliveryType?: string | null
	onClose: () => void
}
const labels = { sales: 'فروش', kitchen: 'آشپزخانه' }
const statusLabels = {
	queued: 'در صف صندوق',
	claimed: 'در حال ارسال به ویندوز',
	spooled: 'پذیرفته‌شده در صف ویندوز',
	failed: 'ناموفق',
	uncertain: 'نتیجه نامشخص؛ چاپگر را بررسی کنید',
	cancelled: 'لغوشده',
}
const agentsKey = ['local-print-agents']
const assignmentKey = ['local-print-assignment']
const busyJob = (job: LocalPrintJobDto) =>
	job.status === 'queued' || job.status === 'claimed'
const pendingKey = (orderId: string) => `sinshin-pending-print:${orderId}`
type PendingJobs = Partial<Record<LocalPrintKind, LocalPrintEnqueueInput>>
function loadPending(orderId: string): PendingJobs {
	try {
		const raw = JSON.parse(sessionStorage.getItem(pendingKey(orderId)) ?? '{}')
		const result: PendingJobs = {}
		for (const kind of ['sales', 'kitchen'] as const) {
			const item = raw?.[kind]
			if (
				item?.kind === kind &&
				item.orderId === orderId &&
				typeof item.jobId === 'string' &&
				/^[a-f0-9-]{36}$/i.test(item.jobId) &&
				[384, 420, 576].includes(item.widthPx) &&
				Number.isInteger(item.heightPx) &&
				item.heightPx > 0 &&
				item.heightPx <= 4000 &&
				typeof item.rows === 'string' &&
				item.rows.length <= 384000
			)
				result[kind] = item
		}
		return result
	} catch {
		return {}
	}
}

/** Both admin levels use this center. Printing is queued; browser fallback is explicit. */
export const InvoicePrintCenterModal = memo(function InvoicePrintCenterModal({
	orderId,
	onClose,
}: InvoicePrintCenterModalProps) {
	const { permissions, isChecking } = usePermissions()
	const canManage = permissions.printingManage
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const [kinds, setKinds] = useState({ sales: true, kitchen: true })
	const [previewKind, setPreviewKind] = useState<LocalPrintKind>('sales')
	const [specs, setSpecs] = useState<
		Partial<Record<LocalPrintKind, PrintDocumentSpec>>
	>({})
	const [previewError, setPreviewError] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState('')
	const submittingRef = useRef(false)
	const generation = useRef(0)
	const pendingRef = useRef(loadPending(orderId))
	const [pending, setPending] = useState(pendingRef.current)
	const invoice = useQuery({
		queryKey: ['staff-invoice', orderId],
		queryFn: () => getStaffOrderInvoice(orderId),
		enabled: !isChecking && permissions.orderDetailsRead,
		retry: false,
		staleTime: 30_000,
	})
	const agents = useQuery({
		queryKey: agentsKey,
		queryFn: getLocalPrintAgents,
		refetchInterval: 15_000,
		retry: false,
	})
	const assignment = useQuery({
		queryKey: assignmentKey,
		queryFn: getLocalPrintAssignment,
		retry: false,
	})
	const jobKey = ['local-print-jobs', orderId]
	const jobs = useQuery({
		queryKey: jobKey,
		queryFn: () => getLocalPrintJobs(orderId),
		enabled: permissions.orderDetailsRead,
		refetchInterval: 3_000,
		retry: false,
	})
	const selected = (['sales', 'kitchen'] as const).filter((kind) => kinds[kind])
	const retryKinds = selected.filter((kind) => pending[kind])
	const queueKinds = retryKinds.length ? retryKinds : selected
	const active = (kind: LocalPrintKind) =>
		jobs.data?.some((job) => job.kind === kind && busyJob(job)) ?? false
	const unknown = (kind: LocalPrintKind) =>
		Boolean(
			pending[kind] &&
				!jobs.data?.some((job) => job.id === pending[kind]?.jobId),
		)
	const spec = specs[previewKind]
	const html = useMemo(
		() => (spec ? buildPrintDocumentHtml(spec) : null),
		[spec],
	)

	useEffect(() => {
		pendingRef.current = loadPending(orderId)
		setPending(pendingRef.current)
		submittingRef.current = false
		setSubmitting(false)
		setError('')
		return () => {
			generation.current += 1
		}
	}, [orderId])
	useEffect(() => {
		let cancelled = false
		setSpecs({})
		setPreviewError('')
		if (invoice.data)
			void buildInvoicePrintSpecs(invoice.data, ['sales', 'kitchen'])
				.then((items) => {
					if (!cancelled)
						setSpecs(
							Object.fromEntries(items.map((item) => [item.kind, item.spec])),
						)
				})
				.catch((err) => {
					if (!cancelled)
						setPreviewError(
							err instanceof Error
								? err.message
								: 'آماده‌سازی فاکتور ناموفق بود',
						)
				})
		return () => {
			cancelled = true
		}
	}, [invoice.data])
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !submittingRef.current) onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	const remember = (next: PendingJobs) => {
		// Persist the exact bitmap before POST, so a retry after remount cannot
		// reuse an ID for different invoice data. Clear only on confirmed receipt.
		sessionStorage.setItem(pendingKey(orderId), JSON.stringify(next))
		pendingRef.current = next
		setPending(next)
	}
	const forget = (kind: LocalPrintKind) => {
		const next = { ...pendingRef.current }
		delete next[kind]
		remember(next)
	}
	const recordJob = (job: LocalPrintJobDto) => {
		queryClient.setQueryData<LocalPrintJobDto[]>(jobKey, (current = []) => [
			job,
			...current.filter((item) => item.id !== job.id),
		])
	}
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: agentsKey }),
			queryClient.invalidateQueries({ queryKey: assignmentKey }),
			queryClient.invalidateQueries({ queryKey: jobKey }),
		])
	const queue = async () => {
		if (
			submittingRef.current ||
			!canManage ||
			!permissions.orderDetailsRead ||
			!invoice.data ||
			!assignment.data ||
			jobs.isPending ||
			jobs.isError ||
			!selected.length
		)
			return
		if (!retryKinds.length && selected.some(active)) {
			setError('برای این فاکتور کار فعالی وجود دارد؛ وضعیت صف را بررسی کنید.')
			return
		}
		const repeat =
			!retryKinds.length &&
			selected.some(
				(kind) =>
					!pendingRef.current[kind] &&
					jobs.data?.some(
						(job) =>
							job.kind === kind &&
							(job.status === 'spooled' || job.status === 'uncertain'),
					),
			)
		if (
			repeat &&
			!window.confirm(
				'این سفارش قبلاً به چاپگر ارسال شده یا نتیجهٔ آن نامشخص است. پس از بررسی چاپگر، نسخهٔ دیگری ارسال شود؟',
			)
		)
			return
		submittingRef.current = true
		setSubmitting(true)
		setError('')
		const current = generation.current
		try {
			if (!retryKinds.length) {
				const prepared = { ...pendingRef.current }
				for (const kind of queueKinds) {
					if (generation.current !== current) return
					const target = assignment.data[kind]
					if (!target)
						throw new Error(`چاپگر ${labels[kind]} را در تنظیمات انتخاب کنید.`)
					prepared[kind] = await buildLocalInvoiceJob(
						invoice.data,
						kind,
						target,
						crypto.randomUUID(),
					)
				}
				if (generation.current !== current) return
				// Commit the entire selection before sending its first receipt. If a
				// later request fails, retry can recover only the outstanding kinds.
				remember(prepared)
			}
			for (const kind of queueKinds) {
				if (generation.current !== current) break
				const payload = pendingRef.current[kind]
				if (!payload) continue
				if (retryKinds.length) {
					try {
						const job = await getLocalPrintJob(payload.jobId)
						if (generation.current !== current) break
						recordJob(job)
						forget(kind)
						continue
					} catch (err) {
						if ((err as { status?: number }).status !== 404) throw err
					}
				}
				if (generation.current !== current) break
				const job = await enqueueLocalPrintJob(payload)
				if (generation.current !== current) break
				recordJob(job)
				forget(kind)
			}
			if (generation.current === current)
				showToast(
					retryKinds.length
						? 'وضعیت درخواست‌های قبلی به‌روز شد؛ نتیجهٔ هر فاکتور را در همین پنجره بررسی کنید.'
						: 'درخواست در صف چاپ ثبت شد؛ نتیجهٔ ارسال به ویندوز در همین پنجره نمایش داده می‌شود.',
				)
		} catch (err) {
			if (generation.current === current)
				setError(
					err instanceof Error
						? err.message
						: 'ارسال ناموفق بود؛ وضعیت کار قبلی را بررسی کنید.',
				)
		} finally {
			await refresh().catch(() => {})
			if (generation.current === current) {
				submittingRef.current = false
				setSubmitting(false)
			}
		}
	}
	const browserPrint = async () => {
		const current = generation.current
		if (submittingRef.current || !spec || !permissions.orderDetailsRead) return
		if (active(previewKind) || unknown(previewKind)) {
			setError(
				'ابتدا وضعیت ارسال قبلی را بررسی و کارِ در صف را لغو کنید تا فاکتور دوبار چاپ نشود.',
			)
			return
		}
		const risk =
			jobs.isError ||
			jobs.data?.some(
				(job) =>
					job.kind === previewKind &&
					(job.status === 'spooled' || job.status === 'uncertain'),
			)
		if (
			risk &&
			!window.confirm(
				'ممکن است این فاکتور قبلاً چاپ شده باشد. پس از بررسی چاپگر، نسخهٔ مرورگر باز شود؟',
			)
		)
			return
		submittingRef.current = true
		setSubmitting(true)
		setError('')
		try {
			await printHtmlDocumentAsync(spec)
		} catch (err) {
			if (generation.current === current)
				setError(
					err instanceof Error ? err.message : 'بازکردن چاپ مرورگر ناموفق بود',
				)
		} finally {
			if (generation.current === current) {
				submittingRef.current = false
				setSubmitting(false)
			}
		}
	}
	const cancel = async (job: LocalPrintJobDto) => {
		const current = generation.current
		if (!canManage || submittingRef.current || job.status !== 'queued') return
		submittingRef.current = true
		setSubmitting(true)
		setError('')
		try {
			const cancelled = await cancelLocalPrintJob(job.id)
			if (generation.current === current) {
				recordJob(cancelled)
				await jobs.refetch()
			}
		} catch (err) {
			if (generation.current === current)
				setError(err instanceof Error ? err.message : 'لغو کار ناموفق بود')
		} finally {
			if (generation.current === current) {
				submittingRef.current = false
				setSubmitting(false)
			}
		}
	}
	const discardPending = async (kind: LocalPrintKind) => {
		const payload = pendingRef.current[kind]
		if (
			submittingRef.current ||
			!canManage ||
			!permissions.orderDetailsRead ||
			!payload
		)
			return
		if (
			!window.confirm(
				`درخواست ذخیره‌شدهٔ چاپ ${labels[kind]} کنار گذاشته شود؟ کارِ در صف لغو می‌شود؛ اگر صندوق آن را دریافت کرده باشد، باید ابتدا نتیجهٔ چاپ را بررسی کنید.`,
			)
		)
			return
		const current = generation.current
		submittingRef.current = true
		setSubmitting(true)
		setError('')
		try {
			const result = await discardPendingLocalPrintJob({
				jobId: payload.jobId,
				orderId,
			})
			if (generation.current !== current) return
			if (result.job) recordJob(result.job)
			forget(kind)
			showToast(
				'درخواست قبلی کنار گذاشته شد. اکنون می‌توانید چاپگر را تنظیم یا چاپ مرورگر را انتخاب کنید.',
			)
		} catch (err) {
			if (generation.current === current)
				setError(
					err instanceof Error
						? err.message
						: 'کنار گذاشتن درخواست ناموفق بود؛ وضعیت قبلی حفظ شد.',
				)
		} finally {
			await refresh().catch(() => {})
			if (generation.current === current) {
				submittingRef.current = false
				setSubmitting(false)
			}
		}
	}
	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-4">
			<button
				type="button"
				aria-label="بستن پنجرهٔ چاپ"
				disabled={submitting}
				onClick={onClose}
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`چاپ فاکتور سفارش ${orderId}`}
				className="relative w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-2xl bg-white dark:bg-[#2a1015] shadow-xl text-gray-800 dark:text-gray-100"
			>
				<div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-white/10">
					<h2 className="font-DanaDemiBold text-lg">چاپ فاکتور — {orderId}</h2>
					<button
						type="button"
						aria-label="بستن"
						disabled={submitting}
						onClick={onClose}
					>
						<X size={20} />
					</button>
				</div>
				<div className="overflow-y-auto min-h-0 p-4 space-y-4">
					<p className="text-sm text-gray-500">
						چاپ اصلی از طریق عامل ویندوز صندوق انجام می‌شود. دیالوگ مرورگر،
						پشتیبانِ فاکتورِ انتخاب‌شده در پیش‌نمایش است.
					</p>
					{agents.isError || assignment.isError ? (
						<p role="alert" className="text-sm text-red-600">
							دریافت وضعیت عامل چاپ ناموفق بود.{' '}
							<button
								type="button"
								onClick={() => void refresh()}
								className="underline"
							>
								تلاش دوباره
							</button>
						</p>
					) : (
						<output className="block text-sm">
							{agents.data?.some((agent) => agent.online)
								? 'عامل چاپ متصل است'
								: 'عامل چاپ متصل نیست؛ کارها تا اتصال در صف می‌مانند.'}
						</output>
					)}
					<LocalPrinterSettings
						agents={agents.data ?? []}
						assignment={assignment.data}
						canManage={canManage}
						disabled={submitting}
						onSaved={refresh}
					/>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{(['sales', 'kitchen'] as const).map((kind) => (
							<label
								key={kind}
								className="flex gap-3 items-center rounded-xl border border-gray-200 dark:border-white/10 p-3 text-sm"
							>
								<input
									type="checkbox"
									disabled={submitting}
									checked={kinds[kind]}
									onChange={() =>
										setKinds((value) => ({ ...value, [kind]: !value[kind] }))
									}
								/>
								<span>
									فاکتور {labels[kind]}
									<span className="block text-xs text-gray-500">
										{assignment.data?.[kind]?.printerName ??
											'چاپگر انتخاب نشده'}
									</span>
								</span>
							</label>
						))}
					</div>
					<button
						type="button"
						onClick={() => void queue()}
						disabled={
							submitting ||
							!canManage ||
							!permissions.orderDetailsRead ||
							!invoice.data ||
							!assignment.data ||
							jobs.isPending ||
							jobs.isError ||
							!selected.length ||
							(!retryKinds.length &&
								queueKinds.some(
									(kind) => active(kind) || !assignment.data?.[kind],
								))
						}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-white p-3 font-DanaDemiBold disabled:opacity-50"
					>
						<Printer size={18} />
						{submitting
							? 'در حال ارسال…'
							: retryKinds.length
								? 'بررسی و تلاش مجدد با همان شناسه'
								: 'ارسال فاکتورهای انتخابی به صندوق'}
					</button>
					{error && (
						<p role="alert" className="text-sm text-red-600">
							{error}
						</p>
					)}
					{(Object.keys(pending).length > 0 || jobs.isError) && (
						<p className="text-sm text-amber-700">
							وضعیت ارسال قبلی را بررسی کنید. خطای اتصال به معنی چاپ‌نشدن فاکتور
							نیست.
						</p>
					)}
					{(['sales', 'kitchen'] as const).map(
						(kind) =>
							pending[kind] && (
								<button
									key={kind}
									type="button"
									disabled={
										submitting || !canManage || !permissions.orderDetailsRead
									}
									onClick={() => void discardPending(kind)}
									className="block text-sm underline disabled:opacity-50"
								>
									کنار گذاشتن درخواست قبلی {labels[kind]}
								</button>
							),
					)}
					<div className="space-y-2 text-xs" aria-live="polite">
						{jobs.data?.slice(0, 8).map((job) => (
							<div
								key={job.id}
								className="rounded-lg bg-gray-50 dark:bg-white/5 p-2"
							>
								<div className="flex flex-wrap justify-between gap-2">
									<span>
										{labels[job.kind]} — {statusLabels[job.status]}
									</span>
									{job.status === 'queued' && (
										<button
											type="button"
											disabled={!canManage || submitting}
											className="underline disabled:opacity-50"
											onClick={() => void cancel(job)}
										>
											لغو کار در صف
										</button>
									)}
								</div>
								{job.error && <p className="mt-1 text-red-600">{job.error}</p>}
							</div>
						))}
						<p className="text-gray-500">
							پذیرش در صف ویندوز به معنی تأیید خروج کاغذ نیست. برای نتیجهٔ
							نامشخص، چاپگر را پیش از چاپ مجدد بررسی کنید.
						</p>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 dark:border-white/10 pt-4">
						<span className="text-sm font-DanaDemiBold">
							پیش‌نمایش و چاپ اضطراری
						</span>
						<div className="flex gap-2">
							{(['sales', 'kitchen'] as const).map((kind) => (
								<button
									key={kind}
									type="button"
									disabled={submitting}
									aria-pressed={previewKind === kind}
									onClick={() => setPreviewKind(kind)}
									className={`rounded-lg border px-3 py-2 text-sm ${previewKind === kind ? 'border-primary text-primary' : 'border-gray-200'}`}
								>
									{labels[kind]}
								</button>
							))}
						</div>
					</div>
					{invoice.isError ? (
						<p role="alert">
							دریافت فاکتور ناموفق بود.{' '}
							<button
								type="button"
								className="underline"
								onClick={() => void invoice.refetch()}
							>
								تلاش دوباره
							</button>
						</p>
					) : previewError ? (
						<p role="alert">{previewError}</p>
					) : html ? (
						<div className="max-w-sm mx-auto w-full rounded-xl bg-gray-100 p-2">
							<ReceiptPreviewPane html={html} />
						</div>
					) : (
						<output className="block text-sm">
							{permissions.orderDetailsRead
								? 'در حال آماده‌سازی فاکتور…'
								: 'دسترسی به فاکتور این سفارش مجاز نیست.'}
						</output>
					)}
					<p className="text-xs leading-relaxed text-gray-500">
						در دیالوگ مرورگر، کاغذ ۸۰ میلی‌متری و مقیاس ۱۰۰٪ را انتخاب کنید؛
						سرصفحه و پاصفحه خاموش باشد. حاشیه‌ها را مطابق چاپگر تنظیم کنید. فقط
						فاکتور پیش‌نمایش‌شده چاپ می‌شود. برای کاغذ ۵۸ میلی‌متری از عامل چاپ
						استفاده کنید.
					</p>
					<button
						type="button"
						onClick={() => void browserPrint()}
						disabled={
							submitting ||
							!spec ||
							!permissions.orderDetailsRead ||
							jobs.isPending ||
							active(previewKind) ||
							unknown(previewKind)
						}
						className="w-full rounded-xl border border-gray-300 dark:border-white/20 p-3 text-sm disabled:opacity-50"
					>
						چاپ مرورگر — فقط فاکتور {labels[previewKind]}
					</button>
				</div>
			</div>
		</div>
	)
})
