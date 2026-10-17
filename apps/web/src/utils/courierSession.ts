// src/utils/courierSession.ts
/** phase-5 — نشست پیک: منبع واحد توکن (sessionStorage، TTL سرور ۳ ساعت (stage-84)) */
const KEY = 'courier-token'

export const getCourierToken = (): string | null =>
	typeof window === 'undefined' ? null : sessionStorage.getItem(KEY)

export const setCourierToken = (token: string): void => {
	sessionStorage.setItem(KEY, token)
}

export const clearCourierToken = (): void => {
	sessionStorage.removeItem(KEY)
}
