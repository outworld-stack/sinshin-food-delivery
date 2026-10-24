// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/pwa/register-sw.tsx
// تغییر (بازخورد ۶): در DEV هم سرویس‌ورکر ثبت می‌شود — اما نه sw.js
//        (workbox، فقط با build:pwa) بلکه sw-push.js سبک و استاتیک؛
//        تا Web Push در حالت توسعه روی دسکتاپ قابل آزمایش باشد.
// ═══════════════════════════════════════════════════════════════

// src/pwa/register-sw.tsx
// ثبت SW + بنر آپدیت (client-only) + install-prompt اندروید + راهنمای iOS
// همه‌چیز داخل useEffect — هیچ رندر SSR نداریم → ناهم‌خوانی هیدریشن صفر
//
// pwa-۲: بستنِ راهنمای iOS «پایدار» است (۳۰ روز، مثل اندروید) — قبلاً فقط
// state بود و با هر رفرش دوباره برمی‌گشت و کاربر iOS را اذیت می‌کرد.
// pwa-۳: بنر آپدیت دکمه‌ی «بعداً» دارد — بستنش فقط برای همین نشست است؛
// جلسه‌ی بعدی (reg.waiting هنوز هست) دوباره پیشنهاد می‌دهد که رفتار درستِ
// آپدیت است.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PwaInstallGuide } from './PwaInstallGuide'
import { usePwaInstall } from './usePwaInstall'

export function PwaRegister({
	lang = 'fa',
	showAutomaticInstall = true,
}: {
	lang?: 'fa' | 'ar'
	showAutomaticInstall?: boolean
}) {
	const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
	const [showUpdate, setShowUpdate] = useState(false)
	const {
		standalone,
		showInstall,
		showIosGuide,
		showInstallGuide,
		requestInstall,
		dismissInstall,
		dismissIosGuide,
		closeInstallGuide,
	} = usePwaInstall()
	const copy =
		lang === 'ar'
			? {
					updateReady: 'يتوفر إصدار جديد',
					update: 'تحديث',
					later: 'لاحقاً',
					installTitle: 'ثبّت سين شين على جهازك',
					install: 'تثبيت',
					close: 'إغلاق',
					ios: 'في Safari أو Chrome: مشاركة ← إضافة إلى الشاشة الرئيسية',
					help: 'طريقة التثبيت',
				}
			: {
					updateReady: 'نسخه‌ی جدید آماده است',
					update: 'به‌روزرسانی',
					later: 'بعداً',
					installTitle: 'سین شین را روی دستگاه خود نصب کنید',
					install: 'نصب',
					close: 'بستن',
					ios: 'در Safari یا Chrome: ‏Share ← Add to Home Screen',
					help: 'راهنمای نصب',
				}

	useEffect(() => {
		// ── ثبت SW ──
		if (!('serviceWorker' in navigator)) return
		let cancelled = false

		// Updating the root registration preserves push subscriptions. Leave
		// other scopes on the same development origin alone.
		if (import.meta.env.DEV) {
			navigator.serviceWorker.register('/sw-push.js').catch(() => {
				/* پوش در dev هم اختیاری است — اپ عادی */
			})
			return
		}

		// round-16 — پاک‌کننده‌های ثبتِ SW (داخل then پر می‌شوند؛ cleanup انتها می‌گیردشان)
		const swCleanupFns: Array<() => void> = []

		// stage-77 (P3-8) — ثبت بعد از load: precache کلِ بیلد (js/css/png/woff)
		// نباید با اولین رندرِ صفحه‌ی تازه‌وارد بر سرِ پهنای‌باند ۳G رقابت کند
		// (الگوی استاندارد registration). readyState کامل ⇒ همین حالا.
		let onWindowLoad: (() => void) | null = null
		let hadController = Boolean(navigator.serviceWorker.controller)
		const registerProdSw = () => {
			navigator.serviceWorker
				.register('/sw.js')
				.then((reg) => {
					if (cancelled) return
					// نسخه‌ی waiting؟ → بنر آپدیت (بدون skipWaiting خودکار)
					if (reg.waiting) {
						setWaitingWorker(reg.waiting)
						setShowUpdate(true)
					}
					const onUpdateFound = () => {
						const nw = reg.installing
						if (!nw) return
						const onStateChange = () => {
							if (
								nw.state === 'installed' &&
								navigator.serviceWorker.controller
							) {
								setWaitingWorker(nw)
								setShowUpdate(true)
							}
						}
						nw.addEventListener('statechange', onStateChange)
						swCleanupFns.push(() =>
							nw.removeEventListener('statechange', onStateChange),
						)
					}
					reg.addEventListener('updatefound', onUpdateFound)
					if (reg.installing) onUpdateFound()

					// بارگذاری مجددِ کنترل‌شده — فقط یک‌بار (فلگ ضد حلقه)
					let reloaded = false
					const onControllerChange = () => {
						if (!hadController) {
							hadController = true
							return
						}
						if (reloaded) return
						reloaded = true
						window.location.reload()
					}
					navigator.serviceWorker.addEventListener(
						'controllerchange',
						onControllerChange,
					)

					// round-16 — پنل زنده روزها باز می‌ماند؛ مرورگر خودش به‌ندرت چک می‌کند.
					// هر ۶ ساعت reg.update() → هات‌فیکس‌ها همان روز دیده می‌شوند.
					const updateTimer = setInterval(() => {
						void reg.update().catch(() => {
							/* هیچ‌کاری نمی‌کند */
						})
					}, 6 * 3600_000)

					// round-16 — پاک‌سازی کامل شنونده‌ها و تایمر (قبلاً فقط beforeinstallprompt پاک می‌شد)
					swCleanupFns.push(() => {
						clearInterval(updateTimer)
						reg.removeEventListener('updatefound', onUpdateFound)
						navigator.serviceWorker.removeEventListener(
							'controllerchange',
							onControllerChange,
						)
					})
				})
				.catch((err) => {
					if (cancelled) return
					// stage-58 — قبلاً اینجا کاملاً بی‌صدا قورت داده می‌شد؛ sw.js شکسته
					// یعنی «هیچ push handlerی در تولید نیست» — حالا: لاگ + fallback به
					// sw-push.js (استاتیک، فقط هندلر پوش) تا پوش هرگز بی‌سرویس‌ورکر
					// نماند و آپدیت بعدی sw.js سالم جایگزینش کند (scope یکسان).
					console.warn('[pwa] ثبت sw.js ناموفق — fallback به sw-push.js:', err)
					navigator.serviceWorker.register('/sw-push.js').catch(() => {
						/* پوش در این مرورگر ممکن نیست — اپ عادی */
					})
				})
		}
		if (document.readyState === 'complete') registerProdSw()
		else {
			// stage-77 — قابلیت حذف در unmount (لحظه‌ی بین mount و load)
			onWindowLoad = registerProdSw
			window.addEventListener('load', onWindowLoad, { once: true })
		}

		return () => {
			cancelled = true
			if (onWindowLoad) window.removeEventListener('load', onWindowLoad)
			for (const fn of swCleanupFns) fn()
		}
	}, [])

	// ── آپدیت: تأیید کاربر → skipWaiting → controllerchange → بارگذاری مجدد (یک‌بار) ──
	const applyUpdate = () => {
		waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
	}

	return (
		<>
			{!standalone &&
				showInstallGuide &&
				createPortal(
					<PwaInstallGuide lang={lang} onClose={closeInstallGuide} />,
					document.body,
				)}
			{/* بنر آپدیت — مینیمال + «بعداً» (pwa-۳)
          stage-75 (P3-27) — هر سه بنرِ این فایل z-90: زیرِ مودال/بات‌شیتِ
          باز (z-100) و بالای هدر (z-40) — بنرِ اطلاع‌رسانی هرگز دیالوگِ
          فعالِ کاربر را نمی‌پوشاند. */}
			{showUpdate && (
				<div className="flex w-full max-w-xl shrink-0 flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c]">
					<span className="text-[13px] text-gray-700 dark:text-gray-200 text-center font-DanaMedium">
						{copy.updateReady}
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={applyUpdate}
							className="px-4 py-1.5 rounded-xl bg-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
						>
							{copy.update}
						</button>
						<button
							type="button"
							onClick={() => setShowUpdate(false)}
							className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
						>
							{copy.later}
						</button>
					</div>
				</div>
			)}

			{/* install-prompt اندروید — stage-59: موبایل دو ردیف (متن بالا، دکمه‌ها کنار هم پایین) */}
			{showAutomaticInstall &&
				!standalone &&
				showInstall &&
				!showIosGuide &&
				!showUpdate &&
				!showInstallGuide && (
					<div className="flex w-full max-w-xl shrink-0 flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c]">
						<span className="color-morph-text text-[13px] sm:text-sm font-DanaDemiBold text-center">
							{copy.installTitle}
						</span>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									void requestInstall()
								}}
								className="px-5 py-1.5 rounded-xl bg-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
							>
								{copy.install}
							</button>
							<button
								type="button"
								onClick={dismissInstall}
								className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
							>
								{copy.later}
							</button>
						</div>
					</div>
				)}

			{/* راهنمای iOS — بستنش ۳۰ روز پایدار است (pwa-۲)
          stage-59: همان متن گرادیانی نصب + راهنمای Share در خط دوم */}
			{showAutomaticInstall &&
				!standalone &&
				showIosGuide &&
				!showUpdate &&
				!showInstallGuide && (
					<div className="flex w-full max-w-xl shrink-0 flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c]">
						<div className="text-center">
							<span className="color-morph-text text-[13px] sm:text-sm font-DanaDemiBold">
								{copy.installTitle}
							</span>
							<span className="block text-[11px] text-gray-500 dark:text-gray-400 font-DanaMedium mt-0.5">
								{copy.ios}
							</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									void requestInstall()
								}}
								className="px-4 py-1.5 rounded-xl bg-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
							>
								{copy.help}
							</button>
							<button
								type="button"
								onClick={dismissIosGuide}
								className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
							>
								{copy.close}
							</button>
						</div>
					</div>
				)}
		</>
	)
}
