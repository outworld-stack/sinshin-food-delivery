// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/shared/NotificationEnableIcon.tsx
// وضعیت: جایگزینی کامل فایل موجود (stage-48)
// تغییر (بازخورد ۴):
//   • پاپ‌اور در موبایل دیگر از لبه‌ی راست صفحه بیرون نمی‌زند:
//     در <sm یک کارتِ fixed با حاشیه‌ی ۱۶px از هر طرف، دقیقاً زیر هدر
//     (همیشه داخل صفحه)؛ از sm به بالا همان پاپ‌اور absolute چسبیده
//     به آیکون.
//   • حالت خطا: اگر مجوز داده شد اما اشتراک ثبت نشد (SW/کلید/شبکه)
//     پیام نارنجیِ «دوباره تلاش کن» داخل پاپ‌اور می‌آید — دکمه دیگر
//     در «در حال فعال‌سازی» گیر نمی‌کند (همه‌ی انتظارها در
//     push-subscription.ts مهلت‌دار شده‌اند).
// ═══════════════════════════════════════════════════════════════
// stage-48 — آیکون بنفشِ چشمک‌زنِ «فعال‌سازی نوتیفیکیشن» در هدر

// src/components/shared/NotificationEnableIcon.tsx
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Check } from 'reicon-react'
import { useI18nSafe } from '#/i18n'
import { apiBase } from '#/lib/api'
import { getAccessToken } from '#/lib/auth-session'
import {
	enablePush,
	getPushState,
	type PushState,
} from '#/lib/push-subscription'

/**
 * stage-48 — آیکون بنفشِ چشمک‌زنِ «فعال‌سازی نوتیفیکیشن» در هدر.
 *
 * قواعد:
 *  • فقط برای کاربرِ لاگین‌شده‌ای که پوشِ این دستگاه خاموش است (دسته‌ی
 *    default/denied یا بدون اشتراک ثبت‌شده) — مثل سفارشِ تحویل‌نگرفته که
 *    نشانِ سبز چشمک‌زن دارد.
 *  • کلیک → پاپ‌اورِ انیمیت‌شده (fade+scale) با دکمه‌ی فعال‌سازی.
 *  • بعد از فعال‌شدن (مجوز granted + اشتراک ثبت‌شده) آیکون از هدر حذف
 *    می‌شود؛ هر وقت غیرفعال شد برمی‌گردد.
 *  • حالت denied: راهنمای بازکردن مجوز از تنظیمات مرورگر.
 * stage-49:
 *  • در موبایل پاپ‌اور fixed زیر هدر است (از صفحه بیرون نمی‌زند).
 *  • شکستِ فعال‌سازی پیام روشن دارد و حالت busy هرگز گیر نمی‌کند.
 */
export const NotificationEnableIcon = memo(function NotificationEnableIcon() {
	const { t } = useI18nSafe()
	const [open, setOpen] = useState(false)
	const [pushState, setPushState] = useState<PushState>({ state: 'default' })
	const [hasSubscription, setHasSubscription] = useState(false)
	const [busy, setBusy] = useState(false)
	const [done, setDone] = useState(false)
	const [failed, setFailed] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)

	const refresh = useCallback(async () => {
		try {
			const st = await getPushState()
			setPushState(st)
			// اشتراکِ ثبت‌شده در بک‌اند (این دستگاه یا کاربر) — استاتوس سروری
			const token = getAccessToken()
			if (!token) {
				setHasSubscription(st.state === 'granted' && st.subscribed)
				return
			}
			const res = await fetch(`${apiBase()}/notifications/push-status`, {
				headers: { authorization: `Bearer ${token}` },
				credentials: 'include',
			})
			if (res.ok) {
				const body = (await res.json()) as { subscriptions?: number }
				setHasSubscription((body.subscriptions ?? 0) > 0)
			} else {
				setHasSubscription(st.state === 'granted' && st.subscribed)
			}
		} catch {
			/* آفلاین — بعداً دوباره */
		}
	}, [])

	useEffect(() => {
		void refresh()
		const onFocus = () => void refresh()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [refresh])

	// بستن پاپ‌اور با کلیک بیرون / Escape
	useEffect(() => {
		if (!open) return
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false)
		}
		document.addEventListener('mousedown', onDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])

	const onEnable = useCallback(async () => {
		setBusy(true)
		setFailed(false)
		try {
			const st = await enablePush()
			setPushState(st)
			if (st.state === 'granted' && st.subscribed) {
				setFailed(false)
				setHasSubscription(true)
				setDone(true)
				// انیمیشن موفقیت؛ سپس خودکار بسته می‌شود و آیکون حذف می‌شود
				setTimeout(() => {
					setOpen(false)
					setDone(false)
				}, 1600)
			} else if (st.state === 'granted') {
				// مجوز داده شد ولی اشتراک ثبت نشد (SW/کلید VAPID/شبکه)
				// — پیام روشن؛ دکمه برای تلاش مجدد آزاد است (بازخورد ۴)
				setFailed(true)
				void refresh()
			}
		} finally {
			// stage-49 — هر نتیجه‌ای باشد، حالت busy تمام می‌شود
			// (قبلاً اگر navigator.serviceWorker.ready معلق می‌شد،
			//  «در حال فعال‌سازی…» برای همیشه می‌ماند)
			setBusy(false)
		}
	}, [refresh])

	// فعال است؟ ⇒ هیچ آیکونی در هدر نیست (خواسته‌ی صریح)
	const enabled = pushState.state === 'granted' && hasSubscription
	if (enabled) return null

	const denied = pushState.state === 'denied'
	const unsupported = pushState.state === 'unsupported'

	return (
		<div ref={rootRef} className="relative">
			{/* آیکون چشمک‌زن بنفش */}
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-label={t['notify.enable.title']}
				title={t['notify.enable.title']}
				aria-expanded={open}
				className="relative flex items-center justify-center p-2 sm:p-2.5 rounded-lg bg-purple-100 dark:bg-purple-500/15 text-purple-500 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-500/25 transition font-DanaMedium shadow-sm"
			>
				{/* هاله‌ی چشمک‌زن — فقط تا وقتی پاپ‌اور باز نیست */}
				{!open && (
					<span
						className="absolute inset-0 rounded-lg animate-ping bg-purple-400/25"
						aria-hidden="true"
					/>
				)}
				<Bell size={20} className="h-[18px] w-[18px] sm:h-5 sm:w-5 relative" />
			</button>

			{/* پاپ‌اور انیمیت‌شده — stage-49:
				• <sm: کارتِ fixed با حاشیه‌ی ۱۶px از هر طرف، دقیقاً زیر هدر
				  (هدر full-width است؛ کارت همیشه داخل صفحه — دیگر از
				  سمت راست بیرون نمی‌زند)
				• ≥sm: همان پاپ‌اور absolute چسبیده به آیکون (left-0) */}
			{open && (
				<div
					role="dialog"
					aria-label={t['notify.enable.title']}
					className="fixed left-4 right-4 top-[4.75rem] z-50 overflow-hidden animate-pop-in bg-white dark:bg-[#1a0a0e] rounded-2xl shadow-2xl border border-purple-200 dark:border-purple-500/20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-24px)]"
				>
					{/* هدر گرادیانی بنفش */}
					<div className="bg-linear-to-br from-purple-500 to-purple-400 dark:from-purple-600 dark:to-purple-500 p-4 text-white">
						<div className="flex items-center gap-3">
							<span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
								<BellRing size={20} className="animate-bounce" />
							</span>
							<div className="min-w-0">
								<p className="font-DanaDemiBold text-sm">
									{t['notify.enable.title']}
								</p>
								<p className="text-[11px] opacity-90 leading-relaxed mt-0.5">
									{t['notify.enable.subtitle']}
								</p>
							</div>
						</div>
					</div>

					{/* بدنه */}
					<div className="p-4 space-y-3">
						{denied ? (
							<p className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
								{t['notify.enable.deniedHint']}
							</p>
						) : unsupported ? (
							<p className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
								{t['notify.pushUnsupported']}
							</p>
						) : (
							<>
								<ul className="space-y-2">
									{[
										t['notify.enable.benefit1'],
										t['notify.enable.benefit2'],
										t['notify.enable.benefit3'],
									].map((line) => (
										<li
											key={line}
											className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed"
										>
											<Check
												size={14}
												className="text-purple-500 shrink-0 mt-0.5"
											/>
											{line}
										</li>
									))}
								</ul>
								<button
									type="button"
									disabled={busy}
									onClick={() => void onEnable()}
									className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-linear-to-l from-purple-500 to-purple-400 text-white text-sm font-DanaDemiBold hover:opacity-90 transition disabled:opacity-50 cursor-pointer shadow-md shadow-purple-500/20"
								>
									<BellRing size={16} className={busy ? 'animate-pulse' : ''} />
									{busy ? t['notify.enable.busy'] : t['notify.enable.action']}
								</button>

								{/* stage-49 — شکست فعال‌سازی: پیام روشن + تلاش مجدد */}
								{failed && (
									<p className="text-[11px] text-orange-500 dark:text-orange-400 font-DanaMedium leading-relaxed bg-orange-50 dark:bg-orange-500/10 border border-orange-100 dark:border-orange-500/20 rounded-xl px-3 py-2.5">
										{t['notify.enable.retryHint']}
									</p>
								)}

								<p className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
									{t['notify.enable.hint'].replace(
										'{b}',
										t['notify.enable.action'],
									)}
								</p>
							</>
						)}
					</div>

					{/* انیمیشن موفقیت */}
					{done && (
						<div className="absolute inset-0 bg-white/95 dark:bg-[#1a0a0e]/95 flex flex-col items-center justify-center gap-2 animate-fade-in">
							<span className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-500/15 text-green-500 flex items-center justify-center">
								<Check size={24} />
							</span>
							<p className="text-xs font-DanaDemiBold text-green-600 dark:text-green-400">
								{t['notify.enable.done']}
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	)
})