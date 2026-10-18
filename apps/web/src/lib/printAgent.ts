// QZ Tray's unsigned protocol keeps printer selection local to this device.
// QZ asks the user to approve requests. A signing private key must never be
// shipped in this public bundle; unattended printing needs a trusted server
// signer and its own deployment configuration.

export type PrintAgentStatus = 'idle' | 'connecting' | 'ready' | 'unavailable'

interface PendingCall {
	resolve: (value: unknown) => void
	reject: (err: Error) => void
	timer: ReturnType<typeof setTimeout>
}

const AGENT_SOCKETS = ['wss://localhost:8181', 'ws://localhost:8182']
const CONNECT_TIMEOUT_MS = 1_500
// Leave time to approve QZ's connection and request prompts.
const CALL_TIMEOUT_MS = 30_000
const PRINT_CALL_TIMEOUT_MS = 60_000
const KEEPALIVE_MS = 25_000

let socket: WebSocket | null = null
let keepAliveTimer: ReturnType<typeof setInterval> | null = null
let status: PrintAgentStatus = 'idle'
let connecting: Promise<boolean> | null = null
let connectionGeneration = 0
let uidCounter = 0
const pending = new Map<string, PendingCall>()
const listeners = new Set<(s: PrintAgentStatus) => void>()

function setStatus(next: PrintAgentStatus) {
	status = next
	for (const fn of listeners) fn(next)
}

export function getPrintAgentStatus(): PrintAgentStatus {
	return status
}

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

function rejectAll(message: string) {
	for (const entry of pending.values()) {
		clearTimeout(entry.timer)
		entry.reject(new Error(message))
	}
	pending.clear()
}

function handleMessage(raw: string) {
	let parsed: { uid?: string; result?: unknown; error?: string } | null
	try {
		parsed = JSON.parse(raw) as typeof parsed
	} catch {
		return
	}
	if (!parsed || typeof parsed.uid !== 'string') return
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

function clearKeepAlive() {
	if (keepAliveTimer !== null) {
		clearInterval(keepAliveTimer)
		keepAliveTimer = null
	}
}

function wireSocket(ws: WebSocket) {
	socket = ws
	ws.onmessage = (evt) => {
		if (socket === ws && typeof evt.data === 'string') handleMessage(evt.data)
	}
	ws.onclose = () => {
		// A previous connection can finish closing after its replacement opens.
		if (socket !== ws) return
		socket = null
		clearKeepAlive()
		rejectAll('اتصالِ سرویس چاپ قطع شد')
		setStatus('unavailable')
	}
	ws.onerror = () => {
		// The close event handles pending calls and status.
	}
	clearKeepAlive()
	keepAliveTimer = setInterval(() => {
		if (socket === ws && ws.readyState === WebSocket.OPEN) {
			try {
				ws.send('ping')
			} catch {
				ws.close()
			}
		}
	}, KEEPALIVE_MS)
}

function openSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url)
		let settled = false
		const fail = (message: string) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			ws.onopen = ws.onerror = ws.onclose = null
			try {
				ws.close()
			} catch {
				// Already closed.
			}
			reject(new Error(message))
		}
		const timer = setTimeout(() => fail('connect timeout'), CONNECT_TIMEOUT_MS)
		ws.onopen = () => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(ws)
		}
		ws.onerror = () => fail('connect failed')
		ws.onclose = () => fail('connect closed')
	})
}

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
		try {
			ws.send(
				JSON.stringify({
					...message,
					uid,
					timestamp: message.timestamp ?? Date.now(),
					position: screenPosition(),
				}),
			)
		} catch (err) {
			clearTimeout(timer)
			pending.delete(uid)
			reject(
				err instanceof Error ? err : new Error('ارسالِ درخواست چاپ ناموفق بود'),
			)
		}
	})
}

function callAgent(
	call: string,
	params: unknown,
	timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
	if (status !== 'ready') {
		return Promise.reject(new Error('سرویس چاپ آماده نیست — دوباره تلاش کنید'))
	}
	// Matches qz-tray.js's default certificate/signature providers.
	return sendAndWait(
		{ call, params, signature: '', signAlgorithm: 'SHA1' },
		timeoutMs,
	)
}

async function establishConnection(generation: number): Promise<boolean> {
	for (const url of AGENT_SOCKETS) {
		if (generation !== connectionGeneration) return false
		let ws: WebSocket
		try {
			ws = await openSocket(url)
		} catch {
			continue
		}
		if (generation !== connectionGeneration) {
			ws.close()
			return false
		}
		wireSocket(ws)
		try {
			await sendAndWait({ certificate: null }, CALL_TIMEOUT_MS)
			if (
				generation !== connectionGeneration ||
				socket !== ws ||
				ws.readyState !== WebSocket.OPEN
			)
				return false
			setStatus('ready')
			return true
		} catch {
			if (socket === ws) {
				socket = null
				clearKeepAlive()
			}
			try {
				ws.close()
			} catch {
				// Already closed.
			}
		}
	}
	if (generation === connectionGeneration) setStatus('unavailable')
	return false
}

export function connectPrintAgent(): Promise<boolean> {
	if (status === 'ready' && socket?.readyState === WebSocket.OPEN)
		return Promise.resolve(true)
	if (connecting) return connecting
	if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
		setStatus('unavailable')
		return Promise.resolve(false)
	}
	setStatus('connecting')
	const attempt = establishConnection(connectionGeneration).finally(() => {
		if (connecting === attempt) connecting = null
	})
	connecting = attempt
	return attempt
}

export function disconnectPrintAgent(): void {
	connectionGeneration += 1
	connecting = null
	clearKeepAlive()
	rejectAll('اتصال چاپ بسته شد')
	const ws = socket
	socket = null
	try {
		ws?.close()
	} catch {
		// Already closed.
	}
	setStatus('idle')
}

export async function listAgentPrinters(): Promise<string[]> {
	const result = await callAgent('printers.find', { query: null })
	if (Array.isArray(result)) {
		return [
			...new Set(
				result.filter(
					(x): x is string => typeof x === 'string' && x.length > 0,
				),
			),
		]
	}
	if (typeof result === 'string' && result.length > 0) return [result]
	return []
}

export async function agentPrintHtml(
	printerName: string,
	html: string,
	opts?: { heightMm?: number; jobName?: string },
): Promise<void> {
	const height = opts?.heightMm
	const size = {
		width: 80,
		height:
			height !== undefined && Number.isFinite(height) && height > 0
				? Math.min(Math.max(Math.ceil(height), 40), 297)
				: 297,
	}
	await callAgent(
		'print',
		{
			printer: { name: printerName },
			options: {
				units: 'mm',
				size,
				...(opts?.jobName !== undefined ? { jobName: opts.jobName } : {}),
			},
			data: [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }],
		},
		PRINT_CALL_TIMEOUT_MS,
	)
}
