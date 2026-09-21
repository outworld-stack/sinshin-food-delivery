// src/routes/dashboard/index.tsx
// ⬅ NEW: loader پری‌فچ + pendingComponent/errorComponent + head
// (اسکلتونِ inline قبلی استخراج شد تا pendingComponent هم همان را نشان دهد)

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { ReferralApplyBox } from '#/components/dashboard/ReferralApplyBox'
import { Skeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import type { UserOrder } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { formatDate, formatPrice, formatReferralId } from '#/utils/format'
import { userProfileOptions } from '#/utils/queryOptions'

// اسکلتون اختصاصی — هم pendingComponent، هم حالت isLoading
function DashboardHomeSkeleton() {
	return (
		<div className="space-y-8">
			<div>
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-64 mt-3" />
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
				<Skeleton className="h-28 rounded-2xl" />
				<Skeleton className="h-28 rounded-2xl" />
			</div>
			<Skeleton className="h-64 rounded-2xl" />
			<Skeleton className="h-56 rounded-2xl" />
		</div>
	)
}

export const Route = createFileRoute('/dashboard/')({
	ssr: false,
	component: DashboardHome,

	// ⬅ NEW: پری‌فچ — هاور روی «پروفایل» در هدر => پروفایل در کش؛
	// ناوبری به داشبورد بدون حتی یک اسکلتون.
	// گارد والد (/dashboard) قبل از این loader اجرا شده و ریدایرکت کرده.
	loader: async ({ context }) => {
		await context.queryClient.query(userProfileOptions)
	},

	pendingComponent: DashboardHomeSkeleton,
	errorComponent: RouteError,
	head: () => ({
		meta: [
			{ title: 'پروفایل من | سین شین' },
			{ name: 'robots', content: 'noindex, nofollow' },
		],
	}),
})

function DashboardHome() {
	const showToast = useToastStore((state) => state.showToast)

	// پروفایل — staleTime از فکتوری (۶۰s)؛ loader همین کلید را پر کرده
	const { data: user, isLoading } = useQuery(userProfileOptions)

	if (isLoading || !user) {
		return <DashboardHomeSkeleton />
	}

	const displayName = user.name || user.phone

	// لینک معرف — روت واقعی /referral است؛ /r/CODE هیچ روتی ندارد و ۴۰۴ می‌داد
	const referralLink = `${window.location.origin}/referral/${user.referralCode}`

	// round-12 — لیبل تحویل بر اساس deliveryType (قبلاً «آدرس null؟» چک می‌شد
	// و PICKUP هم «سرو در سالن» می‌گرفت)
	const deliveryLabel = (o: UserOrder): string =>
		o.deliveryType === 'PICKUP'
			? 'بیرون‌بر (تحویل حضوری)'
			: o.deliveryType === 'DINE_IN'
				? 'سرو در سالن'
				: ''

	return (
		<div className="space-y-8">
			{/* ساختار مخصوص چاپ (فقط هنگام پرینت دیده می‌شود) */}
			<div id="print-area" style={{ display: 'none' }}>
				<div className="print-brand-box">
					<span className="print-brand-text">سین شین</span>
				</div>
				<QRCodeSVG
					value={referralLink}
					size={400}
					bgColor="#ffffff"
					fgColor="#1a0a0e"
					level="H"
					marginSize={0}
				/>
				<p className="font-DanaMedium" style={{ fontSize: '1.2rem' }}>
					کد معرف شما ، با احترام و عشق ، سین شین
				</p>
			</div>

			<div>
				<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
					پروفایل من
				</h1>
				<p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
					خوش آمدید، {displayName} 👋
				</p>
			</div>

			{/* باکس‌های آماری */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
				<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
					<div>
						<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">
							موجودی کیف پول
						</p>
						<p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">
							{formatPrice(user.walletBalance)}{' '}
							<span className="text-sm font-DanaMedium">تومان</span>
						</p>
					</div>
					<div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-primary dark:text-dark-primary"
						>
							<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
							<path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
							<path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
						</svg>
					</div>
				</div>
				<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
					<div>
						<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">
							شماره موبایل
						</p>
						<p
							className="font-DanaDemiBold text-xl text-gray-800 dark:text-white"
							dir="ltr"
						>
							{user.phone}
						</p>
					</div>
					<div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] flex items-center justify-center">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-gray-500 dark:text-gray-400"
						>
							<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
						</svg>
					</div>
				</div>
			</div>

			{/* باکس ۵ سفارش اخیر */}
			<div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">
					سفارش‌های اخیر
				</h2>

				{user.recentOrders.length > 0 ? (
					<div className="space-y-3">
						<div className="hidden md:grid grid-cols-4 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
							<div className="text-right">سفارش</div>
							<div className="text-center">آدرس</div>
							<div className="text-center">پیک</div>
							<div className="text-left">مبلغ</div>
						</div>

						{user.recentOrders.slice(0, 3).map((order) => (
							<div
								key={order.id}
								className="border border-gray-300 dark:border-white/5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4"
							>
								{/* چیدمان موبایل */}
								<div className="grid grid-cols-2 gap-4 text-center md:hidden">
									<div>
										<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
											سفارش
										</p>
										<Link
											to="/dashboard/orders/$orderId"
											params={{ orderId: order.id }}
											className="font-DanaDemiBold text-gray-800 dark:text-white text-sm hover:text-primary dark:hover:text-dark-primary transition-colors cursor-pointer"
										>
											{order.id}
										</Link>
										<p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
											{formatDate(order.date)} • {order.itemCount} کالا
										</p>
									</div>
									<div>
										<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
											مبلغ
										</p>
										<p className="font-DanaDemiBold text-gray-900 dark:text-white text-sm mt-1">
											{formatPrice(order.totalAmount)} تومان
										</p>
									</div>

									{order.deliveryType === 'DELIVERY' ? (
										<>
											<div>
												<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
													آدرس
												</p>
												<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
													{order.address}
												</p>
											</div>
											<div>
												<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
													پیک
												</p>
												<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
													{order.courierName}
												</p>
											</div>
										</>
									) : (
										<div className="col-span-2 w-full text-center text-green-500 text-sm mt-1">
											{deliveryLabel(order)}
										</div>
									)}
								</div>

								{/* چیدمان دسکتاپ */}
								<div className="hidden md:grid grid-cols-4 gap-4 items-center text-right">
									<div>
										<Link
											to="/dashboard/orders/$orderId"
											params={{ orderId: order.id }}
											className="font-DanaDemiBold text-gray-800 dark:text-white text-sm hover:text-primary dark:hover:text-dark-primary transition-colors cursor-pointer"
										>
											سفارش شماره {order.id}
										</Link>
										<p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
											{formatDate(order.date)} • {order.itemCount} کالا
										</p>
									</div>

									{order.deliveryType === 'DELIVERY' ? (
										<>
											<div className="text-center text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
												{order.address}
											</div>
											<div className="text-center text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
												{order.courierName}
											</div>
										</>
									) : (
										<div className="col-span-2 text-center text-sm text-green-500 font-DanaMedium">
											{deliveryLabel(order)}
										</div>
									)}

									<div className="text-left">
										<p className="font-DanaDemiBold text-gray-900 dark:text-white">
											{formatPrice(order.totalAmount)} تومان
										</p>
									</div>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="text-center py-10 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
						<p className="text-gray-400 dark:text-gray-500 font-DanaMedium">
							شما هنوز سفارشی ثبت نکرده‌اید.
						</p>
						<Link
							to="/products"
							className="inline-block mt-4 px-6 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium hover:opacity-90 transition cursor-pointer"
						>
							شروع خرید
						</Link>
					</div>
				)}
			</div>

			{/* باکس دعوت دوستان — لینک محور (روش اصلی اشتراک) */}
			<div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 text-center md:text-right">
					دعوت دوستان
				</h2>
				<p className="text-sm text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium leading-relaxed text-center md:text-right">
					با ارسال این لینک به دوستانتان، هر بار که آن‌ها سفارشی ثبت کنند، درصدی
					از مبلغ سفارش آن‌ها در کیف پول شما شارژ می‌شود!
				</p>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
					{/* ۱. اسکن QR — همون لینک */}
					<div className="flex flex-col items-center justify-center gap-4 p-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-gray-100 dark:border-white/5">
						<div
							id="printable-qr"
							className="p-4 bg-white rounded-2xl shadow-sm"
						>
							<QRCodeSVG
								value={referralLink}
								size={140}
								bgColor="#ffffff"
								fgColor="#1a0a0e"
								level="H"
								marginSize={0}
							/>
						</div>
						<button
							onClick={() => window.print()}
							className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<polyline points="6 9 6 2 18 2 18 9" />
								<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
								<rect x="6" y="14" width="12" height="8" />
							</svg>
							پرینت QR کد
						</button>
					</div>

					{/* ۲. لینک معرف — روش اصلی (همون چیزی که صفحه ورود می‌خونه) */}
					<div className="flex flex-col justify-center p-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-gray-100 dark:border-white/5">
						<h3 className="font-DanaDemiBold text-gray-700 dark:text-gray-300 text-center mb-4">
							لینک دعوت شما
						</h3>
						<div
							className="bg-white dark:bg-[#2a1015] py-3 px-4 rounded-xl text-center text-sm text-primary dark:text-dark-primary border border-dashed border-primary/30 dark:border-dark-primary/30 mb-4 break-all font-DanaMedium"
							dir="ltr"
						>
							{referralLink}
						</div>
						<button
							onClick={() => {
								navigator.clipboard.writeText(referralLink)
								showToast('لینک دعوت کپی شد!')
							}}
							className="w-full px-4 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
						>
							کپی لینک
						</button>
					</div>
				</div>
			</div>

			{/* باکس معرف من */}
			<div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4">
					معرف من
				</h2>
				{user.referrerCode ? (
					<div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
						<div className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center text-primary dark:text-dark-primary">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
								<circle cx="9" cy="7" r="4" />
								<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
								<path d="M16 3.13a4 4 0 0 1 0 7.75" />
							</svg>
						</div>
						<div>
							<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
								من با کد معرف زیر ثبت‌نام کردم:
							</p>
							<p className="font-DanaDemiBold text-lg text-gray-800 dark:text-white tracking-wider">
								{user.referrerCode}
							</p>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<p className="text-center text-gray-400 dark:text-gray-500 font-DanaMedium">
							شما زیر مجموعه ی کسی نیستید.
						</p>
						{/* round-12 — ثبت معرف با اسکن QR / ورود دستی (قبلاً فقط متن خالی بود) */}
						<ReferralApplyBox />
					</div>
				)}
			</div>

			{/* باکس زیرمجموعه‌های من */}
			<div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2">
					زیرمجموعه‌های من
				</h2>
				<p className="text-sm text-gray-400 dark:text-gray-500 mb-6 font-DanaMedium">
					۳ نفر آخر از زیرمجموعه‌های شما که اقدام به خرید کرده‌اند
				</p>

				{user.myReferrals.filter((r) => r.totalOrders > 0).slice(0, 3).length >
				0 ? (
					<div className="space-y-3">
						<div className="hidden md:grid grid-cols-4 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
							<div className="text-right">شناسه</div>
							<div className="text-center">سفارشات</div>
							<div className="text-center">مجموع خرید</div>
							<div className="text-left">سود شما</div>
						</div>

						{user.myReferrals
							.filter((r) => r.totalOrders > 0)
							.slice(0, 3)
							.map((ref) => (
								<div
									key={ref.id}
									className="border border-gray-300 dark:border-white/5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4"
								>
									{/* چیدمان موبایل */}
									<div className="grid grid-cols-2 gap-4 text-center md:hidden">
										<div>
											<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
												شناسه
											</p>
											<p
												className="font-DanaDemiBold text-gray-800 dark:text-white text-sm"
												dir="ltr"
											>
												{formatReferralId(ref.registerDate, ref.phone)}
											</p>
										</div>
										<div>
											<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
												سفارشات
											</p>
											<p className="font-DanaDemiBold text-gray-800 dark:text-white">
												{ref.totalOrders}
											</p>
										</div>
										<div>
											<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
												مجموع خرید
											</p>
											<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
												{formatPrice(ref.totalSpent)}
											</p>
										</div>
										<div>
											<p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
												سود شما
											</p>
											<p className="font-DanaDemiBold text-green-500 text-sm">
												{formatPrice(ref.myProfit)}{' '}
												<span className="text-xs">تومان</span>
											</p>
										</div>
									</div>

									{/* چیدمان دسکتاپ */}
									<div className="hidden md:grid grid-cols-4 gap-4 items-center text-right">
										<div
											className="font-DanaDemiBold text-gray-800 dark:text-white text-sm"
											dir="ltr"
										>
											{formatReferralId(ref.registerDate, ref.phone)}
										</div>
										<div className="text-center font-DanaDemiBold text-gray-800 dark:text-white">
											{ref.totalOrders}
										</div>
										<div className="text-center font-DanaDemiBold text-gray-800 dark:text-white text-sm">
											{formatPrice(ref.totalSpent)}
										</div>
										<div className="text-left font-DanaDemiBold text-green-500 text-sm">
											{formatPrice(ref.myProfit)}{' '}
											<span className="text-xs">تومان</span>
										</div>
									</div>
								</div>
							))}
					</div>
				) : (
					<div className="text-center py-8 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
						<p className="text-gray-400 dark:text-gray-500 font-DanaMedium">
							تا کنون هیچ‌یک از زیرمجموعه‌های شما خریدی نکرده‌اند.
						</p>
					</div>
				)}
			</div>
		</div>
	)
}
