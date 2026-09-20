// src/http/routes/admin-order.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { OrderService } from '#/domain/order/order.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const DISPLAY_PATTERN = '^ord-[a-z0-9]{8}$'

export interface AdminOrderRoutesDeps {
  sessions: SessionService
  orders: OrderService
}

export const adminOrderRoutes = (deps: AdminOrderRoutesDeps) =>
  new Elysia({ prefix: '/admin/orders', tags: ['Admin / Orders'] })
    .use(requireAdmin(deps.sessions))
    .post(
      '/:displayId/refund',
      ({ params, body }) => deps.orders.refund(params.displayId, body.reason),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        body: t.Object({ reason: t.String({ minLength: 3, maxLength: 300 }) }),
        detail: {
          summary: 'Refund a paid order — credit wallet, reverse referral, release coupon',
          description:
            'Main admin only. Credits the full totalAmount back to the customer wallet (the gateway money itself must be settled with the PSP). Reverses referral profit and releases the coupon reservation. Wallet rows are idempotent.',
        },
      },
    )