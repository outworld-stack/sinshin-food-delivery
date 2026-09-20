// src/components/MainLayout.tsx
import { Outlet, Link, useRouterState } from '@tanstack/react-router'
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Header } from '#/components/Header'
import { ScrollToTop } from '#/components/ScrollToTop'
import { Footer } from '#/components/Footer'
import { activeMainCategoriesOptions } from '#/utils/queryOptions'

// تب فعال از URL — امن برای همه صفحات
function useActiveMainTab(): string | null {
  return useRouterState({
    select: (s) => {
      const isProductsPage = s.location.pathname === '/products'
      if (!isProductsPage) return null
      const tab = (s.location.search as Record<string, unknown>).tab
      return typeof tab === 'string' ? tab : null
    },
  })
}

export const MainLayout = memo(function MainLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeTab = useActiveMainTab()

  // Main فعال‌ها — فکتوری مرکزی؛ کوئری مشترک با هدر و هوک products
  const { data: activeMains } = useQuery(activeMainCategoriesOptions)

  const mains = activeMains ?? []

  // قانون: تک main → نوار مخفی | فقط صفحه products
  const showMobileNav = pathname === '/products' && mains.length > 1

  // فرد → آخری کل ردیف
  const isLastOdd = mains.length % 2 === 1

  // فعال پیش‌فرض: tab URL یا اولین (isDefault فاز بعد)
  const defaultSlug = activeTab ?? mains.find(m => m.isDefault)?.slug ?? mains[0]?.slug ?? null
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1a0a0e] transition-colors duration-500 flex flex-col">
      <Header />

      {/* نوار تب موبایل — تنها نوار (صفحه products دیگه نوار نمی‌سازه) */}
      {showMobileNav && (
        <nav className="md:hidden p-3 bg-white dark:bg-[#1a0a0e] border-b border-gray-200 dark:border-white/10">
          <div className="grid grid-cols-2 gap-2">
            {mains.map((mc, i) => (
              <Link
                key={mc.id}
                to="/products"
                search={{ tab: mc.slug }}
                className={`py-2.5 rounded-xl text-center font-DanaMedium transition cursor-pointer ${
                  isLastOdd && i === mains.length - 1 ? 'col-span-2' : ''
                } ${
                  defaultSlug === mc.slug
                    ? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300'
                }`}
              >
                {mc.name}
              </Link>
            ))}
          </div>
        </nav>
      )}

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
        <Outlet />
      </main>

      <Footer />
      <ScrollToTop />
    </div>
  )
})