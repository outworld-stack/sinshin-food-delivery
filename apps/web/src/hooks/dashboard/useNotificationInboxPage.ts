// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/hooks/dashboard/useNotificationInboxPage.ts
// کامیت پیشنهادی: stage sixty-seven
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// stage-68 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/hooks/dashboard/useNotificationInboxPage.ts
// ویرایش نقطه‌ای (اسکن post-s67):
//   F8 — ttlDays از سرور (قرارداد TTL؛ حذف هاردکد ۷ در InboxList)
//   F9 — SSE: رویداد «online» مرورگر ⇒ اگر در انتظار retry ۶۰s هستیم،
//        اتصال فوراً بازسازی می‌شود (قبلاً قطعیِ لحظه‌ای = تا ۶۰ ثانیه
//        کور؛ استریم زنده کاری نمی‌کند چون fetch با قطعی مرده است).
// ═══════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/hooks/dashboard/useNotificationInboxPage.ts
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '#/i18n'
import { apiBase } from '#/lib/api'
import { getAccessToken, tryRefresh } from '#/lib/auth-session'
import {
        enablePush,
        getPushState,
        reconcileSubscription,
        type PushState,
} from '#/lib/push-subscription'
import { createFetchSse } from '#/lib/sse-client'
import { markNotificationsRead } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { myNotificationsOptions } from '#/utils/queryOptions'

// SSE — stage-74: کلاینتِ مشترکِ lib/sse-client (تایم‌اوت اتصال + watchdog
// سکوت ۴۵s + retry ۶۰s + بازسازی روی online/برگشت از پس‌زمینه — F9 قبلی
// حالا مکملِ watchdog است: استریمِ بی‌صدا هم کشف می‌شود نه فقط fetchِ مرده)

/** فاز کارت فعال‌سازی پوش بالای صفحه‌ی صندوق */
export type InboxPushPhase =
        | 'loading' // وضعیت اولیه (getPushState در جریان)
        | 'on' // مجوز + اشتراک فعال
        | 'default' // می‌توان فعال کرد (دکمه‌ی CTA)
        | 'denied' // کاربر رد کرده — راهنمای بازگشت از تنظیمات
        | 'unsupported' // مرورگر/پلتفرم پوش ندارد
        | 'busy' // در حال فعال‌سازی
        | 'failed' // فعال‌سازی شکست خورد — دکمه‌ی تلاش مجدد

function phaseOf(state: PushState): InboxPushPhase {
        switch (state.state) {
                case 'denied':
                        return 'denied'
                case 'default':
                        return 'default'
                case 'unsupported':
                        return 'unsupported'
                case 'granted':
                        // مجوز هست؛ اشتراک ثبت‌شده؟ (بدون آن پوش نمی‌رسد — ولی صندوق کار می‌کند)
                        return state.subscribed ? 'on' : state.failureReason ? 'failed' : 'default'
        }
}

/**
 * stage-67 — صفحه‌ی «صندوق اعلان‌ها» (پروفایل کاربر — تصمیم کارفرما «الف»).
 *
 *  • کوئری: ۳۰ اعلانِ ۷ روز اخیر + بج خوانده‌نشده (TTL سمت سرور از
 *    createdAt هر ردیف — اینجا فقط نمایش).
 *  • markRead/markAllRead → invalidate فوری (بج همان لحظه صفر می‌شود).
 *  • SSE زنده: کانال شخصی notify:{userId} (گارد مالکیت در realtime.routes)
 *    — رویداد notification/connected ⇒ invalidate؛ کانالِ مرده از stage-49
 *    حالا مصرف‌کننده‌ی واقعی دارد.
 *  • کارت فعال‌سازی پوش: getPushState/enablePush (همان ابزارهای
 *    PushAutoPrompt — مبتنی بر کلیک، مجوز بدون ژست نمی‌خواهد).
 */
export function useNotificationInboxPage(userId: string | undefined) {
        const queryClient = useQueryClient()
        const showToast = useToastStore((s) => s.showToast)
        const { t, apiError } = useI18n()

        const { data, isLoading, isError, isFetching, refetch } = useQuery({
                ...myNotificationsOptions(userId),
                enabled: Boolean(userId),
        })

        const invalidate = useCallback(() => {
                void queryClient.invalidateQueries({ queryKey: qk.myNotifications })
                // stage-100 — بج هدر (unread-count) هم همان لحظه تازه شود؛
                // خواندن اعلان در صفحه‌ی صندوق باید بجِ هدر را فوراً صفر کند
                void queryClient.invalidateQueries({ queryKey: qk.notificationsUnread })
        }, [queryClient])

        const markRead = useMutation({
                mutationFn: (id: string) => markNotificationsRead({ id }),
                onSuccess: invalidate,
                // stage-77 (N13) — خطای «علامت‌زدن خوانده‌شده» دیگر بی‌صدا نیست:
                // ردیف خوانده‌نشده می‌ماند و کاربر نمی‌فهمید چرا. توست خطا
                // (دوزبانه — همان لایه‌ی apiError بقیه‌ی داشبورد).
                onError: (err) => {
                        showToast(apiError(err?.message, t['common.error']), 'error')
                },
        })

        const markAllRead = useMutation({
                mutationFn: () => markNotificationsRead({ all: true }),
                onSuccess: invalidate,
                onError: (err) => {
                        showToast(apiError(err?.message, t['common.error']), 'error')
                },
        })

        // stage-75 (P3-28) — callbackهای پایدار: قبلاً صفحه‌ی مصرف‌کننده
        // arrowِ درون‌خطی می‌ساخت (هویتِ تازه هر رندر) و memo(InboxRow) را
        // بی‌اثر می‌کرد — هر رندرِ والد، همه‌ی ردیف‌ها را دوباره رندر می‌کرد.
        // mutate در React-Query v5 پایدار است؛ فقط یک بار ساخته می‌شود.
        const onMarkRead = useCallback(
                (id: string) => markRead.mutate(id),
                [markRead.mutate],
        )
        const onMarkAllRead = useCallback(
                () => markAllRead.mutate(),
                [markAllRead.mutate],
        )
        const onRetry = useCallback(() => void refetch(), [refetch])

        // ── SSE زنده — فقط وقتی userId هست ──
        useEffect(() => {
                if (!userId) return
                if (typeof window === 'undefined' || typeof AbortController === 'undefined')
                        return

                let debounceTimer: ReturnType<typeof setTimeout> | null = null

                // انباشت رویدادها → فقط یک invalidate
                const requestRefetch = () => {
                        if (debounceTimer) return
                        debounceTimer = setTimeout(() => {
                                debounceTimer = null
                                invalidate()
                        }, 400)
                }

                const parseFrame = (frame: string): void => {
                        let eventName = ''
                        for (const line of frame.split('\n')) {
                                if (line.startsWith('event:')) eventName = line.slice(6).trim()
                        }
                        if (eventName === 'connected' || eventName === 'notification')
                                requestRefetch()
                }

                // stage-74 — کلاینت مشترک: تایم‌اوت اتصال (headers گیر نکند)،
                // watchdog سکوت ۴۵s (استریمِ خاموش کشف می‌شود)، retry ۶۰s،
                // بازسازی روی online/برگشت از پس‌زمینه، token-wait ۵s
                // stage-77 (N1) — 401: tryRefresh (نوسازی نشست) + اتصال فوری؛
                // قبلاً کاربرِ روی همین صفحه، بعد از انقضای توکن، استریم
                // مرده و بجِ ثابت داشت تا وقتی تب را رفرش/ترک کند.
                const sse = createFetchSse({
                        url: () => {
                                const token = getAccessToken()
                                if (!token) return null
                                return `${apiBase()}/realtime/stream?channel=notify:${userId}`
                        },
                        headers: () => {
                                const h: Record<string, string> = {}
                                const token = getAccessToken()
                                if (token) h.authorization = `Bearer ${token}`
                                return h
                        },
                        onFrame: parseFrame,
                        onUnauthorized: () => tryRefresh(),
                        reconnectOnWake: true,
                })

                // stage-77 (N2) — کانالِ عمومی notify:all: پخش‌های گروهی
                // (اطلاعیه ادمین/تخفیف محصول/کوپن عمومی) قبلاً هیچ SSE‌ای
                // نداشتند و صندوقِ باز تا focus/navigation تازه نمی‌شد.
                // این پیام فقط «شاید اعلان تازه داری» است — محتوا ندارد؛
                // مشتری خودش invalidate می‌زند (debounce بالا).
                const sseAll = createFetchSse({
                        url: () => {
                                const token = getAccessToken()
                                if (!token) return null
                                return `${apiBase()}/realtime/stream?channel=notify:all`
                        },
                        headers: () => {
                                const h: Record<string, string> = {}
                                const token = getAccessToken()
                                if (token) h.authorization = `Bearer ${token}`
                                return h
                        },
                        onFrame: parseFrame,
                        onUnauthorized: () => tryRefresh(),
                        reconnectOnWake: true,
                })

                return () => {
                        sse.stop()
                        sseAll.stop()
                        if (debounceTimer) clearTimeout(debounceTimer)
                }
        }, [userId, invalidate, showToast, t])

        // ── کارت فعال‌سازی پوش ──
        const [pushPhase, setPushPhase] = useState<InboxPushPhase>('loading')

        useEffect(() => {
                let cancelled = false
                void getPushState().then((s) => s.state === 'granted' ? reconcileSubscription() : s)
                        .then((s) => {
                                if (!cancelled && s) setPushPhase(phaseOf(s))
                        })
                        .catch(() => {
                                if (!cancelled) setPushPhase('default')
                        })
                return () => {
                        cancelled = true
                }
        }, [userId])

        const handleEnablePush = useCallback(async () => {
                setPushPhase('busy')
                const state = await enablePush().catch(() => null)
                if (state === null) {
                        setPushPhase('failed')
                        return
                }
                const next = phaseOf(state)
                setPushPhase(next)
                if (next === 'on') {
                        showToast(t['notify.enable.done'], 'success')
                        return
                }
                if (next === 'denied') return // راهنما در خود کارت
                if (state.state === 'granted' && !state.subscribed) {
                        // ثبت/اشتراک شکست خورد — پیام دقیق مرحله
                        showToast(t['notify.enable.errRegister'], 'error')
                        setPushPhase('failed')
                }
        }, [showToast, t])

        // stage-72 (P2-۱۵) — «بررسی مجدد مجوز» در حالت denied: بعد از تغییر
        // مجوز از تنظیمات مرورگر، کاربر اینجا وضعیت را تازه می‌کند
        const handleRecheck = useCallback(async () => {
                setPushPhase('loading')
                const s = await getPushState()
                        .then((state) => state.state === 'granted' ? reconcileSubscription() : state)
                        .catch(() => null)
                setPushPhase(s ? phaseOf(s) : 'denied')
        }, [])

        return {
                items: data?.items ?? [],
                unread: data?.unread ?? 0,
                // stage-68 (F8) — قرارداد TTL از سرور؛ ۷ فقط fallback پیش از
                // پاسخ اول است (سرور همین مقدار را می‌فرستد — یک منبع حقیقت)
                ttlDays: data?.ttlDays ?? 7,
                isLoading,
                isError,
                // stage-72 (P2-۱۳) — برای دکمه‌ی «تلاش مجدد» در حالت خطا
                isFetching,
                refetch,
                // stage-75 (P3-28) — پایدار برای memo(InboxRow)
                onRetry,
                markRead,
                markAllRead,
                onMarkRead,
                onMarkAllRead,
                pushPhase,
                handleEnablePush,
                handleRecheck,
        }
}
