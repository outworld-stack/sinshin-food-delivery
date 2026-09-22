// src/components/AdminLayout.tsx
import { Outlet, Link } from '@tanstack/react-router'
import { memo, useState, useMemo, useCallback, useEffect } from 'react'
import { useAuthStore } from '#/stores/authStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { Brand } from '#/components/Brand'
import { ThemeToggle } from '#/components/ThemeToggle'
import { useRealLogout } from '#/hooks/shared/useRealLogout'
import type { NavItem } from '#/types/shared/navigation'
import {
  ChartBarTrendUp, Users, Bag, Cart, File, Ticket,
  Bicycle, Star, ShieldCheck, Settings, Bell, Layout,
  Logout4, Menu, X,
} from 'reicon-react'
import { useHydrated } from '#/hooks/useHydrated'
import { AdminLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useQuery } from '@tanstack/react-query'
import { admin2SessionOptions } from '#/utils/queryOptions'

// --- آیتم‌های مشترک ---
const LIVE_PANEL_ITEM: NavItem = {
  to: '/admin/admin2/live-orders', label: 'سفارشات زنده', icon: <Bell size={20} />, exact: true,
}

const ORDERS_ITEM: NavItem = {
  to: '/admin/orders', label: 'سفارشات', icon: <Cart size={20} />,
}

const COURIERS_ITEM: NavItem = {
  to: '/admin/couriers', label: 'پیک‌ها', icon: <Bicycle size={20} />,
}

function buildAdminItems(): NavItem[] {
  return [
    { to: '/admin', label: 'داشبورد', icon: <ChartBarTrendUp size={20} />, exact: true },
    // round-13 — ادمین اصلی هم پنل زنده را می‌بیند: تایید سفارش، تخصیص/تغییر پیک
    LIVE_PANEL_ITEM,
    ORDERS_ITEM,
    { to: '/admin/users', label: 'کاربران', icon: <Users size={20} /> },
    { to: '/admin/products', label: 'محصولات', icon: <Bag size={20} /> },
    COURIERS_ITEM,
    { to: '/admin/articles', label: 'مقالات', icon: <File size={20} /> },
    { to: '/admin/coupons', label: 'کوپن‌ها', icon: <Ticket size={20} /> },
    { to: '/admin/reviews', label: 'نظرات', icon: <Star size={20} /> },
    { to: '/admin/admins', label: 'ادمین‌ها', icon: <ShieldCheck size={20} /> },
    { to: '/admin/settings', label: 'تنظیمات', icon: <Settings size={20} /> },
  ]
}

function buildAdmin2Items(permissions: { productsRead: boolean; usersRead: boolean }): NavItem[] {
  const items: NavItem[] = [
    { to: '/admin/admin2/dashboard/', label: 'داشبورد من', icon: <Layout size={20} />, exact: true },
    LIVE_PANEL_ITEM,
    ORDERS_ITEM,
    COURIERS_ITEM,
    { to: '/admin/settings', label: 'تنظیمات', icon: <Settings size={20} /> },   // ⬅ ناحیه‌های ارسال
  ]
  if (permissions.productsRead) {
    items.push({ to: '/admin/products', label: 'محصولات', icon: <Bag size={20} /> })
  }
  if (permissions.usersRead) {
    items.push({ to: '/admin/users', label: 'کاربران', icon: <Users size={20} /> })
  }
  return items
}

const SidebarNav = memo(function SidebarNav({ items, onNavigate }: {
  items: NavItem[]
  onNavigate?: () => void
}) {
  return (
    <nav className="flex flex-col gap-2 flex-1">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
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
  )
})

export const AdminLayout = memo(function AdminLayout() {
  const hydrated = useHydrated()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const role = useAuthStore((s) => s.role)
  const logout = useAuthStore((s) => s.logout)

  const { permissions, isAdmin2 } = usePermissions()

  // سینک سشن ادمین۲ — سشن سرور مرده => استور کلاینت هم پاک شه (گارد روت ریدایرکت می‌کنه)
  // فکتوری مشترک با usePermissions؛ فقط polling اینجا اضافه می‌شه
  const { data: admin2Session } = useQuery({
    ...admin2SessionOptions,
    enabled: role === 'admin2',
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (role === 'admin2' && admin2Session && !admin2Session.isAdmin2LoggedIn) {
      logout()
    }
  }, [role, admin2Session, logout])

  const menuItems = useMemo(() => {
    if (isAdmin2) return buildAdmin2Items(permissions)
    return buildAdminItems()
  }, [isAdmin2, permissions])

  const handleLogout = useRealLogout('/')

  const handleOpenMobileMenu = useCallback(() => setIsMobileMenuOpen(true), [])
  const handleCloseMobileMenu = useCallback(() => setIsMobileMenuOpen(false), [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1a0a0e]">

      {/* کروم: تا هیدریشن اسکلتون — بعد واقعی */}
      {hydrated ? (
        <>
          {/* سایدبار دسکتاپ */}
          <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-[#2a1015] border-l border-gray-200 dark:border-[#3a151c] p-6 fixed right-0 top-0 bottom-0 z-30">
            <div className="flex items-center justify-between mb-6">
              <Brand textSize="text-lg sm:text-2xl" />
              <ThemeToggle />
            </div>
            <div className="border-t border-gray-200 dark:border-white/10 mx-2 mb-6"></div>
            <SidebarNav items={menuItems} />
            <button
              onClick={handleLogout}
              className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-DanaMedium cursor-pointer"
            >
              <Logout4 size={20} />
              خروج از پنل
            </button>
          </aside>

          {/* هدر موبایل */}
          <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-[#2a1015] border-b border-gray-200 dark:border-[#3a151c] sticky top-0 z-30">
            <Brand textSize="text-lg" />
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <button onClick={handleOpenMobileMenu} className="p-2 text-gray-600 dark:text-gray-300 cursor-pointer">
                <Menu size={24} />
              </button>
            </div>
          </header>

          {/* منوی کشویی موبایل */}
          <div className={`md:hidden fixed inset-0 z-50 ${isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
              className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
              onClick={handleCloseMobileMenu}
            />
            <div
              className={`absolute top-0 right-0 bottom-0 w-64 bg-white dark:bg-[#1a0a0e] p-6 flex flex-col shadow-xl transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
              <div className="flex items-center justify-between mb-6">
                <Brand textSize="text-lg" />
                <button onClick={handleCloseMobileMenu} className="text-gray-500 cursor-pointer p-1">
                  <X size={24} />
                </button>
              </div>
              <div className="border-t border-gray-200 dark:border-white/10 mx-2 mb-6"></div>
              <SidebarNav items={menuItems} onNavigate={handleCloseMobileMenu} />
              <button
                onClick={() => { handleLogout(); handleCloseMobileMenu(); }}
                className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors font-DanaMedium cursor-pointer"
              >
                <Logout4 size={20} />
                خروج از پنل
              </button>
            </div>
          </div>
        </>
      ) : (
        <AdminLayoutSkeleton />
      )}

      {/* ⬅ محتوا همیشه رندر می‌شه — هر صفحه اسکلتون مخصوص خودش رو دارد */}
      <main className="md:mr-64 p-6 lg:p-10 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
})