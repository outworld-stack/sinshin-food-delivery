// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/dashboard/notifications/InboxPushCard.tsx
// کامیت پیشنهادی: stage sixty-seven
// ═══════════════════════════════════════════════════════════════

// src/components/dashboard/notifications/InboxPushCard.tsx
import { BellRing, CheckCircle, Refresh } from 'reicon-react'
import type { InboxPushPhase } from '#/hooks/dashboard/useNotificationInboxPage'
import { useI18n } from '#/i18n'

interface InboxPushCardProps {
	phase: InboxPushPhase
	onEnable: () => void
}

/**
 * stage-67 — کارت بالای «صندوق اعلان‌ها» (متنِ دقیقِ خواسته‌ی کارفرما):
 * با فعال کردن نوتیفیکیشن‌ها از آخرین اخبار تخفیفی سایت باخبر می‌شوید؛
 * اخبار در همین صفحه ذخیره می‌شوند و ۷ روز در دسترس‌اند (تایمرِ حذف هر
 * اعلان از لحظه‌ی ایجاد خودش است — کامنت سرویس).
 *
 * دکمه‌ی فعال‌سازی مبتنی بر کلیک است (همان درس stage-64 — بدون ژستِ
 * کاربر مرورگرها پرامپت را رد/quiet می‌کنند؛ enablePush فقط داخل کلیک).
 */
export function InboxPushCard({ phase, onEnable }: InboxPushCardProps) {
	const { t } = useI18n()

	const busy = phase === 'busy'

	return (
		<section
			aria-label={t['notify.inbox.title']}
			className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-[#3a151c] p-5 sm:p-6 shadow-sm"
		>
			<div className="flex items-start gap-4">
				<span
					aria-hidden="true"
					className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0"
				>
					<BellRing size={24} />
				</span>

				<div className="min-w-0 flex-1 space-y-2">
					<h2 className="font-DanaDemiBold text-base sm:text-lg text-gray-800 dark:text-white leading-relaxed">
						{t['notify.inbox.intro']}
					</h2>
					<p className="font-DanaRegular text-[13px] sm:text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
						{t['notify.inbox.ttlNote']}
					</p>

					{/* وضعیت پوش — متن/دکمه بر اساس فاز */}
					<div className="pt-2">
						{phase === 'loading' && (
							<div className="h-11 w-48 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
						)}

						{phase === 'on' && (
							<div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-DanaMedium text-sm">
								<CheckCircle size={18} />
								{t['notify.pushEnabled']}
							</div>
						)}

						{phase === 'default' && (
							<button
								type="button"
								onClick={onEnable}
								className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer min-h-11"
							>
								{t['notify.enable.action']}
							</button>
						)}

						{busy && (
							<button
								type="button"
								disabled
								className="px-5 py-2.5 rounded-xl bg-primary/60 dark:bg-dark-primary/60 text-white text-sm font-DanaDemiBold cursor-wait min-h-11"
							>
								{t['notify.enable.busy']}
							</button>
						)}

						{phase === 'denied' && (
							<p className="text-[13px] text-orange-500 dark:text-orange-400 font-DanaMedium leading-relaxed">
								{t['notify.enable.deniedHint']}
							</p>
						)}

						{phase === 'unsupported' && (
							<p className="text-[13px] text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
								{t['notify.pushUnsupported']}
							</p>
						)}

						{phase === 'failed' && (
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-[13px] text-red-500 dark:text-red-400 font-DanaMedium">
									{t['notify.enable.errRegister']}
								</p>
								<button
									type="button"
									onClick={onEnable}
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-300 dark:border-[#3a151c] text-gray-700 dark:text-gray-200 text-[13px] font-DanaDemiBold hover:bg-gray-100 dark:hover:bg-[#1a0a0e] transition cursor-pointer min-h-11"
								>
									<Refresh size={15} />
									{t['notify.enable.recheck']}
								</button>
							</div>
						)}
					</div>
				</div>
			</div>
		</section>
	)
}