// src/routes/cart/index.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useCartPage } from '#/hooks/site/useCartPage'
import { cartDetailsOptions } from '#/utils/queryOptions'
import { CartItemsList } from '#/components/site/cart/CartItemsList'
import { CartSummary } from '#/components/site/cart/CartSummary'
import { CartMobileBar } from '#/components/site/cart/CartMobileBar'
import { EmptyState } from '#/components/EmptyState'
import { ConfirmModal } from '#/components/ConfirmModal'
import { CartPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { ChevronRight } from 'reicon-react'
import { useBack } from '#/hooks/useBack'
import { useHydrated } from '#/hooks/useHydrated'
import { asProductId, asSizeId } from '@sinshin/shared'


function CartPage() {
  const back = useBack('/products')
  const hasHydrated = useHydrated()
  const page = useCartPage()

  // آیتم‌های استور (فقط id و quantity)
  const items = page.items
  // دیتای قیمت از سرور — فکتوری مرکزی؛
  // آیتم‌ها مستقیم داخل کلید می‌شینن (hash ساختاری — بدون JSON.stringify،
  // مثل checkoutDetails)؛ هر تغییر سبد → ریکوئست تازه، placeholderData بدون فلیک
  const { data: cartData, isLoading } = useQuery({
    ...cartDetailsOptions(
      items.map(i => ({
        productId: asProductId(i.productId),
        sizeId: i.sizeId ? asSizeId(i.sizeId) : null,
        quantity: i.quantity,
      }))
    ),
    enabled: items.length > 0,
  })

  // آمار مشتق‌شده — محاسبات ساده ولی برای خوانایی useMemo
  const cartStats = useMemo(() => {
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)
    const total = cartData?.total ?? 0
    const totalSavings = cartData?.items.reduce(
      (sum, item) => sum + (item.originalPrice - item.finalPrice) * item.quantity, 0
    ) ?? 0
    return { totalItems, total, totalSavings }
  }, [items, cartData])

  // اسکلتون اختصاصی هنگام هیدریشن/لودینگ
  if (!hasHydrated || (isLoading && !cartData)) {
    return <CartPageSkeleton />
  }

  // سبد خالی
  if (items.length === 0) {
    return (
      <div className="py-10 px-4">
        <EmptyState
          title="سبد خرید شما خالی است"
          description="هنوز محصولی به سبد خرید اضافه نکرده‌اید. می‌توانید منوی محصولات را مشاهده کنید."
        />
        <div className="mt-6 text-center">
          <Link to="/products" className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer">
            مشاهده محصولات
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="py-10 px-4 pb-32 lg:pb-10">
      {/* بازگشت */}
      <button
        type="button"
        onClick={back}
        className="flex items-center cursor-pointer gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition mb-10 font-DanaMedium w-fit"
      >
        <ChevronRight size={20} />
        بازگشت
      </button>

      {/* هدر + دکمه خالی کردن */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">سبد خرید</h1>
        <button
          type="button"
          onClick={page.handleOpenClearModal}
          className="text-sm text-red-500 hover:text-red-600 transition font-DanaMedium cursor-pointer"
        >
          خالی کردن سبد
        </button>
      </div>

      {/* گرید اصلی */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <CartItemsList
          items={cartData?.items ?? []}
          onIncrement={page.handleIncrement}
          onDecrement={page.handleDecrement}
          onRemove={page.handleRemove}
        />
        <CartSummary
          totalItems={cartStats.totalItems}
          total={cartStats.total}
          totalSavings={cartStats.totalSavings}
        />
      </div>

      {/* نوار موبایل */}
      <CartMobileBar total={cartStats.total} />

      {/* مودال تایید خالی کردن */}
      <ConfirmModal
        isOpen={page.state.isClearModalOpen}
        title="خالی کردن سبد خرید"
        message="آیا از خالی کردن سبد خرید خود مطمئن هستید؟ تمام محصولات از سبد شما حذف خواهند شد."
        onConfirm={page.handleConfirmClear}
        onCancel={page.handleCloseClearModal}
      />
    </div>
  )
}

export const Route = createFileRoute('/cart/')({
  component: CartPage,
  pendingComponent: CartPageSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'سبد خرید | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})