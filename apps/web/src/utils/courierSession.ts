const KEY = 'courier-token'
const TTL_MS = 3 * 60 * 60 * 1000
type Session = { token: string; expiresAt: number }
let memorySession: Session | null = null
let initialized = false

export function getCourierToken(): string | null {
	if (typeof window === 'undefined') return null
	// Storage only bootstraps this tab. Once set/clear runs, an old readable
	// value must not override it when storage writes or removals have failed.
	if (!initialized) {
		initialized = true
		try {
			const raw = sessionStorage.getItem(KEY)
			if (raw) {
				const parsed: unknown = raw.startsWith('{')
					? JSON.parse(raw)
					: { token: raw, expiresAt: Date.now() + TTL_MS }
				if (parsed && typeof parsed === 'object' && 'token' in parsed && 'expiresAt' in parsed &&
					typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)) {
					memorySession = { token: parsed.token, expiresAt: parsed.expiresAt }
				}
			}
		} catch {
			// Keep authentication usable when private browsing blocks storage.
		}
	}
	if (!memorySession || memorySession.expiresAt <= Date.now()) {
		clearCourierToken()
		return null
	}
	return memorySession.token
}

export function setCourierToken(token: string): void {
	initialized = true
	memorySession = { token, expiresAt: Date.now() + TTL_MS }
	try { sessionStorage.setItem(KEY, JSON.stringify(memorySession)) } catch { /* memory fallback */ }
}

export function clearCourierToken(): void {
	initialized = true
	memorySession = null
	try { sessionStorage.removeItem(KEY) } catch { /* storage may be unavailable */ }
}
