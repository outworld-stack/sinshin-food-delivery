// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/Header.tsx
// تغییر: فیکس z-index — پنل کشویی زنگ نوتیفیکیشن زیر محتوای
//        صفحه (کارت‌های محصول و…) می‌افتاد؛ هدر الان relative z-40 است.
// ═══════════════════════════════════════════════════════════════

// src/components/Header.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Brand } from '#/components/Brand'
import { ThemeToggle } from '#/components/ThemeToggle'
import { LangSwitcher } from '#/components/LangSwitcher'
import { useCartStore } from '#/stores/cartStore'
import { useAuthStore } from '#/stores/authStore'
import {
        activeMainCategoriesOptions,
        userProfileLightClientOptions,
} from '#/utils/queryOptions'
import { Cart, User, Package, Shield, Bell } from 'reicon-react'
import { useHydrated } from '#/hooks/useHydrated'
import { HeaderSkeleton } from '#/components/LoadingSkeletons'
import { useActiveOrder } from '#/hooks/shared/useActiveOrder'
import { NotificationBell } from '#/components/shared/NotificationBell'
import { NotificationEnableIcon } from '#/components/shared/NotificationEnableIcon'
import { useI18n } from '#/i18n'

// round-14 — موبایل فیکس (گوشی‌های سامسونگ):
//  • آیکون‌ها/پدینگ‌ها/گپ‌ها در سایز کوچک جمع‌وجورتر (آیکون 18px، p-2)
//  • ردیف هدر هرگز نمی‌شکند: brand با min-w-0 + shrink جمع می‌شود،
//    آیکون‌ها shrink-0 می‌مانند — با وجود هر ۵ آیکون (تم + پنل ادمین +
//    سفارش فعال سبز + سبد + پروفایل) در عرض 360px هم به‌هم‌ریختگی نیست
//  • ارتفاع موبایل 64px (قبلاً 80px) — فضای تنفسی برای ردیف فشرده
// رارد ۳۲ — دوزبانه: متن‌ها/aria از دیکشنری + سوییچر زبان (جفت در دسکتاپ،
//   تک‌دکمه در موبایل — تصمیم ۳) کنار آیکون تم.
export const Header = memo(function Header() {
        const hydrated = useHydrated()
        const totalItems = useCartStore((state) => state.getTotalItems())
        const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
        const role = useAuthStore((state) => state.role)
        const activeOrderId = useAuthStore((state) => state.activeOrderId)
        const { t, fmt } = useI18n()

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

        // سایز آیکون: موبایل 18px / دسکتاپ 20-22px — CSS روی اتریبیوت size غلبه می‌کند
        const ico = 'h-[18px] w-[18px] sm:h-5 sm:w-5'

        // stage-47 — z-index فیکس: backdrop-blur-md یک stacking context می‌سازد؛
        // بدون position/z-index کل هدر (و پنل نوتیفیکیشنِ z-50 داخلش) در لایه‌ی
        // in-flow می‌افتاد و زیر کارت‌های positioned (محصولات/مقالات/گالری)
        // می‌رفت. الان هدر z-40 است: بالای همه‌ی محتوای صفحه، زیر مودال‌ها (z-100)
        // و توست (z-200) — پنل زنگ هم داخل همین لایه روی همه‌چیز دیده می‌شود.
        return (
                <header className="relative z-40 w-full bg-white/80 dark:bg-[#1a0a0e]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/10 transition-colors duration-500">
                        <div className="container mx-auto px-3 sm:px-6 lg:px-8">
                                <div className="flex h-16 sm:h-20 items-center justify-between gap-2 sm:gap-4">
                                        {/* برند — کاربر لاگین → محصولات */}
                                        <div className="flex items-center justify-center min-w-0 shrink">
                                                <Brand
                                                        to={isAuthenticated ? '/products' : '/'}
                                                        textSize="text-base sm:text-lg md:text-2xl"
                                                />
                                        </div>

                                        {/* ناوبری دسکتاپ — Main داینامیک */}
                                        <nav className="hidden md:flex items-center gap-8">
                                                {(activeMains ?? []).map((mc) => (
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

                                        <div className="flex items-center justify-end gap-1.5 sm:gap-3 md:gap-4 shrink-0">
                                                <ThemeToggle />

                                                {/* رارد ۳۲ — سوییچر زبان: جفت «فا/ع» در دسکتاپ، تک‌دکمه در موبایل (تصمیم ۳)
                                                stage-48 — md..lg به‌هم‌ریخته بود: در این بازه هم فقط دکمه‌ی زبان مقابل
                                                (تک‌دکمه) نشان داده می‌شود — جفت‌باکس‌ها فقط از lg به بالا. */}
                                                <div className="hidden lg:flex">
                                                        <LangSwitcher />
                                                </div>
                                                <div className="lg:hidden">
                                                        <LangSwitcher variant="single" />
                                                </div>

                                                {/* stage-48 — آیکون چشمک‌زن «فعال‌سازی نوتیف» (بنفش):
                                                فقط وقتی پوش خاموش است؛ بعد از فعال‌شدن حذف می‌شود. */}
                                                {isAuthenticated && <NotificationEnableIcon />}

                                                {/* فاز-۲ — زنگ نوتیفیکیشن (فقط isAuthenticated) */}
                                                {isAuthenticated && (
                                                        <NotificationBell userId={user?.id} />
                                                )}

                                                {/* پنل‌ها + پیگیری سفارش + پروفایل — فقط isAuthenticated */}
                                                {isAuthenticated && (
                                                        <>
                                                                {role === 'admin' && (
                                                                        <Link
                                                                                to="/admin"
                                                                                aria-label={t['header.adminPanel']}
                                                                                title={t['header.adminPanel']}
                                                                                className="p-2 sm:p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm"
                                                                        >
                                                                                <Shield size={20} className={ico} />
                                                                        </Link>
                                                                )}
                                                                {role === 'admin2' && (
                                                                        <Link
                                                                                to="/admin/admin2/live-orders"
                                                                                aria-label={t['header.ordersPanel']}
                                                                                title={t['header.ordersPanel']}
                                                                                className="p-2 sm:p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm"
                                                                        >
                                                                                <Bell size={20} className={ico} />
                                                                        </Link>
                                                                )}

                                                                {activeOrderId && (
                                                                        <Link
                                                                                to="/dashboard/orders/$orderId"
                                                                                params={{ orderId: activeOrderId }}
                                                                                aria-label={t['header.trackOrder']}
                                                                                title={t['header.trackOrder']}
                                                                                className="relative flex items-center justify-center p-2 sm:p-2.5 text-sm rounded-lg bg-green-50 dark:bg-green-500/10 text-green-500 hover:bg-green-100 dark:hover:bg-green-500/20 transition font-DanaMedium shadow-sm border border-green-200 dark:border-green-500/20"
                                                                        >
                                                                                <Package
                                                                                        size={22}
                                                                                        className="h-4.5 w-4.5 sm:h-5.5 sm:w-5.5"
                                                                                />
                                                                                <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5 sm:h-3 sm:w-3">
                                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-3 sm:w-3 bg-green-500"></span>
                                                                                </span>
                                                                        </Link>
                                                                )}
                                                        </>
                                                )}

                                                {/* ⬇️ سبد — همیشه، بدون هیچ شرطی */}
                                                <Link
                                                        to="/cart"
                                                        aria-label={t['header.cart']}
                                                        className="relative flex items-center gap-1.5 sm:gap-2 px-2.5 py-2 sm:px-5 sm:py-2.5 text-sm rounded-lg bg-gray-100 dark:bg-[#2a1015] text-primary dark:text-dark-primary hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaMedium shadow-sm border border-gray-200 dark:border-white/10"
                                                >
                                                        <Cart
                                                                size={22}
                                                                className="h-4.5 w-4.5 sm:h-5.5 sm:w-5.5"
                                                        />
                                                        {totalItems > 0 && (
                                                                <span className="absolute -top-1.5 -left-1.5 sm:-top-2 sm:-left-2 bg-primary dark:bg-dark-primary text-white text-[10px] sm:text-xs w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full font-DanaDemiBold shadow-md">
                                                                        {fmt.num(totalItems)}
                                                                </span>
                                                        )}
                                                        {/* stage-48 — md..lg: فقط آیکون (مثل موبایل)؛ متن از lg به بالا */}
                                                        <span className="hidden lg:inline">{t['header.cart']}</span>
                                                </Link>

                                                {/* پروفایل — لاگین → داشبورد / مهمان → ورود */}
                                                <Link
                                                        to={isAuthenticated ? '/dashboard' : '/login'}
                                                        aria-label={isAuthenticated ? t['header.profile'] : t['header.auth']}
                                                        className="flex items-center gap-2 p-2 sm:px-5 sm:py-2.5 text-sm rounded-xl bg-primary dark:bg-dark-primary text-white hover:opacity-90 transition font-DanaMedium shadow-sm"
                                                >
                                                        <User size={20} className={ico} />
                                                        <span className="hidden lg:inline">
                                                                {isAuthenticated ? t['header.profile'] : t['header.auth']}
                                                        </span>
                                                </Link>
                                        </div>
                                </div>
                        </div>
                </header>
        )
})