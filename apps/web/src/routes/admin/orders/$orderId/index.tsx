// src/routes/admin/orders/$orderId/index.tsx
// ⬅ NEW: رفع باگ رفرش — قبلاً loader مستقیماً دیتا برمی‌گرداند (بدون کش) و
// کامپوننت از Route.useLoaderData می‌خواند؛ یعنی تایید/تغییر پیک در پنل زنده
// هیچ ریفچی روی این صفحه نمی‌ساخت (snapshot کهنه می‌ماند).
// حالا: loader و کامپوننت یک کش مشترک دارند (adminOrderDetailsOptions) =>
// invalidate های پنل زنده، واقعاً این صفحه را به‌روز می‌کنند + پری‌فچ روی هاور.
//
// round-12: ①حضوری‌ها «پیک هنوز تخصیص نیافته»/باکس اسکن پیک نمی‌بینند
// ②QR واقعی به‌جای لینک متنی ③دکمه‌های چاپ فاکتور (اشپزخانه/فروش) با موتور مستقل

import type { OrderBreakdown } from '@sinshin/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { memo, useCallback, useState } from 'react'
import { ChevronRight, Phone, Printer, Store } from 'reicon-react'
import { AdminOrderDetailSkeleton } from '#/components/LoadingSkeletons'
import { OrderBreakdownCard } from '#/components/shared/OrderBreakdownCard'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { StatusBadge } from '#/components/shared/StatusBadge'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { useHydrated } from '#/hooks/useHydrated'
import { getStaffOrderInvoice, type StaffInvoice } from '#/server/admin'
import { ensureAuthHydrated, useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { formatDate, formatPrice } from '#/utils/format'
import { printOrderInvoices } from '#/utils/invoicePrint'
import { adminOrderDetailsOptions } from '#/utils/queryOptions'

const OrderDetailPage = memo(function OrderDetailPage() {
	const { orderId } = Route.useParams()
	const showToast = useToastStore((s) => s.showToast)
	const hydrated = useHydrated()
	const { permissions, isMainAdmin } = usePermissions()
	const [printing, setPrinting] = useState(false)

	// نقش‌محور: ادمین۲ فقط سفارش خودش (بک: adminId از کوکی)
	const role = useAuthStore((s) => s.role)
	const admin2Id = useAuthStore((s) => s.admin2Id)
	const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined

	// ⬅ NEW: اشتراک در کش مشترک با loader (فکتوری مرکزی) —
	// همان کلیدی که loader با query پر کرده؛
	// invalidate از ConfirmOrderModal (تایید/تغییر پیک) اینجا واقعاً می‌نشیند
	const { data: order } = useQuery(
		adminOrderDetailsOptions(orderId, viewAdmin2Id),
	)

	// ریز فاکتور — ادمین اصلی همیشه / ادمین۲ با پرمیشن orderDetailsRead
	const canSeeBreakdown = isMainAdmin || permissions.orderDetailsRead

	// round-12 — چاپ مجدد فاکتور از صفحهٔ جزئیات (اشپزخانه + فروش)
	const handlePrint = useCallback(
		async (kinds: ('kitchen' | 'sales')[]) => {
			setPrinting(true)
			try {
				const inv: StaffInvoice = await getStaffOrderInvoice(orderId)
				await printOrderInvoices(inv, kinds)
				showToast('پنجرهٔ چاپ فاکتور باز شد — از «Save as PDF» استفاده کنید')
			} catch (err) {
				showToast(
					err instanceof Error ? err.message : 'چاپ فاکتور ناموفق بود',
					'error',
				)
			} finally {
				setPrinting(false)
			}
		},
		[orderId, showToast],
	)

	if (!order) {
		// در حال ریفچ بعد از invalidate یا سفارش خارج از دسترس نقش
		return <RouteNotFound />
	}

	// لینک اسکن پیک — QR واقعی روی فاکتور فروش همین مسیر را انکد می‌کند
	const scanUrl = `${window.location.origin}/courier/scan/${order.id}${order.courierSecurityEnabled && order.courierId ? `?courier=${order.courierId}` : ''}`

	const isDelivery = order.deliveryType === 'DELIVERY'

	return (
		<div className="space-y-6">
			<Link
				to="/admin/orders"
				className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit cursor-pointer"
			>
				<ChevronRight size={20} />
				بازگشت به لیست سفارشات
			</Link>

			{/* هدر سفارش */}
			<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
							{order.id}
						</h1>
						<StatusBadge status={order.status} perspective="admin" />
					</div>
					<p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
						{formatDate(order.date)}
					</p>
				</div>
				<div className="flex items-center gap-4">
					<div className="text-left">
						<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
							مبلغ کل
						</p>
						<p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary mt-1">
							{formatPrice(order.amount)} تومان
						</p>
					</div>
				</div>
			</div>

			{/* round-12 — چاپ فاکتور: اشپزخانه (بدون قیمت) + فروش (کامل، با QR پیک) */}
			<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2">
					چاپ فاکتور
				</h2>
				<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-4 leading-relaxed">
					هر فاکتور در پنجرهٔ چاپ جداگانه و با فرمت رسیدی (ستونی ۸۰mm — مناسب
					پرینترهای مغازه) ارسال می‌شود تا هر کدام روی پرینتر خودش (اشپزخانه /
					میز بیرون‌بر) چاپ شود. فاکتور فروش، QR مخصوص پیک دارد و فقط برای
					سفارش‌های «ارسال با پیک» چاپ می‌شود؛ اگر موقع تایید، «چاپ یادداشت در
					فاکتور بیرون‌بر» روشن بوده باشد، یادداشت ادمین هم روی آن می‌آید.
				</p>
				<div className="flex flex-col sm:flex-row gap-3">
					<button
						type="button"
						onClick={() => void handlePrint(['kitchen'])}
						disabled={printing}
						className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
					>
						<Printer size={16} />
						فاکتور اشپزخانه
					</button>
					<button
						type="button"
						onClick={() => void handlePrint(['sales'])}
						disabled={printing}
						className="flex-1 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
					>
						<Printer size={16} />
						فاکتور فروش{isDelivery ? ' (با QR پیک)' : ''}
					</button>
					<button
						type="button"
						onClick={() => void handlePrint(['kitchen', 'sales'])}
						disabled={printing}
						className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
					>
						<Printer size={16} />
						هر دو فاکتور
					</button>
				</div>
			</div>

			<div
				className="grid grid-cols-1 lg:grid-cols-2 gap-6"
				id="order-detail-print"
			>
				{/* ستون راست: اطلاعات سفارش */}
				<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
					<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
						اطلاعات سفارش
					</h2>

					<div className="space-y-6">
						<div>
							<p className="text-xs text-gray-400 font-DanaMedium mb-1">
								مشتری
							</p>
							<div className="flex flex-col">
								<span className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
									{order.userName}
								</span>
								<a
									href={`tel:${order.userPhone}`}
									className="text-xs text-gray-400 hover:text-primary transition"
									dir="ltr"
								>
									{order.userPhone}
								</a>
							</div>
						</div>

						{/* round-12 — نوع تحویل: قبلاً هیچ‌جا نمایش داده نمی‌شد */}
						<div>
							<p className="text-xs text-gray-400 font-DanaMedium mb-1">
								نوع تحویل
							</p>
							<span className="inline-flex items-center gap-1.5 text-xs font-DanaDemiBold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300">
								<Store size={13} />
								{isDelivery
									? 'ارسال با پیک'
									: order.deliveryType === 'PICKUP'
										? 'بیرون‌بر (تحویل حضوری)'
										: 'سرو در سالن'}
							</span>
						</div>

						{order.confirmedByName && (
							<div>
								<p className="text-xs text-gray-400 font-DanaMedium mb-1">
									ثبت‌کننده سفارش (ادمین سطح ۲)
								</p>
								<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
									{order.confirmedByName}
								</p>
							</div>
						)}

						{order.customerNote && (
							<div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
								<p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
									<span className="font-DanaDemiBold">نکته مشتری: </span>
									{order.customerNote}
								</p>
							</div>
						)}

						{order.internalNote && (
							<div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
								<p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium leading-relaxed">
									<span className="font-DanaDemiBold">نکته ادمین: </span>
									{order.internalNote}
								</p>
							</div>
						)}

						{order.courierSecurityEnabled && (
							<div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10">
								<span className="text-xs text-green-600 dark:text-green-400 font-DanaDemiBold">
									احراز هویت پیک فعال است
								</span>
							</div>
						)}
					</div>
				</div>

				{/* ستون چپ: اطلاعات تحویل و پیک — round-12: حضوری‌ها مسیر پیک نمی‌بینند */}
				<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
					<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
						اطلاعات تحویل
					</h2>

					<div className="space-y-6">
						{isDelivery ? (
							<>
								{order.courierName ? (
									<div>
										<p className="text-xs text-gray-400 font-DanaMedium mb-1">
											پیک
										</p>
										<div className="flex items-center justify-between bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-lg">
											<div>
												<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
													{order.courierName}
												</p>
												{order.courierPhone && (
													<p className="text-xs text-gray-400" dir="ltr">
														{order.courierPhone}
													</p>
												)}
											</div>
											{order.courierPhone && (
												<a
													href={`tel:${order.courierPhone}`}
													className="p-2 rounded-lg bg-green-500 text-white cursor-pointer hover:opacity-90 transition"
												>
													<Phone size={20} />
												</a>
											)}
										</div>
									</div>
								) : (
									<div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-50 dark:bg-yellow-500/10">
										<p className="text-xs text-yellow-600 dark:text-yellow-400 font-DanaMedium">
											سفارش ارسالی است و پیک هنوز تخصیص نیافته — هنگام تایید
											انتخاب کنید.
										</p>
									</div>
								)}

								{order.courierArrivedAt && (
									<div>
										<p className="text-xs text-gray-400 font-DanaMedium mb-1">
											رسیدن پیک به مغازه
										</p>
										<p className="text-sm text-gray-700 dark:text-gray-300 font-DanaMedium">
											{formatDate(order.courierArrivedAt)}
										</p>
									</div>
								)}
							</>
						) : (
							<div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-500/10">
								<Store size={22} className="text-green-500 shrink-0" />
								<p className="text-sm text-green-600 dark:text-green-400 font-DanaMedium leading-relaxed">
									سفارش شما از نوع تحویل حضوری است. با مراجعه به محل سین شین
									سفارش خود را تحویل بگیرید.
								</p>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* ⬅ ریز مبلغ فاکتور — ادمین اصلی همیشه / ادمین۲ با پرمیشن (بعد از هیدریشن — بدون mismatch) */}
			{hydrated && order.breakdown && canSeeBreakdown && (
				<OrderBreakdownCard
					breakdown={order.breakdown as OrderBreakdown}
					title="جزئیات مبلغ سفارش"
				/>
			)}
			{hydrated && order.breakdown && !canSeeBreakdown && (
				<div className="bg-white dark:bg-[#2a1015] p-4 rounded-2xl border border-dashed border-gray-300 dark:border-white/10 text-center">
					<p className="text-xs text-gray-400 font-DanaMedium">
						ریز مبلغ فاکتور — قابل مشاهده با اجازه‌ی مدیر اصلی
					</p>
				</div>
			)}

			{/* round-12 — QR اسکن پیک: فقط سفارش‌های ارسالی + رندر واقعی QR
          (قبلاً لینک متنی «شبیه‌سازی» بود و همهٔ سفارش‌ها حتی حضوری‌ها می‌گرفتند) */}
			{isDelivery && (
				<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
					<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2">
						اسکن پیک
					</h2>
					<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-4 leading-relaxed">
						این QR روی فاکتور فروش چاپ می‌شود؛ پیک با اسکن آن، رسیدنش ثبت و سفارش
						«در مسیر» می‌شود.
						{order.courierSecurityEnabled
							? ' امنیت فعال است: فقط پیک تخصیص‌یافته می‌تواند اسکن را تکمیل کند.'
							: ' امنیت خاموش است: هر پیک می‌تواند اسکن کند.'}
					</p>
					<div className="flex flex-col sm:flex-row items-center gap-5">
						<div className="p-3 bg-white rounded-2xl border border-gray-100 dark:border-white/10 shrink-0">
							<QRCodeSVG
								value={scanUrl}
								size={140}
								bgColor="#ffffff"
								fgColor="#1a0a0e"
								level="M"
								marginSize={0}
							/>
						</div>
						<div className="flex-1 w-full min-w-0 space-y-3">
							<div
								className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-xs text-primary dark:text-dark-primary font-DanaMedium break-all"
								dir="ltr"
							>
								{scanUrl}
							</div>
							<button
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(scanUrl)
									showToast('لینک اسکن کپی شد')
								}}
								className="px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
							>
								کپی لینک اسکن
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
})

export const Route = createFileRoute('/admin/orders/$orderId/')({
	ssr: false,
	component: OrderDetailPage,

	// ⬅ NEW: prefetch — هاور روی شناسه سفارش در لیست/داشبورد => دیتا در کش؛
	// ناوبری به جزئیات بدون حتی یک اسکلتون.
	// نقش‌محور: ادمین۲ فقط سفارش خودش را پرلیچ می‌کند (همان کلید کامپوننت)
	loader: async ({ context, params }) => {
		await ensureAuthHydrated()
		const { role, admin2Id } = useAuthStore.getState()
		if (role !== 'admin' && role !== 'admin2') return
		const viewAdmin2Id = role === 'admin2' ? (admin2Id ?? undefined) : undefined
		const order = await context.queryClient.query(
			adminOrderDetailsOptions(params.orderId, viewAdmin2Id),
		)
		if (!order) throw notFound()
	},

	pendingComponent: AdminOrderDetailSkeleton,
	errorComponent: RouteError,
	notFoundComponent: RouteNotFound,

	head: () => ({
		meta: [
			{ title: 'جزئیات سفارش | سین شین' },
			{ name: 'robots', content: 'noindex, nofollow' },
		],
	}),
})
