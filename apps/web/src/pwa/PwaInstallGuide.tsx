import { useEffect, useId, useRef, useState } from 'react'
import type { Lang } from '#/i18n'
import { isIosInstallDevice } from './install'

const copy = {
	fa: {
		title: 'نصب سین‌شین',
		intro: 'روش نصب را از منوی مرورگر دستگاهتان انتخاب کنید.',
		ios: 'آیفون و آیپد',
		iosSteps: [
			'سایت را در Safari یا Chrome به‌روز باز کنید و دکمهٔ اشتراک‌گذاری (Share) را بزنید. اگر گزینهٔ افزودن در مرورگرتان نبود، Safari را امتحان کنید.',
			'افزودن به صفحهٔ اصلی (Add to Home Screen) و سپس افزودن (Add) را انتخاب کنید. اگر گزینهٔ Open as Web App نمایش داده شد، آن را روشن کنید.',
		],
		android: 'گوشی و تبلت اندروید',
		androidSteps: [
			'سایت را مستقیماً در مرورگر، مانند Chrome یا Samsung Internet، باز کنید.',
			'از منوی مرورگر، نصب (Install) یا افزودن به صفحهٔ اصلی (Add to Home screen) را انتخاب و تأیید کنید. در بعضی نسخه‌های Chrome، نصب داخل بخش Install and create shortcut است.',
		],
		desktop: 'کامپیوتر',
		desktopSteps: [
			'در Chrome یا Edge از آیکون نصب در نوار آدرس یا گزینهٔ نصب در منوی مرورگر استفاده کنید.',
			'در Safari مک، اگر گزینهٔ File → Add to Dock وجود دارد، آن را انتخاب کنید.',
		],
		missing: 'گزینهٔ نصب را نمی‌بینید؟',
		missingText:
			'اگر سایت داخل برنامه‌ای مانند اینستاگرام یا تلگرام باز است، از گزینهٔ «باز کردن در مرورگر» استفاده کنید. از حالت خصوصی خارج شوید و مرورگر را به‌روز کنید. اگر مرورگر یا سیستم شما نصب را پشتیبانی نمی‌کند، می‌توانید سایت را نشانک‌گذاری و در مرورگر استفاده کنید.',
		blocked: 'خطای «Unsafe app blocked» در اندروید',
		blockedText:
			'Chrome و Google Play را از فروشگاه رسمی به‌روز کنید و نصب را دوباره امتحان کنید. اگر Play Protect همچنان نصب را مسدود می‌کند، فعلاً سایت را در مرورگر استفاده کنید؛ دکمهٔ نصب سایت نمی‌تواند این محدودیت را برطرف کند.',
		close: 'بستن',
	},
	ar: {
		title: 'تثبيت سين‌شين',
		intro: 'اختر طريقة التثبيت من قائمة متصفح جهازك.',
		ios: 'آيفون وآيباد',
		iosSteps: [
			'افتح الموقع في Safari أو Chrome المحدّث واضغط على زر المشاركة (Share). إذا لم يظهر خيار الإضافة في متصفحك، جرّب Safari.',
			'اختر إضافة إلى الشاشة الرئيسية (Add to Home Screen)، ثم إضافة (Add). إذا ظهر خيار Open as Web App، فعّله.',
		],
		android: 'هواتف وأجهزة أندرويد اللوحية',
		androidSteps: [
			'افتح الموقع مباشرة في متصفح، مثل Chrome أو Samsung Internet.',
			'من قائمة المتصفح اختر تثبيت (Install) أو إضافة إلى الشاشة الرئيسية (Add to Home screen)، ثم أكّد. في بعض إصدارات Chrome يوجد التثبيت ضمن Install and create shortcut.',
		],
		desktop: 'الكمبيوتر',
		desktopSteps: [
			'في Chrome أو Edge، استخدم رمز التثبيت في شريط العنوان أو خيار التثبيت في قائمة المتصفح.',
			'في Safari على Mac، اختر File → Add to Dock إذا كان متاحاً.',
		],
		missing: 'لا يظهر خيار التثبيت؟',
		missingText:
			'إذا فُتح الموقع داخل تطبيق مثل إنستغرام أو تلغرام، استخدم «فتح في المتصفح». اخرج من التصفح الخاص وحدّث المتصفح. إذا كان المتصفح أو النظام لا يدعم التثبيت، يمكنك حفظ الموقع في الإشارات المرجعية واستخدامه في المتصفح.',
		blocked: 'خطأ «Unsafe app blocked» على أندرويد',
		blockedText:
			'حدّث Chrome وGoogle Play من المتجر الرسمي، ثم حاول التثبيت مجدداً. إذا استمر Play Protect في حظر التثبيت، استخدم الموقع مؤقتاً في المتصفح؛ زر التثبيت في الموقع لا يستطيع إزالة هذا القيد.',
		close: 'إغلاق',
	},
} as const

export function PwaInstallGuide({
	lang,
	onClose,
}: {
	lang: Lang
	onClose: () => void
}) {
	const text = copy[lang]
	const titleId = useId()
	const panelRef = useRef<HTMLDivElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const onCloseRef = useRef(onClose)
	onCloseRef.current = onClose
	const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>(
		'desktop',
	)
	useEffect(() => {
		setPlatform(
			isIosInstallDevice()
				? 'ios'
				: /android/i.test(navigator.userAgent)
					? 'android'
					: 'desktop',
		)
		const previousFocus = document.activeElement as HTMLElement | null
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		closeRef.current?.focus()
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault()
				onCloseRef.current()
			} else if (event.key === 'Tab') {
				const focusable =
					panelRef.current?.querySelectorAll<HTMLElement>('button, summary')
				if (!focusable?.length) return
				const first = focusable[0]
				const last = focusable[focusable.length - 1]
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault()
					last.focus()
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault()
					first.focus()
				}
			}
		}
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('keydown', onKey)
			document.body.style.overflow = previousOverflow
			if (previousFocus?.isConnected) previousFocus.focus()
		}
	}, [])

	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				dir="rtl"
				lang={lang}
				className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#2a1015] p-5 shadow-xl text-gray-800 dark:text-gray-100"
			>
				<div className="flex items-center justify-between gap-4 mb-3">
					<h2 id={titleId} className="text-lg font-DanaDemiBold">
						{text.title}
					</h2>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						className="px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10"
					>
						{text.close}
					</button>
				</div>
				<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
					{text.intro}
				</p>
				<div className="space-y-3 text-sm leading-relaxed">
					{(['ios', 'android', 'desktop'] as const).map((device) => (
						<details
							key={device}
							open={platform === device}
							className="rounded-xl border border-gray-200 dark:border-white/10 p-3"
						>
							<summary className="cursor-pointer font-DanaDemiBold">
								{text[device]}
							</summary>
							<ol className="list-decimal ps-5 mt-3 space-y-2">
								{text[`${device}Steps`].map((step) => (
									<li key={step}>{step}</li>
								))}
							</ol>
						</details>
					))}
					<details className="p-3">
						<summary className="cursor-pointer font-DanaMedium">
							{text.missing}
						</summary>
						<p className="mt-2 text-gray-500 dark:text-gray-400">
							{text.missingText}
						</p>
					</details>
					<details className="p-3">
						<summary className="cursor-pointer font-DanaMedium">
							{text.blocked}
						</summary>
						<p className="mt-2 text-gray-500 dark:text-gray-400">
							{text.blockedText}
						</p>
					</details>
				</div>
			</div>
		</div>
	)
}
