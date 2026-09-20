//src/domain/reconcile/reconcile.service.ts
import { and, desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders, reconcileFindings } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { OrderService } from '#/domain/order/order.service'
import { asOrderId } from '#/domain/shared/brand'

export interface CheckResult {
    checkId: string
    severity: 'info' | 'warning' | 'critical'
    findings: Array<{
        entityType: 'order' | 'payment' | 'wallet_tx' | 'user'
        entityId: string
        detail: Record<string, unknown>
    }>
    /** فقط برای چک‌های flagged — چند تا اگر auto بود درست می‌شد */
    wouldFix: number
}

export interface ReconcileReport {
    ranAt: Date
    checks: CheckResult[]
    totalOpen: number
}

/**
 * مغایرت‌گیری مالی — ۱۰ چک، شغل ۰۳:۰۰ تهران.
 *
 * Flags per-check: RECONCILE_AUTO_R1..R10 (on/off) — پیش‌فرض همه off.
 * حالت off = report-only (R1 findings را می‌سازد ولی settle نمی‌زند؛
 * wouldFix می‌شمارد برای تصمیم).
 *
 * قرارداد برداشتِ سفارشی: wallet_tx با type='WITHDRAW' و orderId != null.
 * (برداشت واقعی کاربر — که فعلاً نداریم — orderId ندارد.)
 */
export class ReconcileService {
    constructor(
        private readonly deps: { db: Db; config: AppConfig; orders: OrderService },
    ) { }

    private autoFixEnabled(checkId: string): boolean {
        const key = `RECONCILE_AUTO_${checkId}`
        const v = (Bun.env[key] ?? '').trim().toLowerCase()
        return v === 'on' || v === 'true' || v === '1'
    }

    async run(): Promise<ReconcileReport> {
        const checks: CheckResult[] = []
        // ترتیب مهم نیست — هر چک مستقل
        checks.push(await this.r1PaymentSuccessOrderPending())
        checks.push(await this.r2OrderSuccessNoPayment())
        checks.push(await this.r3WalletPerOrder())
        checks.push(await this.r4OrderSuccessAnyNoPaymentRow())
        checks.push(await this.r5MultipleSuccessfulPayments())
        checks.push(await this.r6OrphanPayment())
        checks.push(await this.r7WalletTxWithoutOrder())
        checks.push(await this.r8NegativeBalance())
        checks.push(await this.r9AmountMismatch())
        checks.push(await this.r10StuckPending())

        let totalOpen = 0
        for (const c of checks) totalOpen += c.findings.length

        return { ranAt: new Date(), checks, totalOpen }
    }

    // ═══════════ R1: payment=SUCCESS اما order=PENDING_PAYMENT ═══════════

    /**
     * شرط‌های اعتماد قبل از settle مجدد:
     *  - فقط یک payment موفق برای این order (چک R5 هم می‌بیند، اینجا پیش‌شرط)
     *  - مبلغ payment == order.breakdown.amountPaidOnline (integer)
     *  - payment.user == order.user
     * Flag on → settle با claim اتمیک (settlePayment خودش idempotent است:
     *   WHERE status='PENDING_PAYMENT' — رقابت = no-op).
     */
    private async r1PaymentSuccessOrderPending(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select p.id as payment_id, p.order_id, p.amount, p.user_id,
             o.id as oid, o.status, o.display_id, o.user_id as order_user,
             o.breakdown
      from payments p
      join orders o on o.id = p.order_id
      where p.status = 'SUCCESS'
        and o.status = 'PENDING_PAYMENT'
    `)) as unknown as Array<{
            payment_id: string; order_id: string; amount: number; user_id: string
            oid: string; status: string; display_id: string; order_user: string
            breakdown: unknown
        }>

        const findings: CheckResult['findings'] = []
        let wouldFix = 0

        for (const row of rows) {
            const okCount = (await this.deps.db.execute(sql`
        select count(*)::int as c from payments
        where order_id = ${row.order_id} and status = 'SUCCESS'
      `)) as unknown as Array<{ c: number }>
            const onlyOne = (okCount[0]?.c ?? 0) === 1

            // Bun.sql ممکن است jsonb را string برگرداند — parse اگر لازم بود
            const bd =
                typeof row.breakdown === 'string'
                    ? (JSON.parse(row.breakdown) as { amountPaidOnline: number })
                    : (row.breakdown as { amountPaidOnline: number })
            const amountMatch = row.amount === bd.amountPaidOnline
            const userMatch = row.user_id === row.order_user

            if (!onlyOne || !amountMatch || !userMatch) {
                findings.push({
                    entityType: 'payment',
                    entityId: row.payment_id,
                    detail: {
                        reason: 'trust-check-failed',
                        onlyOne, amountMatch, userMatch,
                        orderDisplayId: row.display_id,
                        paymentAmount: row.amount,
                        expected: bd.amountPaidOnline,
                    },
                })
                continue
            }

            findings.push({
                entityType: 'payment',
                entityId: row.payment_id,
                detail: {
                    orderDisplayId: row.display_id,
                    amount: row.amount,
                    trustVerified: true,
                },
            })
            wouldFix++

            if (this.autoFixEnabled('R1')) {
                await this.tryAutoSettle(row.order_id, row.display_id)
            }
        }

        return { checkId: 'R1', severity: 'critical', findings, wouldFix }
    }

    private async tryAutoSettle(orderId: string, displayId: string): Promise<void> {
        try {
            await this.deps.db.transaction(async (tx) => {
                const order = (
                    await tx.select().from(orders).where(eq(orders.id, asOrderId(orderId)))
                )[0]
                if (!order || order.status !== 'PENDING_PAYMENT') return // هم‌زمان settle شد
                await this.deps.orders.settlePayment(tx, order)
            })
            console.log(`[reconcile] R1 auto-fixed ${displayId}`)
        } catch (e) {
            console.error(`[reconcile] R1 auto-fix failed for ${displayId}:`, e)
        }
    }

    // ═══════════ R2: order.paymentStatus=SUCCESS بدون payment موفق ═══════════

    private async r2OrderSuccessNoPayment(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select o.id, o.display_id
      from orders o
      where o.payment_status = 'SUCCESS'
        and not exists (
          select 1 from payments p
          where p.order_id = o.id and p.status = 'SUCCESS'
        )
    `)) as unknown as Array<{ id: string; display_id: string }>

        return {
            checkId: 'R2',
            severity: 'critical',
            findings: rows.map((r) => ({
                entityType: 'order' as const,
                entityId: r.id,
                detail: { orderDisplayId: r.display_id, note: 'payment row missing — manual review' },
            })),
            wouldFix: 0, // تشخیصی — هرگز auto
        }
    }

    // ═══════════ R3: per-order wallet deduction mismatch ═══════════

    private async r3WalletPerOrder(): Promise<CheckResult> {
        // برداشتِ سفارشی = type WITHDRAW + orderId — فقط این‌ها با breakdown مقایسه می‌شوند
        const rows = (await this.deps.db.execute(sql`
      select o.id, o.display_id,
             o.breakdown->>'walletDeduction' as promised,
             (select coalesce(sum(w.amount), 0)::int from wallet_transactions w
              where w.order_id = o.id and w.type = 'WITHDRAW') as actual
      from orders o
      where o.payment_status = 'SUCCESS'
    `)) as unknown as Array<{
            id: string; display_id: string; promised: string; actual: number
        }>

        const findings: CheckResult['findings'] = []
        for (const r of rows) {
            const promised = Number(r.promised) // integer در jsonb — بدون float
            if (promised !== r.actual) {
                findings.push({
                    entityType: 'order',
                    entityId: r.id,
                    detail: {
                        orderDisplayId: r.display_id,
                        promisedWalletDeduction: promised,
                        actualWithdrawTotal: r.actual,
                    },
                })
            }
        }
        return { checkId: 'R3', severity: 'critical', findings, wouldFix: 0 }
    }

    // ═══════════ R4: order موفق بدون هیچ ردیف payment ═══════════

    private async r4OrderSuccessAnyNoPaymentRow(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select o.id, o.display_id
      from orders o
      where o.status <> 'PENDING_PAYMENT' and o.status <> 'CANCELED'
        and not exists (select 1 from payments p where p.order_id = o.id)
    `)) as unknown as Array<{ id: string; display_id: string }>

        return {
            checkId: 'R4',
            severity: 'warning',
            findings: rows.map((r) => ({
                entityType: 'order' as const,
                entityId: r.id,
                detail: { orderDisplayId: r.display_id },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R5: چند payment موفق برای یک order ═══════════

    private async r5MultipleSuccessfulPayments(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select order_id, count(*)::int as c
      from payments where status = 'SUCCESS'
      group by order_id having count(*) > 1
    `)) as unknown as Array<{ order_id: string; c: number }>

        return {
            checkId: 'R5',
            severity: 'critical',
            findings: rows.map((r) => ({
                entityType: 'payment' as const,
                entityId: r.order_id,
                detail: { successfulPayments: r.c },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R6: payment یتیم ═══════════

    private async r6OrphanPayment(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select p.id
      from payments p
      where not exists (select 1 from orders o where o.id = p.order_id)
    `)) as unknown as Array<{ id: string }>

        return {
            checkId: 'R6',
            severity: 'critical',
            findings: rows.map((r) => ({
                entityType: 'payment' as const,
                entityId: r.id,
                detail: { note: 'payment without order' },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R7: تراکنش wallet بدون order (غیر DEPOSIT) ═══════════

    private async r7WalletTxWithoutOrder(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select w.id, w.type, w.description
      from wallet_transactions w
      where w.order_id is null and w.type = 'WITHDRAW'
    `)) as unknown as Array<{ id: string; type: string; description: string }>

        return {
            checkId: 'R7',
            severity: 'warning',
            findings: rows.map((r) => ({
                entityType: 'wallet_tx' as const,
                entityId: r.id,
                detail: { type: r.type, description: r.description },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R8: balance منفی ═══════════

    private async r8NegativeBalance(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select user_id, sum(case when type = 'DEPOSIT' then amount else -amount end)::int as bal
      from wallet_transactions
      group by user_id
      having sum(case when type = 'DEPOSIT' then amount else -amount end) < 0
    `)) as unknown as Array<{ user_id: string; bal: number }>

        return {
            checkId: 'R8',
            severity: 'critical',
            findings: rows.map((r) => ({
                entityType: 'user' as const,
                entityId: r.user_id,
                detail: { balance: r.bal },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R9: اختلاف مبلغ payment ↔ order ═══════════

    private async r9AmountMismatch(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select p.id, p.amount, o.display_id,
             o.breakdown->>'amountPaidOnline' as expected
      from payments p
      join orders o on o.id = p.order_id
      where p.status = 'SUCCESS'
        and o.payment_status = 'SUCCESS'
        and p.amount <> (o.breakdown->>'amountPaidOnline')::int
    `)) as unknown as Array<{
            id: string; amount: number; display_id: string; expected: string
        }>

        return {
            checkId: 'R9',
            severity: 'critical',
            findings: rows.map((r) => ({
                entityType: 'payment' as const,
                entityId: r.id,
                detail: {
                    orderDisplayId: r.display_id,
                    paymentAmount: r.amount,
                    expected: Number(r.expected),
                },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ R10: PENDING_PAYMENT گیرکرده > ۳۰ دقیقه ═══════════

    private async r10StuckPending(): Promise<CheckResult> {
        const rows = (await this.deps.db.execute(sql`
      select id, display_id, created_at
      from orders
      where status = 'PENDING_PAYMENT'
        and created_at < now() - interval '30 minutes'
    `)) as unknown as Array<{ id: string; display_id: string; created_at: Date }>

        return {
            checkId: 'R10',
            severity: 'warning',
            findings: rows.map((r) => ({
                entityType: 'order' as const,
                entityId: r.id,
                detail: {
                    orderDisplayId: r.display_id,
                    createdAt: r.created_at,
                    note: 'detection delay up to 24h (daily job)',
                },
            })),
            wouldFix: 0,
        }
    }

    // ═══════════ ثبت findings — idempotent روزانه ═══════════

    /**
     * upsert: finding باز → lastSeenAt + occurrences++ ؛
     * finding resolved که دوباره دیده شد → reopen (status→open, resolvedAt→null).
     * unique (check_id, entity_id) — بدون status در کلید.
     */
    async persistFindings(report: ReconcileReport): Promise<void> {
        for (const check of report.checks) {
            for (const f of check.findings) {
                await this.deps.db
                    .insert(reconcileFindings)
                    .values({
                        checkId: check.checkId,
                        severity: check.severity,
                        entityType: f.entityType,
                        entityId: f.entityId,
                        detail: f.detail,
                    })
                    .onConflictDoUpdate({
                        target: [reconcileFindings.checkId, reconcileFindings.entityId],
                        set: {
                            lastSeenAt: new Date(),
                            occurrences: sql`${reconcileFindings.occurrences} + 1`,
                        },
                    })
            }
        }

        // reopen در گام جدا — روشن‌تر از sql شرطی در upsert:
        await this.deps.db.execute(sql`
      update reconcile_findings
      set status = 'open', resolved_at = null
      where status in ('acknowledged', 'resolved_external')
        and last_seen_at = now()
    `)
    }

    // ═══════════ خواندن — پنل ادمین ═══════════

    async listFindings(filters: {
        status?: string
        severity?: string
        checkId?: string
    }): Promise<Array<typeof reconcileFindings.$inferSelect>> {
        const conditions = []
        if (filters.status) conditions.push(eq(reconcileFindings.status, filters.status))
        if (filters.severity) conditions.push(eq(reconcileFindings.severity, filters.severity))
        if (filters.checkId) conditions.push(eq(reconcileFindings.checkId, filters.checkId))
        return this.deps.db
            .select()
            .from(reconcileFindings)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(reconcileFindings.lastSeenAt))
            .limit(500)
    }

    async acknowledge(id: string): Promise<void> {
        await this.deps.db
            .update(reconcileFindings)
            .set({ status: 'acknowledged', resolvedAt: new Date() })
            .where(eq(reconcileFindings.id, id))
    }

    /** خلاصه برای گزارش HTML */
    async summary(): Promise<{
        open: number
        critical: number
        byCheck: Record<string, number>
    }> {
        const rows = (await this.deps.db.execute(sql`
      select check_id, severity, count(*)::int as c
      from reconcile_findings
      where status = 'open'
      group by check_id, severity
    `)) as unknown as Array<{ check_id: string; severity: string; c: number }>

        const byCheck: Record<string, number> = {}
        let open = 0
        let critical = 0
        for (const r of rows) {
            byCheck[r.check_id] = (byCheck[r.check_id] ?? 0) + r.c
            open += r.c
            if (r.severity === 'critical') critical += r.c
        }
        return { open, critical, byCheck }
    }
}