// src/lib/auth-session.ts
import { useAuthStore } from '#/stores/authStore'

let accessToken: string | null = null

export function getAccessToken(): string | null {
	return accessToken
}

export function setAccessToken(token: string): void {
	accessToken = token
}

export function clearAccessToken(): void {
	accessToken = null
}

export function onUnauthorized(): void {
	clearAccessToken()
	useAuthStore.getState().logout()
}

let refreshPromise: Promise<boolean> | null = null

/** پیامِ 401 نرمِ «رقابتِ چرخش» — همان رشته‌ی session.service (apps/api) */
const RACE_RETRY_MESSAGE = 'نشست هم‌زمان چرخیده است؛ دوباره تلاش کنید.'

/** stage-60 — سقفِ ۲۰ ثانیه‌ای خودِ فراخوانی refresh (SW درخواست‌های POST را نمی‌گیرد) */
const REFRESH_TIMEOUT_MS = 20_000

/**
 * stage-74 — سقفِ هر تلاش (تست‌ها موقتاً کوچکش می‌کنند؛ غیر از تست کسی
 * دست نمی‌زند). این مقدار «تا پایان خواندن بدنه» است — نه فقط headers.
 */
let refreshTimeoutMs = REFRESH_TIMEOUT_MS

/** فقط برای تست‌ها — زمان‌بندی را موقتاً کوچک می‌کند */
export function _setRefreshTimeoutForTest(ms: number): void {
	refreshTimeoutMs = ms
}

interface RefreshOutcome {
	status: number
	body: unknown | null
}

/**
 * stage-74 — تایمرِ abort تا «پایان خواندن بدنه» زنده می‌ماند:
 * قبلاً در finally بعد از fetch پاک می‌شد؛ res.json() بی‌مرز بود و
 * بدنه‌ی گیرکرده یعنی refreshPromise ای که هرگز settle نمی‌شود — و چون
 * این promise بین همه‌ی درخواست‌های احراز (authJson/api-client) مشترک
 * است، همان یک گیرکردن «کلِ پنل» را فریز می‌کرد (علتِ گزارشِ «بعد از
 * ~نیم ساعت ادمین هنگ می‌کند و باید اپ را ببندد و باز کند» — توکنِ
 * ۱۵ دقیقه‌ای منقضی می‌شود، اولین 401 وارد refresh می‌شود و در شبکه‌ی
 * ناپایدارِ موبایل/PWA گیر می‌کند). حالا: abort ⇒ res.text() reject ⇒
 * catch بیرونی ⇒ false (غیرقطعی — بدون خروج).
 */
async function refreshFetch(): Promise<RefreshOutcome> {
	const controller = new AbortController()
	const timeoutErr = () =>
		new DOMException('مهلت نوسازی نشست به پایان رسید.', 'TimeoutError')
	const timer = setTimeout(
		() => controller.abort(timeoutErr()),
		refreshTimeoutMs,
	)
	try {
		const base = import.meta.env.VITE_API_URL || window.location.origin
		const res = await fetch(`${base}/api/auth/refresh`, {
			method: 'POST',
			credentials: 'include',
			signal: controller.signal,
		})
		// بدنه زیرِ همان تایمر — مهلت در وسطِ خواندن هم استریم را می‌بندد
		const text = await res.text()
		let body: unknown = null
		if (text) {
			try {
				body = JSON.parse(text)
			} catch {
				body = null
			}
		}
		return { status: res.status, body }
	} finally {
		clearTimeout(timer)
	}
}

/** چرخه‌ی کامل نوسازی — همان منطقِ قبلی؛ فقط با deadline سرتاسری */
async function refreshCycle(): Promise<boolean> {
	try {
		let r = await refreshFetch()
		if (r.status === 401) {
			const body = (r.body ?? null) as {
				error?: { code?: string; message?: string }
			} | null
			if (body?.error?.message === RACE_RETRY_MESSAGE) {
				// stage-60 — رقابتِ چرخش: دو کانتکست هم‌کوکی پشت‌سرهم refresh
				// زدند؛ سرور 401 نرم با پیامِ «retry» می‌دهد. یک مکث کوتاه (کوکیِ
				// تازه از چرخندهٔ برنده در jar می‌نشیند) و یک تلاش دیگر.
				await new Promise((res) => setTimeout(res, 500))
				r = await refreshFetch()
			} else {
				// 401 قطعی (نشست مرده/باطل) — تنها حالتِ مجازِ خروج
				onUnauthorized()
				return false
			}
		}
		if (r.status === 401 || r.status === 403) {
			// بعد از ریتری هم 401/403 — قطعی
			onUnauthorized()
			return false
		}
		if (!(r.status >= 200 && r.status < 300)) {
			// stage-60 — 429 (سقف IPِ CGNATِ اشتراکی) / 5xx (ری‌استارت دیپلوی):
			// خروج نیست؛ کاربر می‌ماند و فراخواننده خطای خودش را نشان می‌دهد.
			return false
		}
		const data = (r.body ?? null) as { accessToken?: string } | null
		// stage-74 — توکن غایب = شکستِ نرم (قبلاً undefined در setAccessToken
		// می‌نشست و hasSession() بی‌توکن هم true می‌شد)
		if (!data?.accessToken) return false
		setAccessToken(data.accessToken)
		return true
	} catch {
		// خطای شبکه/مهلت — غیرقطعی؛ خروج ممنوع
		return false
	}
}

export async function tryRefresh(): Promise<boolean> {
	if (refreshPromise) return refreshPromise
	// stage-74 — «در هر حالت آزاد شود»: finally روی خودِ promise سوار است؛
	// حتی اگر چرخه به هر دلیلی settle نشود، watchdog (در doRefresh) آن را
	// false می‌کند ⇒ این finally اجرا می‌شود ⇒ refreshPromise آزاد می‌شود ⇒
	// درخواست بعدی refresh تازه می‌زند (نه گرهِ ابدی).
	const p = doRefresh().finally(() => {
		if (refreshPromise === p) refreshPromise = null
	})
	refreshPromise = p
	return p
}

/**
 * stage-74 — safety-watchdog: چرخه در سقفِ (۲×تایم‌اوت + ۵s) «همیشه»
 * settle می‌شود — حتی اگر یک مسیرِ آینده جایی گیر کند. watchdog فقط
 * false برمی‌گرداند (غیرقطعی — هرگز خروج نمی‌زند؛ خروج فقط از پاسخِ
 * قطعیِ 401/403 خودِ سرور). تایمرِ watchdog با settle شدنِ چرخه زودتر
 * پاک می‌شود.
 */
async function doRefresh(): Promise<boolean> {
	const watchdogMs = refreshTimeoutMs * 2 + 5_000
	let watchdogTimer: ReturnType<typeof setTimeout> | undefined
	const watchdog = new Promise<boolean>((resolve) => {
		watchdogTimer = setTimeout(() => resolve(false), watchdogMs)
	})
	try {
		return await Promise.race([refreshCycle(), watchdog])
	} finally {
		if (watchdogTimer) clearTimeout(watchdogTimer)
	}
}

export function hasSession(): boolean {
	return accessToken !== null
}

// ─── Boot: بعد از رفرش، اگر توکن نیست، یک‌بار refresh بزن ───
// در کلاینت اجرا می‌شود — قبل از اولین درخواست‌های authJson
if (typeof window !== 'undefined') {
	void tryRefresh()
}

/** اگر توکن نیست و refresh در جریان است — صبر کن تمام شود */
export async function ensureSession(): Promise<void> {
	if (accessToken !== null) return
	await tryRefresh()
}
