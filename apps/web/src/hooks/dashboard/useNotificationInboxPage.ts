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
import { getAccessToken } from '#/lib/auth-session'
import {
	enablePush,
	getPushState,
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
			return state.subscribed ? 'on' : 'default'
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
	const { t } = useI18n()

	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		...myNotificationsOptions,
		enabled: Boolean(userId),
	})

	const invalidate = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.myNotifications })
	}, [queryClient])

	const markRead = useMutation({
		mutationFn: (id: string) => markNotificationsRead({ id }),
		onSuccess: invalidate,
	})

	const markAllRead = useMutation({
		mutationFn: () => markNotificationsRead({ all: true }),
		onSuccess: invalidate,
	})

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
			reconnectOnWake: true,
		})

		return () => {
			sse.stop()
			if (debounceTimer) clearTimeout(debounceTimer)
		}
	}, [userId, invalidate])

	// ── کارت فعال‌سازی پوش ──
	const [pushPhase, setPushPhase] = useState<InboxPushPhase>('loading')

	useEffect(() => {
		let cancelled = false
		void getPushState()
			.then((s) => {
				if (!cancelled && s) setPushPhase(phaseOf(s))
			})
			.catch(() => {
				if (!cancelled) setPushPhase('default')
			})
		return () => {
			cancelled = true
		}
	}, [])

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
		const s = await getPushState().catch(() => null)
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
		markRead,
		markAllRead,
		pushPhase,
		handleEnablePush,
		handleRecheck,
	}
}
