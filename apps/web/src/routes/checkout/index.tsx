// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 16 از 18
// مسیر مقصد: web/src/routes/checkout/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/checkout/index.tsx

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CheckoutPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { AddAddressModal } from '#/components/site/checkout/AddAddressModal'
import { AddressSelector } from '#/components/site/checkout/AddressSelector'
import { CouponBox } from '#/components/site/checkout/CouponBox'
import { CustomerNoteBox } from '#/components/site/checkout/CustomerNoteBox'
import { DeliveryTypeSelector } from '#/components/site/checkout/DeliveryTypeSelector'
import { OrderSummary } from '#/components/site/checkout/OrderSummary'
import { PaymentSection } from '#/components/site/checkout/PaymentSection'
import { RestaurantStatusNotice } from '#/components/site/checkout/RestaurantStatusNotice'
import { useCheckoutPage } from '#/hooks/site/useCheckoutPage'
import { useHydrated } from '#/hooks/useHydrated'
import { useI18n } from '#/i18n'
import { noindexHead } from '#/lib/seo'
import { useAuthStore } from '#/stores/authStore'
import { useCartStore } from '#/stores/cartStore'
import {
	restaurantStatusOptions,
	userProfileLightClientOptions,
} from '#/utils/queryOptions'

export const Route = createFileRoute('/checkout/')({
	component: CheckoutPage,

	// فقط دیتای سروری — وضعیت رستوران (آیتم ۲۲)
	// از طریق کش کوئری: هم SSR می‌شه، هم با staleTime ۳۰s بین ناوبری‌ها کش می‌شه
	loader: ({ context }) => context.queryClient.query(restaurantStatusOptions),

	pendingComponent: CheckoutPageSkeleton,
	errorComponent: RouteError,

	// رارد ۳۸ — noindex با عنوان دوزبانه
	head: noindexHead('checkout'),
})

function CheckoutPage() {
	const navigate = useNavigate()
	// خودِ وضعیت — loaderData مستقیم دیتای کوئری است
	const restaurantStatus = Route.useLoaderData()
	const hasHydrated = useHydrated()
	const { t } = useI18n()

	const items = useCartStore((s) => s.items)
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

	// پروفایل سبک (کار-۶) — چک‌اوت فقط موجودی کیف پول + آدرس‌ها را می‌خواهد؛
	// حالت سبک هر دو را دارد (آدرس‌ها سبک‌اند و داخل پاسخ سبک می‌آیند)
	const { data: user } = useQuery({
		...userProfileLightClientOptions,
		enabled: hasHydrated && isAuthenticated,
	})

	// ⬅ هوک صاحب کوئری جزئیات — آدرس و نوع تحویل و آیتم‌ها → هزینه‌ی ناحیه‌ای زنده
	const page = useCheckoutPage({ items, isAuthenticated })

	// ریدایرکت سبد خالی — با useEffect نه پیمایش وسط رندر (SSR-safe)
	useEffect(() => {
		if (hasHydrated && items.length === 0) {
			navigate({ to: '/cart', replace: true })
		}
	}, [hasHydrated, items.length, navigate])

	// دروازه ورود
	if (hasHydrated && !isAuthenticated) {
		return (
			<div className="py-20 text-center px-4">
				<h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white mb-4">
					{t['checkout.loginRequired']}
				</h1>
				<Link
					to="/login"
					className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium cursor-pointer"
				>
					{t['header.auth']}
				</Link>
			</div>
		)
	}

	// اسکلتون اختصاصی
	if (!hasHydrated || page.isDetailsLoading) {
		return <CheckoutPageSkeleton />
	}

	return (
		<div className="py-10 px-4">
			<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-8">
				{t['checkout.title']}
			</h1>

			{/* آیتم ۲۲: اطلاع بسته بودن رستوران */}
			<div className="mb-6">
				<RestaurantStatusNotice
					isOpen={restaurantStatus.isOpen}
					nextOpenTime={restaurantStatus.nextOpenTime}
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				<div className="lg:col-span-2 space-y-6">
					<DeliveryTypeSelector
						deliveryType={page.state.deliveryType}
						deliveryFee={page.calc.deliveryFee}
						packagingFee={page.calc.packagingFee}
						onChange={page.handleDeliveryTypeChange}
					/>

					<CouponBox
						status={page.state.couponStatus}
						code={page.state.couponDraft}
						applied={page.couponApplied}
						onStatusChange={page.handleCouponStatusChange}
						onCodeChange={page.handleCouponCodeChange}
						onApply={page.handleApplyCoupon}
					/>

					<PaymentSection
						useWallet={page.state.useWallet}
						walletBalance={user?.walletBalance ?? 0}
						walletDeduction={page.calc.walletDeduction}
						onToggleWallet={page.handleToggleWallet}
						selectedGateway={page.state.selectedGateway}
						onGatewayChange={page.handleGatewayChange}
						gatewaysDisabled={page.isGatewayDisabled}
						amountPaidOnline={page.calc.amountPaidOnline}
						deliveryType={page.state.deliveryType}
					/>

					{page.state.deliveryType === 'DELIVERY' && (
						<AddressSelector
							addresses={user?.addresses ?? []}
							selectedId={page.state.selectedAddressId}
							onSelect={page.handleSelectAddress}
							onOpenModal={page.handleOpenAddressModal}
						/>
					)}

					{/* آیتم ۱۳: یادداشت مشتری */}
					<CustomerNoteBox
						value={page.state.customerNote}
						onChange={page.handleCustomerNoteChange}
					/>
				</div>

				<OrderSummary
					subtotal={page.calc.payableFood + page.calc.discount}
					discount={page.calc.discount}
					walletDeduction={page.calc.walletDeduction}
					deliveryFee={page.calc.deliveryFee}
					packagingFee={page.calc.packagingFee}
					total={page.calc.total}
					amountPaidOnline={page.calc.amountPaidOnline}
					deliveryType={page.state.deliveryType}
					isLoading={page.isDetailsLoading}
					isSubmitBlocked={page.isSubmitBlocked}
					isSubmitting={page.checkoutMutation.isPending}
					onSubmit={page.handleFinalSubmit}
					restaurantStatus={restaurantStatus}
				/>
			</div>

			{/* مودال آدرس */}
			{page.state.isAddressModalOpen && (
				<AddAddressModal onClose={page.handleCloseAddressModal} />
			)}
		</div>
	)
}