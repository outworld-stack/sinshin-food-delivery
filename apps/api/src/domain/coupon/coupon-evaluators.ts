//src/domain/coupon/coupon-evaluators.ts
import { sql, type SQL } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'

/**
 * ۹ ارزیاب شرط کوپن — SQL خالص ایندکس‌دار.
 * هر ارزیاب یک subquery قابل‌استفاده در expression بزرگ‌تر برمی‌گرداند.
 *
 * قرارداد params (jsonb) برای هر نوع — در کامنت enum ثبت شده.
 * همیشه با placeholders — هیچ رشته‌ی کاربر در SQL نمی‌نشیند.
 */

export interface EvaluatorContext {
  db: Db
  /** کاربرِ مورد ارزیابی */
  userId: string
  /** تاریخ ارزیابی — برای ORDER_IN_LAST_DAYS */
  now: Date
}

export type ConditionType =
  | 'MIN_ORDERS_COUNT'
  | 'MIN_TOTAL_SPEND'
  | 'MIN_PRODUCT_ORDERS'
  | 'MIN_CATEGORY_ORDERS'
  | 'REGISTERED_DAYS_AGO'
  | 'MIN_REFERRALS'
  | 'MIN_REFERRAL_ORDERS'
  | 'MIN_REFERRAL_SPEND'
  | 'ORDERS_IN_LAST_DAYS'

export type ConditionParams = Record<string, unknown>

/** خروجی ارزیاب — boolean SQL و «مقدار فعلی» برای missingCount */
export interface EvaluatorResult {
  satisfied: SQL
  /** مقدار فعلی شاخص — برای پیام «X قدم مانده» (اختیاری) */
  current: SQL
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** سفارش‌های موفق کاربر — عبارت مشترک */
function successfulOrdersExpr(): SQL {
  return sql`(
    select count(*)::int from orders o
    where o.user_id = u.id
      and o.payment_status = 'SUCCESS'
      and o.status <> 'CANCELED'
  )`
}

export function evaluateCondition(
  ctx: EvaluatorContext,
  type: ConditionType,
  params: ConditionParams,
): EvaluatorResult {
  switch (type) {
    case 'MIN_ORDERS_COUNT': {
      const count = num(params.count, 1)
      return {
        satisfied: sql`${successfulOrdersExpr()} >= ${count}`,
        current: successfulOrdersExpr(),
      }
    }

    case 'MIN_TOTAL_SPEND': {
      const amount = num(params.amount, 1)
      const spent = sql`(
        select coalesce(sum(o.total_amount), 0)::int from orders o
        where o.user_id = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
      )`
      return { satisfied: sql`${spent} >= ${amount}`, current: spent }
    }

    case 'MIN_PRODUCT_ORDERS': {
      const productId = str(params.productId)
      const count = num(params.count, 1)
      if (!productId) {
        // شرط غیرقابل‌ارزیابی → همیشه ناراضی (امن: کوپن اعطا نمی‌شود)
        return { satisfied: sql`false`, current: sql`0` }
      }
      const bought = sql`(
        select coalesce(sum(oi.quantity), 0)::int
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.user_id = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
          and oi.product_id = ${productId}::uuid
      )`
      return { satisfied: sql`${bought} >= ${count}`, current: bought }
    }

    case 'MIN_CATEGORY_ORDERS': {
      const categoryId = str(params.categoryId)
      const count = num(params.count, 1)
      if (!categoryId) {
        return { satisfied: sql`false`, current: sql`0` }
      }
      const bought = sql`(
        select coalesce(sum(oi.quantity), 0)::int
        from order_items oi
        join orders o on o.id = oi.order_id
        join products p on p.id = oi.product_id
        where o.user_id = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
          and p.category_id = ${categoryId}::uuid
      )`
      return { satisfied: sql`${bought} >= ${count}`, current: bought }
    }

    case 'REGISTERED_DAYS_AGO': {
      const days = num(params.days, 1)
      return {
        satisfied: sql`(extract(epoch from (${ctx.now.toISOString()}::timestamptz - u.created_at)) / 86400) >= ${days}`,
        current: sql`(extract(epoch from (${ctx.now.toISOString()}::timestamptz - u.created_at)) / 86400)::int`,
      }
    }

    case 'MIN_REFERRALS': {
      const count = num(params.count, 1)
      const refs = sql`(
        select count(*)::int from users r where r.referred_by = u.id
      )`
      return { satisfied: sql`${refs} >= ${count}`, current: refs }
    }

    case 'MIN_REFERRAL_ORDERS': {
      const count = num(params.count, 1)
      const refOrders = sql`(
        select count(*)::int
        from orders o
        join users b on b.id = o.user_id
        where b.referred_by = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
      )`
      return { satisfied: sql`${refOrders} >= ${count}`, current: refOrders }
    }

    case 'MIN_REFERRAL_SPEND': {
      const amount = num(params.amount, 1)
      const refSpend = sql`(
        select coalesce(sum(o.total_amount), 0)::int
        from orders o
        join users b on b.id = o.user_id
        where b.referred_by = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
      )`
      return { satisfied: sql`${refSpend} >= ${amount}`, current: refSpend }
    }

    case 'ORDERS_IN_LAST_DAYS': {
      const days = num(params.days, 1)
      const count = num(params.count, 1)
      const recent = sql`(
        select count(*)::int from orders o
        where o.user_id = u.id
          and o.payment_status = 'SUCCESS'
          and o.status <> 'CANCELED'
          and o.created_at >= ${ctx.now.toISOString()}::timestamptz - ${days} * interval '1 day'
      )`
      return { satisfied: sql`${recent} >= ${count}`, current: recent }
    }
  }
}

/**
 * ترکیب شرط‌های یک کوپن برای یک کاربر:
 * satisfied = همه‌ی شرط‌ها + unsatisfied = همه منهای یکی.
 * خروجی: عبارت SQL که روی ردیف users (aliased u) قابل JOIN است.
 */
export function buildUserCondition(
  ctx: EvaluatorContext,
  conditions: Array<{ type: ConditionType; params: ConditionParams }>,
): { allSatisfied: SQL; allButOne: SQL; satisfiedCount: SQL; totalConditions: number } {
  if (conditions.length === 0) {
    return {
      allSatisfied: sql`true`,
      allButOne: sql`true`,
      satisfiedCount: sql`0`,
      totalConditions: 0,
    }
  }

  const results = conditions.map((c) => evaluateCondition(ctx, c.type, c.params))
  const all = sql.join(
    results.map((r) => r.satisfied),
    sql` and `,
  )
  const counts = sql.join(
    results.map((r) => sql`case when ${r.satisfied} then 1 else 0 end`),
    sql` + `,
  )
  const total = conditions.length

  return {
    allSatisfied: sql`(${all})`,
    allButOne: sql`(${counts}) >= ${total - 1}`,
    satisfiedCount: sql`(${counts})`,
    totalConditions: total,
  }
}