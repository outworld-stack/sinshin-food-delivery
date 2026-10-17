// src/lib/printAgent.ts
// stage-85 — سرویس «چاپ مستقیم» بدون دیالوگِ مرورگر (الگوی POS پیشرفته).
//
// چرا؟ دیالوگ چاپِ مرورگر هر بار «انتخابِ پرینتر» می‌خواهد و مقصدِ انتخابیِ
// قبلی سراسری است — برای رستورانی با دو پرینتر (سالن + آشپزخانه) یعنی
// هر سفارش دو بار انتخابِ دستی. راه‌حلِ استانداردِ وب (همان الگویی که
// پنل‌های POS حرفه‌ای مثل کیت‌های اسنپ‌فود/چلو و الف‌فود به‌کار می‌برند)
// یک «عامل چاپ محلی» است: نرم‌افزار رایگانِ QZ Tray روی همان دستگاهِ
// صندوق نصب می‌شود و از طریق WebSocketِ لوکال، پرینترهای سیستم را به
// صفحه می‌دهد؛ ما فاکتور را مستقیم به «پرینترِ منتخبِ همان نوع فاکتور»
// می‌فرستیم — بدون هیچ دیالوگی.
//
// پروتکل: همان سیم‌کشیِ رسمیِ qz-tray.js (بدون هیچ وابستگی جدید):
//  • wss://localhost:8181 (صفحهٔ https — نیاز به پذیرشِ یک‌بارهٔ گواهیِ QZ)
//  • ws://localhost:8182  (پشتیبان — localhost برای مرورگر «قابل‌اعتماد» است)
//  • پیام‌ها: {call, params, timestamp, uid, signature, signAlgorithm, position}
//  • امضا: SHA-256(json({call, params, timestamp})) → رشتهٔ hex →
//    RSA PKCS1v1.5/SHA-1 روی «بایت‌های همان hex» — عینِ کتابخانهٔ رسمی.
//  • پیامِ نخستِ پس از اتصال: certificate (گواهیِ «سایت») — کاربر یک بار
//    در QZ Tray آن را تأیید می‌کند و برای همیشه whitelist می‌شود.
//  • بدونِ QZ Tray / بدونِ Secure Context / خطای امضا → مودال به مسیرِ
//    دیالوگِ مرورگر برمی‌گردد (رفتارِ قبلِ stage-85 دست‌نخورده).
//
// گواهی و کلیدِ «سین‌شین» پایین self-signed و مخصوصِ همین کار ساخته
// شده‌اند (CN=Sinshin Web Print). کلید در باندل عمومی است — امنیتِ این
// لایه همان تأییدِ یک‌بارهٔ کاربرِ همان دستگاه است، نه محرمانگیِ کلید.

/** وضعیت اتصال عامل چاپ (QZ Tray) */
export type PrintAgentStatus = 'idle' | 'connecting' | 'ready' | 'unavailable'

interface PendingCall {
	resolve: (value: unknown) => void
	reject: (err: Error) => void
	timer: ReturnType<typeof setTimeout>
}

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDaTCCAlGgAwIBAgIULxXEN9ulsrHxrum7/72/I4g47lUwDQYJKoZIhvcNAQEL
BQAwRDEaMBgGA1UEAwwRU2luc2hpbiBXZWIgUHJpbnQxGTAXBgNVBAoMEFNpbnNo
aW4gRm9vZHBhcmsxCzAJBgNVBAYTAklSMB4XDTI2MTAxNzIxMzgyM1oXDTM2MTAx
NDIxMzgyM1owRDEaMBgGA1UEAwwRU2luc2hpbiBXZWIgUHJpbnQxGTAXBgNVBAoM
EFNpbnNoaW4gRm9vZHBhcmsxCzAJBgNVBAYTAklSMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAsyEMo6BfndJpOsjUqfxC+7+rUVxZdsSUlh2FWSHlyh3G
NeHtMvkl1YprEfm1klYsiL/cJohnk9Ejt9dHdonoErMbtJK70jQhYDuGvp7RAvEU
UQyT3PqCjZfzoqYl6XvKqi//M2vBzD2q3Z8ujCVcrETrQSV1V5m8uBZJspsyWbph
SVZvjguu+14cV3rWpOBkWLxtXlOOpnWP/3+Xl2nmWTEvhWYwjjRY01EJ8Zv+Ts6l
GcWoRQuj6ZSrrzzQfwyNxKK4AoTViqxyxeWdWTjYmiQgaFSf74vTYM5rx8e4Z4fr
Sd/7T82KPDi28i4kYpcHqqeYHs2IxKYA5nEwYCsCpwIDAQABo1MwUTAdBgNVHQ4E
FgQU4IGCqADNPiHutP1jaAm08ZHgSCowHwYDVR0jBBgwFoAU4IGCqADNPiHutP1j
aAm08ZHgSCowDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEABOzk
VeQWtmb1atG0+6XtYTbnrbObtZjYvIeP+FBiqCLRHxr2pzrcEuE6R52zsgnOfqpJ
87sZ50FAKWHklVr/8Cj2Xu1XJqLYOpCvyc3OYBWrTSdwly3lXkKc/EUDGkoBK9NU
VGzCmwpUuJ8DpBOYxOcuZgYuc3R/ylNcdNX9EpVYvfnGoaB/22LBrDSaBzlEPsWM
DO/2Z3HrbvrmdsBHC7s/kdpzvNsV2Zy+ELZ80haCZtEiH31cYElmXslyAdrkaREo
fUv6vMWYf8MivCs+p1dItt2t7NFsNltNxJabUctw6+X6rvrGJ2MKSe+kUZYqjGSj
7PszmxdlWOlkEb1tEw==
-----END CERTIFICATE-----`

const KEY_PKCS8_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCzIQyjoF+d0mk6
yNSp/EL7v6tRXFl2xJSWHYVZIeXKHcY14e0y+SXVimsR+bWSViyIv9wmiGeT0SO3
10d2iegSsxu0krvSNCFgO4a+ntEC8RRRDJPc+oKNl/OipiXpe8qqL/8za8HMPard
ny6MJVysROtBJXVXmby4FkmymzJZumFJVm+OC677XhxXetak4GRYvG1eU46mdY//
f5eXaeZZMS+FZjCONFjTUQnxm/5OzqUZxahFC6PplKuvPNB/DI3EorgChNWKrHLF
5Z1ZONiaJCBoVJ/vi9NgzmvHx7hnh+tJ3/tPzYo8OLbyLiRilweqp5gezYjEpgDm
cTBgKwKnAgMBAAECggEAVxNvw3LISD3qbWsHBgLcxOgtbYWI79UrrbV4BxYVUCUd
H0BOQAMhQybgWYKboyFE0M0DRa/1OcPmqw15bcQoDj8G7saNiudQeik1nSAy1k0+
5Q9KKZeVMyN0idJeh5tnr0dZtTNip9gqYUVqKTJYVF3ERozg986CELK07J/I4BiL
uEQ+OW1iCUJOn3lfixYsa+BzttsmX/qhrtxIXoXb95lXxlG4fBLUztcTwUU4EqDM
4DvioMM4y/oCKNjROqPLGonlt8hREU5uF1di5KuBg7wYyt2km6z6ZhnqIIe8CP7d
ulRcYCdFZbvoaLH7bThB1HMWCzcdgWvPN04etY/KMQKBgQDdMN/f4DWTlPpyBxvS
W+cqcvbLkxeU61IBtte8D+uqqfTtYF7iCrdPGLT2NmFEUPilJiZEtug/MZxpB4aZ
fPaEyHI0jEYmTCeWah1UDXjo0kc5fC4y8Qy5mFEqYHiUgi9UPbaP3J23t3qX8zpx
Xj71CFOgdZQjGGds+BlJsSgBowKBgQDPUaEMw8bgMCVXd9OGjjHp5OWqWXFCEzOd
HyjqmQJNo/mVYXXzhP0SM3/BL7C+VP/vEYZ0kc3Av9q0QaKPHY9PsjzB/3pBC9WH
DcbB9XnIq1LH6cSetUuC3WVCWSKmeC6zzjjkB2Y6M9x+pcTh74CILIzOxe8wqlJG
swuonmfzLQKBgQCTueKraNkfee5SXcENG2gmh6WgjNrBEPEyR+WJqrBgySXVq/ly
ymlnID8r+WG4+MM3uWTxm589JWsrEmWo+TbDtAPiaJUpWs9NvA1eZ6kLBfWfxPot
96PiCIKc5NVjihcGEjltl5CWdKoh9cZglOtDR45iqmSHk/LvajupZfIsNQKBgBkS
sD2Q995pNDrt3QEq9VJqQnRluNLa66UW/aXRt3uYVzj/vnojHVA0NkEw+VkrgoBx
SCeU8qNbEKI4Rea1Fn32+m4j7a8sNTjOK7mNbJseTTasSQFAv88l43cwvIYRhuRs
DmlVk8F6QDJ47eS9SHgvmx/uxEzIbIbsZH6SGdRJAoGBAMJuHmLP2FltA1NWjU6n
LdSQdnK0ziwtNhhWB5Wr/QsiNOBmZvys4pC8GdiGxYiS963yef9KjBQlfDgbvRAm
SUdiA1A/C9yuBC8xqB7XB+xZYKl1fICbNPijavEUTusgvF2JYOhVRQDbn5Zqoms1
xbz+tDZYVdlBWn4ggJgdu8YG
-----END PRIVATE KEY-----`

/** پورت‌های QZ Tray — همان لیستِ کتابخانهٔ رسمی (اولین مورد کافی است؛
 *  ۸۱۸۱ امن، ۸۱۸۲ غیرامن برای صفحه‌های http یا گواهی‌پذیرفته‌نشده) */
const AGENT_SOCKETS = ['wss://localhost:8181', 'ws://localhost:8182']

/** مهلتِ برقراریِ اتصال به هر آدرس (ms) */
const CONNECT_TIMEOUT_MS = 1_500
/** مهلتِ پاسخِ هر فراخوانی (ms) — چاپِ HTML ممکن است روی سیستمِ کند
 *  چند ثانیه طول بکشد؛ پیامِ print تا ۳۰ ثانیه */
const CALL_TIMEOUT_MS = 12_000
const PRINT_CALL_TIMEOUT_MS = 30_000
/** نگه‌داشتنِ اتصال — همان «ping» خامِ کتابخانهٔ رسمی */
const KEEPALIVE_MS = 25_000

let socket: WebSocket | null = null
let keepAliveTimer: ReturnType<typeof setInterval> | null = null
let status: PrintAgentStatus = 'idle'
let signingKey: CryptoKey | null = null
let uidCounter = 0
const pending = new Map<string, PendingCall>()
const listeners = new Set<(s: PrintAgentStatus) => void>()

function setStatus(next: PrintAgentStatus) {
	status = next
	for (const fn of listeners) fn(next)
}

/** وضعیتِ فعلیِ عامل چاپ (بدون فراخوانیِ شبکه) */
export function getPrintAgentStatus(): PrintAgentStatus {
	return status
}

/** اطلاعِ تغییرِ وضعیت — برای رندرِ زندهٔ مودال */
export function subscribePrintAgentStatus(
	fn: (s: PrintAgentStatus) => void,
): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

function newUid(): string {
	uidCounter += 1
	return `s${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function screenPosition(): { x: number; y: number } {
	try {
		return {
			x: Math.round(
				(screen.availWidth || screen.width) / 2 + (window.screenLeft || 0),
			),
			y: Math.round(
				(screen.availHeight || screen.height) / 2 + (window.screenTop || 0),
			),
		}
	} catch {
		return { x: 0, y: 0 }
	}
}

function pemToBytes(pem: string): Uint8Array {
	const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')
	const raw = atob(b64)
	const out = new Uint8Array(raw.length)
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
	return out
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = ''
	for (const b of bytes) hex += b.toString(16).padStart(2, '0')
	return hex
}

function bytesToBase64(bytes: Uint8Array): string {
	let raw = ''
	for (const b of bytes) raw += String.fromCharCode(b)
	return btoa(raw)
}

async function getSigningKey(): Promise<CryptoKey | null> {
	if (signingKey) return signingKey
	try {
		signingKey = await crypto.subtle.importKey(
			'pkcs8',
			pemToBytes(KEY_PKCS8_PEM) as unknown as ArrayBuffer,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
			false,
			['sign'],
		)
		return signingKey
	} catch {
		// Secure Context نیست یا کلید نامعتبر — چاپ مستقیم تعطیل
		return null
	}
}

function rejectAll(message: string) {
	for (const entry of pending.values()) {
		clearTimeout(entry.timer)
		entry.reject(new Error(message))
	}
	pending.clear()
}

function handleMessage(raw: string) {
	let parsed: { uid?: string; result?: unknown; error?: string }
	try {
		parsed = JSON.parse(raw) as typeof parsed
	} catch {
		return
	}
	if (typeof parsed.uid !== 'string') return
	const entry = pending.get(parsed.uid)
	if (!entry) return
	pending.delete(parsed.uid)
	clearTimeout(entry.timer)
	if (typeof parsed.error === 'string' && parsed.error.length > 0) {
		entry.reject(new Error(parsed.error))
	} else {
		entry.resolve(parsed.result)
	}
}

function wireSocket(ws: WebSocket) {
	socket = ws
	ws.onmessage = (evt) => {
		if (typeof evt.data === 'string') handleMessage(evt.data)
	}
	ws.onclose = () => {
		if (socket === ws) socket = null
		if (keepAliveTimer !== null) {
			clearInterval(keepAliveTimer)
			keepAliveTimer = null
		}
		rejectAll('اتصالِ سرویس چاپ قطع شد')
		setStatus('unavailable')
	}
	ws.onerror = () => {
		// onclose همیشه بعدش می‌آید — پاک‌سازی همان‌جا
	}
	if (keepAliveTimer !== null) clearInterval(keepAliveTimer)
	keepAliveTimer = setInterval(() => {
		if (socket === ws && ws.readyState === WebSocket.OPEN) {
			// همان خامِ کتابجهٔ رسمی — سِرِ زنده‌ماندنِ سوکت
			ws.send('ping')
		}
	}, KEEPALIVE_MS)
}

async function openSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url)
		const timer = setTimeout(() => {
			ws.close()
			reject(new Error('connect timeout'))
		}, CONNECT_TIMEOUT_MS)
		ws.onopen = () => {
			clearTimeout(timer)
			resolve(ws)
		}
		ws.onerror = () => {
			clearTimeout(timer)
			reject(new Error('connect failed'))
		}
		ws.onclose = () => {
			clearTimeout(timer)
			reject(new Error('connect closed'))
		}
	})
}

/** فرستادنِ یک پیامِ ازپیش‌ساخته (بدون امضا — پیامِ گواهی) و انتظارِ پاسخ */
function sendAndWait(
	message: Record<string, unknown>,
	timeoutMs: number,
): Promise<unknown> {
	const ws = socket
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		return Promise.reject(new Error('سرویس چاپ متصل نیست'))
	}
	return new Promise((resolve, reject) => {
		const uid = newUid()
		const timer = setTimeout(() => {
			pending.delete(uid)
			reject(new Error('پاسخِ سرویس چاپ طولانی شد'))
		}, timeoutMs)
		pending.set(uid, { resolve, reject, timer })
		message.uid = uid
		message.timestamp = Date.now()
		message.position = screenPosition()
		ws.send(JSON.stringify(message))
	})
}

/**
 * فراخوانیِ امضاشده — عینِ dataPromise کتابجهٔ رسمی:
 * canonical = json({call, params, timestamp}) → sha256 → hex →
 * امضا با RSA PKCS1v1.5/SHA-1 → base64. signAlgorithm: 'SHA1'.
 */
async function callAgent(
	call: string,
	params: unknown,
	timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
	const key = await getSigningKey()
	if (!key) throw new Error('امضای درخواست ممکن نیست (Secure Context لازم است)')
	const timestamp = Date.now()
	// ترتیبِ کلیدها عمداً ثابت است — سرورِ QZ همین ترتیب را بازسازی می‌کند
	const canonical = JSON.stringify({ call, params, timestamp })
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonical) as unknown as ArrayBuffer,
	)
	const hex = bytesToHex(new Uint8Array(digest))
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(hex) as unknown as ArrayBuffer,
	)
	return sendAndWait(
		{
			call,
			params,
			signature: bytesToBase64(new Uint8Array(signature)),
			signAlgorithm: 'SHA1',
		},
		timeoutMs,
	)
}

/**
 * برقراریِ اتصال با عامل چاپ (QZ Tray) — یک بار در هر باز شدنِ مودال
 * صدا زده می‌شود؛ true = آمادهٔ چاپ مستقیم. در نبودِ QZ Tray سریع و
 * بی‌صدا false می‌شود (مسیرِ مرورگر جایگزین می‌شود).
 */
export async function connectPrintAgent(): Promise<boolean> {
	if (socket?.readyState === WebSocket.OPEN) return true
	if (typeof WebSocket === 'undefined' || !window.isSecureContext) {
		setStatus('unavailable')
		return false
	}
	setStatus('connecting')
	for (const url of AGENT_SOCKETS) {
		let ws: WebSocket
		try {
			ws = await openSocket(url)
		} catch {
			continue
		}
		wireSocket(ws)
		try {
			// پیامِ گواهی — اولین فرصتِ تأیید/ردِ کاربر در QZ Tray
			await sendAndWait({ certificate: CERT_PEM }, CALL_TIMEOUT_MS)
			setStatus('ready')
			return true
		} catch {
			// کاربر رد کرد یا نسخه ناسازگار — این سوکت بی‌فایده است
			try {
				ws.close()
			} catch {
				// بسته بود
			}
			if (socket === ws) {
				socket = null
				if (keepAliveTimer !== null) {
					clearInterval(keepAliveTimer)
					keepAliveTimer = null
				}
			}
		}
	}
	setStatus('unavailable')
	return false
}

/** بستنِ اتصال (پاک‌سازی) */
export function disconnectPrintAgent(): void {
	if (keepAliveTimer !== null) {
		clearInterval(keepAliveTimer)
		keepAliveTimer = null
	}
	rejectAll('اتصال چاپ بسته شد')
	const ws = socket
	socket = null
	try {
		ws?.close()
	} catch {
		// بسته بود
	}
	setStatus('idle')
}

/** فهرستِ نامِ پرینترهای دستگاه (از QZ Tray) */
export async function listAgentPrinters(): Promise<string[]> {
	const result = await callAgent('printers.find', { query: null })
	if (Array.isArray(result)) {
		return result.filter((x): x is string => typeof x === 'string')
	}
	if (typeof result === 'string') return [result]
	return []
}

/**
 * چاپِ مستقیمِ یک سندِ HTML روی پرینترِ مشخص — بدونِ دیالوگ.
 * heightMm اختیاری طولِ کاغذ را «هم‌قدِ محتوا» می‌کند (مسیرِ fitHeight).
 */
export async function agentPrintHtml(
	printerName: string,
	html: string,
	opts?: { heightMm?: number; jobName?: string },
): Promise<void> {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		throw new Error('سرویس چاپ متصل نیست — دوباره تلاش کنید')
	}
	const size =
		opts?.heightMm !== undefined && opts.heightMm > 0
			? {
					width: 80,
					height: Math.min(Math.max(Math.ceil(opts.heightMm), 40), 297),
				}
			: undefined
	await callAgent(
		'print',
		{
			printer: { name: printerName },
			options: {
				units: 'mm',
				...(size !== undefined ? { size } : {}),
				...(opts?.jobName !== undefined ? { jobName: opts.jobName } : {}),
			},
			data: [
				{
					type: 'pixel',
					format: 'html',
					flavor: 'plain',
					data: html,
				},
			],
		},
		PRINT_CALL_TIMEOUT_MS,
	)
}
