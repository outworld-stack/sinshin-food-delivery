// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/dashboard/notifications/InboxList.tsx
// کامیت پیشنهادی: stage sixty-seven
// ═══════════════════════════════════════════════════════════════

import type { NotificationInboxItemDto } from '@sinshin/shared'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
// src/components/dashboard/notifications/InboxList.tsx
import { memo } from 'react'
import { Bell, Check, ChevronLeft, Clock, Gift, InfoCircle } from 'reicon-react'
import { tpl, useI18n } from '#/i18n'
import { faNum, formatRelative } from '#/utils/format'

/** TTL صندوق — قرارداد با سرویس (NOTIFICATION_TTL_DAYS) */
const TTL_DAYS = 7

type TypeIcon = { icon: ReactNode; label: string }

function iconOf(type: string, t: { [k: string]: string }): TypeIcon {
	switch (type) {
		case 'coupon':
		case 'coupon_nudge':
			return { icon: <Gift size={20} />, label: t['notify.type.coupon'] }
		case 'product_discount':
			return { icon: <Clock size={20} />, label: t['notify.type.discount'] }
		case 'broadcast':
			return { icon: <Bell size={20} />, label: t['notify.type.broadcast'] }
		default:
			return { icon: <InfoCircle size={20} />, label: t['notify.type.system'] }
	}
}

/** بج «چقدر تا حذف خودکار» — تایمر از createdAt همان ردیف (تصمیم کارفرما) */
function ttlBadge(
	item: NotificationInboxItemDto,
	daysLeftLabel: string,
	lessThanDayLabel: string,
): string {
	const created = new Date(item.createdAt)
	if (Number.isNaN(created.getTime())) return ''
	const msLeft = created.getTime() + TTL_DAYS * 86_400_000 - Date.now()
	if (msLeft <= 0) return ''
	const days = Math.floor(msLeft / 86_400_000)
	if (days >= 1) return tpl(daysLeftLabel, { n: faNum(days) })
	return lessThanDayLabel
}

interface InboxRowProps {
	item: NotificationInboxItemDto
	onMarkRead: (id: string) => void
	daysLeftLabel: string
	lessThanDayLabel: string
}

/** یک اعلان — کلیک: خوانده‌شده + ناوبری به مقصد (اگر url داشت) */
const InboxRow = memo(function InboxRow({
	item,
	onMarkRead,
	daysLeftLabel,
	lessThanDayLabel,
}: InboxRowProps) {
	const { t } = useI18n()
	const { icon, label } = iconOf(item.type, t)
	const unread = item.readAt === null
	const ttl = ttlBadge(item, daysLeftLabel, lessThanDayLabel)

	const inner = (
		<>
			<span
				aria-hidden="true"
				title={label}
				className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
					unread
						? 'bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary'
						: 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-400 dark:text-gray-500'
				}`}
			>
				{icon}
			</span>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					{unread && (
						<span
							aria-hidden="true"
							className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary shrink-0"
						/>
					)}
					<p
						className={`font-DanaDemiBold text-sm truncate ${
							unread
								? 'text-gray-800 dark:text-gray-100'
								: 'text-gray-500 dark:text-gray-400'
						}`}
					>
						{item.title}
					</p>
				</div>
				<p
					className={`font-DanaRegular text-[13px] leading-relaxed mt-1 line-clamp-2 ${
						unread
							? 'text-gray-600 dark:text-gray-300'
							: 'text-gray-400 dark:text-gray-500'
					}`}
				>
					{item.body}
				</p>
				<div className="flex items-center gap-3 mt-2 text-[11px] font-DanaMedium text-gray-400 dark:text-gray-500">
					<span>{formatRelative(item.createdAt)}</span>
					{ttl && (
						<span className="inline-flex items-center gap-1">
							<Clock size={12} />
							{ttl}
						</span>
					)}
				</div>
			</div>

			<span className="shrink-0 text-gray-300 dark:text-gray-600">
				<ChevronLeft size={18} />
			</span>
		</>
	)

	const className = `w-full flex items-center gap-3 text-right p-3 sm:p-4 rounded-xl transition-colors cursor-pointer ${
		unread
			? 'bg-white dark:bg-[#2a1015] hover:bg-gray-50 dark:hover:bg-[#331319] border border-gray-200 dark:border-[#3a151c]'
			: 'bg-gray-50 dark:bg-[#23090d] hover:bg-gray-100 dark:hover:bg-[#2a1015] border border-transparent'
	}`

	if (item.url) {
		return (
			<Link
				to={item.url}
				onClick={() => onMarkRead(item.id)}
				className={className}
			>
				{inner}
			</Link>
		)
	}
	return (
		<button
			type="button"
			onClick={() => onMarkRead(item.id)}
			className={className}
		>
			{inner}
		</button>
	)
})

interface InboxListProps {
	items: NotificationInboxItemDto[]
	unread: number
	isLoading: boolean
	isMarkingAll: boolean
	onMarkRead: (id: string) => void
	onMarkAllRead: () => void
}

/**
 * stage-67 — لیست اعلان‌های صندوق (۷ روز اخیر). اسکلتون در لود؛
 * لیست بلند داخل max-h-96 با اسکرول (قاعده‌ی لیست‌های بلند پروژه).
 */
export function InboxList({
	items,
	unread,
	isLoading,
	isMarkingAll,
	onMarkRead,
	onMarkAllRead,
}: InboxListProps) {
	const { t } = useI18n()

	return (
		<section
			aria-label={t['notify.title']}
			className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-[#3a151c] p-4 sm:p-6 shadow-sm"
		>
			<div className="flex items-center justify-between gap-3 mb-4">
				<h3 className="font-DanaDemiBold text-base sm:text-lg text-gray-800 dark:text-white flex items-center gap-2">
					{t['notify.title']}
					{unread > 0 && (
						<span className="text-[11px] font-DanaDemiBold px-2 py-0.5 rounded-full bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary">
							{tpl(t['notify.unreadCount'], { n: faNum(unread) })}
						</span>
					)}
				</h3>

				{unread > 0 && (
					<button
						type="button"
						onClick={onMarkAllRead}
						disabled={isMarkingAll}
						className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-DanaDemiBold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] transition cursor-pointer disabled:opacity-50 disabled:cursor-wait min-h-11"
					>
						<Check size={15} />
						{t['notify.markAllRead']}
					</button>
				)}
			</div>

			{isLoading ? (
				<div className="space-y-3" aria-busy="true">
					{['one', 'two', 'three'].map((s) => (
						<div
							key={`inbox-skel-${s}`}
							className="flex items-center gap-3 p-4"
						>
							<div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse shrink-0" />
							<div className="flex-1 space-y-2">
								<div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
								<div className="h-3 w-full rounded bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
								<div className="h-3 w-1/3 rounded bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
							</div>
						</div>
					))}
				</div>
			) : items.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
					<Bell size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
					<p className="font-DanaMedium text-sm text-gray-500 dark:text-gray-400">
						{t['notify.empty']}
					</p>
				</div>
			) : (
				<div className="max-h-96 overflow-y-auto space-y-2.5 pr-1">
					{items.map((item) => (
						<InboxRow
							key={item.id}
							item={item}
							onMarkRead={onMarkRead}
							daysLeftLabel={t['notify.inbox.daysLeft']}
							lessThanDayLabel={t['notify.inbox.lessThanDay']}
						/>
					))}
				</div>
			)}
		</section>
	)
}