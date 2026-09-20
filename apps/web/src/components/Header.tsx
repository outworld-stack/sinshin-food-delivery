// src/components/Header.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Brand } from '#/components/Brand'
import { ThemeToggle } from '#/components/ThemeToggle'
import { useCartStore } from '#/stores/cartStore'
import { useAuthStore } from '#/stores/authStore'
import { activeMainCategoriesOptions, userProfileLightClientOptions } from '#/utils/queryOptions'
import { Cart, User, Package, Shield, Bell } from 'reicon-react'
import { useHydrated } from '#/hooks/useHydrated'
import { HeaderSkeleton } from '#/components/LoadingSkeletons'
import { useActiveOrder } from '#/hooks/shared/useActiveOrder'



export const Header = memo(function Header() {
  const hydrated = useHydrated()
  const totalItems = useCartStore((state) => state.getTotalItems())
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const role = useAuthStore((state) => state.role)
  const activeOrderId = useAuthStore((state) => state.activeOrderId)

  // Main فعال‌ها — فکتوری مرکزی (کلید یکسان با MainLayout و /products)
  const { data: activeMains } = useQuery(activeMainCategoriesOptions)

  // پروفایل سبک (کار-۶) — هدر روی «هر» صفحه‌ی سایت است؛ فقط برای تشخیص
  // سفارش فعال نیاز دارد — قبلاً پروفایل مگا (همه‌ی سفارش‌ها + txs + دستگاه‌ها)
  // در هر صفحه‌لود بارگذاری می‌شد
  const { data: user } = useQuery({
    ...userProfileLightClientOptions,
    enabled: isAuthenticated,
  })

  // چک خودکار سفارش فعال
  useActiveOrder(user?.allOrders)

  if (!hydrated) return <HeaderSkeleton />

  return (
    <header className="w-full bg-white/80 dark:bg-[#1a0a0e]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/10 transition-colors duration-500">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">

          {/* برند — کاربر لاگین → محصولات */}
          <div className="flex items-center justify-center">
            <Brand to={isAuthenticated ? '/products' : '/'} textSize="text-lg sm:text-2xl" />
          </div>

          {/* ناوبری دسکتاپ — Main داینامیک */}
          <nav className="hidden md:flex items-center gap-8">
            {(activeMains ?? []).map(mc => (
              <Link
                key={mc.id}
                to="/products"
                search={{ tab: mc.slug }}
                className="text-gray-600 hover:text-primary dark:text-gray-300 dark:hover:text-dark-primary transition font-DanaMedium"
              >
                {mc.name}
              </Link>
            ))}
          </nav>

          <div className="flex items-center justify-end gap-3 sm:gap-4">
            <ThemeToggle />

            {/* پنل‌ها + پیگیری سفارش + پروفایل — فقط isAuthenticated */}
            {isAuthenticated && (
              <>
                {role === 'admin' && (
                  <Link to="/admin" className="p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm" title="پنل مدیریت">
                    <Shield size={20} />
                  </Link>
                )}
                {role === 'admin2' && (
                  <Link to="/admin/admin2/live-orders" className="p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm" title="پنل سفارشات">
                    <Bell size={20} />
                  </Link>
                )}

                {activeOrderId && (
                  <Link
                    to="/dashboard/orders/$orderId"
                    params={{ orderId: activeOrderId }}
                    className="relative flex items-center justify-center p-2.5 text-sm rounded-lg bg-green-50 dark:bg-green-500/10 text-green-500 hover:bg-green-100 dark:hover:bg-green-500/20 transition font-DanaMedium shadow-sm border border-green-200 dark:border-green-500/20"
                    title="پیگیری سفارش"
                  >
                    <Package size={22} />
                    <span className="absolute -top-1 -left-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                  </Link>
                )}
              </>
            )}


            {/* ⬇️ سبد — همیشه، بدون هیچ شرطی */}
            <Link to="/cart" className="relative flex items-center gap-2 px-3 py-2.5 sm:px-5 text-sm rounded-lg bg-gray-100 dark:bg-[#2a1015] text-primary dark:text-dark-primary hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaMedium shadow-sm border border-gray-200 dark:border-white/10">
              <Cart size={22} />
              {totalItems > 0 && (
                <span className="absolute -top-2 -left-2 bg-primary dark:bg-dark-primary text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-DanaDemiBold shadow-md">
                  {totalItems.toLocaleString('fa-IR')}
                </span>
              )}
              <span className="hidden sm:inline">سبد خرید</span>
            </Link>

            {/* پروفایل — لاگین → داشبورد / مهمان → ورود */}
            <Link
              to={isAuthenticated ? "/dashboard" : "/login"}
              className="flex items-center gap-2 p-2.5 sm:px-5 text-sm rounded-xl bg-primary dark:bg-dark-primary text-white hover:opacity-90 transition font-DanaMedium shadow-sm"
            >
              <User size={20} />
              <span className="hidden sm:inline">{isAuthenticated ? 'پروفایل' : 'ورود / ثبت‌نام'}</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
})