// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 25 از 49
// مسیر مقصد: apps/web/src/lib/api-fetch.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/lib/api-fetch.ts
// هلپرهای fetch مشترک — همه‌ی server/*.ts از اینجا استفاده می‌کنند
// تبدیل نوع فقط اینجا (مرز serde) — به‌علاوه‌ی تبدیل نوع در هر فراخواننده با قرارداد

import { apiBase, ssrFetchSignal } from '#/lib/api'
import { getAccessToken, tryRefresh } from '#/lib/auth-session'
import { langHeaders, resolveRequestLang } from '#/lib/lang-header'

export interface FetchOpts {
	/** هدرهای اضافی — با هدرهای پایه ادغام می‌شوند (مثل idempotency-key) */
	headers?: Record<string, string>
	/** Longer bounded operations, such as printer discovery, can set their budget. */
	timeoutMs?: number
}

/**
 * stage-59 — ریشه‌یابی باگ «تعویض بلادرنگ fa↔ar»:
 * سرور محتوای زبان را در هدرِ درخواست می‌فرستد (x-sinshin-lang)، ولی کشِ
 * HTTPِ مرورگر فقط با (method + URL) کلید می‌خورد. رِفچِ فوریِ بعد از
 * تعویض زبان (invalidateQueries + router.invalidate — که همه درست کار
 * می‌کنند) به همان URL می‌رخت و مرورگر تا ۳۰ ثانیه (max-age + SWR تا ۹۰)
 * بدنه‌ی کش‌شده‌ی «زبان قبلی» را از کش HTTP برمی‌گرداند — اسم غذاها و
 * توضیحات عربی نمی‌شد. حل قطعی و مستقل از پشتیبانی Vary در مرورگرها:
 * زبان به‌عنوان پارامتر URL به همه‌ی GETها چسبانده می‌شود → هر زبان ورودیِ
 * کش HTTP اختصاصی خودش را دارد؛ تعویض زبان همان لحظه داده‌ی تازه می‌گیرد.
 * (ا آزمایش شد: Elysia پارامترهای اضافه‌ی query را نادیده می‌گیرد — 200.)
 */
function withLangQuery(path: string, lang: 'fa' | 'ar'): string {
	const sep = path.includes('?') ? '&' : '?'
	return `${path}${sep}lang=${lang}`
}

/**
 * stage-60 — سقفِ زمانیِ fetch (باگ «فریز PWA»): در مرورگر سیگنالی نبود و
 * اتصالِ سیاه‌چاله‌ی موبایل fetch را برای همیشه معلق می‌گذاشت — اسکلتونِ
 * ابدی/روتِ pending. AbortController دستی (بدون AbortSignal.timeout —
 * پشتیبانیِ مرورگرهای قدیمی) + زنجیرکردنِ سیگنالِ بیرونی (SSR: سقف ۱۰s
 * همان قبل؛ سقفِ ۳۰s اینجا فقط پشتوانه‌ی مرورگر است). AbortController و
 * setTimeout در Bun/Node هم هستند — همین یک پیاده‌سازی هر دو سمت را می‌پوشاند.
 *
 * stage-74 — سقف تا «پایان خواندن بدنه»، نه فقط headers:
 * fetch با رسیدنِ headers resolve می‌شود؛ قبلاً تایمر همین‌جا پاک می‌شد و
 * خواندنِ res.text()/res.json() بی‌مرز می‌ماند — بدنه‌ی گیرکرده یعنی
 * درخواستِ معلقِ ابدی (نصفِ ریشه‌ی «فریز PWA» — گزارش کارفرما). حالا
 * پاسخِ برگشتی با Proxy پوشیده شده: تایمر تا پایانِ مصرفِ بدنه زنده می‌ماند
 * و abort استریم را می‌بندد ⇒ خواندن reject می‌شود. بودجه = کلِ چرخه
 * (اتصال + headers + بدنه) — همان «اعمال timeout تا پایان خواندن بدنه».
 */
const FETCH_TIMEOUT_MS = 30_000

export interface FetchWithTimeoutOpts {
	/** سقفِ کلِ چرخه (headers + بدنه) — میلی‌ثانیه؛ پیش‌فرض ۳۰s (تست: کوچک) */
	timeoutMs?: number
}

/** صادرشده برای api-client.ts (treaty) — همان سقفِ ۳۰ ثانیه‌ای + پوششِ بدنه */
export async function fetchWithTimeout(
	input: string,
	init: RequestInit,
	opts?: FetchWithTimeoutOpts,
): Promise<Response> {
	const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS
	const external = init.signal ?? undefined
	const controller = new AbortController()
	const timeoutErr = () =>
		new DOMException('مهلت پاسخ سرور به پایان رسید.', 'TimeoutError')

	let timer: ReturnType<typeof setTimeout> | null = null
	let cleaned = false
	const onExternalAbort = () => controller.abort(external?.reason)
	const cleanup = () => {
		if (cleaned) return
		cleaned = true
		if (timer) {
			clearTimeout(timer)
			timer = null
		}
		if (external) external.removeEventListener('abort', onExternalAbort)
	}

	// تایمرِ روشن: روی مهلت → abort (استریم/بدنه می‌بندد) + پاکسازی.
	// بعد از resolve شدن fetch عمداً «روشن» می‌ماند تا مصرفِ بدنه هم زیرِ
	// همان بودجه باشد؛ با پایانِ خواندنِ بدنه (deadlineResponse) پاک می‌شود.
	const armTimer = () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = null
			controller.abort(timeoutErr())
			cleanup()
		}, timeoutMs)
	}
	armTimer()

	try {
		if (external) {
			if (external.aborted) controller.abort(external.reason)
			else external.addEventListener('abort', onExternalAbort)
		}
		const res = await fetch(input, { ...init, signal: controller.signal })
		return deadlineResponse(res, cleanup)
	} catch (e) {
		cleanup()
		throw e
	}
}

/**
 * stage-74 — پاسخِ با بدنه‌ی زیرِ deadline: متدهای مصرفِ بدنه
 * (json/text/arrayBuffer/blob/formData) موقع پایان، تایمرِ abort را
 * خاموش می‌کنند. اگر بدنه در بودجه‌ی باقی‌مانده نرسد، abort استریم را
 * می‌بندد و خواندن reject می‌شود (TimeoutError/AbortError) — دیگر هیچ
 * «headers آمد ولی بدنه برای همیشه گیر کرد» وجود ندارد.
 * (res.body/getReader هم امن است: abort همان‌جا استریم را می‌بندد.)
 */
function deadlineResponse(res: Response, onBodyDone: () => void): Response {
	const BODY_METHODS = new Set([
		'json',
		'text',
		'arrayBuffer',
		'blob',
		'formData',
	])
	return new Proxy(res, {
		get(target, prop) {
			if (BODY_METHODS.has(prop as string)) {
				const orig = Reflect.get(target, prop, target) as unknown
				if (typeof orig !== 'function') return orig
				return async (...args: unknown[]) => {
					try {
						return await (orig as (...a: unknown[]) => Promise<unknown>).apply(
							target,
							args,
						)
					} finally {
						onBodyDone()
					}
				}
			}
			const v = Reflect.get(target, prop, target) as unknown
			return typeof v === 'function'
				? (v as (...a: unknown[]) => unknown).bind(target)
				: v
		},
	})
}

export async function getJson<T>(path: string): Promise<T> {
	// round-34 — x-sinshin-lang از کوکی (SSR: درخواست ورودی؛ مرورگر: document)
	// stage-59 — زبان در URL (کش HTTP per-lang) + هدر متقارن fa/ar
	const lang = await resolveRequestLang()
	const res = await fetchWithTimeout(apiBase() + withLangQuery(path, lang), {
		credentials: 'include',
		headers: { 'x-sinshin-lang': lang },
		signal: ssrFetchSignal(), // کار-۳: سقف ۱۰s فقط SSR (stage-60: زنجیر می‌شود)
	})
	return handleResponse<T>(res)
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetchWithTimeout(apiBase() + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(await langHeaders()) },
		body: JSON.stringify(body),
		credentials: 'include',
		signal: ssrFetchSignal(), // کار-۳
	})
	return handleResponse<T>(res)
}

/** با Authorization + جریانِ نوسازیِ توکن روی 401 + هدرهای اختیاری (phase-3) */
export async function authJson<T>(
	path: string,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	body?: unknown,
	opts?: FetchOpts,
): Promise<T> {
	const token = getAccessToken()
	// ⬅ phase-3: هدرهای سفارشی «قبل از» توکن — authorization همیشه
	// توسط خودِ هلپر ست می‌شود؛ فراخواننده نمی‌تواند آن را بازنویسی کند
	// round-34 — هدر زبان هم قبل از توکن ادغام می‌شود (منبع: کوکی)
	// stage-59 — GETهای احراز-دار هم زبان را در URL می‌برند (کش per-lang)
	const lang = await resolveRequestLang()
	const fetchPath = method === 'GET' ? withLangQuery(path, lang) : path
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-sinshin-lang': lang,
		...(opts?.headers ?? {}),
	}
	if (token) headers.authorization = `Bearer ${token}`

	let res = await fetchWithTimeout(apiBase() + fetchPath, {
		method,
		headers,
		credentials: 'include',
		signal: ssrFetchSignal(), // کار-۳
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, { timeoutMs: opts?.timeoutMs })

	if (res.status === 401) {
		const refreshed = await tryRefresh()
		if (refreshed) {
			const newToken = getAccessToken()
			if (newToken) headers.authorization = `Bearer ${newToken}`
			// همان headers (شامل idempotency-key) — تلاش مجدد امن
			res = await fetchWithTimeout(apiBase() + fetchPath, {
				method,
				headers,
				credentials: 'include',
				signal: ssrFetchSignal(), // کار-۳ — سیگنال تازه برای تلاش مجدد
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			}, { timeoutMs: opts?.timeoutMs })
		}
		// stage-60 — خروج فقط داخلِ خود tryRefresh رخ می‌دهد (401/403 قطعی از
		// refresh)؛ 429/5xx/شبکه → false بدون خروج — همین res خطای خودش را
		// نشان می‌دهد و کاربر لاگین می‌ماند.
	}

	return handleResponse<T>(res)
}

async function handleResponse<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const b = (await res.json().catch(() => null)) as {
			error?: { message?: string; code?: string }
		} | null
		// phase-fix: کاربری که وسط نشست VPN روشن کرده — رفرش سخت؛
		// دروازه‌ی SSR دوباره اجرا می‌شود و صفحه‌ی «دسترسی محدود» می‌آید
		if (b?.error?.code === 'GEO_BLOCKED' && typeof window !== 'undefined') {
			window.location.reload()
		}
		// phase-fix: status روی خطا — شرطِ ریترایِ TanStack Query این را می‌خواند؛
		// قبلاً 4xx هم دو بار تلاش مجدد می‌شد (سه برابر بار روی API در خطای اعتبارسنجی)
		throw Object.assign(new Error(b?.error?.message ?? `خطای ${res.status}`), {
			status: res.status,
			code: b?.error?.code,
		})
	}
	// ⬅ بدنه‌ی خالی — 204 یا هیچ:
	const text = await res.text()
	if (!text) return undefined as T
	return JSON.parse(text) as T
}
