// src/routes/checkout/index.tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { restaurantStatusOptions, userProfileLightClientOptions } from '#/utils/queryOptions'
import { useCartStore } from '#/stores/cartStore'
import { useAuthStore } from '#/stores/authStore'
import { useHydrated } from '#/hooks/useHydrated'
import { useCheckoutPage } from '#/hooks/site/useCheckoutPage'
import { RestaurantStatusNotice } from '#/components/site/checkout/RestaurantStatusNotice'
import { DeliveryTypeSelector } from '#/components/site/checkout/DeliveryTypeSelector'
import { CouponBox } from '#/components/site/checkout/CouponBox'
import { PaymentSection } from '#/components/site/checkout/PaymentSection'
import { AddressSelector } from '#/components/site/checkout/AddressSelector'
import { AddAddressModal } from '#/components/site/checkout/AddAddressModal'
import { CustomerNoteBox } from '#/components/site/checkout/CustomerNoteBox'
import { OrderSummary } from '#/components/site/checkout/OrderSummary'
import { CheckoutPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'

export const Route = createFileRoute('/checkout/')({
  component: CheckoutPage,

  // فقط دیتای سروری — وضعیت رستوران (آیتم ۲۲)
  // از طریق query cache: هم SSR می‌شه، هم با staleTime ۳۰s بین ناوبری‌ها کش می‌شه
  loader: ({ context }) => context.queryClient.query(restaurantStatusOptions),

  pendingComponent: CheckoutPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'تسویه حساب | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});

function CheckoutPage() {
  const navigate = useNavigate()
  // خودِ وضعیت — loaderData مستقیم دیتای query است
  const restaurantStatus = Route.useLoaderData()
  const hasHydrated = useHydrated()

  const items = useCartStore((s) => s.items)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // پروفایل سبک (کار-۶) — چک‌اوت فقط موجودی کیف پول + آدرس‌ها را می‌خواهد؛
  // حالت سبک هر دو را دارد (آدرس‌ها سبک‌اند و داخل پاسخ سبک می‌آیند)
  const { data: user } = useQuery({
    ...userProfileLightClientOptions,
    enabled: hasHydrated && isAuthenticated,
  })

  // ⬅ هوک صاحب کوئری جزئیات — آدرس و نوع تحویل و آیتم‌ها → هزینه‌ی ناحیه‌ای زنده
  const page = useCheckoutPage({ items, isAuthenticated });

  // ریدایرکت سبد خالی — با useEffect نه navigate وسط رندر (SSR-safe)
  useEffect(() => {
    if (hasHydrated && items.length === 0) {
      navigate({ to: '/cart', replace: true })
    }
  }, [hasHydrated, items.length, navigate])

  // دروازه ورود
  if (hasHydrated && !isAuthenticated) {
    return (
      <div className="py-20 text-center px-4">
        <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white mb-4">برای ادامه خرید باید وارد شوید</h1>
        <Link to="/login" className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium cursor-pointer">
          ورود / ثبت‌نام
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
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-8">تسویه حساب</h1>

      {/* آیتم ۲۲: اطلاع بسته بودن رستوران */}
      <div className="mb-6">
        <RestaurantStatusNotice isOpen={restaurantStatus.isOpen} nextOpenTime={restaurantStatus.nextOpenTime} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <DeliveryTypeSelector
            deliveryType={page.state.deliveryType}
            deliveryFee={page.calc.deliveryFee}
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