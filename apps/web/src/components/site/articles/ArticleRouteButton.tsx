// Send a fresh browser position as the origin when available. Without one,
// hand off the article's destination using Neshan's documented point link.
// Neshan itself controls live tracking and permissions after the handoff.
import { memo, useEffect, useRef, useState } from 'react'
import { useI18n } from '#/i18n'
import { useToastStore } from '#/stores/toastStore'
import {
	isNeshanCoord,
	neshanPointUrl,
	neshanRouteFromUrl,
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
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const valid = isNeshanCoord(lat, lng)

	// biome-ignore lint/correctness/useExhaustiveDependencies: changing destination must cancel the previous GPS request.
	useEffect(() => {
		setLocating(false)
		return () => {
			// Geolocation cannot be cancelled. Ignore its result if the article
			// closes or the block's destination changes while permission is pending.
			pendingRef.current = null
			if (timerRef.current !== null) clearTimeout(timerRef.current)
			timerRef.current = null
		}
	}, [lat, lng])

	const handleClick = () => {
		if (pendingRef.current || !valid) return
		const pending = Symbol('article-route')
		pendingRef.current = pending
		setLocating(true)

		const finish = (href: string, fallback = false) => {
			if (pendingRef.current !== pending) return
			pendingRef.current = null
			if (timerRef.current !== null) clearTimeout(timerRef.current)
			timerRef.current = null
			setLocating(false)
			if (fallback) showToast(t['article.routeGpsDenied'], 'error')
			// GPS resolves after browser user activation expires, so a new tab
			// would be blocked. Keep this document visible for the permission
			// prompt, then navigate in this tab; Back still restores the article.
			window.location.assign(href)
		}
		const openFallback = () => finish(neshanPointUrl(lat, lng), true)
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			openFallback()
			return
		}
		// The browser's GPS timeout need not include time waiting for permission.
		// Always release the button, even if the provider never calls us back.
		timerRef.current = setTimeout(openFallback, 12_000)
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
				{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
			)
		} catch {
			openFallback()
		}
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={locating || !valid}
			className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-60"
		>
			{locating ? t['article.routeLocating'] : t['article.routeMap']}
		</button>
	)
})
