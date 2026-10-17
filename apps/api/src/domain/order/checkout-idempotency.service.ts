// src/domain/order/checkout-idempotency.service.ts
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { normalizeCouponCode, type CheckoutInput } from '@sinshin/shared'

import type { Db } from '#/infra/db/client'
import { checkoutIdempotency } from '#/infra/db/schema'

export type CheckoutClaim = { key: string; token: string }
export type IdempotencyClaim =
  | { kind: 'claimed'; token: string }
  | { kind: 'replay'; response: Record<string, unknown> }
  | { kind: 'in-flight' }
  | { kind: 'mismatch' }

/** Stable across JSON property order and omitted nullable fields. */
export function checkoutRequestHash(input: CheckoutInput): string {
  const canonical = JSON.stringify({
    items: input.items.map((item) => ({
      productId: item.productId.toLowerCase(),
      sizeId: item.sizeId?.toLowerCase() ?? null,
      quantity: item.quantity,
    })),
    deliveryType: input.deliveryType,
    useWallet: input.useWallet,
    addressId: input.deliveryType === 'DELIVERY' ? input.addressId?.toLowerCase() ?? null : null,
    customerNote: input.customerNote ?? null,
    couponCode: normalizeCouponCode(input.couponCode ?? '') || null,
    gatewayId: input.gatewayId?.trim().toUpperCase() || null,
  })
  return new Bun.CryptoHasher('sha256').update(canonical).digest('hex')
}

const STALE_CLAIM = sql`now() - interval '60 seconds'`

export class CheckoutIdempotency {
  constructor(private readonly deps: { db: Db }) {}

  async claim(userId: string, key: string, requestHash: string): Promise<IdempotencyClaim> {
    const { db } = this.deps
    const token = crypto.randomUUID()
    const inserted = await db.insert(checkoutIdempotency)
      .values({ userId, key, requestHash, claimToken: token })
      .onConflictDoNothing()
      .returning({ userId: checkoutIdempotency.userId })
    if (inserted.length > 0) return { kind: 'claimed', token }

    const [existing] = await db.select().from(checkoutIdempotency)
      .where(and(eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, key)))
    if (!existing) return { kind: 'in-flight' }
    if (existing.requestHash !== null && existing.requestHash !== requestHash) return { kind: 'mismatch' }
    if (existing.response !== null) return { kind: 'replay', response: existing.response }

    // Checkout holds this row lock until both its order and fallback response
    // commit. A slow live transaction cannot be reclaimed after the lease ages.
    const took = await db.update(checkoutIdempotency)
      .set({ claimToken: token, requestHash, claimedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, key),
        eq(checkoutIdempotency.claimToken, existing.claimToken),
        isNull(checkoutIdempotency.response), lt(checkoutIdempotency.claimedAt, STALE_CLAIM),
      ))
      .returning({ userId: checkoutIdempotency.userId })
    return took.length > 0 ? { kind: 'claimed', token } : { kind: 'in-flight' }
  }

  /** Enrich the already durable fallback with the gateway URL. Failure leaves
   * the committed order response available; it never permits a second order. */
  async complete(userId: string, claim: CheckoutClaim, response: Record<string, unknown>): Promise<void> {
    try {
      await this.deps.db.update(checkoutIdempotency)
        .set({ response, updatedAt: sql`now()` })
        .where(and(
          eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, claim.key),
          eq(checkoutIdempotency.claimToken, claim.token),
        ))
    } catch (err) {
      console.error('[idempotency] response enrichment failed; durable order response retained:', err)
    }
  }

  /** Release only this attempt, and only if no order was committed. */
  async release(userId: string, claim: CheckoutClaim): Promise<void> {
    try {
      await this.deps.db.delete(checkoutIdempotency)
        .where(and(
          eq(checkoutIdempotency.userId, userId), eq(checkoutIdempotency.key, claim.key),
          eq(checkoutIdempotency.claimToken, claim.token), isNull(checkoutIdempotency.response),
        ))
    } catch (err) {
      console.error('[idempotency] release failed:', err)
    }
  }
}
