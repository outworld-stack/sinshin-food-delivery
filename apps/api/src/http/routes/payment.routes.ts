//src/http/routes/payment.routes.ts
import { Elysia, t } from 'elysia'

import type { PaymentService } from '#/domain/payment/payment.service'

export interface PaymentRoutesDeps {
  payments: PaymentService
}

export const paymentRoutes = (deps: PaymentRoutesDeps) =>
  new Elysia({ prefix: '/payments', tags: ['Payments'] })

    // شبیه‌ساز پرداخت — state امضاشده در URL، بدون auth (توکن خودش گارد است)
    .post(
      '/mock/:state',
      ({ params, body }) => deps.payments.handleMockPay(params.state, body.success),
      {
        params: t.Object({ state: t.String({ maxLength: 100 }) }),
        body: t.Object({ success: t.Boolean() }),
        detail: {
          summary: 'Mock gateway — simulate payment result',
          description:
            'state is an HMAC-signed token from checkout paymentUrl. Chooses success/failure deterministically for testing.',
        },
      },
    )

    // callback درگاه‌های واقعی — GET (ریدایرکت مرورگر)
    .get(
      '/:gateway/callback',
      async ({ params, query, set }) => {
        const q: Record<string, string> = {}
        for (const [k, v] of Object.entries(query ?? {})) {
          if (typeof v === 'string') q[k] = v
        }
        const r = await deps.payments.handleCallback(params.gateway, q)
        set.status = 302
        set.headers.location = r.redirect
        return { ok: true }
      },
      {
        params: t.Object({ gateway: t.String({ maxLength: 20 }) }),
        detail: {
          summary: 'Gateway callback — verify + settle, then 302 to order page',
        },
      },
    )