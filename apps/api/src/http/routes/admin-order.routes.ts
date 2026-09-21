// src/http/routes/admin-order.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { OrderService } from '#/domain/order/order.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const DISPLAY_PATTERN = '^ord-[a-z0-9]{8}$'

export interface AdminOrderRoutesDeps {
  sessions: SessionService
  orders: OrderService
  audit: AuditService
}

export const adminOrderRoutes = (deps: AdminOrderRoutesDeps) =>
  new Elysia({ prefix: '/admin/orders', tags: ['Admin / Orders'] })
    .use(requireAdmin(deps.sessions))
    .post(
      '/:displayId/refund',
      async ({ params, body, user }) => {
        await deps.orders.refund(params.displayId, body.reason)
        // round-11 (اسکن M-2-api): بازگشت وجه حساس‌ترین عمل پولی پنل است —
        // بدون audit می‌ماند در حالی که بقیهٔ عملیات ثبت می‌شوند.
        await deps.audit.log({
          actorId: user.id,
          action: 'REFUND',
          entity: 'order',
          entityId: params.displayId,
          metadata: { reason: body.reason },
        })
      },
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        body: t.Object({ reason: t.String({ minLength: 3, maxLength: 300 }) }),
        detail: {
          summary: 'Refund a paid order — credit wallet, reverse referral, release coupon',
          description:
            'Main admin only. Credits the full totalAmount back to the customer wallet (the gateway money itself must be settled with the PSP). Reverses referral profit and releases the coupon reservation. Wallet rows are idempotent. Audit-logged as REFUND.',
        },
      },
    )