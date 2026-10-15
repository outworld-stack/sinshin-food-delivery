// ═══════════════════════════════════════════════════════════════
// stage-67 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/hooks/dashboard/useNotificationInboxPage.ts
// کامیت پیشنهادی: stage sixty-seven
// ═══════════════════════════════════════════════════════════════

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
import { markNotificationsRead } from '#/server/user'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { myNotificationsOptions } from '#/utils/queryOptions'

// SSE — همان الگوی پنل ادمین۲ (round-16/H5): استریم با fetch + هدر
// Authorization (EventSource هدر نمی‌گیرد). خطا → ریفچ فوری (invalidation
// کلی) + تلاش مجدد ۶۰s؛ توکنِ هیدریشن‌نشده → ۵s صبر و دوباره.
const SSE_RETRY_MS = 60_000
const SSE_TOKEN_WAIT_MS = 5_000

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

	const { data, isLoading, isError, refetch } = useQuery({
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

		let abort: AbortController | null = null
		let retryTimer: ReturnType<typeof setTimeout> | null = null
		let debounceTimer: ReturnType<typeof setTimeout> | null = null
		let disposed = false

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

		const connect = async (): Promise<void> => {
			if (disposed) return
			const token = getAccessToken()
			if (!token) {
				// توکن هنوز هیدره نشده — چند بار با فاصله‌ی کوتاه دوباره بخواه
				if (!retryTimer) {
					retryTimer = setTimeout(() => {
						retryTimer = null
						void connect()
					}, SSE_TOKEN_WAIT_MS)
				}
				return
			}
			abort = new AbortController()
			try {
				const res = await fetch(
					`${apiBase()}/realtime/stream?channel=notify:${userId}`,
					{
						headers: { authorization: `Bearer ${token}` },
						cache: 'no-store',
						signal: abort.signal,
					},
				)
				if (!res.ok || !res.body) throw new Error(`SSE failed (${res.status})`)
				const reader = res.body.getReader()
				const decoder = new TextDecoder()
				let buffer = ''
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					buffer += decoder.decode(value, { stream: true })
					const frames = buffer.split('\n\n')
					buffer = frames.pop() ?? ''
					for (const f of frames) parseFrame(f)
				}
				throw new Error('SSE stream closed')
			} catch {
				abort?.abort()
				abort = null
				if (!disposed && !retryTimer) {
					retryTimer = setTimeout(() => {
						retryTimer = null
						void connect()
					}, SSE_RETRY_MS)
				}
			}
		}
		void connect()

		return () => {
			disposed = true
			if (debounceTimer) clearTimeout(debounceTimer)
			if (retryTimer) clearTimeout(retryTimer)
			abort?.abort()
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

	return {
		items: data?.items ?? [],
		unread: data?.unread ?? 0,
		isLoading,
		isError,
		refetch,
		markRead,
		markAllRead,
		pushPhase,
		handleEnablePush,
	}
}