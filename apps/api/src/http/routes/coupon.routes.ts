// ═══════════════════════════════════════════════════════════════
// stage-66 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/coupon.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ① maxPerUser در body ساخت/ویرایش (سقف مصرف به‌ازای کاربر —
//        سیاست ۱؛ این روت‌ها فقط با گارد requireAdmin = ادمین اصلی)
//        ② کد broadcast حالا مثل DB نرمال می‌شود (قبلاً «sin66» خام در
//        اعلان می‌رفت ولی «SIN66» ذخیره می‌شد)
//        ③ قرارداد عمومی⇔بدون‌شرط/خصوصی⇔حداقل‌یک‌شرط در سرویس گارد
//        می‌شود؛ OpenAPI همان را مستند می‌کند.
// ═══════════════════════════════════════════════════════════════

// stage-65 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/coupon.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر:
//   ① سوییچ «کوپن بی‌صدا» (announceSuppressed — پیش‌فرض خاموش):
//     ادمین اصلی می‌تواند هنگام ساخت، اعلان broadcast همان کوپن را
//     ممنوع کند. فقط ساختِ «عمومی» اعلان می‌گیرد (سیاست stage-64) و
//     این سوییچ همان یک اعلان را خاموش می‌کند.
//   ② GET /:id/consumers — مصرف‌کنندگان واقعی (redemptions) برای
//     صفحه‌ی اختصاصی کوپن؛ صفحه‌بندی سروری.
//   ③ DELETE = حذف واقعی (hard) + پاک شدن تاریخچه‌ی مصرف با cascade؛
//     غیرفعال‌سازی نرم به PATCH /:id/status (body.active=false) رفت.
//
// stage-64 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/coupon.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: «اعلان کوپن» — ساخت کوپنِ عمومی (isPublic=true) حالا به‌علاوه‌ی
//        درج DB، یک broadcast نوع coupon هم می‌فرستد (ماتریس تست کارفرما:
//        «ساخت/انتشار کوپن ⇒ اطلاعیه طبق سیاست اعلان، نه فقط درج»).
//        سیاست: فقط «عمومی» در «ساخت» اعلان می‌شود — کد عمومی از ابتدا
//        برای اشتراک‌گذاری است. کوپن خصوصی اعلان عمومی نمی‌گیرد (کد فقط
//        به هدف‌یابی‌شده‌ها می‌رسد — اعلام عمومی یعنی لو رفتن کد)؛ ویرایش/
//        فعال‌سازی مجدد هم اعلان نمی‌گیرد (اسپم می‌شد). فرستنده = system.
//
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/coupon.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: cronEnabled — سوییچ عضویت کوپن در فرآیند کرون‌جاب
//        (اسکن شایستگی + یادآور). پیش‌فرض خاموش.
// ═══════════════════════════════════════════════════════════

// src/http/routes/coupon.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { CouponService } from '#/domain/coupon/coupon.service'
import type { AuditService } from '#/domain/audit/audit.service'
import type { NotificationService } from '#/domain/notification/notification.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { UUID_PATTERN } from '#/domain/shared/ids'


const CONDITION_TYPES = [
  'MIN_ORDERS_COUNT', 'MIN_TOTAL_SPEND', 'MIN_PRODUCT_ORDERS', 'MIN_CATEGORY_ORDERS',
  'REGISTERED_DAYS_AGO', 'MIN_REFERRALS', 'MIN_REFERRAL_ORDERS', 'MIN_REFERRAL_SPEND',
  'ORDERS_IN_LAST_DAYS',
] as const

/** phase-5: قرارداد فرانت (CouponRule: value/quantity) → params ارزیابها
 *  stage-47 — MIN_PRODUCT_ORDERS / MIN_CATEGORY_ORDERS: quantity=0 (یا
 *  نیامدن) یعنی «خرید صفر» — ارزیاب bought >= 0 → همیشه برقرار →
 *  کوپن بدون نیاز به خرید قبلی فعال می‌شود. quantity>=1 = حداقل خرید. */
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
      return { days: n, count: Math.max(1, quantity ?? 1) }
    case 'MIN_PRODUCT_ORDERS':
      return { productId: String(value), count: Math.max(0, quantity ?? 0) }
    case 'MIN_CATEGORY_ORDERS':
      return { categoryId: String(value), count: Math.max(0, quantity ?? 0) }
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
  // stage-47 — 0 مجاز: «خرید صفر» (فعال بدون خرید قبلی) برای شرط‌های محصول/دسته
  quantity: t.Optional(t.Numeric({ minimum: 0, maximum: 100000 })),
})

const couponBody = t.Object({
  code: t.String({ minLength: 3, maxLength: 16 }),
  title: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
  discountPercentage: t.Number({ minimum: 1, maximum: 99 }),
  maxUses: t.Number({ minimum: 0, maximum: 1000000 }),
  /** stage-66 (سیاست ۱) — سقف مصرف به‌ازای هر کاربر برای کوپن عمومی؛ ۰ = نامحدود (پیش‌فرض) */
  maxPerUser: t.Optional(t.Number({ minimum: 0, maximum: 1000000 })),
  isPublic: t.Boolean(),
  expiryDate: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
  rules: t.Array(ruleSchema, { maxItems: 10 }),
  /** stage-48 — ورود به فرآیند کرون‌جاب کوپن‌ها (پیش‌فرض خاموش) */
  cronEnabled: t.Optional(t.Boolean()),
  /** stage-65 — ممنوعیت اعلان انتشار ساخت (پیش‌فرض خاموش = اعلان می‌رود) */
  announceSuppressed: t.Optional(t.Boolean()),
})

export interface CouponRoutesDeps {
  sessions: SessionService
  coupons: CouponService
  /** stage-10: لاگ ممیزی — عملیات کوپن ادمین اصلی */
  audit: AuditService
  /** stage-64 — اعلان broadcast برای کوپن عمومیِ تازه‌ساخت */
  notifications: NotificationService
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

    // ── stage-65: مصرف‌کنندگان واقعی کوپن — تاریخچه‌ی redemption ──
    .get(
      '/:id/consumers',
      ({ params, query }) =>
        deps.coupons.consumers(params.id, query.page ?? 1, query.limit ?? 20),
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        query: t.Object({
          page: t.Optional(t.Numeric({ minimum: 1, maximum: 10000 })),
          limit: t.Optional(t.Numeric({ minimum: 5, maximum: 100 })),
        }),
        detail: {
          summary: 'Coupon consumers — redemption history (paginated, newest first)',
          description:
            'Real redemptions (coupon_redemptions) joined with users + order displayId. Public and private coupons both included. 404 if coupon is deleted.',
        },
      },
    )

    .post(
      '/',
      async ({ body, user }) => {
        // stage-66 — کد یک‌جا نرمال (همان قاعده‌ی سرویس) تا audit و broadcast
        // دقیقاً همان کدی را بگویند که در DB می‌نشیند (قبلاً broadcast کد خام
        // را می‌گفت: «sin66» در اعلان، «SIN66» در دیتابیس).
        const code = body.code.trim().toUpperCase().slice(0, 16)
        const res = await deps.coupons.create({
          code,
          title: body.title ?? null,
          discountPercentage: body.discountPercentage,
          maxUses: body.maxUses,
          // stage-66 (سیاست ۱) — سقف per-user (نیامد = ۰ = نامحدود)
          maxPerUser: body.maxPerUser ?? 0,
          isPublic: body.isPublic,
          expiryDate: body.expiryDate ?? null,
          cronEnabled: body.cronEnabled ?? false,
          // stage-65 — سوییچ «کوپن بی‌صدا» (پیش‌فرض خاموش = اعلان ساخت می‌رود)
          announceSuppressed: body.announceSuppressed ?? false,
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
          metadata: { code, discount: body.discountPercentage },
        })
        // stage-64 — اعلانِ ساختِ کوپنِ «عمومی»: کد از ابتدا برای همه است،
        // پس همه باید خبردار شوند (سیاست اعلان — سربرگ فایل). کوپن خصوصی
        // اعلان نمی‌گیرد؛ ویرایش/فعال‌سازی مجدد هم نه. فایر-اند-فورگت +
        // خودِ broadcast هرگز throw نمی‌کند — ساخت کوپن هرگز گیر اعلان
        // نمی‌کند؛ مقصد کلیک /products (کد در چک‌اوت زده می‌شود).
        // stage-65 — سوییچ «کوپن بی‌صدا»: announceSuppressed=true یعنی
        // همین یک اعلان هم نمی‌رود (خواسته‌ی صریح کارفرما؛ پیش‌فرض خاموش).
        if (res.success && body.isPublic && !(body.announceSuppressed ?? false)) {
          void deps.notifications
            .broadcast({
              type: 'coupon',
              title: '🎁 کد تخفیف جدید!',
              body: `کد «${code}» با ٪${body.discountPercentage} تخفیف فعال شد — در چک‌اوت واردش کنید.`,
              url: '/products',
              data: { code, discount: body.discountPercentage },
            })
            .catch(() => { /* ضد-کرش دوبل — قانون طلایی */ })
        }
        return res
      },
      {
        body: couponBody,
        detail: {
          summary:
            'Create coupon (contract: value/quantity; public + not suppressed ⇒ broadcast announcement)',
          description:
            'stage-66: public coupons carry no rules and private coupons need at least one (422 otherwise, enforced in service). maxPerUser caps redemptions per user on public coupons (0 = unlimited default). The broadcast body uses the normalized code (uppercased/trimmed) exactly as stored.',
        },
      },
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
          // stage-66 (سیاست ۱) — سقف per-user (نیامد = دست‌نخورده)
          maxPerUser: body.maxPerUser,
          isPublic: body.isPublic,
          expiryDate: body.expiryDate ?? null,
          cronEnabled: body.cronEnabled,
          // stage-65 — سوییچ «کوپن بی‌صدا» (نیامد = دست‌نخورده)
          announceSuppressed: body.announceSuppressed,
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

    // ── stage-65: حذف واقعی — ردیف + تاریخچه‌ی مصرف (cascade) ──
    // غیرفعال‌سازی نرم (برگشت‌پذیر) = PATCH /:id/status با active=false.
    .delete(
      '/:id',
      async ({ params, user }) => {
        const res = await deps.coupons.remove(params.id)
        await deps.audit.log({
          actorId: user.id,
          action: 'COUPON_DELETE',
          entity: 'coupon',
          entityId: params.id,
        })
        return res
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: {
          summary: 'Hard-delete coupon + purge consumer history',
          description:
            'Irreversible. Deletes the coupon row; conditions, grants, redemptions and nudges cascade away (consumer history purged from DB). Orders keep their money rows/breakdown — their coupon link is nulled in the same transaction. In-flight PENDING_PAYMENT orders settle safely (settle skips redemption when coupon is gone). For a reversible off, use PATCH /:id/status with active=false instead.',
        },
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