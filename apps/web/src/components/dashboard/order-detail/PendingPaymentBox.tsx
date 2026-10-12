// ═══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/dashboard/order-detail/PendingPaymentBox.tsx
// کامیت پیشنهادی: stage fifty-eight
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQueryClient } from '@tanstack/react-query'
// src/components/dashboard/order-detail/PendingPaymentBox.tsx
/**
 * stage-58 — باکس «ادامه‌ی پرداخت» برای سفارش‌های PENDING_PAYMENT.
 *
 * چرا؟ پیامِ خطای چک‌اوت (وقتی initiate بعد از commitِ سفارش شکست می‌خورد)
 * قولِ «پرداخت را از صفحه‌ی سفارش ادامه دهید» را می‌داد ولی چنین UIای
 * وجود نداشت — سفارش تا کارِ تایم‌اوت (۲۴ ساعت پنجره‌ی پول‌ایمنی) در
 * PENDING_PAYMENT گیر می‌کرد و کیف پول/کوپن قفل می‌ماند.
 *
 *  • دکمه → POST /payments/retry (بک‌اند stage-58): ردیف تازه + initiate
 *    با درگاهِ آخرین تلاش خود سفارش. پاسخ: paymentUrl.
 *  • درگاه واقعی (URL مطلق) → ریدایرکت کامل مرورگر (مثل چک‌اوت).
 *  • MOCK (URL نسبی — فقط محیط توسعه) → فلوی برنامه‌ای mockPay،
 *    همان الگوی useCheckoutPage؛ روت mock فقط POST است.
 *  • ?payment=pending (callback نامشخص/برگشتِ ۳۰ثانیه‌ای از درگاه):
 *    پیام «در حال بررسی» — پولینگ ۳ثانیه‌ای خودِ صفحه وضعیت را قطعی
 *    می‌کند (PAID ⇒ رندر عادی؛ CANCELED ⇒ همین باکس با دکمه‌ی رِتری).
 *  • خطای 409 (استعلام نامشخص/«چند دقیقه بعد») → توستِ apiError؛
 *    دکمه می‌ماند و کاربر دوباره می‌زند.
 */
import { memo, useCallback, useEffect, useState } from 'react'
import { CreditCard } from 'reicon-react'
import { tpl, useI18n } from '#/i18n'
import { mockPay, retryOrderPayment } from '#/server/checkout'
import type { UserOrder } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'

interface PendingPaymentBoxProps {
	order: UserOrder
}

export const PendingPaymentBox = memo(function PendingPaymentBox({
	order,
}: PendingPaymentBoxProps) {
	const { t, fmt, apiError } = useI18n()
	const showToast = useToastStore((s) => s.showToast)
	const queryClient = useQueryClient()

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

	const retryMutation = useMutation({
		mutationFn: () => retryOrderPayment({ orderId: order.id }),
		onSuccess: async (res) => {
			if (!res.paymentUrl) {
				showToast(apiError(t['dash.orderDetail.pendingRetryNoUrl']), 'error')
				return
			}
			// ── درگاه واقعی (URL مطلق) — ریدایرکت کامل ──
			if (res.paymentUrl.startsWith('http')) {
				window.location.href = res.paymentUrl
				return
			}
			// ── MOCK (URL نسبی) — فقط محیط توسعه؛ روت mock فقط POST است ──
			try {
				const payResult = await mockPay(res.paymentUrl, true)
				// پولینگ/کوئری صفحه وضعیت تازه را می‌گیرد؛ invalidate فوری‌تر
				await queryClient.invalidateQueries({
					queryKey: qk.orderDetails(order.id),
				})
				showToast(
					payResult.paymentStatus === 'SUCCESS'
						? t['checkout.paySuccess']
						: t['checkout.payFailed'],
					payResult.paymentStatus === 'SUCCESS' ? 'success' : 'error',
				)
			} catch (err) {
				showToast(
					apiError(err instanceof Error ? err.message : t['common.error']),
					'error',
				)
			}
		},
		onError: (err) => {
			showToast(apiError(err.message || t['common.error']), 'error')
		},
	})

	const handleRetry = useCallback(() => {
		if (!retryMutation.isPending) retryMutation.mutate()
	}, [retryMutation])

	const amount = order.breakdown?.amountPaidOnline ?? order.totalAmount

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
				<p className="text-sm text-yellow-700 dark:text-yellow-300 font-DanaDemiBold flex-1">
					{tpl(t['dash.orderDetail.pendingAmount'], {
						n: `${fmt.price(amount)} ${t['common.toman']}`,
					})}
				</p>
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