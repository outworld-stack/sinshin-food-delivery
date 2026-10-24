// ═══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/dashboard/order-detail/PendingPaymentBox.tsx
// کامیت پیشنهادی: stage fifty-eight
// ═══════════════════════════════════════════════════════════════
// stage-98 — پنجرهٔ پرداخت (۱۰ دقیقه): شمارش‌معکوس + پیامِ انقضا.

// src/components/dashboard/order-detail/PendingPaymentBox.tsx
/**
 * stage-58 — باکس «ادامه‌ی پرداخت» برای سفارش‌های PENDING_PAYMENT.
 *
 * چرا؟ پیامِ خطای چک‌اوت (وقتی initiate بعد از commitِ سفارش شکست می‌خورد)
 * قولِ «پرداخت را از صفحه‌ی سفارش ادامه دهید» را می‌داد ولی چنین UIای
 * وجود نداشت — سفارش تا کارِ تایم‌اوت (۲۴ ساعت پنجره‌ی پول‌ایمنی) در
 * PENDING_PAYMENT گیر می‌کرد و کیف پول/کوپن قفل می‌ماند.
 *
 *  • دکمه → POST /payments/retry: بازگشت به جلسه‌ی موجود درگاه؛
 *    اگر تلاش قبلی قطعاً ناموفق باشد، جلسه‌ی تازه ساخته می‌شود. پاسخ: paymentUrl.
 *  • درگاه واقعی (URL مطلق) → ریدایرکت کامل مرورگر (مثل چک‌اوت).
 *  • MOCK (URL نسبی — فقط محیط توسعه) → فلوی برنامه‌ای mockPay،
 *    همان الگوی useCheckoutPage؛ روت mock فقط POST است.
 *  • ?payment=pending (callback نامشخص/برگشتِ ۳۰ثانیه‌ای از درگاه):
 *    پیام «در حال بررسی» — پولینگ ۳ثانیه‌ای خودِ صفحه وضعیت را قطعی
 *    می‌کند (PAID/CANCELED ⇒ باکس پرداخت حذف می‌شود).
 *  • خطای 409 (استعلام نامشخص/«چند دقیقه بعد») → توستِ apiError؛
 *    دکمه می‌ماند و کاربر دوباره می‌زند.
 *
 * stage-98 — پنجرهٔ پرداخت:
 *  • شمارش‌معکوسِ m:ss (ارقام فارسی) از `pendingExpiresAt`ی سرور
 *    (createdAt + PENDING_ORDER_EXPIRY_MINUTES) — نه ساعتِ دستگاهِ
 *    کاربر به‌تنهایی؛ زیرِ یک دقیقه قرمز می‌شود.
 *  • صفر ⇒ دکمه می‌رود؛ نتیجهٔ پرداخت هنوز باید توسط سرور تأیید شود.
 *    پولینگِ صفحه نتیجهٔ نهایی را می‌گیرد؛ ساعت به‌تنهایی به معنی لغو نیست.
 *  • pendingCheckedAt مبنای ساعتِ سرور است؛ گذر زمان در مرورگر با
 *    performance.now محاسبه می‌شود تا تغییر ساعت دستگاه اثر نگذارد.
 *  • pendingExpiresAt نبود (استقرارِ مخلوطِ قدیم/جدید) ⇒ بدونِ شمارش،
 *    رفتارِ stage-58 — بدونِ شکستگی.
 */
import { memo, useEffect, useState } from 'react'
import { CreditCard } from 'reicon-react'
import { useOrderPaymentRetry } from '#/hooks/dashboard/useOrderPaymentRetry'
import { tpl, useI18n } from '#/i18n'
import type { UserOrder } from '#/server/user'

interface PendingPaymentBoxProps {
	order: UserOrder
}

/** stage-98 — باقی‌ماندهٔ پنجره به ثانیه (برای شمارش‌معکوس) */
function remainingSeconds(ms: number): number {
	return Math.max(0, Math.ceil(ms / 1000))
}

function timestamp(value: Date | null | undefined): number | null {
	const ms = value ? new Date(value).getTime() : Number.NaN
	return Number.isFinite(ms) ? ms : null
}

export const PendingPaymentBox = memo(function PendingPaymentBox({
	order,
}: PendingPaymentBoxProps) {
	const { t, fmt } = useI18n()
	const { retryMutation, handleRetry } = useOrderPaymentRetry(order.id)

	// ?payment=pending — فقط بعد از هیدریشن بخوان (SSR بی‌خطر؛ پارامترِ
	// ریدایرکتِ سرورِ callback است و اثری روی رندر اولیه ندارد)
	const [justReturned, setJustReturned] = useState(false)
	useEffect(() => {
		try {
			const params = new URLSearchParams(window.location.search)
			setJustReturned(params.get('payment') === 'pending')
		} catch {
			setJustReturned(false)
		}
	}, [])

	const deadlineMs = timestamp(order.pendingExpiresAt)
	const checkedAtMs = timestamp(order.pendingCheckedAt)
	const orderId = order.id
	const [countdown, setCountdown] = useState<{
		orderId: string
		deadlineMs: number
		checkedAtMs: number | null
		remaining: number
	} | null>(null)
	useEffect(() => {
		if (deadlineMs === null) return
		// Initial SSR/hydration output uses only the serialized server snapshot.
		// Older API responses fall back to the device clock after hydration.
		const initialRemaining = deadlineMs - (checkedAtMs ?? Date.now())
		const startedAt = performance.now()
		let timer: ReturnType<typeof setInterval> | undefined
		const tick = () => {
			const remaining = Math.max(
				0,
				initialRemaining - (performance.now() - startedAt),
			)
			setCountdown({ orderId, deadlineMs, checkedAtMs, remaining })
			if (remaining === 0) clearInterval(timer)
			return remaining
		}
		if (tick() > 0) timer = setInterval(tick, 1000)
		return () => clearInterval(timer)
	}, [orderId, deadlineMs, checkedAtMs])
	const remaining =
		deadlineMs === null
			? null
			: countdown?.orderId === orderId &&
					countdown.deadlineMs === deadlineMs &&
					countdown.checkedAtMs === checkedAtMs
				? countdown.remaining
				: checkedAtMs === null
					? null
					: Math.max(0, deadlineMs - checkedAtMs)
	const expired = remaining !== null && remaining <= 0
	// ارقامِ بومیِ زبانِ فعال (فا/ع) + padding با صفرِ همان بومی — fmt.num
	// ورودیِ عددی می‌خواهد، پس دو تکه را جدا می‌سازیم: m:ss
	const clock = (() => {
		if (remaining === null) return null
		const total = remainingSeconds(remaining)
		const zero = fmt.num(0)
		const mm = fmt.num(Math.floor(total / 60)).padStart(2, zero)
		const ss = fmt.num(total % 60).padStart(2, zero)
		return `${mm}:${ss}`
	})()

	const amount = order.breakdown?.amountPaidOnline ?? order.totalAmount

	// stage-98 — حالتِ انقضا: پنجره تمام شده؛ دکمه‌ی پرداخت دیگر معنا ندارد
	if (expired) {
		return (
			<div className="bg-yellow-50 dark:bg-yellow-500/10 p-5 rounded-2xl border border-yellow-200 dark:border-yellow-500/20">
				<div className="flex items-center gap-3">
					<span className="w-11 h-11 rounded-xl bg-yellow-100 dark:bg-yellow-500/20 text-yellow-500 flex items-center justify-center shrink-0">
						<CreditCard size={22} />
					</span>
					<div className="min-w-0">
						<h3 className="font-DanaDemiBold text-base text-yellow-600 dark:text-yellow-400">
							{t['dash.orderDetail.expiredTitle']}
						</h3>
						<p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 font-DanaMedium mt-1 leading-relaxed">
							{t['dash.orderDetail.expiredHint']}
						</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="bg-yellow-50 dark:bg-yellow-500/10 p-5 rounded-2xl border border-yellow-200 dark:border-yellow-500/20">
			<div className="flex items-center gap-3">
				<span className="w-11 h-11 rounded-xl bg-yellow-100 dark:bg-yellow-500/20 text-yellow-500 flex items-center justify-center shrink-0">
					<CreditCard size={22} />
				</span>
				<div className="min-w-0">
					<h3 className="font-DanaDemiBold text-base text-yellow-600 dark:text-yellow-400">
						{justReturned
							? t['dash.orderDetail.pendingVerifyTitle']
							: t['dash.orderDetail.pendingTitle']}
					</h3>
					<p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 font-DanaMedium mt-1 leading-relaxed">
						{justReturned
							? t['dash.orderDetail.pendingVerifyHint']
							: t['dash.orderDetail.pendingHint']}
					</p>
				</div>
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-4 pt-4 border-t border-yellow-200/60 dark:border-yellow-500/20">
				<div className="flex-1 min-w-0">
					<p className="text-sm text-yellow-700 dark:text-yellow-300 font-DanaDemiBold">
						{tpl(t['dash.orderDetail.pendingAmount'], {
							n: `${fmt.price(amount)} ${t['common.toman']}`,
						})}
					</p>
					{clock !== null && remaining !== null && (
						<p
							className={
								remaining < 60_000
									? 'text-xs text-red-600 dark:text-red-400 font-DanaDemiBold mt-1 tabular-nums'
									: 'text-xs text-yellow-600/90 dark:text-yellow-400/90 font-DanaMedium mt-1 tabular-nums'
							}
							dir="rtl"
						>
							{tpl(t['dash.orderDetail.pendingCountdown'], { n: clock })}
						</p>
					)}
				</div>
				<button
					type="button"
					onClick={handleRetry}
					disabled={retryMutation.isPending}
					className="px-5 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-DanaDemiBold transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
				>
					{retryMutation.isPending
						? t['dash.orderDetail.pendingRetrying']
						: t['dash.orderDetail.continuePayment']}
				</button>
			</div>
		</div>
	)
})
