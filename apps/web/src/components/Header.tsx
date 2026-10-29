// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/Header.tsx
// تغییر (بازخورد ۳ + ۵):
//   • زنگ نوتیفیکیشن (NotificationBell) از هدر حذف شد — پوشِ واقعی
//     (آیکن بنفش فعال‌سازی + Service Worker) کانال اصلی اطلاع‌رسانی است.
//   • برند سین‌شین در md..lg دیگر له/کشیده نمی‌شود: کانتینر برند
//     shrink-0 + بدون شکستن خط (whitespace-nowrap) — خودِ برند و
//     پس‌زمینه‌ی اریبش به حالت اصلی برگشت. فضا با «کم کردن گپ»
//     آزاد شد (ناوبری ۴→lg:۸، ردیف ۳ در md، آیکن‌ها ۲.۵ در md..lg)؛
//     ناوبری در فشار کمبود فضا با overflow-hidden قیچی می‌شود نه برند.
// ═══════════════════════════════════════════════════════════════
// stage-47 — فیکس z-index: هدر relative z-40 (backdrop-blur stacking)

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
// src/components/Header.tsx
import { memo } from 'react'
import { Bell, BellRing, Cart, Package, Shield, User } from 'reicon-react'
import { Brand } from '#/components/Brand'
import { LangSwitcher } from '#/components/LangSwitcher'
import { HeaderSkeleton } from '#/components/LoadingSkeletons'
import { ThemeToggle } from '#/components/ThemeToggle'
import { useActiveOrder } from '#/hooks/shared/useActiveOrder'
import { useHydrated } from '#/hooks/useHydrated'
// stage-58 — NotificationEnableIcon (دکمه‌ی بنفش فعال‌سازی پوش) حذف شد —
// پرامپت مجوز نوتیف حالا خودکار است (PushAutoPrompt در __root). Bell
// برای لینک پنل سفارشات زنده‌ی ادمین۲ مانده است.
import { useI18n } from '#/i18n'
import { useAuthStore } from '#/stores/authStore'
import { useCartStore } from '#/stores/cartStore'
import {
        activeMainCategoriesOptions,
        notificationsUnreadOptions,
        userProfileLightClientOptions,
} from '#/utils/queryOptions'

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

        // stage-100 — بج اعلان‌های خوانده‌نشده (فقط کاربر وارد‌شده): اندپوینت
        // سبک unread-count + staleTime ۳۰s + نبض ۶۰s؛ خواندن در صفحه‌ی صندوق
        // همان لحظه این کلید را invalidate می‌کند
        const { data: notifBadge } = useQuery(
                notificationsUnreadOptions(isAuthenticated ? user?.id : undefined),
        )
        const unreadCount = notifBadge?.unread ?? 0

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
                                {/* stage-49 — گپ ردیف در md..lg فشرده‌تر تا برند حالت اصلی خودش را
                                    حفظ کند (بازخورد ۵: به خودِ برند دست نزدیم) */}
                                <div className="flex h-16 sm:h-20 items-center justify-between gap-2 md:gap-3 lg:gap-4 max-[360px]:h-auto max-[360px]:flex-wrap max-[360px]:gap-y-4 max-[360px]:py-4">
                                        {/* برند — stage-49: هرگز جمع/کشیده نمی‌شود (shrink-0 + بدون
                                            شکستن خط)؛ محدودیت فضا به ناوبری و گپ‌ها منتقل شد */}
                                        <div className="flex items-center shrink-0 whitespace-nowrap">
                                                <Brand
                                                        to={isAuthenticated ? '/products' : '/'}
                                                        textSize="text-base sm:text-lg md:text-2xl"
                                                />
                                        </div>

                                        {/* ناوبری دسکتاپ — Main داینامیک؛ stage-49: گپ فشرده‌تر در
                                            md..lg + قیچیِ سرریز به‌جای خم‌کردن برند */}
                                        <nav className="hidden md:flex items-center gap-4 lg:gap-8 min-w-0 overflow-hidden">
                                                {(activeMains ?? []).map((mc) => (
                                                        <Link
                                                                key={mc.id}
                                                                to="/products"
                                                                search={{ tab: mc.slug }}
                                                                className="text-gray-600 hover:text-primary dark:text-gray-300 dark:hover:text-dark-primary transition font-DanaMedium whitespace-nowrap"
                                                        >
                                                                {mc.name}
                                                        </Link>
                                                ))}
                                        </nav>

                                        {/* On the narrowest phones, actions get their own row so
                                            admin controls and an active order cannot overflow. */}
                                        <div className="flex items-center justify-end gap-0.5 sm:gap-2.5 lg:gap-4 shrink-0 max-[360px]:basis-full max-[360px]:justify-between">
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

                                                {/* stage-58 — دکمه‌ی بنفشِ «فعال‌سازی نوتیف» اینجا بود؛ حذف شد:
                                                پرامپت مجوز برای همه (مهمان/عضو) خودکار روی باز شدن صفحه می‌آید
                                                (PushAutoPrompt) و آیکن مزاحم هدر دیگر لازم نیست. */}
                                                {/* پنل‌ها + پیگیری سفارش + پروفایل — فقط isAuthenticated */}
                                                {isAuthenticated && (
                                                        <>
                                                                {role === 'admin' && (
                                                                        <Link
                                                                                to="/admin"
                                                                                aria-label={t['header.adminPanel']}
                                                                                title={t['header.adminPanel']}
                                                                                className="p-1.5 sm:p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm"
                                                                        >
                                                                                <Shield size={20} className={ico} />
                                                                        </Link>
                                                                )}
                                                                {role === 'admin2' && (
                                                                        <Link
                                                                                to="/admin/admin2/live-orders"
                                                                                aria-label={t['header.ordersPanel']}
                                                                                title={t['header.ordersPanel']}
                                                                                className="p-1.5 sm:p-2.5 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary hover:bg-primary/20 transition font-DanaMedium shadow-sm"
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
                                                                                className="relative flex items-center justify-center p-1.5 sm:p-2.5 text-sm rounded-lg bg-green-50 dark:bg-green-500/10 text-green-500 hover:bg-green-100 dark:hover:bg-green-500/20 transition font-DanaMedium shadow-sm border border-green-200 dark:border-green-500/20"
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

                                                {/* ⬇️ stage-100 — صندوق اعلان‌ها (فقط کاربر وارد‌شده): دکمه‌ی
                                                    کوچک با بجِ تعداد خوانده‌نشده → صفحه‌ی صندوق در پروفایل.
                                                    موبایل جمع‌وجورتر (p-1.5) تا عرضِ ردیف در ۳۶۰px سالم بماند.
                                                    آیکن BellRing تا با زنگِ «پنل سفارشات» ادمین۲ اشتباه نشود. */}
                                                {isAuthenticated && (
                                                        <Link
                                                                to="/dashboard/notifications"
                                                                aria-label={t['header.notifications']}
                                                                title={t['header.notifications']}
                                                                className="relative flex items-center justify-center p-1 sm:p-2.5 rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 text-primary dark:text-dark-primary"
                                                        >
                                                                <BellRing size={22} className={ico} />
                                                                {unreadCount > 0 && (
                                                                        <span className="absolute -top-1 -left-1 sm:-top-1.5 sm:-left-1.5 min-w-4 h-4 sm:h-5 px-1 flex items-center justify-center rounded-full bg-primary dark:bg-dark-primary text-white text-[10px] sm:text-xs font-DanaDemiBold shadow-md">
                                                                                {fmt.num(unreadCount)}
                                                                        </span>
                                                                )}
                                                        </Link>
                                                )}

                                                {/* ⬇️ سبد — همیشه، بدون هیچ شرطی (stage-100: پدینگ موبایل جمع‌تر) */}
                                                <Link
                                                        to="/cart"
                                                        aria-label={t['header.cart']}
                                                        className="relative flex items-center gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-2.5 lg:px-5 sm:py-2.5 text-sm rounded-lg bg-gray-100 dark:bg-[#2a1015] text-primary dark:text-dark-primary hover:bg-gray-200 dark:hover:bg-[#3a151c] transition font-DanaMedium shadow-sm border border-gray-200 dark:border-white/10"
                                                >
                                                        <Cart size={22} className="h-4.5 w-4.5 sm:h-5.5 sm:w-5.5" />
                                                        {totalItems > 0 && (
                                                                <span className="absolute -top-1.5 -left-1.5 sm:-top-2 sm:-left-2 bg-primary dark:bg-dark-primary text-white text-[10px] sm:text-xs w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full font-DanaDemiBold shadow-md">
                                                                        {fmt.num(totalItems)}
                                                                </span>
                                                        )}
                                                        {/* stage-48 — md..lg: فقط آیکون (مثل موبایل)؛ متن از lg به بالا */}
                                                        <span className="hidden lg:inline">{t['header.cart']}</span>
                                                </Link>

                                                {/* پروفایل — لاگین → داشبورد / مهمان → ورود (stage-100: پدینگ موبایل جمع‌تر) */}
                                                <Link
                                                        to={isAuthenticated ? '/dashboard' : '/login'}
                                                        aria-label={
                                                                isAuthenticated ? t['header.profile'] : t['header.auth']
                                                        }
                                                        className="flex items-center gap-2 p-1.5 sm:px-2.5 lg:px-5 sm:py-2.5 text-sm rounded-xl bg-primary dark:bg-dark-primary text-white hover:opacity-90 transition font-DanaMedium shadow-sm"
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
