import type { CheckoutItemInput } from '@sinshin/shared'
import { PENDING_CHECKOUT_KEY } from '#/types/site/checkout'

type PendingCheckout = { orderId: string; cartFingerprint: string | null }
let pendingCheckout: PendingCheckout | null = null
let memoryInitialized = false
let consumedOrderId: string | null = null

function cartFingerprint(items: readonly CheckoutItemInput[]): string {
  return JSON.stringify(items.map(item => [item.productId, item.sizeId ?? null, item.quantity])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
}

function readPendingCheckout(): PendingCheckout | null {
  if (memoryInitialized) return pendingCheckout
  try {
    const stored = sessionStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!stored) return null
    try {
      const parsed = JSON.parse(stored) as { orderId?: unknown; cartFingerprint?: unknown }
      return typeof parsed?.orderId === 'string'
        ? { orderId: parsed.orderId, cartFingerprint: typeof parsed.cartFingerprint === 'string' ? parsed.cartFingerprint : null }
        : null
    } catch {
      // Older clients stored only an order ID. It cannot prove which basket was submitted.
      return { orderId: stored, cartFingerprint: null }
    }
  } catch { return null }
}

/** Storage is optional; a completed checkout must still navigate to its order. */
export function rememberPendingCheckout(orderId: string, items?: readonly CheckoutItemInput[]): void {
  pendingCheckout = { orderId, cartFingerprint: items ? cartFingerprint(items) : null }
  memoryInitialized = true
  consumedOrderId = null
  try { sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pendingCheckout)) } catch { /* use memory */ }
}

/** Only the submitted basket may be removed when a late financial result arrives. */
export function pendingCheckoutMatchesCart(orderId: string, items: readonly CheckoutItemInput[]): boolean {
  if (consumedOrderId === orderId) return false
  const pending = readPendingCheckout()
  return pending?.orderId === orderId && pending.cartFingerprint !== null &&
    pending.cartFingerprint === cartFingerprint(items)
}

export function consumePendingCheckout(orderId: string): boolean {
  if (consumedOrderId === orderId) return false
  if (readPendingCheckout()?.orderId !== orderId) return false
  pendingCheckout = null
  memoryInitialized = true
  consumedOrderId = orderId
  try { sessionStorage.removeItem(PENDING_CHECKOUT_KEY) } catch { /* storage unavailable */ }
  return true
}
