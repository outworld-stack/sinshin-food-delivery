// ═══════════════════════════════════════════════════════════════
// stage-64 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/push-subscription.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی stage-58)
// تغییر: حذف autoPushFlow — درخواستِ Notification.requestPermission بدون
//        کلیک در مرورگرها (به‌ویژه Safari/iOS) رد/ساکت می‌شود و اپل
//        ردِ دائم را ثبت می‌کند. پرامپت حالا بنرِ PushAutoPrompt است که
//        کاربر خودش دکمه‌اش را می‌زند (کلیک = مجوزِ پرسیدن). enablePush و
//        بقیه‌ی ابزارها دست‌نخورده‌اند؛ کلیدهای throttle صادر شدند و معنایشان
//        «مهلتِ دیده‌شدنِ بنر» است.
// stage-58 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/push-subscription.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (درخواست کاربر — پرامپت خودکار + رفع «در هیچ مرورگری نمی‌رسد»):
//   ① enablePush حالا گرهِ 409 PUSH_SUB_OWNED را باز می‌کند (مرورگرِ
//      اشتراک‌شده بین دو حساب): unsubscribe → subscribe تازه → ثبت مجدد.
//      قبلاً این حالت failureReason:'register' ابدی بود و پوشِ حسابِ قبلی
//      به مرورگر حسابِ فعلی می‌رسید.
//   ② مهمان: permission گرفته/اشتراک ساخته می‌شود؛ ثبت سرور 401 ⇒
//      pendingLogin:true — بعد از لاگین، reconcile ثبتش می‌کند.
//   ③ reconcileSubscription — «سرور همین اشتراک را دارد؟» با
//      GET /notifications/push-status (endpoints) — فقط در نبودش POST
//      می‌زند (سقف نرخ ۲۰/min/IP روی NAT با POSTهای بی‌فایده پر نمی‌شود).
//   ④ autoPushFlow — نقطه‌ی ورود فلوی خودکارِ صفحه‌باز (دکمه‌ی بنفش
//      هدر حذف شد): permission==='default' + throttle ۳روزه ⇒ enablePush؛
//      permission==='granted' ⇒ reconcile.
//   ۵) شنونده‌ی پیام PUSH_SUBSCRIPTION_CHANGED از SW (چرخش endpoint).
// stage-50/51 (مهلت‌ها، authedPushFetch با ریتری 401، گزارش شفاف خطا،
//            fast-path getPushState) همه محفوظ.
// ═══════════════════════════════════════════════════════════════
// phase-2 — اشتراک Web Push سمت کلاینت

// src/lib/push-subscription.ts
/**
 * فاز-۲ + stage-58 — اشتراک Web Push سمت کلاینت.
 *
 * جریان (همه‌ی گاردها داخلی — هرگز throw به UI):
 *  ۱) SW آماده؟ — getRegistration سریع؛ اگر هیچ SWی نیست، sw-push.js
 *     (فایل استاتیکِ سبک) ثبت می‌شود — در dev و prodِ بدون build:pwa.
 *  ۲) permission — اگر default بود درخواست بگیر؛ denied = تهی
 *  ۳) کلید عمومی VAPID از API (GET /notifications/vapid-public)
 *  ۴) pushManager.subscribe({ userVisibleOnly, applicationServerKey })
 *     — با مهلت؛ هیچ‌وقت معلق نمی‌ماند
 *  ۵) ثبت endpoint در بک‌اند (POST /notifications/subscriptions)
 *     — با نشستِ تازه و ریتری روی ۴۰۱ + بازیابی ۴۰۹ (تسخیر اکانت قبلی)
 *
 * نکته‌ی iOS: پوش فقط وقتی PWA روی هوم‌اسکرین نصب شده باشد کار می‌کند
 * (محدودیت اپل — 16.4+)؛ در مرورگر عادیِ iOS subscribe خطا می‌دهد که
 * همین‌جا به 'ios-installed-only' ترجمه می‌شود.
 * دسکتاپ: Chrome/Edge/Firefox (و Safari 16.4+ مک) کاملاً پشتیبانی
 * می‌کنند — localhost هم Secure Context است، پس dev هم کار می‌کند.
 */

import { apiBase } from '#/lib/api'
import { fetchWithTimeout } from '#/lib/api-fetch'
import { ensureSession, getAccessToken, tryRefresh } from '#/lib/auth-session'

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** stage-51 — علتِ شکست برای پیامِ دقیق در UI (گزارش خطای شفاف) */
export type PushFailureReason =
	| 'vapid' /** GET vapid-public ناموفق (شبکه/401/کلید نامعتبر) */
	| 'subscribe' /** pushManager.subscribe رد شد یا مهلت پر شد */
	| 'register' /** POST subscriptions ناموفق (شبکه/401/اعتبارسنجی) */
	| 'invalid' /** ساختار اشتراک ناقص (endpoint/keys) */

export type PushState =
	| {
			state: 'granted'
			subscribed: boolean
			failureReason?: PushFailureReason
			pendingLogin?: boolean
	  }
	| { state: 'denied' }
	| { state: 'default' }
	| { state: 'unsupported'; reason?: string }

/** SW مخصوص پوش — فایل استاتیک بدون workbox؛ در dev سرو می‌شود */
const SW_PUSH_URL = '/sw-push.js'

/** stage-58 — throttle پرامپت خودکار: دوباره‌پرسیدن حداکثر هر ۳ روز
 *  (کروم بعد از ~۳ رد خودش پرامپت را quiet می‌کند؛ ما هم اذیت نمی‌کنیم) */
export const AUTO_PROMPT_KEY = 'sinshin-push-prompt-last'
export const AUTO_PROMPT_RETRY_DAYS = 3

/** مهلت‌های انتظار — هیچ await معلق نمی‌ماند */
const READY_TIMEOUT_MS = 8_000
const GETSTATE_TIMEOUT_MS = 4_000
const FETCH_TIMEOUT_MS = 10_000
/** subscribe می‌تواند (فایرفاکس/شبکه‌ی کند) طول بکشد — ۳۰ ثانیه سقف */
const SUBSCRIBE_TIMEOUT_MS = 30_000

let pushGeneration = 0
let pushSuspended = false
let pushOperation: Promise<PushState> | null = null
type IsCurrent = () => boolean
const inactiveState = (): PushState => ({ state: 'granted', subscribed: false })

/** Logout invalidates pending subscriptions before clearing the auth session. */
export function resumePushSynchronization(): void {
	pushSuspended = false
}

function runPushOperation(
	action: (isCurrent: IsCurrent) => Promise<PushState>,
): Promise<PushState> {
	if (pushSuspended) return Promise.resolve(inactiveState())
	if (pushOperation) return pushOperation
	const generation = pushGeneration
	const operation = action(
		() => !pushSuspended && generation === pushGeneration,
	)
	pushOperation = operation
	void operation
		.finally(() => {
			if (pushOperation === operation) pushOperation = null
		})
		.catch(() => {})
	return operation
}

/** رقابتِ promise با تایمر — برنده‌ی اول؛ هیچ‌وقت معلق نمی‌ماند */
async function withTimeout<T>(
	p: Promise<T>,
	ms: number,
	fallback: T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			p,
			new Promise<T>((resolve) => {
				timer = setTimeout(() => resolve(fallback), ms)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

/**
 * stage-77 (PWA P2-1) — خواندنِ بدنه زیرِ مهلت: withTimeout قبلاً فقط خودِ
 * fetch را می‌پوشاند (رسیدنِ headers)؛ res.json() بی‌مرز بود — سیاه‌چاله‌ی
 * «headers آمد ولی بدنه هرگز» یعنی enablePush/reconcile برای همیشه معلق
 * و بنرِ PushAutoPrompt در فازِ busy (دکمه‌ی رد پنهان) گیر می‌کند. همان
 * درسِ auth-session (stage-74) — این آخرین مسیرِ fetchِ بی‌سقفِ بدنه بود.
 */
export async function readJsonWithTimeout<T>(
	res: Response,
	ms: number,
	fallback: T,
): Promise<T> {
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		if (!res.body) return fallback
		reader = res.body.getReader()
		const decoder = new TextDecoder()
		const read = async () => {
			let body = ''
			while (true) {
				const chunk = await reader!.read()
				if (chunk.done) break
				body += decoder.decode(chunk.value, { stream: true })
			}
			return JSON.parse(body + decoder.decode()) as T
		}
		return await Promise.race([
			read(),
			new Promise<T>((resolve) => {
				timer = setTimeout(() => {
					void reader?.cancel().catch(() => {})
					resolve(fallback)
				}, ms)
			}),
		])
	} catch {
		return fallback
	} finally {
		clearTimeout(timer)
		try {
			reader?.releaseLock()
		} catch {
			/* cancelled read is settling */
		}
	}
}

/**
 * ثبت‌شده‌ی فعلی (اگر باشد) — سریع؛ null یعنی «هیچ SWی نیست».
 * (getRegistration بدون آرگومان = scope همین صفحه)
 */
async function getRegistrationFast(): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null
	try {
		return (
			(await withTimeout(
				navigator.serviceWorker.getRegistration(),
				GETSTATE_TIMEOUT_MS,
				undefined,
			)) ?? null
		)
	} catch {
		return null
	}
}

/**
 * اطمینان از وجود سرویس‌ورکر برای پوش:
 *  • SW موجود (prod: sw.js باندل‌شده / fallback: sw-push.js) → همان
 *  • هیچ SW نیست → ثبت sw-push.js (استاتیک، فقط هندلر پوش)
 * فایل در public است و vite هم در dev سرو می‌کند.
 */
async function ensurePushRegistration(): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null
	const existing = await getRegistrationFast()
	if (existing) return existing
	try {
		return await withTimeout(
			navigator.serviceWorker.register(SW_PUSH_URL),
			READY_TIMEOUT_MS,
			null,
		)
	} catch {
		return null
	}
}

/** navigator.serviceWorker.ready با مهلت — معلق نمی‌ماند */
async function readyWithTimeout(
	ms: number,
): Promise<ServiceWorkerRegistration | null> {
	try {
		return await withTimeout(navigator.serviceWorker.ready, ms, null)
	} catch {
		return null
	}
}

/**
 * fetch با مهلت + Bearer + نشستِ تازه + یک ریتری روی ۴۰۱ (الگوی authJson).
 * stage-50 — قبلاً توکنِ منقضی یعنی ۴۰۱ و شکستِ همیشگی ثبت اشتراک؛
 * حالا اول نشست تازه می‌شود، و اگر باز ۴۰۱ آمد، tryRefresh و تلاش مجدد.
 * stage-51 — برای vapid-public هم استفاده می‌شود: مسیر در بک‌اند جدید
 * عمومی است؛ روی بک‌اند قدیمی (محافظت‌شده) با همین Bearer جواب می‌گیرد.
 * خروجی null = مهلت/شبکه — کالر حالتِ «تلاش مجدد» نشان می‌دهد.
 */
export async function authedPushFetch(
	url: string,
	init: RequestInit,
	isCurrent: IsCurrent = () => true,
): Promise<Response | null> {
	// نشست را قبل از حرکت تازه کن (توکنِ ۱۵ دقیقه‌ای ممکن است مرده باشد)
	await ensureSession().catch(() => {})
	if (!isCurrent()) return null
	const buildHeaders = (): Headers => {
		const headers = new Headers(init.headers)
		const token = getAccessToken()
		if (token) headers.set('authorization', `Bearer ${token}`)
		return headers
	}
	const run = (): Promise<Response | null> =>
		withTimeout(
			fetchWithTimeout(
				url,
				{ ...init, headers: buildHeaders(), credentials: 'include' },
				{ timeoutMs: FETCH_TIMEOUT_MS },
			),
			FETCH_TIMEOUT_MS,
			null,
		).catch(() => null)

	let res = await run()
	if (res !== null && res.status === 401) {
		if (!isCurrent()) return null
		// توکن کهنه — یک‌بار نوسازی و تلاش مجدد
		const refreshed = await tryRefresh().catch(() => false)
		if (refreshed && isCurrent()) res = await run()
	}
	return res
}

/** وضعیت فعلی — سبک، بدون عارضه */
export async function getPushState(): Promise<PushState> {
	if (
		typeof window === 'undefined' ||
		!('serviceWorker' in navigator) ||
		!('PushManager' in window)
	) {
		return { state: 'unsupported', reason: 'no-push-api' }
	}
	if (!('Notification' in window)) {
		return { state: 'unsupported', reason: 'no-notification-api' }
	}
	const permission = Notification.permission
	if (permission === 'denied') return { state: 'denied' }
	if (permission === 'default') return { state: 'default' }
	// granted — subscribed هست؟
	// stage-50 — fast-path: بدون SW فوری جواب بده (قبلاً ۴ ثانیه
	// انتظارِ بی‌نتیجه روی ready می‌کشید — حالت اولیه‌ی آیکون دیر می‌آمد)
	const reg = await getRegistrationFast()
	if (!reg) return { state: 'granted', subscribed: false }
	try {
		const existing = await withTimeout(
			reg.pushManager.getSubscription(),
			GETSTATE_TIMEOUT_MS,
			null,
		)
		return { state: 'granted', subscribed: existing !== null }
	} catch {
		return { state: 'granted', subscribed: false }
	}
}

// ── stage-58 — قطعه‌های قابل استفاده‌ی مجددِ جریان ──

/** کلید عمومی VAPID از سرور — null یعنی همین‌جا گزارش شده و باید ول کرد */
async function fetchVapidKey(): Promise<Uint8Array<ArrayBuffer> | null> {
	const keyRes = await authedPushFetch(
		`${apiBase()}/notifications/vapid-public`,
		{
			method: 'GET',
		},
	)
	if (!keyRes || !keyRes.ok) {
		// گزارش شفاف — علت واقعی دیگر بی‌صدا نیست (بدون توکن در لاگ)
		console.warn(
			'[push] vapid-public ناموفق:',
			keyRes ? `HTTP ${keyRes.status}` : 'شبکه/مهلت',
		)
		return null
	}
	// stage-77 — بدنه زیرِ همان مهلت (نه بی‌سقف)
	const parsed = await readJsonWithTimeout<{ key?: string }>(
		keyRes,
		FETCH_TIMEOUT_MS,
		{},
	)
	const key: string | undefined = parsed.key
	if (!key) {
		console.warn('[push] vapid-public: کلید خالی برگشت')
		return null
	}
	return urlBase64ToUint8Array(key)
}

/** ساخت (یا گرفتن) اشتراک روی این رجیستری — بدون POST سرور */
async function obtainLocalSubscription(
	reg: ServiceWorkerRegistration,
	isCurrent: IsCurrent,
): Promise<PushSubscription | null> {
	const existing = await withTimeout(
		reg.pushManager.getSubscription(),
		GETSTATE_TIMEOUT_MS,
		null,
	).catch(() => null)
	if (!isCurrent()) return null
	if (existing) return existing
	const applicationServerKey = await fetchVapidKey()
	if (!applicationServerKey || !isCurrent()) return null
	try {
		const sub = await withTimeout(
			reg.pushManager
				.subscribe({
					userVisibleOnly: true,
					applicationServerKey,
				})
				.then(async (sub) => {
					// Native subscribe cannot be aborted. A late completion after logout
					// must be detached instead of restoring delivery for the old account.
					if (!isCurrent()) {
						await withTimeout(
							sub.unsubscribe(),
							GETSTATE_TIMEOUT_MS,
							false,
						).catch(() => false)
						return null
					}
					return sub
				}),
			SUBSCRIBE_TIMEOUT_MS,
			null,
		)
		if (!sub && isCurrent()) {
			console.warn(
				`[push] subscribe بعد از ${SUBSCRIBE_TIMEOUT_MS / 1000}s مهلت پر شد`,
			)
		}
		return sub
	} catch (err) {
		// رد صریح مرورگر (مثلاً AbortError فایرفاکس) — گزارش + علت دقیق
		console.warn(
			'[push] pushManager.subscribe رد شد:',
			err instanceof Error ? `${err.name}: ${err.message}` : err,
		)
		return null
	}
}

interface SubscriptionJson {
	endpoint?: string
	keys?: { p256dh?: string; auth?: string }
}

/** POST ثبت اشتراک در سرور — خروجی: کد وضعیت | null(شبکه) */
async function postSubscription(
	sub: PushSubscription,
	isCurrent: IsCurrent,
): Promise<Response | null> {
	if (!isCurrent()) return null
	const raw = sub.toJSON() as SubscriptionJson
	if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
		console.warn('[push] ساختار اشتراک ناقص است (endpoint/keys)')
		return null
	}
	return authedPushFetch(
		`${apiBase()}/notifications/subscriptions`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				endpoint: raw.endpoint,
				keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
			}),
		},
		isCurrent,
	)
}

/**
 * stage-58 — ثبتِ نهاییِ اشتراک در سرور + «بازیابی ۴۰۹»:
 *  • 409 PUSH_SUB_OWNED = این endpoint قبلاً به حساب دیگری تعلق داشته
 *    (مرورگرِ اشتراکی/تبادل حساب). اشتراک محلی را unsub می‌کنیم، یکی
 *    تازه می‌سازیم و دوباره ثبت می‌کنیم — قبلاً این حالت گرهِ ابدی
 *    failureReason:'register' بود و پوشِ حسابِ قبلی بی‌صدا می‌آمد.
 *  • 401 = کاربر لاگین نیست (مهمان) — pendingLogin، بعد از لاگین ثبت می‌شود.
 * خروجی: 'ok' | 'guest' | 'register-failed'
 */
async function registerOnServer(
	reg: ServiceWorkerRegistration,
	sub: PushSubscription,
	isCurrent: IsCurrent,
): Promise<'ok' | 'guest' | 'register-failed'> {
	let res = await postSubscription(sub, isCurrent)
	if (res === null || !isCurrent()) return 'register-failed'

	// ── گره‌ی ۴۰۹: اشتراکِ متعلق به حساب قبلی — بازسازی تازه ──
	if (res.status === 409) {
		// stage-77 — بدنه زیرِ مهلت؛ خطا/مهلت/بدنه‌ی بی-کد = فرضِ «متعلق به
		// دیگری» (محافظه‌کارانه‌ی قبلی — ۴۰۹ از این مسیر فقط همین معنی را دارد)
		const body = await readJsonWithTimeout<{ error?: { code?: string } }>(
			res,
			FETCH_TIMEOUT_MS,
			{},
		)
		const owned =
			body.error?.code === 'PUSH_SUB_OWNED' || body.error?.code === undefined
		if (owned) {
			if (!isCurrent()) return 'register-failed'
			console.warn('[push] اشتراک به حساب دیگری تعلق داشت — بازسازی تازه')
			try {
				if (!(await withTimeout(sub.unsubscribe(), GETSTATE_TIMEOUT_MS, false)))
					return 'register-failed'
			} catch {
				return 'register-failed'
			}
			const fresh = await obtainLocalSubscription(reg, isCurrent)
			if (fresh) {
				res = await postSubscription(fresh, isCurrent)
				if (res?.ok && isCurrent()) return 'ok'
				if (res?.status === 401) return 'guest'
			}
			return 'register-failed'
		}
		return 'register-failed'
	}

	// ── مهمان: توکنی نیست و refresh هم جواب نداد — بعد از لاگین ──
	if (res.status === 401) return 'guest'

	if (!res.ok) {
		// گزارش شفاف — علت واقعی دیگر بی‌صدا نیست (بدون توکن در لاگ)
		console.warn('[push] ثبت اشتراک ناموفق:', `HTTP ${res.status}`)
		return 'register-failed'
	}
	return 'ok'
}

/** درخواست permission + subscribe + ثبت در بک‌اند (مسیر دستی/خودکار) */
export function enablePush(): Promise<PushState> {
	return runPushOperation(enablePushCurrent)
}

async function enablePushCurrent(isCurrent: IsCurrent): Promise<PushState> {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
		return { state: 'unsupported', reason: 'no-sw' }
	}
	if (!('Notification' in window) || !('PushManager' in window)) {
		return { state: 'unsupported', reason: 'no-push-api' }
	}
	// iOS غیرنصب‌شده — پیام روشن بده نه خطای خام
	const isIos =
		/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	const isStandalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		(window.navigator as unknown as { standalone?: boolean }).standalone ===
			true
	if (isIos && !isStandalone) {
		return { state: 'unsupported', reason: 'ios-installed-only' }
	}

	try {
		const permission = await Notification.requestPermission()
		if (!isCurrent()) return inactiveState()
		if (permission !== 'granted') {
			return permission === 'denied'
				? { state: 'denied' }
				: { state: 'default' }
		}

		// stage-50 — SW: اول ثبت‌شده را ببین (سریع)؛ نبود ⇒ همین‌جا ثبت
		// sw-push.js؛ فقط بعدش منتظر فعال‌شدن بمان.
		let reg = await ensurePushRegistration()
		if (reg) reg = (await readyWithTimeout(READY_TIMEOUT_MS)) ?? reg
		if (!reg || !isCurrent())
			return { state: 'granted', subscribed: false, failureReason: 'subscribe' }

		let sub = await withTimeout(
			reg.pushManager.getSubscription(),
			GETSTATE_TIMEOUT_MS,
			null,
		).catch(() => null)
		if (!sub) {
			sub = await obtainLocalSubscription(reg, isCurrent)
			if (!sub) {
				return {
					state: 'granted',
					subscribed: false,
					failureReason: 'subscribe',
				}
			}
		}

		const outcome = await registerOnServer(reg, sub, isCurrent)
		if (outcome === 'ok') return { state: 'granted', subscribed: true }
		if (outcome === 'guest') {
			// stage-58 — مهمان: اشتراک محلی ساخته شد؛ ثبت سرور بعد از لاگین
			return { state: 'granted', subscribed: false, pendingLogin: true }
		}
		return { state: 'granted', subscribed: false, failureReason: 'register' }
	} catch (err) {
		console.error('[push] enablePush ناموفق:', err)
		return { state: 'granted', subscribed: false, failureReason: 'register' }
	}
}

/**
 * stage-58 — آشتیِ وضعیت برای کاربرِ لاگین‌شده:
 * «اشتراک محلی هست؟ سرور همین را دارد؟» — فقط در نبودش POST می‌زند.
 * GET push-status خودش ارزان است (SELECT کوچک) و POST فقط وقتی واقعاً
 * لازم است رخ می‌دهد (نرخ‌سقف ۲۰/min/IP هم برای NATها نگرانی نیست).
 */
export function reconcileSubscription(): Promise<PushState> {
	return runPushOperation(reconcileSubscriptionCurrent)
}

async function reconcileSubscriptionCurrent(
	isCurrent: IsCurrent,
): Promise<PushState> {
	if (
		typeof window === 'undefined' ||
		!('serviceWorker' in navigator) ||
		!('PushManager' in window)
	) {
		return { state: 'unsupported', reason: 'no-push-api' }
	}
	if (!('Notification' in window)) {
		return { state: 'unsupported', reason: 'no-notification-api' }
	}
	if (Notification.permission !== 'granted') {
		return Notification.permission === 'denied'
			? { state: 'denied' }
			: { state: 'default' }
	}
	try {
		const reg = await ensurePushRegistration()
		if (!reg || !isCurrent()) return inactiveState()

		const sub = await withTimeout(
			reg.pushManager.getSubscription(),
			GETSTATE_TIMEOUT_MS,
			null,
		).catch(() => null)
		if (!sub || !isCurrent()) return inactiveState()

		// سرور چه اشتراک‌هایی برای «این کاربر» دارد؟ (لاگین‌نشده = 401)
		const statusRes = await authedPushFetch(
			`${apiBase()}/notifications/push-status`,
			{
				method: 'GET',
			},
			isCurrent,
		)
		if (!isCurrent()) return inactiveState()
		if (statusRes === null) {
			return { state: 'granted', subscribed: false, failureReason: 'register' }
		}
		if (statusRes.status === 401) {
			// مهمان — بعد از لاگین reconcile دوباره صدا زده می‌شود
			return { state: 'granted', subscribed: false, pendingLogin: true }
		}
		if (!statusRes.ok) {
			return { state: 'granted', subscribed: false, failureReason: 'register' }
		}
		// stage-77 — بدنه زیرِ مهلت؛ نامفهوم/مهلت = همان تصمیمِ محافظه‌کارانه
		const body = await readJsonWithTimeout<{ endpoints?: string[] } | null>(
			statusRes,
			FETCH_TIMEOUT_MS,
			null,
		)
		if (body === null || !Array.isArray(body.endpoints)) {
			/* بدنه‌ی نامفهوم — محافظه‌کارانه: POST نمی‌زنیم */
			return { state: 'granted', subscribed: false }
		}
		const endpoints: string[] = body.endpoints

		if (!isCurrent()) return inactiveState()

		if (endpoints.includes(sub.endpoint)) {
			return { state: 'granted', subscribed: true }
		}
		// سرور ندارد — ثبت (با بازیابی ۴۰۹)
		const outcome = await registerOnServer(reg, sub, isCurrent)
		if (outcome === 'ok') return { state: 'granted', subscribed: true }
		if (outcome === 'guest')
			return { state: 'granted', subscribed: false, pendingLogin: true }
		return { state: 'granted', subscribed: false, failureReason: 'register' }
	} catch (err) {
		console.error('[push] reconcile ناموفق:', err)
		return { state: 'granted', subscribed: false, failureReason: 'register' }
	}
}

/** لغو اشتراک — هم مرورگر هم بک‌اند */
export async function disablePush(): Promise<PushState> {
	pushSuspended = true
	++pushGeneration
	try {
		const reg = await getRegistrationFast()
		const sub = reg
			? await withTimeout(
					reg.pushManager.getSubscription(),
					GETSTATE_TIMEOUT_MS,
					null,
				)
			: null
		if (sub) {
			try {
				// Use the existing identity without refreshing it during logout. Local
				// unsubscribe in finally also cuts delivery when the server is unreachable.
				const headers = new Headers({ 'content-type': 'application/json' })
				const token = getAccessToken()
				if (token) headers.set('authorization', `Bearer ${token}`)
				await withTimeout(
					fetchWithTimeout(
						`${apiBase()}/notifications/subscriptions`,
						{
							method: 'DELETE',
							headers,
							credentials: 'include',
							body: JSON.stringify({ endpoint: sub.endpoint }),
						},
						{ timeoutMs: FETCH_TIMEOUT_MS },
					),
					FETCH_TIMEOUT_MS,
					null,
				).catch(() => null)
			} finally {
				if (
					!(await withTimeout(sub.unsubscribe(), GETSTATE_TIMEOUT_MS, false))
				) {
					return {
						state: 'granted',
						subscribed: true,
						failureReason: 'register',
					}
				}
			}
		}
	} catch (err) {
		console.error('[push] disablePush ناموفق:', err)
	}
	return inactiveState()
}

// ── helpers ──

/** base64url → Uint8Array<ArrayBuffer> برای applicationServerKey (BufferSource) */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
	const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
	const raw = atob(padded)
	const out = new Uint8Array(new ArrayBuffer(raw.length))
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
	return out
}
