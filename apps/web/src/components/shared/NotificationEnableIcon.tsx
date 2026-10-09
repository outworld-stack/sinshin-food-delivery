// ═══════════════════════════════════════════════════════════════
// stage-50 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/shared/NotificationEnableIcon.tsx
// وضعیت: جایگزینی کامل فایل موجود (stage-49)
// تغییر (اسکن عمیق — بازخورد کاربر):
//   • باگ حالتِ denied (بن‌بست): کاربری که نوتیف را از تنظیمات مرورگر
//     خاموش کرده بود، آیکون برمی‌گشت ولی پاپ‌اور «فقط متن» بود — بدون
//     هیچ دکمه‌ای («دکمه‌ی فعال‌سازی نیستش و کاربر باید دستی…»).
//     حالا: راهنمای گام‌به‌گامِ بازکردن مجوز + دکمه‌ی «بررسی مجدد مجوز»
//     — کاربر مجوز را در مرورگر Allow می‌کند، دکمه را می‌زند و همان
//     جریانِ فعال‌سازی ادامه می‌یابد (بدون رفرش/جست‌وجوی دستی).
//   • بازبینی خودکار حالت روی focus + visibilitychange + بازشدنِ
//     پاپ‌اور (قبلاً فقط focus) — تغییرِ مجوز از تنظیمات مرورگر،
//     به‌محضِ برگشتن به تب، خودش دیده می‌شود.
//   • push-status با همان authedPushFetch مهلت‌دار + نوساز ۴۰۱
//     (قبلاً fetch خام بدون مهلت/ریتری — توکنِ منقضی ⇒ آیکین
//     دیر/غلط به‌روز می‌شد).
//   • گیرکردن دکمه: ریشه در push-subscription.ts (مهلتِ subscribe +
//     ریتری ۴۰۱) رفع شد؛ اینجا فقط رندرِ حالت‌هاست — busy همیشه در
//     finally تمام می‌شود.
// ═══════════════════════════════════════════════════════════════
// stage-48 — آیکون بنفشِ چشمک‌زنِ «فعال‌سازی نوتیفیکیشن» در هدر

// src/components/shared/NotificationEnableIcon.tsx
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Check, Refresh } from 'reicon-react'
import { useI18nSafe } from '#/i18n'
import { apiBase } from '#/lib/api'
import {
	enablePush,
	getPushState,
	authedPushFetch,
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
 *  • حالت denied: راهنمای گام‌به‌گام + دکمه‌ی «بررسی مجدد مجوز»
 *    (stage-50 — قبلاً بن‌بستِ متنی بود).
 * stage-49:
 *  • در موبایل پاپ‌اور fixed زیر هدر است (از صفحه بیرون نمی‌زند).
 *  • شکستِ فعال‌سازی پیام روشن دارد و حالت busy هرگز گیر نمی‌کند.
 * stage-50:
 *  • بازبینی روی focus/visibilitychange/بازشدن پاپ‌اور؛ push-status
 *    مهلت‌دار و با نوسازی توکن.
 */
export const NotificationEnableIcon = memo(function NotificationEnableIcon() {
	const { t } = useI18nSafe()
	const [open, setOpen] = useState(false)
	const [pushState, setPushState] = useState<PushState>({ state: 'default' })
	const [hasSubscription, setHasSubscription] = useState(false)
	const [busy, setBusy] = useState(false)
	const [recheckBusy, setRecheckBusy] = useState(false)
	const [done, setDone] = useState(false)
	const [failed, setFailed] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)

	const refresh = useCallback(async () => {
		try {
			const st = await getPushState()
			setPushState(st)
			// اشتراکِ ثبت‌شده در بک‌اند (این دستگاه یا کاربر) — استاتوس سروری
			// stage-50 — authedPushFetch: مهلت‌دار + نوسازی ۴۰۱ (توکن ۱۵ دقیقه‌ای)
			const res = await authedPushFetch(`${apiBase()}/notifications/push-status`, {
				method: 'GET',
			})
			if (res && res.ok) {
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
		// stage-50 — برگشتن به تب (بعد از تغییر مجوز در تنظیمات مرورگر)
		// خودش بازبینی می‌کند؛ قبلاً فقط window.focus این کار را می‌کرد.
		const onVisibility = () => {
			if (document.visibilityState === 'visible') void refresh()
		}
		window.addEventListener('focus', onFocus)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			window.removeEventListener('focus', onFocus)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [refresh])

	// بازشدن پاپ‌اور ⇒ وضعیت تازه (مجوز ممکن است از تنظیمات مرورگر
	// برگشته باشد — denied → default/granted)
	useEffect(() => {
		if (open) void refresh()
	}, [open, refresh])

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
				// — پیام روشن؛ دکمه برای تلاش مجدد آزاد است
				setFailed(true)
				void refresh()
			}
		} finally {
			// هر نتیجه‌ای باشد، حالت busy تمام می‌شود — stage-50:
			// ریشه‌ی گیرکردن در push-subscription.ts (مهلت‌ها) رفع شد؛
			// این finally تضمِ نهایی است.
			setBusy(false)
		}
	}, [refresh])

	// stage-50 — «بررسی مجدد مجوز»: کاربر بعد از Allow کردنِ مجوز از
	// تنظیمات مرورگر، بدون رفرشِ صفحه به جریان فعال‌سازی برمی‌گردد.
	const onRecheck = useCallback(async () => {
		setRecheckBusy(true)
		try {
			const st = await getPushState()
			setPushState(st)
			// اگر مجوز برگشته و همین دستگاه اشتراکِ زنده دارد، بقیه‌ی مسیر
			// (ثبت در بک‌اند) خودش با enablePush تکمیل می‌شود — دکمه‌ی
			// فعال‌سازی نمایان می‌شود.
			if (st.state === 'granted') void refresh()
		} finally {
			setRecheckBusy(false)
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
				<Bell size={20} className="h-4.5 w-4.5 sm:h-5 sm:w-5 relative" />
			</button>

			{/* پاپ‌اور انیمیت‌شده — stage-49:
					• <sm: کارتِ fixed با حاشیه‌ی ۱۶px از هر طرف، دقیقاً زیر هدر
					• ≥sm: همان پاپ‌اور absolute چسبیده به آیکون (left-0) */}
			{open && (
				<div
					role="dialog"
					aria-label={t['notify.enable.title']}
					className="fixed left-4 right-4 top-19 z-50 overflow-hidden animate-pop-in bg-white dark:bg-[#1a0a0e] rounded-2xl shadow-2xl border border-purple-200 dark:border-purple-500/20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-24px)]"
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
							/* stage-50 — حالت denied دیگر بن‌بست نیست:
								راهنمای گام‌به‌گام + دکمه‌ی بررسی مجدد.
								قبلاً فقط یک متن بود و کاربر هیچ اقدامی از داخل
								سایت نمی‌توانست بکند. */
							<>
								<p className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
									{t['notify.enable.deniedHint']}
								</p>
								<ol className="space-y-2 border-r-2 border-purple-200 dark:border-purple-500/20 pr-3">
									{[
										t['notify.enable.deniedStep1'],
										t['notify.enable.deniedStep2'],
										t['notify.enable.deniedStep3'],
									].map((step, i) => (
										<li
											key={step}
											className="relative flex items-start gap-2 text-[11px] text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed"
										>
											<span className="w-5 h-5 shrink-0 rounded-full bg-purple-100 dark:bg-purple-500/15 text-purple-500 dark:text-purple-300 text-[10px] font-DanaDemiBold flex items-center justify-center">
													{i + 1}
											</span>
											{step}
										</li>
									))}
								</ol>
								<button
									type="button"
									disabled={recheckBusy}
									onClick={() => void onRecheck()}
									className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-linear-to-l from-purple-500 to-purple-400 text-white text-sm font-DanaDemiBold hover:opacity-90 transition disabled:opacity-50 cursor-pointer shadow-md shadow-purple-500/20"
								>
									<Refresh size={16} className={recheckBusy ? 'animate-spin' : ''} />
									{recheckBusy
										? t['notify.enable.busy']
										: t['notify.enable.recheck']}
								</button>
							</>
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