// src/http/routes/coupon.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { CouponService } from '#/domain/coupon/coupon.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const CONDITION_TYPES = [
  'MIN_ORDERS_COUNT', 'MIN_TOTAL_SPEND', 'MIN_PRODUCT_ORDERS', 'MIN_CATEGORY_ORDERS',
  'REGISTERED_DAYS_AGO', 'MIN_REFERRALS', 'MIN_REFERRAL_ORDERS', 'MIN_REFERRAL_SPEND',
  'ORDERS_IN_LAST_DAYS',
] as const

/** phase-5: قرارداد فرانت (CouponRule: value/quantity) → params ارزیابها */
function ruleToParams(
  type: string,
  value: string | number,
  quantity?: number,
): Record<string, unknown> {
  const n = Number(value)
  switch (type) {
    case 'MIN_TOTAL_SPEND':
    case 'MIN_REFERRAL_SPEND':
      return { amount: n }
    case 'REGISTERED_DAYS_AGO':
      return { days: n }
    case 'ORDERS_IN_LAST_DAYS':
      return { days: n, count: quantity ?? 1 }
    case 'MIN_PRODUCT_ORDERS':
      return { productId: String(value), count: quantity ?? 1 }
    case 'MIN_CATEGORY_ORDERS':
      return { categoryId: String(value), count: quantity ?? 1 }
    case 'MIN_ORDERS_COUNT':
    case 'MIN_REFERRALS':
    case 'MIN_REFERRAL_ORDERS':
      return { count: n }
    default:
      return {}
  }
}

const ruleSchema = t.Object({
  type: t.Union(CONDITION_TYPES.map((c) => t.Literal(c))),
  value: t.Union([t.String({ minLength: 1, maxLength: 100 }), t.Numeric()]),
  quantity: t.Optional(t.Numeric({ minimum: 1, maximum: 100000 })),
})

const couponBody = t.Object({
  code: t.String({ minLength: 3, maxLength: 16 }),
  title: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
  discountPercentage: t.Number({ minimum: 1, maximum: 99 }),
  maxUses: t.Number({ minimum: 0, maximum: 1000000 }),
  isPublic: t.Boolean(),
  expiryDate: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
  rules: t.Array(ruleSchema, { maxItems: 10 }),
})

export interface CouponRoutesDeps {
  sessions: SessionService
  coupons: CouponService
  /** stage-10: لاگ ممیزی — عملیات کوپن ادمین اصلی */
  audit: AuditService
}

export const couponRoutes = (deps: CouponRoutesDeps) =>
  new Elysia({ prefix: '/admin/coupons', tags: ['Admin / Coupons'] })
    .use(requireAdmin(deps.sessions))

    .get('/', () => deps.coupons.list(), {
      detail: { summary: 'List coupons with conditions + recipients count' },
    })

    // ── phase-9: جزئیات یک کوپن — صفحه‌ی اختصاصی ادمین ──
    .get(
      '/:id',
      ({ params }) => deps.coupons.get(params.id),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Coupon detail with conditions + recipients count' },
      },
    )

    .post(
      '/',
      async ({ body, user }) => {
        const res = await deps.coupons.create({
          code: body.code,
          title: body.title ?? null,
          discountPercentage: body.discountPercentage,
          maxUses: body.maxUses,
          isPublic: body.isPublic,
          expiryDate: body.expiryDate ?? null,
          rules: body.rules.map((r) => ({
            type: r.type,
            params: ruleToParams(r.type, r.value, r.quantity),
          })),
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'COUPON_CREATE',
          entity: 'coupon',
          entityId: res.id ?? null,
          metadata: { code: body.code, discount: body.discountPercentage },
        })
        return res
      },
      { body: couponBody, detail: { summary: 'Create coupon (contract: value/quantity)' } },
    )

    // ── phase-5: PATCH — فرانت updateCoupon می‌فرستید ولی روت نبود! ──
    .patch(
      '/:id',
      async ({ params, body, user }) => {
        const res = await deps.coupons.update(params.id, {
          code: body.code,
          title: body.title ?? null,
          discountPercentage: body.discountPercentage,
          maxUses: body.maxUses,
          isPublic: body.isPublic,
          expiryDate: body.expiryDate ?? null,
          rules: body.rules.map((r) => ({
            type: r.type,
            params: ruleToParams(r.type, r.value, r.quantity),
          })),
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'COUPON_UPDATE',
          entity: 'coupon',
          entityId: params.id,
          metadata: { code: body.code, discount: body.discountPercentage },
        })
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: couponBody,
        detail: { summary: 'Update coupon — conditions replaced' },
      },
    )

    .delete(
      '/:id',
      async ({ params, user }) => {
        const res = await deps.coupons.remove(params.id)
        await deps.audit.log({
          actorId: user.id,
          action: 'COUPON_DEACTIVATE',
          entity: 'coupon',
          entityId: params.id,
        })
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Delete coupon' },
      },
    )

    // ── stage-10: فعال/غیرفعال — رفع باگ «برگشتی نداشتن غیرفعال‌سازی» ──
    .patch(
      '/:id/status',
      async ({ params, body, user }) => {
        const res = await deps.coupons.setActive(params.id, body.active)
        await deps.audit.log({
          actorId: user.id,
          action: body.active ? 'COUPON_ACTIVATE' : 'COUPON_DEACTIVATE',
          entity: 'coupon',
          entityId: params.id,
        })
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        body: t.Object({ active: t.Boolean() }),
        detail: {
          summary: 'Activate / deactivate coupon',
          description:
            'Deactivate = soft (same as delete). Activate rejected while endsAt is in the past — edit expiry first.',
        },
      },
    )