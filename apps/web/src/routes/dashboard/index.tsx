// src/routes/dashboard/index.tsx
// ⬅ NEW: پیش‌واکشی در loader + pendingComponent/errorComponent + head
// (اسکلتونِ درون‌خطی قبلی استخراج شد تا pendingComponent هم همان را نشان دهد)
//
// رارد ۳۳ — دوزبانه: همه‌ی رشته‌ها از دیکشنری (t) و همه‌ی اعداد/تاریخ‌ها از
// فرمترهای چندزبانه (fmt) — فارسی همان خروجی قبلی، عربی قرینه‌ی ar-EG.

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { Skeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import type { UserOrder } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { tpl, useI18n } from '#/i18n'
import { formatReferralId } from '#/utils/format'
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
        const { t, fmt } = useI18n()

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
                        ? t['dash.delivery.pickup']
                        : o.deliveryType === 'DINE_IN'
                                ? t['dash.delivery.dineIn']
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
                                        {t['dash.home.printReferralText']}
                                </p>
                        </div>

                        <div>
                                <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
                                        {t['dash.nav.profile']}
                                </h1>
                                <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
                                        {tpl(t['dash.home.welcome'], { n: displayName })}
                                </p>
                        </div>

                        {/* باکس‌های آماری */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
                                        <div>
                                                <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">
                                                        {t['dash.home.walletBalance']}
                                                </p>
                                                <p className="font-MorabbaBold text-2xl text-primary dark:text-dark-primary">
                                                        {fmt.price(user.walletBalance)}{' '}
                                                        <span className="text-sm font-DanaMedium">{t['common.toman']}</span>
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
                                                        {t['dash.home.phone']}
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
                                        {t['dash.home.recentOrders']}
                                </h2>

                                {user.recentOrders.length > 0 ? (
                                        <div className="space-y-3">
                                                <div className="hidden md:grid grid-cols-4 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
                                                        <div className="text-right">{t['dash.col.order']}</div>
                                                        <div className="text-center">{t['dash.col.address']}</div>
                                                        <div className="text-center">{t['dash.col.courier']}</div>
                                                        <div className="text-left">{t['dash.col.amount']}</div>
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
                                                                                        {t['dash.col.order']}
                                                                                </p>
                                                                                <Link
                                                                                        to="/dashboard/orders/$orderId"
                                                                                        params={{ orderId: order.id }}
                                                                                        className="font-DanaDemiBold text-gray-800 dark:text-white text-sm hover:text-primary dark:hover:text-dark-primary transition-colors cursor-pointer"
                                                                                >
                                                                                        {order.id}
                                                                                </Link>
                                                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                                                                        {fmt.date(order.date)} • {tpl(t['dash.itemCount'], { n: fmt.num(order.itemCount) })}
                                                                                </p>
                                                                        </div>
                                                                        <div>
                                                                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                                                                                        {t['dash.col.amount']}
                                                                                </p>
                                                                                <p className="font-DanaDemiBold text-gray-900 dark:text-white text-sm mt-1">
                                                                                        {fmt.price(order.totalAmount)} {t['common.toman']}
                                                                                </p>
                                                                        </div>

                                                                        {order.deliveryType === 'DELIVERY' ? (
                                                                                <>
                                                                                        <div>
                                                                                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                                                                                                        {t['dash.col.address']}
                                                                                                </p>
                                                                                                <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
                                                                                                        {order.address}
                                                                                                </p>
                                                                                        </div>
                                                                                        <div>
                                                                                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                                                                                                        {t['dash.col.courier']}
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
                                                                                        {tpl(t['dash.orderNumber'], { n: order.id })}
                                                                                </Link>
                                                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                                                                        {fmt.date(order.date)} • {tpl(t['dash.itemCount'], { n: fmt.num(order.itemCount) })}
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
                                                                                        {fmt.price(order.totalAmount)} {t['common.toman']}
                                                                                </p>
                                                                        </div>
                                                                </div>
                                                        </div>
                                                ))}
                                        </div>
                                ) : (
                                        <div className="text-center py-10 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
                                                <p className="text-gray-400 dark:text-gray-500 font-DanaMedium">
                                                        {t['dash.home.noOrders']}
                                                </p>
                                                <Link
                                                        to="/products"
                                                        className="inline-block mt-4 px-6 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaMedium hover:opacity-90 transition cursor-pointer"
                                                >
                                                        {t['dash.home.startShopping']}
                                                </Link>
                                        </div>
                                )}
                        </div>

                        {/* باکس دعوت دوستان — لینک محور (روش اصلی اشتراک) */}
                        <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
                                <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 text-center md:text-right">
                                        {t['dash.home.inviteFriends']}
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium leading-relaxed text-center md:text-right">
                                        {t['dash.home.inviteDesc']}
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
                                                        {t['dash.home.printQr']}
                                                </button>
                                        </div>

                                        {/* ۲. لینک معرف — روش اصلی (همون چیزی که صفحه ورود می‌خونه) */}
                                        <div className="flex flex-col justify-center p-6 bg-gray-50 dark:bg-[#1a0a0e] rounded-2xl border border-gray-100 dark:border-white/5">
                                                <h3 className="font-DanaDemiBold text-gray-700 dark:text-gray-300 text-center mb-4">
                                                        {t['dash.home.yourInviteLink']}
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
                                                                showToast(t['dash.home.linkCopied'])
                                                        }}
                                                        className="w-full px-4 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
                                                >
                                                        {t['dash.home.copyLink']}
                                                </button>
                                        </div>
                                </div>
                        </div>

                        {/* round-14 — باکس «معرف من» حذف شد: امکان معرفی معرف فقط لحظه‌ی ثبت‌نام وجود دارد؛
                            باکس زیرمجموعه‌ها سر جایش است */}

                        {/* باکس زیرمجموعه‌های من */}
                        <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
                                <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2">
                                        {t['dash.home.myReferrals']}
                                </h2>
                                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6 font-DanaMedium">
                                        {t['dash.home.referralsHint']}
                                </p>

                                {user.myReferrals.filter((r) => r.totalOrders > 0).slice(0, 3).length >
                                0 ? (
                                        <div className="space-y-3">
                                                <div className="hidden md:grid grid-cols-4 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">
                                                        <div className="text-right">{t['dash.col.id']}</div>
                                                        <div className="text-center">{t['dash.col.orders']}</div>
                                                        <div className="text-center">{t['dash.col.totalSpent']}</div>
                                                        <div className="text-left">{t['dash.col.profit']}</div>
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
                                                                                                {t['dash.col.id']}
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
                                                                                                {t['dash.col.orders']}
                                                                                        </p>
                                                                                        <p className="font-DanaDemiBold text-gray-800 dark:text-white">
                                                                                                {fmt.num(ref.totalOrders)}
                                                                                        </p>
                                                                                </div>
                                                                                <div>
                                                                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                                                                                                {t['dash.col.totalSpent']}
                                                                                        </p>
                                                                                        <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
                                                                                                {fmt.price(ref.totalSpent)}
                                                                                        </p>
                                                                                </div>
                                                                                <div>
                                                                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                                                                                                {t['dash.col.profit']}
                                                                                        </p>
                                                                                        <p className="font-DanaDemiBold text-green-500 text-sm">
                                                                                                {fmt.price(ref.myProfit)}{' '}
                                                                                                <span className="text-xs">{t['common.tomanShort']}</span>
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
                                                                                        {fmt.num(ref.totalOrders)}
                                                                                </div>
                                                                                <div className="text-center font-DanaDemiBold text-gray-800 dark:text-white text-sm">
                                                                                        {fmt.price(ref.totalSpent)}
                                                                                </div>
                                                                                <div className="text-left font-DanaDemiBold text-green-500 text-sm">
                                                                                        {fmt.price(ref.myProfit)}{' '}
                                                                                        <span className="text-xs">{t['common.tomanShort']}</span>
                                                                                </div>
                                                                        </div>
                                                                </div>
                                                        ))}
                                        </div>
                                ) : (
                                        <div className="text-center py-8 px-4 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
                                                <p className="text-gray-400 dark:text-gray-500 font-DanaMedium">
                                                        {t['dash.home.noReferralPurchases']}
                                                </p>
                                        </div>
                                )}
                        </div>
                </div>
        )
}