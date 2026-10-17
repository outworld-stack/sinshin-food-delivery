// src/routes/dashboard/orders/$orderId.tsx
// ⬅ NEW: loader و صفحه حالا «یک کش مشترک» دارند (کوئری)
//
// چرا؟ قبلاً loader مستقیم دیتا برمی‌گردوند و کلاینت با useQuery(orderDetailsOptions)
// پول می‌کرد — یعنی:
//   ✗ دو فچ جدا برای یک دیتا (لودر SSR + کوئری کلاینت)
//   ✗ نامعتبرسازی در میوتیشن «تایید تحویل» به کشِ خالی اشاره می‌کرد —
//     qk.orderDetails پر نبود => رفرش واقعی رخ نمی‌داد
//
// حالا: loader ← query(فکتوری) ← useQuery(همان فکتوری)
// + پولینگ یکجا: refetchInterval به‌صورت callback — فقط سفارش‌های ارسالیِ
//   در جریان؛ با DELIVERED/CANCELED خودش خاموش می‌شود (دو کوئری یکی شد)

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { memo, useEffect, useMemo } from 'react'
import { ChevronRight } from 'reicon-react'
import { CourierTrackingMap } from '#/components/dashboard/order-detail/CourierTrackingMap'
import { DeliverButton } from '#/components/dashboard/order-detail/DeliverButton'
import { DeliveryInfoBox } from '#/components/dashboard/order-detail/DeliveryInfoBox'
import { FeedbackBox } from '#/components/dashboard/order-detail/FeedbackBox'
import { OrderDetails } from '#/components/dashboard/order-detail/OrderDetails'
import { OrderStatusHeader } from '#/components/dashboard/order-detail/OrderStatusHeader'
// stage-58 — «ادامه‌ی پرداخت» برای PENDING_PAYMENT (قولِ پیام خطای چک‌اوت)
import { PendingPaymentBox } from '#/components/dashboard/order-detail/PendingPaymentBox'
import { noindexHead, headLang, type HeadFnCtx } from '#/lib/seo'
import { SEO } from '#/i18n/seo'
import { ReferralProfitBox } from '#/components/dashboard/order-detail/ReferralProfitBox'
import { OrderDetailSkeleton } from '#/components/LoadingSkeletons'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { useOrderDetailPage } from '#/hooks/dashboard/useOrderDetailPage'
import { useOrderFinancialSync } from '#/hooks/dashboard/useOrderFinancialSync'
import { useI18n } from '#/i18n'
import { useAuthStore } from '#/stores/authStore'
import { useCartStore } from '#/stores/cartStore'
import { consumePendingCheckout } from '#/lib/pending-checkout'
import { clearCheckoutIntent } from '#/lib/checkout-intent'
import {
	liveTrackingOptions,
	orderDetailsOptions,
	orderReviewedOptions,
	userProfileOptions,
} from '#/utils/queryOptions'

/** stage-77 (P3-15) — «سفارش {id} | سین شین» به زبانِ فعال (fa/ar) */
function orderHeadTitle(matches: HeadFnCtx['matches'], id: string): string {
	const title = SEO[headLang(matches)].orderDetail.title
	return title.includes('{id}') ? title.replace('{id}', id) : `${id} | ${title}`
}

const OrderDetailPage = memo(function OrderDetailPage() {
	const { orderId } = Route.useParams()
	const { t } = useI18n()
	const clearCart = useCartStore((s) => s.clearCart)
	const setActiveOrderId = useAuthStore((s) => s.setActiveOrderId)

	// ⬅ داده‌ی سفارش — «یک کوئری واحد»؛ دیتای اولیه از کشِ پرشده توسط loader
	// (همان کلید qk.orderDetails). پولینگ فقط برای سفارش‌های ارسالیِ در جریان؛
	// refetchInterval به‌صورت callback تا با تغییر وضعیت خودش خاموش شود
	const { data: order } = useQuery({
		...orderDetailsOptions(orderId),
		refetchInterval: (query) => {
			const o = query.state.data
			if (!o) return false
			// ⬅ phase-3: در انتظار نتیجه‌ی پرداخت — برگشت از درگاه قبل از رسیدن
			// callback، یا پوشش کارِ تایم‌اوت (PENDING → PAID/CANCELED را می‌گیرد)
			if (o.status === 'PENDING_PAYMENT') return 3000
			// round-12: پولینگ برای همه‌ی سفارش‌های در جریان — قبلاً فقط DELIVERY
			// بود و تغییر وضعیت سفارش حضوری (تایید آشپزخانه) بدون رفرش دیده نمی‌شد
			return o.status !== 'DELIVERED' && o.status !== 'CANCELED' ? 4000 : false
		},
	})

	// پروفایل (برای hasReferrer) — فکتوری مرکزی
	const { data: userProfile } = useQuery(userProfileOptions)

	// پرچم ردیابی زنده — از تنظیمات ادمین
	const { data: liveTracking } = useQuery({
		...liveTrackingOptions(orderId),
		enabled: order?.deliveryType === 'DELIVERY',
	})

	// محصولاتِ نظرداده‌شده‌ی این سفارش — جلوگیری از نظر تکراری
	const { data: reviewedData } = useQuery({
		...orderReviewedOptions(orderId),
		enabled: order?.status === 'DELIVERED',
	})

	const page = useOrderDetailPage(orderId)
	useOrderFinancialSync(orderId, order?.status, order?.paymentStatus)

	// ⬅ phase-3: برگشت از درگاه — اولین SUCCESS با پرچمِ «همین سفارشِ همین تب» →
	// سبد پاک شود. دیدن سفارش‌های قدیمی/سفارش دیگران سبد را پاک نمی‌کند.
	useEffect(() => {
		if (!order || !['SUCCESS', 'FAILED', 'REFUNDED'].includes(order.paymentStatus)) return
		if (!consumePendingCheckout(orderId)) return
		clearCheckoutIntent()
		if (order.paymentStatus === 'SUCCESS') clearCart()
		setActiveOrderId(orderId)
	}, [order, orderId, clearCart, setActiveOrderId])

	// دیتا فقط لحظه‌ی اول (بدون لودر) undefined است؛ لودر تضمینش کرده.
	// بعد از نامعتبرسازی دیتای قبلی حفظ می‌شود (فقط رفرش در پس‌زمینه)
	const hasReferrer = useMemo(() => !!userProfile?.referrerCode, [userProfile])
	// stage-77 (P2-2) — این useMemo از قبلِ returnِ شرطی بالا آمده: قانونِ
	// هوک‌ها می‌گفت رندرِ اول (اسکلتون — بدون hook) و رندرِ دوم (با داده —
	// یک hook بیشتر) = «Rendered more hooks…» و کرشِ کل مسیر. شاخه‌ی
	// اسکلتون عمداً نگه داشته شده بود ولی خودش ماشه‌ی همین باگ بود.
	if (!order) {
		return <OrderDetailSkeleton />
	}

	const isDelivered = order.status === 'DELIVERED'
	// امن-۷: دکمه تایید تحویل فقط بعد از تایید رستوران —
	// PAID/PENDING_PAYMENT دیگر قابل بستن نیست (قرارداد جدید بک‌اند)
	const canConfirmDelivery =
		order.status === 'CONFIRMED' || order.status === 'ON_THE_WAY'
	return (
		<div className="max-w-6xl space-y-6">
			<Link
				to="/dashboard/orders"
				className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit cursor-pointer"
			>
				<ChevronRight size={20} />
				{t['dash.orderDetail.backToOrders']}
			</Link>

			<OrderStatusHeader order={order} />

			{/* stage-58 — سفارش در انتظار پرداخت: دکمه‌ی ادامه از همین
                            صفحه (callback نامشخص ⇒ ?payment=pending ⇒ پیام «در حال بررسی») */}
			{order.status === 'PENDING_PAYMENT' && (
				<PendingPaymentBox order={order} />
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* ستون اصلی */}
				<div className="lg:col-span-2 space-y-6">
					<OrderDetails
						items={order.items.map((i) => ({
							...i,
							productId: i.productId ?? ('' as any),
						}))}
						breakdown={order.breakdown ?? null}
					/>
					{/* آیتم ۱۶: دکمه تحویل — فقط CONFIRMED/ON_THE_WAY (امن-۷) */}
					{canConfirmDelivery && (
						<DeliverButton
							isSubmitting={page.confirmDeliveryMutation.isPending}
							onConfirm={page.handleConfirmDelivery}
						/>
					)}

					{/* آیتم ۱۸: نقشه پیک — با موقعیت زنده از استریم پیک */}
					{order.deliveryType === 'DELIVERY' &&
						order.status === 'ON_THE_WAY' &&
						liveTracking?.isEnabled && (
							<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
								<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
									{t['dash.orderDetail.courierRoute']}
								</h2>
								<CourierTrackingMap
									status={order.status}
									courierLocation={order.courierLocation}
									customerLocation={order.customerLocation}
								/>
							</div>
						)}

					{/* آیتم ۹: باکس نظر — فقط بعد از تحویل */}
					{isDelivered && (
						<FeedbackBox
							items={order.items}
							reviewedProductIds={reviewedData?.productIds ?? []}
							isSubmitting={page.submitFeedbackMutation.isPending}
							onSubmit={page.handleSubmitFeedback}
							successTick={page.feedbackSuccessTick}
						/>
					)}
				</div>

				{/* ستون اطلاعات */}
				<div className="lg:col-span-1 space-y-6">
					<DeliveryInfoBox order={order} />
					<ReferralProfitBox
						profit={order.referralProfit}
						hasReferrer={hasReferrer}
					/>
				</div>
			</div>
		</div>
	)
})

export const Route = createFileRoute('/dashboard/orders/$orderId')({
	component: OrderDetailPage,
	loader: async ({ context, params }) => {
		const order = await context.queryClient.query(
			orderDetailsOptions(params.orderId),
		)
		if (!order) throw notFound()
		return order
	},

	pendingComponent: OrderDetailSkeleton,
	errorComponent: RouteError,
	notFoundComponent: RouteNotFound,

	head: ({ loaderData, matches }) => ({
		meta: loaderData
			? [
					// stage-77 (P3-15) — عنوان دوزبانه با شناسه‌ی سفارش
					// (قبلاً فارسیِ هاردکد؛ الگوی {id} از دیکشنری سئو)
					{ title: orderHeadTitle(matches, loaderData.id) },
					{ name: 'robots', content: 'noindex, nofollow' },
				]
			: noindexHead('orderDetail')({ matches }).meta,
	}),
})
