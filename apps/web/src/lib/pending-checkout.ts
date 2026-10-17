import { PENDING_CHECKOUT_KEY } from '#/types/site/checkout'

let pendingOrderId: string | null = null
let consumedOrderId: string | null = null

/** Storage is optional; a completed checkout must still navigate to its order. */
export function rememberPendingCheckout(orderId: string): void {
  pendingOrderId = orderId
  consumedOrderId = null
  try { sessionStorage.setItem(PENDING_CHECKOUT_KEY, orderId) } catch { /* use memory */ }
}

export function consumePendingCheckout(orderId: string): boolean {
  if (consumedOrderId === orderId) return false
  let stored = pendingOrderId
  try { stored ??= sessionStorage.getItem(PENDING_CHECKOUT_KEY) } catch { /* use memory */ }
  if (stored !== orderId) return false
  pendingOrderId = null
  consumedOrderId = orderId
  try { sessionStorage.removeItem(PENDING_CHECKOUT_KEY) } catch { /* storage unavailable */ }
  return true
}
