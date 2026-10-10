// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/order.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: هدر Idempotency-Key در چک‌اوت اجباری شد (دِداپ همه‌جانبه؛
//        قبلاً کلاینتِ بدون-کلید از دِداپ DB عبور می‌کرد)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-52 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/order.routes.ts
// تغییر: چک‌اوت تمام-کیف‌پول (سفارش PAID بلافاصله وارد صف زنده می‌شود) علاوه بر
//         رویداد SSE ‏orders:new، Web Push هم به ادمین‌های سطح ۲ می‌فرستد —
//         deps.notifications جدید + فراخوان fire-and-forget (هرگز مسیر را نمی‌شکند).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 47 از 97
// مسیر مقصد: apps/api/src/http/routes/order.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

//src/http/routes/order.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { OrderService } from '#/domain/order/order.service'
import type { ProfileService } from '#/domain/order/profile.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { PaymentService } from '#/domain/payment/payment.service'
import type { RedisService } from '#/infra/redis/redis'
import type { CheckoutIdempotency } from '#/domain/order/checkout-idempotency.service'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { NotificationService } from '#/domain/notification/notification.service'
import { requireAuth } from '#/http/hooks/require-auth'
import { Err } from '#/domain/shared/errors'
import { langFromHeaders } from '#/domain/shared/lang'
import type { CheckoutResponse } from '@sinshin/shared'
import { UUID_PATTERN, DISPLAY_PATTERN, isDisplayId } from '#/domain/shared/ids'
import { cartItemSchema, deliveryTypeSchema } from '#/http/schemas'


export interface OrderRoutesDeps {
  sessions: SessionService
  orders: OrderService
  profile: ProfileService
  settings: SettingsService
  payments: PaymentService
  /** فقط perUserLimit — سقف ضد-اسپم با پشتیبان ردیس */
  redis: RedisService
  /** round-20 — تصرف اتمیک روی PK مرکب؛ مقیم DB، مستقل از ردیس */
  idempotency: CheckoutIdempotency
  /** round-16 — چک‌اوت تمام-کیف‌پول: سفارش PAID بلافاصله به پنل زنده اعلام شود */
  hub: SseHub
  /** stage-52 — همان لحظه: Web Push «سفارش جدید» به ادمین‌های سطح ۲ */
  notifications: NotificationService
}

export const orderRoutes = (deps: OrderRoutesDeps) => {
  /**
   * phase-fix — سقف هر «کاربر» (نه IP — CGNAT ایرانی: ده‌ها کاربر پشت یک IP).
   * شکست‌باز: قطعی Redis = عبور؛ این سقف ضد سوءاستفاده است نه ضد پیک.
   */
  // رارد L7 — پشتیبان در-حافظه وقتی ردیس پایین است: قبلاً fail-open یعنی
  // بی‌سقفِ کامل؛ حالا همان سقف/پنجره با شمارنده‌ی محلی (per-instance).
  const fallbackCounts = new Map<string, { count: number; resetAt: number }>()
  const fallbackLimit = (key: string, limit: number, windowSeconds: number): void => {
    const now = Date.now()
    const entry = fallbackCounts.get(key)
    if (!entry || entry.resetAt <= now) {
      if (fallbackCounts.size > 10_000) fallbackCounts.clear() // سقف حافظه
      fallbackCounts.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
      return
    }
    entry.count += 1
    if (entry.count > limit) {
      throw Err.rateLimited(
        'درخواست‌های شما زیاد است؛ کمی بعد دوباره تلاش کنید.',
        Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      )
    }
  }

  const perUserLimit = async (
    userId: string,
    scope: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> => {
    const key = `rl:${scope}:user:${userId}`
    const count = await deps.redis.incr(key)
    if (!Number.isFinite(count) || count < 1) {
      // ردیس پایین — رارد L7: دیگر بی‌سقف نیستیم
      fallbackLimit(key, limit, windowSeconds)
      return
    }
    if (count === 1 || count <= limit) {
      await deps.redis.expire(key, windowSeconds)
    }
    if (count > limit) {
      throw Err.rateLimited('درخواست‌های شما زیاد است؛ کمی بعد دوباره تلاش کنید.', windowSeconds)
    }
  }

  return new Elysia({ prefix: '/orders', tags: ['Orders'] })

    // وضعیت رستوران — عمومی (قرارداد getRestaurantStatus)
    .get(
      '/restaurant-status',
      // round-13 — وضعیت کامل (شامل علت بسته‌شدن موقت) برای نمایش در چک‌اوت؛
      // isOpen اینجا فقط «ساعتی» است؛ temporarilyClosed جدا می‌آید.
      // round-34 — علت موقت از کلید عربی می‌آید وقتی x-sinshin-lang: ar (خالی = فارسی).
      ({ headers }) => deps.settings.restaurantStatus(langFromHeaders(headers)),
      {
        detail: {
          summary: 'Restaurant status + temporary-close reason (public)',
          description:
            'isOpen = scheduled open only. Combine with temporarilyClosed for the customer-facing state. temporaryCloseReason is shown in the checkout order-summary box. round-34: x-sinshin-lang: ar returns the Arabic close reason when set.',
        },
      },
    )

    .use(requireAuth(deps.sessions))

    // پروفایل کامل — قرارداد getUserProfile
    // perf-fix (کار-۶): ?light=1 — حالت سبک برای هدر/لایوت/چک‌اوت:
    // بدون txs/devices/referrals؛ سفارش‌ها = ۱۰ آخر + فعال‌ها
    .get(
      '/profile',
      ({ user, auth, query }) =>
        deps.profile.get(user.id, auth.deviceId, { light: query.light === true }),
      {
        query: t.Object({ light: t.Optional(t.BooleanString()) }),
        detail: {
          summary: 'Full user profile (frontend getUserProfile contract)',
          description:
            'Default: full lists. ?light=true: bounded variant for always-on consumers (site header, dashboard layout, checkout) — no wallet transactions/devices/referrals, orders = last 10 + all active (PAID/CONFIRMED/ON_THE_WAY). Same DTO shape.',
        },
      },
    )

    // phase-3 — ویرایش پروفایل (name/email) — فرانت تا امروز صرفاً نمایشی بود
    .patch(
      '/profile',
      ({ user, body }) =>
        deps.profile.updateProfile(user.id, {
          name: body.name,
          email: body.email ?? null,
        }),
      {
        body: t.Object({
          name: t.Nullable(t.String({ minLength: 2, maxLength: 60 })),
          email: t.Optional(t.Nullable(t.String({ maxLength: 120, format: 'email' }))),
        }),
        detail: { summary: 'Update profile name/email' },
      },
    )

    // round-12 — bind معرف پس از ثبت‌نام (اسکن QR / ورود دستی کد در داشبورد).
    // سقف هر کاربر: ۱۰ تلاش در ساعت — ضد brute-force کد معرف
    .post(
      '/profile/apply-referral',
      async ({ user, auth, body }) => {
        await perUserLimit(user.id, 'apply-referral', 10, 3600)
        return deps.profile.applyReferral(user.id, auth.deviceId, body.code)
      },
      {
        body: t.Object({ code: t.String({ minLength: 3, maxLength: 32 }) }),
        detail: {
          summary: 'Bind a referrer code after signup (dashboard scanner)',
          description:
            'One-shot: fails with 409 if a referrer is already bound. Guards: own-code rejected, referrer must exist, device-cluster REFERRAL_BLOCK (same rule as signup). Rate-limited per user.',
        },
      },
    )

    // چک‌اوت
    .post(
      '/checkout',
      async ({ user, body, headers }) => {
        // phase-fix: سقف هر کاربر — ۱۰ چک‌اوت در دقیقه (ضد اسپم سفارش/کوپن)
        await perUserLimit(user.id, 'checkout', 10, 60)

        // ── phase-2 → round-20: تکرارناپذیری مقیم در DB ──
        // فرانت برای هر «نیت خرید» یک UUID در هدر Idempotency-Key می‌فرستد؛
        // تلاش مجددِ شبکه همان پاسخ قبلی را می‌گیرد، نه سفارش دوم. تصرف اتمیک
        // روی PK مرکب (user_id, key) است و برخلاف نسخهٔ Redis در قطعی و
        // ری‌استارت ردیس هم پابرجا می‌ماند (مسیر پول از ردیس جدا شد).
        const idemKey = headers['idempotency-key']
        // stage-55 — کلید اجباری: بدون آن چک‌اوت بدون دِداپ همه‌جانبه می‌ماند
        // (فقط سقف نرخ per-user محافظت می‌کرد). کلاینت رسمی از قبل همیشه می‌فرستد.
        if (typeof idemKey !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(idemKey)) {
          throw Err.validation('Idempotency-Key (۸ تا ۶۴ کاراکتر حرفی/عددی) الزامی است.')
        }
        const claim = await deps.idempotency.claim(user.id, idemKey)
        // replay: همان پاسخ قبلی — بدون ساخت سفارش
        if (claim.kind === 'replay') return claim.response
        // تصرف زندهٔ دیگری (درخواست موازی/تاخیرافتن) — 409؛ تلاش مجدد با
        // کلید تازه بی‌درنگ موفق می‌شود
        if (claim.kind === 'in-flight') {
          throw Err.conflict('درخواست قبلی هنوز در حال پردازش است — چند لحظه صبر کنید.')
        }

        // رارد ۴۳ — پاسخ چک‌اوت با قرارداد مشترک تایپ‌دار شد
        let response: CheckoutResponse
        // رارد C2 — آیا سفارش COMMIT شده؟ اگر initiate بعد از commit شکست
        // بخورد، release یعنی بمب «سفارش تکراری» (replay همان کلید → سفارش
        // دوم + رزرو دوبل کیف/کوپن تا ۳۰ دقیقه). پس: قفل، نه آزادسازی.
        let committed: { displayId: string; breakdown: CheckoutResponse['breakdown'] } | null = null
        try {
          const r = await deps.orders.checkout(user.id, body)
          committed = { displayId: r.displayId, breakdown: r.breakdown }
          // round-16 — چک‌اوت تمام-کیف‌پول همین‌جا PAID می‌شود؛
          // پس از commit به پنل زنده اعلام (مسیر درگاهی در PaymentService.finalize اعلام می‌کند)
          if (!r.requiresPayment) {
            try {
              deps.hub.publish('orders:new', {
                event: 'order-created',
                data: { id: r.displayId },
              })
            } catch {
              /* هیچ‌کاری نمی‌کند */
            }
            // stage-52 — سفارش جدید صف زنده: پنل‌ها SSE را گرفتند؛ حالا
            // ادمین‌های سطح ۲ علاوه بر آن Web Push هم می‌گیرند (مرورگر بسته/
            // تب دیگری هم باشد می‌رسد؛ کلیک ⇒ پنل سفارشات زنده). فایر-اند-
            // فورگت — سرویس هرگز throw نمی‌کند و پاسخ چک‌اوت برای پوش
            // هرگز معطل نمی‌ماند.
            void deps.notifications
              .notifyAdmin2sNewOrder({ displayId: r.displayId })
              .catch(() => { /* ضد-کرش دوبل — قانون طلایی */ })
          }
          response = !r.requiresPayment || !r.paymentId
            ? {
              orderCompleted: true,
              orderId: r.displayId,
              requiresPayment: false,
              breakdown: r.breakdown,
            }
            : {
              orderCompleted: false,
              orderId: r.displayId,
              requiresPayment: true,
              paymentUrl: (
                await deps.payments.initiate(r.paymentId, body.gatewayId ?? 'MOCK', {
                  displayId: r.displayId,
                  amount: r.amountPaidOnline,
                  mobile: user.phone,
                })
              ).paymentUrl,
              breakdown: r.breakdown,
            }
        } catch (e) {
          if (committed) {
            // ✅ رارد C2: سفارش در DB ثبت شده — release ممنوع. پاسخِ قفل‌شده
            // باعث می‌شود replayِ همان کلید دوباره سفارش نسازد؛ کاربر پرداخت
            // را از صفحه‌ی سفارش ادامه می‌دهد (job تایم‌اوت هم آن را می‌پاید).
            if (idemKey) {
              await deps.idempotency.complete(user.id, idemKey, {
                orderCompleted: false,
                orderId: committed.displayId,
                requiresPayment: true,
                paymentUrl: undefined,
                breakdown: committed.breakdown,
              })
            }
            throw Err.serviceUnavailable(
              `سفارش ${committed.displayId} ثبت شد اما اتصال به درگاه برقرار نشد؛ ` +
                'پرداخت را از صفحه‌ی سفارش ادامه دهید.',
            )
          }
          // شکستِ واقعی چک‌اوت (قبل از commit) — تصرف آزاد شود تا تلاش مجدد ممکن باشد
          if (idemKey) await deps.idempotency.release(user.id, idemKey)
          throw e
        }

        if (idemKey) {
          await deps.idempotency.complete(user.id, idemKey, response)
        }
        return response
      },
      {
        body: t.Object({
          items: t.Array(cartItemSchema, { minItems: 1, maxItems: 100 }),
          deliveryType: deliveryTypeSchema,
          useWallet: t.Boolean(),
          addressId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
          customerNote: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
          couponCode: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
          gatewayId: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        }),
        detail: {
          summary: 'Checkout — server-priced order + payment initiation (idempotent)',
          description:
            'All pricing server-side (size/discount/coupon/zone-aware delivery fee). Wallet-only orders settle instantly. Idempotency-Key header (UUID per purchase intent) is required (stage-55) — network retries never create a second order; the claim lives in the database (atomic composite PK), independent of Redis. Response is replayed for 48h per key.',
        },
      },
    )

    // phase-2 — پیش‌نمایش چک‌اوت: قیمت زنده‌ی سرور بدون ثبت سفارش
    .post(
      '/checkout/preview',
      async ({ user, body }) => {
        // phase-fix: سقف هر کاربر — ۴۵ در دقیقه (ضد brute-force کد تخفیف)
        await perUserLimit(user.id, 'checkout-preview', 45, 60)
        return deps.orders.preview(user.id, body)
      },
      {
        body: t.Object({
          items: t.Array(cartItemSchema, { minItems: 1, maxItems: 100 }),
          deliveryType: deliveryTypeSchema,
          useWallet: t.Boolean(),
          addressId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
          couponCode: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
        }),
        detail: {
          summary: 'Checkout preview — live server pricing, no order created',
          description:
            'Same pricing as checkout (sizes/discount/coupon validation/zone fee/packaging/wallet) but read-only. couponCode is validated but never reserved.',
        },
      },
    )

    .get('/', ({ user }) => deps.orders.myOrders(user.id), {
      detail: { summary: 'My orders (newest first, with items)' },
    })

    .get(
      '/:displayId',
      ({ user, params }) => deps.orders.byDisplayId(user.id, params.displayId),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        detail: { summary: 'Order detail (owner only)' },
      },
    )

    .post(
      '/:displayId/deliver',
      ({ user, params }) => deps.orders.confirmDelivery(user.id, params.displayId),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        detail: { summary: 'Customer confirms delivery → DELIVERED' },
      },
    )

    .get(
      '/:displayId/tracking',
      ({ user, params }) => deps.orders.tracking(user.id, params.displayId),
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        detail: {
          summary: 'Live-tracking flag for this order',
          description:
            'Snapshotted at checkout — orders placed before enabling never track.',
        },
      },
    )

    /** فاکتور چاپی — kitchen | sales — JSON ساختاریافته برای رندر/چاپ فرانت */
    .get(
      '/:displayId/invoice',
      ({ user, params, query }) => {
        if (!isDisplayId(params.displayId)) throw Err.notFound('سفارش پیدا نشد.')
        return deps.orders.byDisplayId(user.id, params.displayId).then((order) => {
          if (query.type === 'kitchen') {
            return {
              type: 'kitchen' as const,
              orderId: order.id,
              date: order.date,
              items: order.items.map((i) => ({ name: i.name, sizeName: i.sizeName, quantity: i.quantity })),
            }
          }
          return {
            type: 'sales' as const,
            orderId: order.id,
            date: order.date,
            items: order.items,
            breakdown: order.breakdown,
            customerNote: order.customerNote,
          }
        })
      },
      {
        params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
        query: t.Object({ type: t.Union([t.Literal('kitchen'), t.Literal('sales')]) }),
        detail: {
          summary: 'Invoice for printing — kitchen or sales',
          description: 'Structured JSON; frontend renders and prints (owner only).',
        },
      },
    )
}