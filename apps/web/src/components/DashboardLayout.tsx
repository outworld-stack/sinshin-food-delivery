// src/components/DashboardLayout.tsx
import { Outlet, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brand } from '#/components/Brand'
import { ThemeToggle } from '#/components/ThemeToggle'
import { useAuthStore } from '#/stores/authStore'
import { userProfileClientOptions } from '#/utils/queryOptions'
import type { NavItem } from '#/types/shared/navigation'
import { useHydrated } from '#/hooks/useHydrated'
import { useRealLogout } from '#/hooks/shared/useRealLogout'
import { DashboardLayoutSkeleton } from '#/components/LoadingSkeletons'
import { User, Cart, Wallet, Pin, Discover2, Logout4, Menu, Package, X } from 'reicon-react'
import { useActiveOrder } from '#/hooks/shared/useActiveOrder'

export function DashboardLayout() {
  const hydrated = useHydrated()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const navigate = useNavigate()
  const activeOrderId = useAuthStore((state) => state.activeOrderId)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  const { data: user } = useQuery({
    ...userProfileClientOptions,
    enabled: isAuthenticated,
  })

  // phase-fix: لاگ‌اوت واقعی — سشن سرور revoke می‌شود، توکن و کش پاک (مرگ لاگ‌اوت دکوری)
  const handleLogout = useRealLogout('/')

  // phase-fix: سشن وسط باز کردن منقضی شد (۴۰۱) → استور پاک می‌شود ولی
  // کاربر روی صفحه‌ی خطا گیر نمی‌کند — به لاگین برگرد
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [hydrated, isAuthenticated, navigate])


  // ردیابی خودکار سفارش فعال
  useActiveOrder(user?.allOrders)

  const menuItems: NavItem[] = [
    { to: '/dashboard', label: 'پروفایل من', icon: <User size={20} />, exact: true },
    { to: '/dashboard/orders', label: 'سفارشات من', icon: <Cart size={20} /> },
    { to: '/dashboard/wallet', label: 'کیف پول', icon: <Wallet size={20} /> },
    { to: '/dashboard/addresses', label: 'آدرس‌های من', icon: <Pin size={20} /> },
    { to: '/dashboard/info', label: 'اطلاعات کاربری', icon: <Discover2 size={20} /> },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1a0a0e] flex flex-col md:flex-row">

      {hydrated ? (
        <>
          {/* سایدبار دسکتاپ */}
          <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-[#2a1015] border-l border-gray-200 dark:border-[#3a151c] p-6 fixed right-0 top-0 bottom-0 z-30">
            <div className="flex items-center justify-between mb-6">
              <Brand to="/products" textSize="text-lg sm:text-2xl" />
              <ThemeToggle />
            </div>

            <div className="border-t border-gray-200 dark:border-white/10 mx-2 mb-6"></div>

            <nav className="flex flex-col gap-2 flex-1">
              {menuItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  activeProps={{ className: 'bg-primary dark:bg-dark-primary text-white shadow-sm' }}
                  inactiveProps={{ className: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a0a0e]' }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-DanaMedium"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>

            <button
              onClick={handleLogout}
              className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-DanaMedium cursor-pointer"
            >
              <Logout4 size={20} />
              خروج از حساب
            </button>
          </aside>

          {/* هدر موبایل */}
          <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-[#2a1015] border-b border-gray-200 dark:border-[#3a151c] sticky top-0 z-30">
            <Brand to="/products" textSize="text-lg" />
            <div className="flex items-center gap-4">
              {activeOrderId && (
                <Link
                  to="/dashboard/orders/$orderId"
                  params={{ orderId: activeOrderId }}
                  className="relative flex items-center justify-center p-2 text-sm rounded-lg bg-green-50 dark:bg-green-500/10 text-green-500 hover:bg-green-100 dark:hover:bg-green-500/20 transition shadow-sm border border-green-200 dark:border-green-500/20"
                  title="پیگیری سفارش"
                >
                  <Package size={20} />
                  <span className="absolute -top-1 -left-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                </Link>
              )}
              <ThemeToggle />
              <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-gray-600 dark:text-gray-300 cursor-pointer">
                <Menu size={24} />
              </button>
            </div>
          </header>

          {/* منوی کشویی موبایل */}
          <div className={`md:hidden fixed inset-0 z-50 ${isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
              className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <div
              className={`absolute top-0 right-0 bottom-0 w-64 bg-white dark:bg-[#1a0a0e] p-6 flex flex-col shadow-xl transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
              <div className="flex items-center justify-between mb-6">
                <Brand to="/products" textSize="text-lg" />
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-gray-500 cursor-pointer p-1">
                  <X size={24} />
                </button>
              </div>

              <div className="border-t border-gray-200 dark:border-white/10 mx-2 mb-6"></div>

              <nav className="flex flex-col gap-2 flex-1">
                {menuItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setIsMobileMenuOpen(false)}
                    activeOptions={{ exact: item.exact }}
                    activeProps={{ className: 'bg-primary dark:bg-dark-primary text-white shadow-sm' }}
                    inactiveProps={{ className: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a1015]' }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-DanaMedium"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </nav>

              <button
                onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-DanaMedium cursor-pointer"
              >
                <Logout4 size={20} />
                خروج از حساب
              </button>
            </div>
          </div>
        </>
      ) : (
        <DashboardLayoutSkeleton />
      )}

      {/* ⬅ محتوا همیشه رندر می‌شه — اسکلتون مخصوص هر صفحه */}
      <main className="flex-1 md:mr-64 p-6 lg:p-10">
        <Outlet />
      </main>
    </div>
  )
}