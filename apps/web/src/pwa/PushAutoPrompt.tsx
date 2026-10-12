// ═══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/pwa/PushAutoPrompt.tsx
// کامیت پیشنهادی: stage fifty-eight
// ═══════════════════════════════════════════════════════════════

// src/pwa/PushAutoPrompt.tsx
/**
 * stage-58 — پرامپتِ خودکارِ مجوز نوتیفیکیشن (به‌جای دکمه‌ی بنفش هدر).
 *
 * خواسته‌ی صریح کاربر: «پرامپت درخواست مجوز نوتیفیکیشن باید برای همه‌ی
 * کاربرها موقع باز شدن صفحه، اگر هنوز مجوز نداده‌اند، خودکار ظاهر شود.»
 *
 *  • بعد از ۲.۵ ثانیه (صفحه اول رندر شود؛ پرامپت مزاحم لود نیست) —
 *    autoPushFlow: permission==='default' + throttle ۳روزه ⇒ پرامپت خودِ
 *    مرورگر + اشتراک + ثبت سرور؛ permission==='granted' ⇒ reconcile.
 *  • مهمان: permission گرفته می‌شود؛ ثبتِ سرور بعد از لاگین (فلگ
 *    pendingLogin) — این useEffect دوم روی isAuthenticated.
 *  • iOS مرورگرِ غیرنصب‌شده: خودش رد می‌شود (داخل autoPushFlow) —
 *    راهنمای نصب PWA (بنر موجود register-sw) جای درستش است.
 *  • پیام PUSH_SUBSCRIPTION_CHANGED از SW (چرخش endpoint فایرفاکس/کروم)
 *    ⇒ فوراً reconcile تا اشتراک تازه در سرور ثبت شود.
 *
 * هیچ UI رندر نمی‌کند (null) — پرامپتِ خود مرورگر تنها نماینده‌ی کاربر است.
 * همه‌ی کارها داخل useEffect — هیچ رندر SSR نداریم → ناهم‌خوانی هیدریشن صفر.
 */

import { useEffect } from 'react'
import { autoPushFlow, reconcileSubscription } from '#/lib/push-subscription'
import { useAuthStore } from '#/stores/authStore'

/** مکث اولیه — UX: صفحه آماده شود، بعد پرامپت (نه وسط لود) */
const INITIAL_DELAY_MS = 2500

export function PushAutoPrompt() {
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

	// ── فلوی خودکارِ باز شدن صفحه ──
	useEffect(() => {
		if (typeof window === 'undefined') return
		let cancelled = false

		const run = () => {
			if (cancelled) return
			void autoPushFlow().catch((err) => {
				console.warn('[push] فلوی خودکار ناموفق:', err)
			})
		}
		const timer = window.setTimeout(run, INITIAL_DELAY_MS)

		// ── چرخش/انقضای اشتراک از سمت SW — فوراً آشتی کن ──
		const onSwMessage = (event: MessageEvent) => {
			const data = event.data as { type?: string } | null
			if (data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
				void reconcileSubscription().catch(() => {})
			}
		}
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.addEventListener('message', onSwMessage)
		}

		return () => {
			cancelled = true
			window.clearTimeout(timer)
			if ('serviceWorker' in navigator) {
				navigator.serviceWorker.removeEventListener('message', onSwMessage)
			}
		}
	}, [])

	// ── بعد از لاگین: اشتراکِ مهمانِ pending را در سرور ثبت کن ──
	// (false→true شد؟ reconcile از GET push-status می‌فهمد سرور چه دارد؛
	//  فقط در نبودِ اشتراک POST می‌زند — نرخ‌سقف هم خطر نیست)
	useEffect(() => {
		if (!isAuthenticated) return
		void reconcileSubscription().catch(() => {})
	}, [isAuthenticated])

	return null
}