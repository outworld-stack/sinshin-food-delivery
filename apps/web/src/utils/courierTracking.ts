import { updateCourierLocation } from '#/server/courier'
import { clearCourierToken } from '#/utils/courierSession'

/** One GPS watcher and at most one in-flight upload per delivery page. */
export function startCourierTracking(input: {
	orderId: string
	courierToken: string
	onPosition: (position: { lat: number; lng: number }) => void
	onSent: () => void
	onMessage: (message: string) => void
	onStopped: () => void
}): () => void {
	let active = true
	let inFlight = false
	let lastSent = -Infinity
	let watchId: number | undefined
	const stop = () => {
		active = false
		if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
		watchId = undefined
	}
	const halt = (message: string) => {
		stop()
		input.onMessage(message)
		input.onStopped()
	}
	if (!navigator.geolocation) {
		halt('مرورگر شما موقعیت را پشتیبانی نمی‌کند')
		return stop
	}
	try {
		watchId = navigator.geolocation.watchPosition(async ({ coords }) => {
			if (!active) return
			const { latitude: lat, longitude: lng } = coords
			if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return
			input.onPosition({ lat, lng })
			const now = Date.now()
			if (inFlight || now - lastSent < 5000) return
			lastSent = now
			inFlight = true
			try {
				const result = await updateCourierLocation({ orderId: input.orderId, courierToken: input.courierToken, lat, lng })
				if (!active) return
				if (result.stopTracking) {
					halt(result.message ?? 'ارسال موقعیت برای این سفارش متوقف شد')
				} else if (result.success) {
					if (result.accepted !== false) input.onSent()
					input.onMessage('')
				} else {
					input.onMessage(result.message ?? 'ارسال موقعیت انجام نشد')
				}
			} catch (error) {
				if (!active) return
				const message = error instanceof Error ? error.message : 'خطا در ارسال موقعیت'
				const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
				if (status === 401 || status === 403 || status === 404) {
					if (status === 401) clearCourierToken()
					halt(message)
				} else input.onMessage(message)
			} finally {
				inFlight = false
			}
		}, (error) => {
			if (!active) return
			if (error.code === 1) halt('دسترسی به موقعیت رد شد؛ دسترسی مرورگر را فعال کنید و دوباره تلاش کنید')
			else input.onMessage('دریافت موقعیت ناموفق بود؛ تلاش دوباره ادامه دارد')
		}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 })
	} catch {
		halt('شروع دریافت موقعیت ناموفق بود؛ دسترسی مرورگر را بررسی کنید و دوباره تلاش کنید')
	}
	return stop
}
