import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '#/infra/db/client'
import { payments, type PaymentRow } from '#/infra/db/schema'
import type { GatewayVerifyResult, PaymentGateway } from './gateway.types'

type Verification = {
  reference: string | null
  amount: number
  gateway: string
  mode: string
  queryKey: string
  failures: number
  token?: string
  leaseUntil?: string
  nextAt?: string
  checkedAt?: string
  result?: GatewayVerifyResult
}

const unknown = (reference: string | null): GatewayVerifyResult => ({
  success: false, gatewayRef: reference, indeterminate: true,
})

/** A database lease limits background PSP calls across workers and requests.
 * Financial state is still finalized by PaymentService under settlement locks.
 * Scheduling writes deliberately do not change the payment business revision. */
export class PaymentVerification {
  constructor(private readonly db: Db, private readonly timeoutMs: number) {}

  async verify(
    payment: PaymentRow,
    gateway: PaymentGateway,
    query: Record<string, string> = {},
    callback = false,
  ): Promise<GatewayVerifyResult> {
    const [current] = await this.db.select().from(payments).where(eq(payments.id, payment.id))
    if (!current || current.gatewayRef !== payment.gatewayRef || current.amount !== payment.amount ||
      current.gateway !== payment.gateway || current.mode !== payment.mode ||
      current.userId !== payment.userId || current.orderId !== payment.orderId) {
      return unknown(payment.gatewayRef)
    }
    const raw = current.metadata?.verification
    const savedQuery = current.metadata?.callbackQuery
    const effectiveQuery = !callback && Object.keys(query).length === 0
      ? this.retryQuery(savedQuery, payment.gateway) : query
    const queryKey = JSON.stringify(this.retryQuery(effectiveQuery, payment.gateway))
    const previous = this.read(raw, payment, queryKey)
    const now = Date.now()
    const token = crypto.randomUUID()
    const matches = and(
      eq(payments.id, payment.id),
      eq(payments.status, 'PENDING'),
      sql`${payments.gatewayRef} is not distinct from ${payment.gatewayRef}`,
      eq(payments.amount, payment.amount), eq(payments.gateway, payment.gateway),
      eq(payments.mode, payment.mode),
      eq(payments.userId, payment.userId), eq(payments.orderId, payment.orderId),
    )

    if (!callback) {
      if (current.status !== 'PENDING') return unknown(payment.gatewayRef)
      if (previous?.result && !previous.result.indeterminate) return previous.result
      if (this.future(previous?.leaseUntil, now) || this.future(previous?.nextAt, now)) {
        return unknown(payment.gatewayRef)
      }
      const claim: Verification = {
        reference: payment.gatewayRef, amount: payment.amount, gateway: payment.gateway, mode: payment.mode, queryKey,
        failures: previous?.failures ?? 0, token,
        // Allow an extra minute for provider handling and process scheduling.
        leaseUntil: new Date(now + Math.max(60_000, this.timeoutMs * 2 + 60_000)).toISOString(),
      }
      const [claimed] = await this.db.update(payments).set({
        metadata: this.metadata(claim),
      }).where(and(matches,
        sql`${payments.metadata}->'verification' is not distinct from ${raw ?? null}::jsonb`,
        sql`${payments.metadata}->'callbackQuery' is not distinct from ${savedQuery ?? null}::jsonb`,
      )).returning({ id: payments.id })
      if (!claimed) return unknown(payment.gatewayRef)
    }

    // A callback can prove a charge after any deadline/backoff. It bypasses the
    // background lease, and its persistence makes that lease owner's CAS stale.
    let result: GatewayVerifyResult
    try {
      result = await gateway.verify({ paymentId: payment.id, gatewayRef: payment.gatewayRef,
        amount: payment.amount, query: effectiveQuery })
    } catch {
      result = unknown(payment.gatewayRef)
    }
    const failures = result.indeterminate ? Math.min((previous?.failures ?? 0) + 1, 7) : 0
    const verification: Verification = {
      reference: payment.gatewayRef, amount: payment.amount, gateway: payment.gateway, mode: payment.mode, queryKey,
      failures, checkedAt: new Date().toISOString(), result,
      ...(result.indeterminate ? {
        nextAt: new Date(Date.now() + Math.min(60_000 * 2 ** (failures - 1), 3_600_000)).toISOString(),
      } : {}),
    }
    const guard = callback
      ? !result.success
        // An older unknown callback must not discard conclusive PSP evidence.
        ? sql`not coalesce((
            ${payments.metadata}->'verification'->>'reference' is not distinct from ${payment.gatewayRef}
            and ${payments.metadata}->'verification'->>'amount' = ${String(payment.amount)}
            and ${payments.metadata}->'verification'->>'gateway' = ${payment.gateway}
            and ${payments.metadata}->'verification'->>'mode' = ${payment.mode}
            and ${payments.metadata}->'verification'->'result'->>'indeterminate' is distinct from 'true'
            and ${result.indeterminate
              ? sql`${payments.metadata}->'verification'->'result'->>'success' in ('true', 'false')`
              : sql`${payments.metadata}->'verification'->'result'->>'success' = 'true'`}
          ), false)`
        : undefined
      : sql`${payments.metadata}->'verification'->>'token' = ${token}`
    const [persisted] = await this.db.update(payments).set({ metadata: this.metadata(verification) })
      .where(and(matches, guard, !callback
        ? sql`${payments.metadata}->'callbackQuery' is not distinct from ${savedQuery ?? null}::jsonb`
        : undefined))
      .returning({ id: payments.id })
    // A newer callback/lease can invalidate an unpaid verdict while the PSP
    // request is running. Never use that stale negative result to cancel.
    if (!persisted && !result.success) return unknown(payment.gatewayRef)
    return result
  }

  private metadata(verification: Verification) {
    return sql`jsonb_set(coalesce(${payments.metadata}, '{}'::jsonb), '{verification}', ${verification}::jsonb, true)`
  }

  private future(value: string | undefined, now: number): boolean {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now
  }

  private read(value: unknown, payment: PaymentRow, queryKey: string): Verification | undefined {
    if (!value || typeof value !== 'object') return undefined
    const item = value as Partial<Verification>
    if (item.reference !== payment.gatewayRef || item.amount !== payment.amount || item.gateway !== payment.gateway ||
      item.mode !== payment.mode || item.queryKey !== queryKey ||
      !Number.isInteger(item.failures) || item.failures! < 0 || item.failures! > 7) return undefined
    if (item.result && (typeof item.result.success !== 'boolean' ||
      (item.result.gatewayRef !== null && typeof item.result.gatewayRef !== 'string') ||
      (item.result.indeterminate !== undefined && typeof item.result.indeterminate !== 'boolean'))) return undefined
    return item as Verification
  }

  private retryQuery(value: unknown, gateway: string): Record<string, string> {
    const keys = gateway === 'MELLAT' ? ['ResCode', 'SaleOrderId', 'SaleReferenceId', 'RefId']
      : gateway === 'SEP' ? ['State', 'RefNum', 'ResNum', 'TerminalId'] : []
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const raw = value as Record<string, unknown>
    const query: Record<string, string> = {}
    for (const key of keys) {
      const found = raw[key] ?? Object.entries(raw).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]
      if (typeof found === 'string' && found.length <= 120) query[key] = found
    }
    return query
  }
}
