// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/hooks/shared/useMenuLive.ts
// ═══════════════════════════════════════════════════════════════

// src/hooks/shared/useMenuLive.ts
import { useEffect, useRef } from 'react'

import { apiBase } from '#/lib/api'

/**
 * stage-48 — استریم عمومیِ menu:live (بدون auth — مهمانِ سبد‌دار هم).
 * رویداد «menu» یعنی موجودی/حالت ارسال/وضعیتِ محصولی (یا کل دسته‌ای)
 * عوض شده؛ مصرف‌کننده (سبد/چک‌اوت) باید داده‌های سروری خودش را رفرش کند.
 *
 * پیاده‌سازی: EventSource سبک + retry با backoff ثابت ۱۵s؛ fail-soft کامل.
 * (fetch-stream لازم نیست — کانال عمومی است و هدر Authorization نمی‌خواهد.)
 */
export function useMenuLive(onMenuEvent?: (data: MenuLiveEvent) => void) {
	const handlerRef = useRef<((data: MenuLiveEvent) => void) | undefined>(
		onMenuEvent,
	)
	handlerRef.current = onMenuEvent

	useEffect(() => {
		if (typeof window === 'undefined' || typeof EventSource === 'undefined')
			return

		let source: EventSource | null = null
		let retryTimer: ReturnType<typeof setTimeout> | null = null
		let disposed = false

		const connect = () => {
			if (disposed) return
			try {
				source = new EventSource(`${apiBase()}/realtime/menu-stream`)
				source.addEventListener('menu', (e) => {
					try {
						const data = JSON.parse(
							(e as MessageEvent<string>).data,
						) as MenuLiveEvent
						handlerRef.current?.(data)
					} catch {
						/* payload خراب — رد */
					}
				})
				source.onerror = () => {
					// بستن + تلاش مجدد با فاصله (EventSource خودش هم reconnect می‌کند؛
					// این مسیر برای حالت‌های خطای دائمی مثل 403 است)
					source?.close()
					source = null
					if (!disposed && !retryTimer) {
						retryTimer = setTimeout(() => {
							retryTimer = null
							connect()
						}, 15_000)
					}
				}
			} catch {
				/* آفلاین/قابلیت نداشتن — سکوت */
			}
		}

		connect()

		return () => {
			disposed = true
			if (retryTimer) clearTimeout(retryTimer)
			source?.close()
		}
	}, [])
}

/** شکل داده‌ی رویداد menu:live (آینه‌ی publish سرور) */
export interface MenuLiveEvent {
	productId: string | null
	reason: string
	isAvailable?: boolean
	courierAllowed?: boolean
	takeawayAllowed?: boolean
	dineInAllowed?: boolean
	at?: string
}