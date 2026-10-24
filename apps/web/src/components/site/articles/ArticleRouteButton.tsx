// src/components/site/articles/ArticleRouteButton.tsx
// stage-98 — «مسیریابی از موقعیت من» با GPS واقعی + فالبکِ تأییدشده.
//
// چرا دکمه شد (قبلاً لینکِ ساده بود)؟ لینکِ فقط-مقصد پنلِ مسیریابیِ نشان را
// با «مبدأ خالی» باز می‌کند و نشان در بارگذاریِ تازه هرگز GPS را خودکار
// فعال نمی‌کند → از کاربر مبدا (و مقصد) می‌پرسید. داکیومنتِ رسمیِ نشان هم
// «مبدأ خودکار» ندارد؛ پس خودِ سایت باید GPS بخواند و مبدأ را صریح بگذارد:
//   • GPS موفق و سالم → لینکِ رسمیِ nshn.ir?origin=…&destination=…&vehicle=d
//     (اپِ نصب باشد اپ، وگرنه وبِ کامل — راستی‌آزماییِ 301 در استیج-۹۷).
//   • ردِ پرمیشن / تایم‌اوت / بی‌پشتیبانی / مختصاتِ خراب → توستِ فارسی +
//     همان لینکِ فقط-مقصد تا کاربر مبدأ را روی نقشهٔ نشان خودش بزند
//     (تأییدِ صاحبِ کسب‌وکار: «وقتی gps رد شد، مبدا توسط کاربر روی نقشه
//     نشان انتخاب شود»). الگویِ مقاوم: courierTracking.ts (چکِ پشتیبانی +
//     پیامِ دقیقِ ردِّ پرمیشن + try/catch).
import { memo, useEffect, useRef, useState } from 'react'
import { useI18n } from '#/i18n'
import { useToastStore } from '#/stores/toastStore'
import {
	isNeshanCoord,
	neshanRouteFromUrl,
	neshanRouteUrl,
} from '#/utils/neshanLinks'

interface ArticleRouteButtonProps {
	lat: number
	lng: number
}

export const ArticleRouteButton = memo(function ArticleRouteButton({
	lat,
	lng,
}: ArticleRouteButtonProps) {
	const { t } = useI18n()
	const showToast = useToastStore((s) => s.showToast)
	const [locating, setLocating] = useState(false)
	const pendingRef = useRef<symbol | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: changing destination must cancel the previous GPS request.
	useEffect(() => {
		setLocating(false)
		return () => {
			// Geolocation cannot be cancelled. Ignore its result if the article
			// closes or the block's destination changes while permission is pending.
			pendingRef.current = null
		}
	}, [lat, lng])

	const handleClick = () => {
		if (pendingRef.current) return
		const pending = Symbol('article-route')
		pendingRef.current = pending
		setLocating(true)

		const finish = (href: string, fallback = false) => {
			if (pendingRef.current !== pending) return
			pendingRef.current = null
			setLocating(false)
			if (fallback) showToast(t['article.routeGpsDenied'], 'error')
			// GPS resolves after browser user activation expires, so a new tab
			// would be blocked. Keep this document visible for the permission
			// prompt, then navigate in this tab; Back still restores the article.
			window.location.assign(href)
		}
		const openFallback = () => finish(neshanRouteUrl(lat, lng), true)
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			openFallback()
			return
		}
		try {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					const { latitude: oLat, longitude: oLng } = pos.coords
					if (isNeshanCoord(oLat, oLng)) {
						finish(neshanRouteFromUrl(oLat, oLng, lat, lng))
					} else {
						// GPS ناشناخته/خراب — اعتبارسنجیِ همان ±۹۰/۱۸۰ بلوک
						openFallback()
					}
				},
				openFallback,
				{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
			)
		} catch {
			openFallback()
		}
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={locating}
			className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-60"
		>
			{locating ? t['article.routeLocating'] : t['article.routeMap']}
		</button>
	)
})
