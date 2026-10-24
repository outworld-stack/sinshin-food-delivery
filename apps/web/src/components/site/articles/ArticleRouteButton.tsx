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
import { memo, useState } from 'react'
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

	const openFallback = () => {
		// مقصد پین می‌شود؛ مبدأ را کاربر روی نقشهٔ نشان انتخاب می‌کند.
		window.open(neshanRouteUrl(lat, lng), '_blank', 'noopener')
	}

	const handleClick = () => {
		if (locating) return
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			showToast(t['article.routeGpsDenied'], 'error')
			openFallback()
			return
		}
		setLocating(true)
		try {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					setLocating(false)
					const { latitude: oLat, longitude: oLng } = pos.coords
					if (isNeshanCoord(oLat, oLng)) {
						window.open(
							neshanRouteFromUrl(oLat, oLng, lat, lng),
							'_blank',
							'noopener',
						)
					} else {
						// GPS ناشناخته/خراب — اعتبارسنجیِ همان ±۹۰/۱۸۰ بلوک
						showToast(t['article.routeGpsDenied'], 'error')
						openFallback()
					}
				},
				() => {
					setLocating(false)
					showToast(t['article.routeGpsDenied'], 'error')
					openFallback()
				},
				{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
			)
		} catch {
			setLocating(false)
			showToast(t['article.routeGpsDenied'], 'error')
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
