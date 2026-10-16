// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/routes/dashboard/notifications/index.tsx
// کامیت پیشنهادی: stage sixty-seven
// ═══════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query'
// src/routes/dashboard/notifications/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { memo } from 'react'
import { InboxList } from '#/components/dashboard/notifications/InboxList'
import { InboxPushCard } from '#/components/dashboard/notifications/InboxPushCard'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { useNotificationInboxPage } from '#/hooks/dashboard/useNotificationInboxPage'
import { tpl, useI18n } from '#/i18n'
import {
        myNotificationsOptions,
        userProfileLightClientOptions,
} from '#/utils/queryOptions'

/*
 * stage-68 (F8) — ttlDays از پاسخ سرور به InboxList پاس می‌شود (بج
 * «N روز مانده» با قرارداد TTL می‌سازد — هاردکد حذف شد).
 */

/**
 * stage-67 — «صندوق اعلان‌ها» در پروفایل کاربر (تصمیم کارفرما «الف»):
 *  • کارت معرفی + فعال‌سازی نوتیفیکیشن (متن دقیق خواسته‌شده + توضیح TTL)
 *  • لیست اعلان‌های ۷ روز اخیر + بج خوانده‌نشده + خوانده‌شده (تک/همه)
 *  • زنده: SSE کانال شخصی notify:{userId} (invalidating در هوک)
 *  • هر اعلان ۷ روز پس از «ایجاد» خودکار حذف می‌شود (تایمر سروری)
 */
const NotificationInboxPage = memo(function NotificationInboxPage() {
        const { t, fmt } = useI18n()
        // userId از پروفایل سبک (لایوت داشبورد همین را کش کرده — بدون رفت‌وبرگشت)
        const { data: user } = useQuery(userProfileLightClientOptions)

        const page = useNotificationInboxPage(user?.id)

        return (
                <div className="w-full max-w-3xl space-y-6 sm:space-y-8">
                        <div>
                                <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
                                        {t['dash.nav.notifications']}
                                </h1>
                                <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium text-sm">
                                        {tpl(t['notify.inbox.subtitle'], { n: fmt.num(page.ttlDays) })}
                                </p>
                        </div>

                        <InboxPushCard
                                phase={page.pushPhase}
                                onEnable={page.handleEnablePush}
                                onRecheck={() => void page.handleRecheck()}
                                ttlDays={page.ttlDays}
                        />

                        <InboxList
                                items={page.items}
                                unread={page.unread}
                                ttlDays={page.ttlDays}
                                isLoading={page.isLoading}
                                isError={page.isError}
                                isRefetching={page.isFetching}
                                onRetry={() => void page.refetch()}
                                isMarkingAll={page.markAllRead.isPending}
                                onMarkRead={(id) => page.markRead.mutate(id)}
                                onMarkAllRead={() => page.markAllRead.mutate()}
                        />
                </div>
        )
})

export const Route = createFileRoute('/dashboard/notifications/')({
        ssr: false,
        component: NotificationInboxPage,

        // پری‌فچ — هاور روی «صندوق اعلان‌ها» در سایدبار ⇒ لیست در کش؛ ناوبری
        // بدون اسکلتون. گارد والد (لاگین/نشست واقعی) قبل از این loader اجرا شده.
        loader: async ({ context }) => {
                await context.queryClient.query(myNotificationsOptions)
        },

        errorComponent: RouteError,
        head: () => ({
                meta: [
                        { title: 'صندوق اعلان‌ها | سین شین' },
                        { name: 'robots', content: 'noindex, nofollow' },
                ],
        }),
})