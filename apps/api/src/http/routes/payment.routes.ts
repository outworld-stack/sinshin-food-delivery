// ══════════════════════════════════════════════════════════════
// stage-58 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/payment.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر:
//   ① callbackهای درگاه: خطاهای سخت (state جعلی/درگاه ناهمخوان/404) دیگر
//      JSON خام در مرورگرِ مشتریِ تازه‌پرداخت‌کرده نمی‌سازند — 302 امن به
//      لیست سفارش‌ها (خود handleCallback برای حالت indeterminate 302 به
//      صفحه‌ی سفارش با ?payment=pending می‌دهد).
//   ② POST /payments/retry — «ادامه‌ی پرداخت» سفارش PENDING_PAYMENT از
//      صفحه‌ی سفارش (requireAuth + سقف نرخ IP؛ همان قولی که پیام خطای
//      چک‌اوت می‌داد ولی مسیرش وجود نداشت).
//   ③ حذف Pay.ir — روت generic :gateway/callback نیازی به تغییر ندارد
//      (پارامتری است)؛ آداپتر و رجیستری در سرویس حذف شدند.
// ══════════════════════════════════════════════════════════════

//src/http/routes/payment.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { RedisService } from '#/infra/redis/redis'
import type { PaymentService } from '#/domain/payment/payment.service'
import { requireAuth } from '#/http/hooks/require-auth'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'
import { AppError } from '#/domain/shared/errors'

export interface PaymentRoutesDeps {
  payments: PaymentService
  /** stage-58 — رِتری نیاز به نشست دارد؛ callbackها همچنان state-امضا گاردشان است */
  sessions: SessionService
  /** stage-58 — سقف نرخ IP روی رِتری (ضد حلقه‌ی اسپم دکمه) */
  redis: RedisService
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

/**
 * stage-58 — اجرای callback با شبکه‌ی امن خطا:
 * خطای سخت (state جعلی 403 / پرداخت 404 / درگاه ناهمخوان 403) نباید بعد از
 * پرداختِ موفقِ بانک، JSON خام به مشتری نشان دهد — 302 به لیست سفارش‌ها
 * (کاربرِ عادی هرگز این مسیرها را نمی‌بیند؛ جاعل هم به همان صفحه می‌رسد).
 */
const runCallbackSafe = async (
  deps: PaymentRoutesDeps,
  gatewayId: string,
  query: Record<string, unknown>,
  body: unknown,
) => {
  try {
    return await runCallback(deps.payments, gatewayId, query, body)
  } catch (e) {
    if (e instanceof AppError) {
      console.warn(`[payments] callback ${gatewayId}: ${e.code} — redirect امن`)
      return { redirect: `${deps.payments.siteUrl}/dashboard/orders?payment=error` }
    }
    throw e
  }
}

export const paymentRoutes = (deps: PaymentRoutesDeps) => {
  // ── عمومی: mock + callbackهای درگاه (state امضاشده خودش گارد است) ──
  const publicRoutes = new Elysia({ prefix: '/payments', tags: ['Payments'] })

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
        const r = await runCallbackSafe(deps, params.gateway, query, undefined)
        set.status = 302
        set.headers.location = r.redirect
        return { ok: true }
      },
      {
        params: t.Object({ gateway: t.String({ maxLength: 20 }) }),
        detail: {
          summary: 'Gateway callback — verify + settle, then 302 to order page',
          description:
            'stage-58 — indeterminate verify results also 302 to the order page (?payment=pending) instead of raw 503 JSON; hard errors 302 to the orders list. Never raw JSON in the customer’s browser after a bank return.',
        },
      },
    )

    // callback بانک ملت — برگشت با فرم POST است (همان نتیجه‌ی GET)
    .post(
      '/:gateway/callback',
      async ({ params, query, body, set }) => {
        const r = await runCallbackSafe(deps, params.gateway, query, body)
        set.status = 302
        set.headers.location = r.redirect
        return { ok: true }
      },
      {
        params: t.Object({ gateway: t.String({ maxLength: 20 }) }),
        detail: {
          summary: 'Gateway callback (form POST) — verify + settle, then 302 to order page',
          description:
            'Bank Mellat returns the customer via an urlencoded form POST; form fields are merged with the URL query (state). ' +
            'stage-58 — errors resolve to a safe 302, never raw JSON in the customer’s browser.',
        },
      },
    )

  // ── requireAuth: رِتری پرداخت از صفحه‌ی سفارش ──
  const userRoutes = new Elysia({ prefix: '/payments', tags: ['Payments'] })
    .use(requireAuth(deps.sessions))

    // stage-58 — «ادامه‌ی پرداخت» — فقط مالکِ سفارش PENDING_PAYMENT؛
    // درگاه پیش‌فرض = آخرین تلاش خود سفارش. ایمنی پول (استعلام درگاه قبل
    // از تعویض ردیف قبلی) داخل PaymentService.retryInitiation است.
    .post(
      '/retry',
      async ({ user, body }) => {
        return deps.payments.retryInitiation(user.id, body.orderId, body.gatewayId, user.phone)
      },
      {
        beforeHandle: [
          // دکمه‌ی اسپم‌شونده نباید حلقه‌ی initiate بسازد — ۶ رِتری در دقیقه
          ipRateLimit({ redis: deps.redis, scope: 'payment-retry', limit: 6, windowSeconds: 60 }),
        ],
        body: t.Object({
          /** displayId سفارش — همان کد نمایشی صفحه‌ی سفارش */
          orderId: t.String({ minLength: 3, maxLength: 40 }),
          gatewayId: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        }),
        detail: {
          summary: 'Retry payment initiation for a PENDING_PAYMENT order (owner only)',
          description:
            'stage-58 — makes the checkout error message “پرداخت را از صفحه‌ی سفارش ادامه دهید” actually true. ' +
            'Creates a fresh payment row for the order (audit: هر تلاش یک ردیف), verifies/supersedes previous PENDING attempts safely ' +
            '(money-safety: an unresolved old attempt remains pending until the PSP returns a definitive result), then initiates a new gateway session. ' +
            'gatewayId defaults to the last attempt’s gateway. Rate-limited 6/min/IP.',
        },
      },
    )

  return new Elysia().use(publicRoutes).use(userRoutes)
}
