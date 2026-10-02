//src/http/routes/payment.routes.ts
import { Elysia, t } from 'elysia'

import type { PaymentService } from '#/domain/payment/payment.service'

export interface PaymentRoutesDeps {
  payments: PaymentService
}

/** بدنه‌ی فرم برگشتی بانک — ملت فرم POST می‌فرستد؛ پارس‌شده یا رشته‌ی خام
 *  (هر دو شکل را می‌پذیرد تا به رفتار پارسر فریم‌ورک وابسته نباشیم) */
const flatForm = (body: unknown): Record<string, string> => {
  if (typeof body === 'string') {
    try {
      return Object.fromEntries(new URLSearchParams(body))
    } catch {
      return {}
    }
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** منطق مشترک callback — فیلدهای فرم + پارامترهای آدرس (state) یکی می‌شوند */
const runCallback = async (
  payments: PaymentService,
  gatewayId: string,
  query: Record<string, unknown>,
  body: unknown,
) => {
  const q: Record<string, string> = { ...flatForm(body) }
  for (const [k, v] of Object.entries(query ?? {})) {
    if (typeof v === 'string') q[k] = v
  }
  return payments.handleCallback(gatewayId, q)
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
        const r = await runCallback(deps.payments, params.gateway, query, undefined)
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

    // callback بانک ملت — برگشت با فرم POST است (همان نتیجه‌ی GET)
    .post(
      '/:gateway/callback',
      async ({ params, query, body, set }) => {
        const r = await runCallback(deps.payments, params.gateway, query, body)
        set.status = 302
        set.headers.location = r.redirect
        return { ok: true }
      },
      {
        params: t.Object({ gateway: t.String({ maxLength: 20 }) }),
        detail: {
          summary: 'Gateway callback (form POST) — verify + settle, then 302 to order page',
          description:
            'Bank Mellat returns the customer via an urlencoded form POST; form fields are merged with the URL query (state).',
        },
      },
    )