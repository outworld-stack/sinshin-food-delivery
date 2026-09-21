//src/domain/audit/audit.service.ts
import { desc, eq, gte, lte, sql, and, type SQL } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { auditLogs, users } from '#/infra/db/schema'
// دقت: UserIdِ audit_logs از @sinshin/shared می‌آید (نه brand) — همان تایپ برند
import type { UserId } from '@sinshin/shared'

/**
 * stage-10 — گزارش‌گری ممیزی (audit-log).
 *
 * جدول audit_logs از فاز اول در schema بود ولی هیچ‌جا نوشته نمی‌شد؛
 * باکس گزارشات داشبورد بدون آن خالی می‌ماند. این سرویس:
 *  ۱) log() — ثبت append-only عملیات‌های حساسِ «ادمین اصلی»
 *     (اکشن‌های ادمین۲ از قبل در admin2_activities ثبت می‌شوند).
 *  ۲) report() — خواندن همان جدول برای باکس گزارشات.
 *
 * log عمداً fire-and-forget است: خطای ثبت لاگ هرگز عملیات اصلی را
 * نمی‌شکند (لاگ جانبی است، نه تراکنش).
 */
export class AuditService {
  constructor(private readonly deps: { db: Db }) { }

  async log(input: {
    actorId: string
    action: string
    entity?: string | null
    entityId?: string | null
    userId?: string | null
    metadata?: Record<string, unknown>
  }): Promise<void> {
    try {
      await this.deps.db.insert(auditLogs).values({
        actorId: input.actorId as UserId,
        action: input.action.slice(0, 60),
        entity: input.entity?.slice(0, 40) ?? null,
        entityId: input.entityId ?? null,
        userId: input.userId ? (input.userId as UserId) : null,
        metadata: input.metadata ?? {},
      })
    } catch (err) {
      // لاگ جانبی است — شکستش جریان اصلی را نمی‌شکند؛ فقط دیده شود
      console.warn('[audit] log failed:', err instanceof Error ? err.message : err)
    }
  }

  /** گزارش audit-log — join با users برای نام بازیگر (همان قرارداد باکس گزارشات) */
  async report(input: {
    from?: Date
    to?: Date
    actorId?: string
    limit?: number
  }): Promise<{
    rows: Array<{
      id: string
      actorName: string
      actorPhone: string
      action: string
      entity: string | null
      entityId: string | null
      metadata: Record<string, unknown>
      createdAt: Date
    }>
    total: number
  }> {
    const conditions: SQL[] = []
    if (input.from) conditions.push(gte(auditLogs.createdAt, input.from))
    if (input.to) conditions.push(lte(auditLogs.createdAt, input.to))
    if (input.actorId) conditions.push(eq(auditLogs.actorId, input.actorId as UserId))
    const where = conditions.length > 0 ? and(...conditions) : undefined
    const limit = Math.min(input.limit ?? 500, 2000)

    const [rows, totalRow] = await Promise.all([
      this.deps.db
        .select({ a: auditLogs, u: users })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit),
      this.deps.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where)
        .then((r) => r[0]?.count ?? 0),
    ])

    return {
      rows: rows.map(({ a, u }) => ({
        id: a.id,
        actorName: u?.name ?? '—',
        actorPhone: u?.phone ?? '—',
        action: a.action,
        entity: a.entity ?? null,
        entityId: a.entityId ?? null,
        metadata: (a.metadata ?? {}) as Record<string, unknown>,
        createdAt: a.createdAt,
      })),
      total: totalRow,
    }
  }
}
