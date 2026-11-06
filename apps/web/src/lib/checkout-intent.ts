import type { CheckoutInput } from '@sinshin/shared'

const STORAGE_KEY = 'sinshin:checkout-intent'
const MAX_AGE_MS = 48 * 60 * 60 * 1000
interface Intent { key: string; payload: string; createdAt: number; orderId?: string }
let memory: Intent | null = null

function readIntent(): Intent | null {
  if (memory) return memory
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Intent>
    if (typeof parsed.key === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(parsed.key) &&
        typeof parsed.payload === 'string' && typeof parsed.createdAt === 'number' &&
        Number.isFinite(parsed.createdAt) &&
        (parsed.orderId === undefined || (typeof parsed.orderId === 'string' && parsed.orderId.length > 0))) return parsed as Intent
  } catch { /* optional storage */ }
  return null
}

/** Retry a lost checkout response; a known order allows an independent purchase, even with identical contents. */
export function checkoutIntentKey(input: CheckoutInput): string {
  const payload = JSON.stringify(input)
  const previous = readIntent()
  const now = Date.now()
  if (!previous?.orderId && previous?.payload === payload && now >= previous.createdAt && now - previous.createdAt < MAX_AGE_MS) {
    memory = previous
    return previous.key
  }
  const key = globalThis.crypto?.randomUUID?.() ??
    `idm-${now}-${Math.random().toString(36).slice(2, 12)}`
  memory = { key, payload, createdAt: now }
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory)) } catch { /* in-memory retry */ }
  return key
}

/** Older responses cannot replace a newer checkout's browser state. */
export function checkoutIntentIsCurrent(key: string): boolean {
  return readIntent()?.key === key
}

/** Bind only the request that received this durable order response. */
export function completeCheckoutIntent(key: string, orderId: string): void {
  const previous = readIntent()
  if (!orderId || previous?.key !== key) return
  memory = { ...previous, orderId }
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory)) } catch { /* use memory */ }
}

export function clearCheckoutIntent(orderId?: string): void {
  if (orderId !== undefined && readIntent()?.orderId !== orderId) return
  memory = null
  try { sessionStorage.removeItem(STORAGE_KEY) } catch {
    // A blocked removal must not let an old stored key win over this tombstone.
    memory = { key: '', payload: '', createdAt: 0 }
  }
}
